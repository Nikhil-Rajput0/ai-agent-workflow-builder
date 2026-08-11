const { gqlAdmin } = require("./lib/db");
const { getUserRoleInOrg, ForbiddenError, NotFoundError } = require("./lib/auth");
const { executeWorkflow } = require("./triggerWorkflowRun");

/**
 * Hasura Action handler for `approveStep(step_run_id, approve)`.
 *
 * This is the enforcement point for Layer 2b: clearing an approval_gate.
 * It cannot be a database permission because it's a mid-execution
 * decision (does this specific paused run get to continue?), not a
 * simple row read/write - so the role check happens here, in code,
 * before the run is ever resumed.
 */
module.exports = async function handler(req, res) {
  try {
    const { step_run_id, approve } = req.body.input;
    const sessionVars = req.body.session_variables ?? {};
    const userId = sessionVars["x-hasura-user-id"];
    if (!userId) throw new ForbiddenError("Missing session");

    const data = await gqlAdmin(
      `query ($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id workflow_run_id status
          workflow_step { position workflow_id }
          workflow_run { org_id context }
        }
      }`,
      { id: step_run_id }
    );
    const stepRun = data.step_runs_by_pk;
    if (!stepRun) throw new NotFoundError("Step run not found");
    if (stepRun.status !== "paused") throw new ForbiddenError("This step is not awaiting approval");

    // ---- Layer 2b: only owner/editor in the SAME org may approve ----
    const role = await getUserRoleInOrg(userId, stepRun.workflow_run.org_id);
    if (!role || !["owner", "editor"].includes(role)) {
      throw new ForbiddenError("Only an owner or editor in this workflow's org may approve this step");
    }

    if (!approve) {
      await gqlAdmin(
        `mutation ($id: uuid!) {
          update_step_runs_by_pk(pk_columns: { id: $id }, _set: { status: failed, error: "Rejected by approver" }) { id }
        }`,
        { id: step_run_id }
      );
      await gqlAdmin(
        `mutation ($id: uuid!) {
          update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: failed }) { id }
        }`,
        { id: stepRun.workflow_run_id }
      );
      return res.json({ workflow_run_id: stepRun.workflow_run_id, step_run_id, status: "failed", message: "Rejected" });
    }

    await gqlAdmin(
      `mutation ($id: uuid!, $userId: uuid!) {
        update_step_runs_by_pk(pk_columns: { id: $id }, _set: {
          status: succeeded, approved_by: $userId, approved_at: "now()", finished_at: "now()"
        }) { id }
      }`,
      { id: step_run_id, userId }
    );
    await gqlAdmin(
      `mutation ($id: uuid!) { update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: running }) { id } }`,
      { id: stepRun.workflow_run_id }
    );

    const result = await executeWorkflow(
      stepRun.workflow_step.workflow_id,
      stepRun.workflow_run.org_id,
      stepRun.workflow_run_id,
      stepRun.workflow_step.position + 1,
      stepRun.workflow_run.context ?? {}
    );

    return res.json({
      workflow_run_id: stepRun.workflow_run_id,
      step_run_id,
      status: result.status,
      message: result.message,
    });
  } catch (err) {
    const status = err.status ?? 500;
    return res.status(status).json({ message: err.message ?? "Internal error" });
  }
};

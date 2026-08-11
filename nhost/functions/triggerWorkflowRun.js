const { gqlAdmin } = require("./lib/db");
const { getUserRoleInOrg, ForbiddenError, NotFoundError } = require("./lib/auth");
const { assertQuotaAvailable, incrementQuotaUsage } = require("./lib/quota");
const { executeStep } = require("./lib/stepExecutors");

/**
 * Hasura Action handler for `triggerWorkflowRun(workflow_id)`.
 *
 * 1. Verifies the caller is owner/editor in the workflow's org (Layer 1,
 *    re-checked in code since Actions run with the admin secret).
 * 2. Checks the org's quota isn't exhausted.
 * 3. Creates the workflow_run, then executes steps in order.
 * 4. On approval_gate: pauses the run and stops - approveStep resumes it.
 * 5. Updates step_runs / workflow_run throughout so the subscription
 *    reflects progress live.
 * 6. Increments quota usage on completion.
 */
module.exports = async function handler(req, res) {
  try {
    const { workflow_id } = req.body.input;
    const sessionVars = req.body.session_variables ?? {};
    const userId = sessionVars["x-hasura-user-id"];
    if (!userId) throw new ForbiddenError("Missing session");

    const wfData = await gqlAdmin(
      `query ($id: uuid!) { workflows_by_pk(id: $id) { id org_id } }`,
      { id: workflow_id }
    );
    const workflow = wfData.workflows_by_pk;
    if (!workflow) throw new NotFoundError("Workflow not found");

    // ---- Layer 1: org + role check, done explicitly in code ----
    const role = await getUserRoleInOrg(userId, workflow.org_id);
    if (!role || !["owner", "editor"].includes(role)) {
      throw new ForbiddenError("Only an owner or editor in this workflow's org may trigger a run");
    }

    await assertQuotaAvailable(workflow.org_id);

    const run = await createRun(workflow.id, workflow.org_id, userId, "manual");

    const result = await executeWorkflow(workflow.id, workflow.org_id, run.id);

    return res.json({
      workflow_run_id: run.id,
      status: result.status,
      message: result.message,
    });
  } catch (err) {
    const status = err.status ?? 500;
    return res.status(status).json({ message: err.message ?? "Internal error" });
  }
};

async function createRun(workflowId, orgId, userId, triggerType) {
  const data = await gqlAdmin(
    `mutation ($workflowId: uuid!, $orgId: uuid!, $userId: uuid, $triggerType: trigger_type!) {
      insert_workflow_runs_one(object: {
        workflow_id: $workflowId, org_id: $orgId, triggered_by: $userId,
        trigger_type: $triggerType, status: running
      }) { id }
    }`,
    { workflowId, orgId, userId, triggerType }
  );
  return { id: data.insert_workflow_runs_one.id };
}

/**
 * Runs (or resumes) a workflow_run's steps in order, starting from
 * `fromPosition`. Shared by triggerWorkflowRun, approveStep (resume),
 * scheduledRunner and eventTrigger.
 */
async function executeWorkflow(workflowId, orgId, runId, fromPosition = 0, priorContext = {}) {
  const stepsData = await gqlAdmin(
    `query ($workflowId: uuid!) {
      workflow_steps(where: { workflow_id: { _eq: $workflowId } }, order_by: { position: asc }) {
        id position type name config
      }
    }`,
    { workflowId }
  );
  const steps = stepsData.workflow_steps;
  const context = { ...priorContext };
  let skipUntilPosition = -1;

  for (const step of steps) {
    if (step.position < fromPosition) continue;
    if (skipUntilPosition >= step.position) {
      await upsertStepRun(runId, step.id, orgId, "skipped", {}, { skipped: true });
      continue;
    }

    await setRunPosition(runId, step.position);
    const stepRunId = await upsertStepRun(runId, step.id, orgId, "running", context.previousInput ?? {});

    if (step.type === "approval_gate") {
      await updateStepRun(stepRunId, { status: "paused" });
      await updateRunStatus(runId, "paused");
      return { status: "paused", message: `Awaiting approval on step "${step.name}"` };
    }

    try {
      const result = await executeStep(step.type, step.config, { orgId, workflowRunId: runId, context });
      await updateStepRun(stepRunId, { status: "succeeded", output: result.output, finished_at: true });
      context[`step_${step.position}`] = result.output;
      context.previous = result.output;

      if (step.type === "conditional_branch" && result.branchTaken === "else") {
        const skipCount = Number(step.config?.else_skip_next ?? 0);
        skipUntilPosition = step.position + skipCount;
      }
    } catch (err) {
      await updateStepRun(stepRunId, { status: "failed", error: String(err.message ?? err), finished_at: true });
      await updateRunStatus(runId, "failed");
      return { status: "failed", message: `Step "${step.name}" failed: ${err.message}` };
    }
  }

  await updateRunStatus(runId, "succeeded");
  await incrementQuotaUsage(orgId, 1);
  return { status: "succeeded" };
}

async function setRunPosition(runId, position) {
  await gqlAdmin(
    `mutation ($id: uuid!, $pos: Int!) {
      update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { current_step_position: $pos }) { id }
    }`,
    { id: runId, pos: position }
  );
}

async function updateRunStatus(runId, status) {
  const finished = ["succeeded", "failed", "cancelled"].includes(status);
  await gqlAdmin(
    `mutation ($id: uuid!, $status: run_status!, $finishedAt: timestamptz) {
      update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: $status, finished_at: $finishedAt }) { id }
    }`,
    { id: runId, status, finishedAt: finished ? new Date().toISOString() : null }
  );
}

async function upsertStepRun(runId, stepId, orgId, status, input, extra = {}) {
  const data = await gqlAdmin(
    `mutation ($runId: uuid!, $stepId: uuid!, $orgId: uuid!, $status: step_run_status!, $input: jsonb!, $output: jsonb) {
      insert_step_runs_one(object: {
        workflow_run_id: $runId, workflow_step_id: $stepId, org_id: $orgId,
        status: $status, input: $input, output: $output,
        started_at: "now()", attempt_count: 1
      }) { id }
    }`,
    { runId, stepId, orgId, status, input, output: extra ?? null }
  );
  return data.insert_step_runs_one.id;
}

async function updateStepRun(stepRunId, fields) {
  await gqlAdmin(
    `mutation ($id: uuid!, $status: step_run_status!, $output: jsonb, $error: String, $finishedAt: timestamptz) {
      update_step_runs_by_pk(pk_columns: { id: $id }, _set: {
        status: $status, output: $output, error: $error, finished_at: $finishedAt
      }) { id }
    }`,
    {
      id: stepRunId,
      status: fields.status,
      output: fields.output ?? null,
      error: fields.error ?? null,
      finishedAt: fields.finished_at ? new Date().toISOString() : null,
    }
  );
}

module.exports.createRun = createRun;
module.exports.executeWorkflow = executeWorkflow;

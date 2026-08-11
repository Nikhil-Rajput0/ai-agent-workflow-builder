const { gqlAdmin } = require("./lib/db");
const { createRun, executeWorkflow } = require("./triggerWorkflowRun");
const { assertQuotaAvailable } = require("./lib/quota");

/**
 * Plain (non-GraphQL) inbound endpoint for the Webhook trigger type.
 * External systems POST to /webhookTrigger/:trigger_id with the trigger's
 * webhook_secret (as a header) to start a run - no user session exists
 * here, so authentication is entirely via the per-trigger secret, which
 * is why webhook_secret is never exposed through the GraphQL API
 * (see tables.yaml select_permissions on workflow_triggers).
 *
 * Only an owner can attach a webhook trigger in the first place (Layer 2,
 * enforced at insert time in Hasura permissions) - this endpoint itself
 * doesn't need to re-check org role, since the secret IS the credential.
 */
module.exports = async function handler(req, res) {
  const triggerId = req.query.trigger_id;
  const providedSecret = req.headers["x-webhook-secret"];

  const data = await gqlAdmin(
    `query ($id: uuid!) {
      workflow_triggers_by_pk(id: $id) {
        id workflow_id webhook_secret is_active
        workflow { org_id }
      }
    }`,
    { id: triggerId }
  );
  const trigger = data.workflow_triggers_by_pk;

  if (!trigger || trigger.webhook_secret !== providedSecret || !trigger.is_active) {
    // Deliberately vague error so this can't be used to enumerate/guess
    // valid trigger IDs or secrets.
    return res.status(401).json({ message: "invalid trigger or secret" });
  }

  try {
    await assertQuotaAvailable(trigger.workflow.org_id);
  } catch (err) {
    return res.status(409).json({ message: err.message });
  }

  const run = await createRun(trigger.workflow_id, trigger.workflow.org_id, null, "webhook");
  // Execute inline for the demo; a production version would enqueue this.
  const result = await executeWorkflow(trigger.workflow_id, trigger.workflow.org_id, run.id);

  return res.json({ workflow_run_id: run.id, status: result.status });
};

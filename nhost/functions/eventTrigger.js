const { gqlAdmin } = require("./lib/db");
const { createRun, executeWorkflow } = require("./triggerWorkflowRun");
const { assertQuotaAvailable } = require("./lib/quota");

/**
 * Receives Hasura Event Trigger payloads fired on INSERT into
 * `external_events` (our stand-in "watched table"). Looks up any active
 * `database_event` workflow_triggers whose watch_table matches the row's
 * table_name and org, and starts a run for each - this is the
 * Database event trigger type.
 */
module.exports = async function handler(req, res) {
  const secret = req.headers["x-webhook-secret"];
  if (secret !== process.env.EVENT_TRIGGER_SECRET) {
    return res.status(401).json({ message: "invalid webhook secret" });
  }

  const event = req.body.event;
  if (event?.op !== "INSERT") return res.json({ ok: true, skipped: true });

  const row = event.data.new;

  const data = await gqlAdmin(
    `query ($tableName: String!, $orgId: uuid!) {
      workflow_triggers(where: {
        type: { _eq: database_event }, is_active: { _eq: true },
        watch_table: { _eq: $tableName },
        workflow: { org_id: { _eq: $orgId } }
      }) {
        id workflow_id watch_table
        workflow { org_id }
      }
    }`,
    { tableName: row.table_name, orgId: row.org_id }
  );

  const started = [];
  for (const trigger of data.workflow_triggers) {
    try {
      await assertQuotaAvailable(trigger.workflow.org_id);
      const run = await createRun(trigger.workflow_id, trigger.workflow.org_id, null, "database_event");
      await executeWorkflow(trigger.workflow_id, trigger.workflow.org_id, run.id);
      started.push(run.id);
    } catch (err) {
      console.error(`eventTrigger: failed to start workflow ${trigger.workflow_id}`, err);
    }
  }

  return res.json({ started_runs: started });
};

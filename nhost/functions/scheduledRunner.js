const cronParser = require("cron-parser");
const { gqlAdmin } = require("./lib/db");
const { createRun, executeWorkflow } = require("./triggerWorkflowRun");
const { assertQuotaAvailable } = require("./lib/quota");

/**
 * Invoked every minute by a Hasura cron trigger. Finds every active
 * `scheduled` workflow_trigger whose cron_schedule is due "now" and
 * starts a run for it - this is the Scheduled trigger type.
 */
module.exports = async function handler(_req, res) {
  const now = new Date();
  const data = await gqlAdmin(
    `query {
      workflow_triggers(where: { type: { _eq: scheduled }, is_active: { _eq: true } }) {
        id workflow_id cron_schedule
        workflow { org_id }
      }
    }`
  );

  const started = [];
  for (const trigger of data.workflow_triggers) {
    if (!trigger.cron_schedule) continue;
    if (!isDueThisMinute(trigger.cron_schedule, now)) continue;

    try {
      await assertQuotaAvailable(trigger.workflow.org_id);
      const run = await createRun(trigger.workflow_id, trigger.workflow.org_id, null, "scheduled");
      // fire-and-forget style execution, same engine as manual trigger
      await executeWorkflow(trigger.workflow_id, trigger.workflow.org_id, run.id);
      started.push(run.id);
    } catch (err) {
      // quota exhausted or execution error - skip this trigger this minute
      console.error(`scheduledRunner: failed to start workflow ${trigger.workflow_id}`, err);
    }
  }

  return res.json({ started_runs: started });
};

function isDueThisMinute(cronExpr, now) {
  try {
    const interval = cronParser.parseExpression(cronExpr, { currentDate: new Date(now.getTime() - 1000) });
    const next = interval.next().toDate();
    return next.getUTCFullYear() === now.getUTCFullYear() &&
      next.getUTCMonth() === now.getUTCMonth() &&
      next.getUTCDate() === now.getUTCDate() &&
      next.getUTCHours() === now.getUTCHours() &&
      next.getUTCMinutes() === now.getUTCMinutes();
  } catch {
    return false;
  }
}

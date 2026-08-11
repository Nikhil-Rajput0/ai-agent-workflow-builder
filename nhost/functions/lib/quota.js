const { gqlAdmin } = require("./db");
const { ConflictError } = require("./auth");

async function assertQuotaAvailable(orgId) {
  const data = await gqlAdmin(
    `query ($orgId: uuid!) {
      organizations_by_pk(id: $orgId) { quota_calls_used quota_calls_allowed }
    }`,
    { orgId }
  );
  const org = data.organizations_by_pk;
  if (!org) throw new ConflictError("Organization not found");
  if (org.quota_calls_used >= org.quota_calls_allowed) {
    throw new ConflictError("Organization quota exhausted for this period");
  }
}

async function incrementQuotaUsage(orgId, amount = 1) {
  await gqlAdmin(
    `mutation ($orgId: uuid!, $amount: Int!) {
      update_organizations_by_pk(pk_columns: { id: $orgId }, _inc: { quota_calls_used: $amount }) { id }
    }`,
    { orgId, amount }
  );
}

module.exports = { assertQuotaAvailable, incrementQuotaUsage };

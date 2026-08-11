const { gqlAdmin } = require("./db");

/**
 * Layer 1 check, done in code (not just relying on Hasura permissions),
 * because Actions run with the admin secret and therefore bypass row
 * permissions entirely - so the handler is the only thing standing
 * between "any authenticated user" and "every org's data" here.
 */
async function getUserRoleInOrg(userId, orgId) {
  const data = await gqlAdmin(
    `query ($userId: uuid!, $orgId: uuid!) {
      org_members(where: { user_id: { _eq: $userId }, org_id: { _eq: $orgId } }, limit: 1) {
        role
      }
    }`,
    { userId, orgId }
  );
  return data.org_members[0]?.role ?? null;
}

function extractUserId(headers) {
  const raw = headers["x-hasura-user-id"] ?? headers["X-Hasura-User-Id"];
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] : raw;
}

class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.status = 403;
  }
}
class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.status = 404;
  }
}
class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
  }
}

module.exports = { getUserRoleInOrg, extractUserId, ForbiddenError, NotFoundError, ConflictError };

// Thin GraphQL client that talks to Hasura using the admin secret.
// Functions run server-side and are trusted to bypass row permissions -
// that's exactly why every function does its own explicit role/org check
// before writing anything (see auth.js).

const HASURA_URL = process.env.NHOST_GRAPHQL_URL || process.env.HASURA_GRAPHQL_URL;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET;

async function gqlAdmin(query, variables = {}) {
  const res = await fetch(HASURA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

module.exports = { gqlAdmin };

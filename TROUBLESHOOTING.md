# Local Dev Troubleshooting

Real issues hit while standing this project up locally on Windows/WSL2, and how they were fixed.

## Windows requires WSL2
The `nhost` CLI ships Linux/macOS binaries only. On Windows, everything (CLI, Docker, Node) must run inside WSL2 Ubuntu, not native PowerShell.

## Wrong npm package
`npm install -g nhost` installs an unrelated old package. The real CLI is `@nhost/cli`:
```bash
npm uninstall -g nhost
npm install -g @nhost/cli
```

## Local URLs are not localhost:1337
Modern `@nhost/cli` (`nhost up`) serves everything over HTTPS on `*.local.nhost.run` subdomains with a self-signed cert, e.g.:
- `https://local.graphql.local.nhost.run`
- `https://local.auth.local.nhost.run`
- `https://local.functions.local.nhost.run`

Frontend `.env.local` must use:
NEXT_PUBLIC_NHOST_SUBDOMAIN=local
NEXT_PUBLIC_NHOST_REGION=local

You must manually visit each `*.local.nhost.run` subdomain once per browser and accept the self-signed cert warning, or background `fetch()` calls fail silently as generic "Network Error".

## New sign-ups aren't verified by default
Local Auth requires email verification, but there's no real mail service wired up. After each sign-up, manually check "Verified" for that user in the Nhost dashboard (Auth → Users) or sign-in will fail/hang.

## Migrations can silently fail to apply
`nhost up` may report "nothing to apply" even when the target database has zero tables (a mismatch between the tracked "default" vs actual "local" database name in some CLI versions). If `\dt` on the `local` database shows no tables, apply the migration directly:
```bash
psql "postgres://postgres:postgres@localhost:5432/local" -f migrations/default/1700000000000_init/up.sql
```

## ⚠️ `nhost up` / `nhost down` resets Hasura metadata
This is the single biggest gotcha of the whole session. Restarting nhost re-applies nhost's own cached metadata snapshot, silently overwriting relationships/permissions/actions defined in this repo's `nhost/metadata/`. Symptom: GraphQL queries that worked before suddenly fail with `field 'x' not found in type 'y'`.

**Standing rule: after every `nhost up`, immediately run:**
```bash
cd nhost
hasura metadata apply --skip-update-check
hasura metadata ic list   # must say "metadata is consistent"
```
This requires the standalone Hasura CLI (different from `@nhost/cli`):
```bash
curl -L https://github.com/hasura/graphql-engine/raw/stable/cli/get.sh | bash
```
and a `nhost/config.yaml`:
```yaml
version: 3
endpoint: https://local.hasura.local.nhost.run
admin_secret: <your admin secret>
metadata_directory: metadata
```

## Hasura rejects `HASURA_GRAPHQL_*` in action/cron headers
Newer Hasura blocks forwarding `HASURA_GRAPHQL_*` env vars as webhook headers (security hardening). Remove any `headers: - name: x-hasura-admin-secret / value_from_env: HASURA_GRAPHQL_ADMIN_SECRET` blocks from `actions.yaml` and `cron_triggers.yaml` — functions already read the admin secret from their own env, they don't need Hasura to forward it.

## `nhost/.env` isn't reliably read by function containers for metadata `_from_env` refs
Env vars referenced via `value_from_env`/`webhook_from_env` inside Hasura metadata (event triggers, cron triggers) weren't resolving even when present in `nhost/.env`. Workaround used here: hardcode those specific URLs/secrets directly in `tables.yaml`/`cron_triggers.yaml` instead of `_from_env` indirection, since they're local-dev-only values anyway.

## Functions container needs its own node_modules, freshly installed
```bash
cd nhost/functions
rm -rf node_modules package-lock.json
npm install
```
then `nhost down && nhost up` to remount. If `functions/package.json` ever looks truncated/empty after an install, rewrite it from scratch — this happened once, cause unconfirmed.

## Functions router does not support dynamic path segments
`nhost`'s function runtime uses file-based routing — `webhookTrigger.js` only ever serves the literal path `/webhookTrigger`, never `/webhookTrigger/:id`. Pass dynamic values via query string instead:

POST /v1/webhookTrigger?trigger_id=<uuid>
(not `/v1/webhookTrigger/<uuid>`), and read it in the handler via `req.query.trigger_id` instead of `req.params.trigger_id`.

## External function URLs need a `/v1` prefix
Traefik only proxies to the functions container for paths under `/v1/*` (and strips that prefix before forwarding). So:
- Internal (inside container): `http://localhost:3000/triggerWorkflowRun`
- External (what everything else must use): `https://local.functions.local.nhost.run/v1/triggerWorkflowRun`

`nhost/.env`'s `NHOST_FUNCTIONS_URL` must include `/v1`.

## Frontend bugs fixed along the way
- `useEffect`-based redirects, not bare `router.push()` calls during render (React warns/errors otherwise)
- All hooks must be called unconditionally before any early `return` in a component
- `useAuthenticationStatus()` should gate (`pause:`) data queries, since firing a query before the session restores from storage returns an empty/cached result that urql then serves forever
- `MY_MEMBERSHIPS` must filter `where: { user_id: { _eq: $userId } }` — otherwise it returns every member's row for a shared org, not just your own, causing duplicate React keys
- `ADD_TRIGGER`'s mutation must not select `webhook_secret` back in the response — it's intentionally excluded from user-facing select permissions
- All buttons need explicit `type="button"` to prevent implicit form-submit/page-reload behavior

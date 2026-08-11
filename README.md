# AI Agent Workflow Builder

A mini n8n purpose-built for chaining AI agent steps, built on **nhost + Hasura + PostgreSQL + GraphQL**, with a **Next.js 16** frontend.

> Note on scope: this repo was written outside a live nhost/Hasura environment (no network access
> in the environment that produced it), so it hasn't been deployed or click-tested end-to-end.
> Everything below — schema, migrations, Hasura metadata, Actions, and frontend — is complete and
> internally consistent, but treat first boot like any fresh clone: run migrations, apply metadata,
> and expect to iron out the normal config/env wrinkles (URLs, ports, package versions) before the
> Final Task walkthrough works live.

## Stack

- **nhost** — Postgres + Hasura + Auth + Storage + Functions, one CLI to run it all locally
- **Hasura GraphQL Engine** — schema tracking, relationships, permissions, Actions, subscriptions, event triggers, cron triggers
- **PostgreSQL** — schema in `nhost/migrations`
- **Next.js 16** (App Router, React 19, plain JavaScript/JSX — no TypeScript) — frontend, using `@nhost/nextjs` for auth and `urql` (+ `graphql-ws`) for queries/mutations/live subscriptions
- **nhost Functions** are also plain JavaScript (CommonJS `require`/`module.exports`), not TypeScript

## Repo layout

```
nhost/
  nhost.toml                     # project config
  migrations/default/…/up.sql    # full schema (tables, enums, view, helper fn)
  seeds/default/seed.sql         # Org A / Org B seed skeleton for the demo scenario
  metadata/
    databases/default/tables/tables.yaml   # tables, relationships, BOTH permission layers
    actions.yaml + actions.graphql         # triggerWorkflowRun, approveStep
    cron_triggers.yaml                     # scheduled-trigger scanner (runs every minute)
  functions/
    triggerWorkflowRun.js        # Action handler: the core orchestrator
    approveStep.js                # Action handler: resumes a paused approval_gate
    scheduledRunner.js            # cron-invoked: starts due `scheduled` triggers
    eventTrigger.js               # Hasura Event Trigger receiver: `database_event` triggers
    webhookTrigger.js             # plain inbound endpoint: `webhook` triggers
    lib/{db,auth,quota,stepExecutors}.js
frontend/
  app/page.jsx                   # sign in / sign up
  app/dashboard/page.jsx         # org switcher, quota, workflow list, create workflow
  app/workflows/[id]/page.jsx    # builder (steps/triggers), Run button, live status
  components/StepStatusList.jsx  # subscription-driven per-step progress + approve/reject
  lib/{nhost,graphql}.js
```

## How the two permission layers work

**Layer 1 — org + role scoping.** All data tables (`workflows`, `workflow_steps`,
`workflow_triggers`, `workflow_runs`, `step_runs`, …) carry (directly or via their parent
`workflow`) an `org_id`. Every Hasura permission filter traverses relationships down to
`org_members` and requires `org_members.user_id = X-Hasura-User-Id`, so a user only ever sees
rows belonging to orgs they're a member of — never by row id, never by relationship, regardless
of role. Within an org, `owner`/`editor`/`viewer` gates writes (see `tables.yaml`).

**Layer 2a — step-level type gating.** `db_write`, `notify`, and `webhook` triggers reach outside
the sandbox, so their `insert` permission check adds an extra clause requiring the caller be an
`owner` specifically, even though editors can insert every other step/trigger type. This is a
Hasura permission, since "which step type is this row" is a static check.

**Layer 2b — approval_gate resume.** This *can't* be a Hasura permission, because "should this
specific paused run resume" is a runtime decision, not a row check. `approveStep.ts` looks up the
caller's role in the run's org in code, rejects if not owner/editor, and only then flips the step
to `succeeded` and resumes execution from the next step. Regular users have **no** update
permission on `step_runs` at all — every write to it goes through the Action handlers running as
admin, which is exactly why those handlers re-verify org+role themselves rather than trusting the
caller.

## Local setup

> **Hit an error?** Check `TROUBLESHOOTING.md` first — it documents every real issue encountered getting this running locally, including a critical gotcha about `nhost up` resetting Hasura metadata.

1. **Install the nhost CLI** and start the backend:
   ```bash
   npm install -g nhost
   cd nhost
   nhost up
   ```
   This boots Postgres, Hasura, Auth, Storage, and Functions locally and applies
   `migrations/` + `metadata/` automatically.

2. **Environment variables** (nhost injects most of these into functions automatically; set the
   rest in `nhost/.secrets` or your Nhost Cloud project's env vars):
   ```
   HASURA_GRAPHQL_ADMIN_SECRET=<from nhost up output>
NHOST_GRAPHQL_URL=https://local.graphql.local.nhost.run/v1/graphql
NHOST_FUNCTIONS_URL=https://local.functions.local.nhost.run/v1
EVENT_TRIGGER_SECRET=<any random string>
LLM_API_KEY=<optional>
   LLM_API_KEY=<optional - Groq/OpenRouter/Gemini key; omitted = stubbed llm_call with disclosed delay>
   ```

3. **Frontend:**
   ```bash
   cd frontend
   cp .env.example .env.local   # fill in NEXT_PUBLIC_NHOST_SUBDOMAIN / _REGION (local)
   npm install
   npm run dev
   ```

4. **Seed the demo scenario:** sign up 4 users through the frontend (`orgA-owner`, `orgA-editor`,
   `orgA-viewer`, `orgB-owner`), then use their `auth.users.id` values to fill in
   `nhost/seeds/default/seed.sql` and run it (`nhost/scripts` in a real setup, or `psql` directly).

## Deploying

- Push `nhost/` to an Nhost Cloud project (`nhost deploy` or connect the GitHub repo in the Nhost
  dashboard) — migrations and metadata apply automatically.
- Deploy `frontend/` to Vercel, pointing `NEXT_PUBLIC_NHOST_SUBDOMAIN`/`NEXT_PUBLIC_NHOST_REGION`
  at the deployed Nhost project.

## Running the Final Task scenario

1. Sign in as `orgA-owner`. Create a workflow with an `llm_call` step, an `http_request` step, a
   `conditional_branch` step (referencing the llm_call's output), and an `approval_gate` step.
2. Add a `webhook` trigger (owner-only) — copy the returned `webhook_secret`.
3. Click **Run workflow** — watch live per-step status stream in via the subscription.
4. From another terminal, `POST` to `/webhookTrigger/<trigger_id>` with header
   `x-webhook-secret: <secret>` to start a second run without touching the UI.
5. When the run reaches the `approval_gate`, it shows **paused, awaiting approval** live; approve
   it as `orgA-owner` or `orgA-editor` to resume.
6. Sign in as `orgB-owner` and confirm Org A's workflows/runs are invisible — including by pasting
   Org A's workflow/run UUIDs directly into the GraphQL API (they resolve to nothing, since every
   permission filter is relationship-based, not id-based).

## What's stubbed / simplified for the assignment's scope

- `llm_call` falls back to a disclosed, artificially-delayed stub if `LLM_API_KEY` is unset.
- Step execution runs synchronously inside the Action/function invocation rather than via a job
  queue — fine for the assignment's step counts, but a real system would enqueue steps so a slow
  `http_request` doesn't hold an HTTP connection open.
- `db_write` writes into `external_events` as a generic "save a result" sink rather than a
  bespoke user-defined table.

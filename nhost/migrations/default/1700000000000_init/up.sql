-- =========================================================
-- AI Agent Workflow Builder — initial schema
-- =========================================================
create extension if not exists pgcrypto;

-- ---------- enums ----------
create type org_role as enum ('owner', 'editor', 'viewer');
create type step_type as enum ('llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate');
create type trigger_type as enum ('manual', 'webhook', 'scheduled', 'database_event');
create type run_status as enum ('pending', 'running', 'paused', 'succeeded', 'failed', 'cancelled');
create type step_run_status as enum ('pending', 'running', 'succeeded', 'failed', 'paused', 'skipped');

-- ---------- organizations ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quota_calls_allowed int not null default 1000,
  quota_calls_used int not null default 0,
  quota_period_start timestamptz not null default date_trunc('month', now()),
  created_at timestamptz not null default now()
);

-- ---------- org_members ----------
-- links auth.users (nhost's built-in users table) to an org with a role
create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index idx_org_members_user on org_members(user_id);
create index idx_org_members_org on org_members(org_id);

-- ---------- workflows ----------
create table workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_workflows_org on workflows(org_id);

-- ---------- workflow_steps ----------
create table workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  position int not null,
  type step_type not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workflow_id, position)
);
create index idx_steps_workflow on workflow_steps(workflow_id);

-- ---------- workflow_triggers ----------
create table workflow_triggers (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  type trigger_type not null,
  -- webhook secret used to authenticate inbound calls (never exposed to viewers)
  webhook_secret uuid default gen_random_uuid(),
  cron_schedule text,               -- e.g. '*/15 * * * *' for scheduled triggers
  watch_table text,                 -- for database_event triggers
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_triggers_workflow on workflow_triggers(workflow_id);

-- ---------- workflow_runs ----------
create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade, -- denormalized for fast/simple permission scoping
  status run_status not null default 'pending',
  triggered_by uuid references auth.users(id),   -- null for non-manual triggers
  trigger_type trigger_type not null default 'manual',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  current_step_position int not null default 0,
  context jsonb not null default '{}'::jsonb -- running "memory" passed between steps
);
create index idx_runs_workflow on workflow_runs(workflow_id);
create index idx_runs_org on workflow_runs(org_id);

-- ---------- step_runs ----------
create table step_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  workflow_step_id uuid not null references workflow_steps(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade, -- denormalized for permission scoping
  status step_run_status not null default 'pending',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  attempt_count int not null default 0,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);
create index idx_step_runs_run on step_runs(workflow_run_id);
create index idx_step_runs_org on step_runs(org_id);

-- ---------- external_events ----------
-- Stand-in "watched table": a row inserted here represents a write in
-- some external/business table. A Hasura Event Trigger fires on insert
-- and the eventTrigger function looks for matching database_event
-- workflow_triggers (by table_name) to auto-start runs.
create table external_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  table_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_external_events_org on external_events(org_id);

-- =========================================================
-- Aggregation: org-level usage view (this month) + avg run duration
-- =========================================================
create view org_usage_stats as
select
  o.id as org_id,
  o.quota_calls_allowed,
  o.quota_calls_used,
  o.quota_calls_used::float / greatest(o.quota_calls_allowed, 1) as usage_ratio,
  coalesce((
    select avg(extract(epoch from (wr.finished_at - wr.started_at)))
    from workflow_runs wr
    where wr.org_id = o.id and wr.finished_at is not null
  ), 0) as avg_run_duration_seconds,
  (
    select count(*) from workflow_runs wr2
    where wr2.org_id = o.id
      and wr2.started_at >= date_trunc('month', now())
  ) as runs_this_month
from organizations o;

-- helper function used by Hasura Actions / functions to check role for a user in an org
create or replace function fn_user_role_in_org(p_user_id uuid, p_org_id uuid)
returns org_role
language sql stable
as $$
  select role from org_members where user_id = p_user_id and org_id = p_org_id limit 1;
$$;

-- keep workflows.updated_at fresh
create or replace function fn_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_workflows_touch
before update on workflows
for each row execute function fn_touch_updated_at();

// All GraphQL documents used by the frontend, in one place.

// Returns the caller's own memberships (and therefore role) alongside
// each org's data - this is how the frontend knows whether to show the
// Run button, since viewers must never see it.
export const MY_MEMBERSHIPS = `
  query MyMemberships($userId: uuid!) {
    org_members(where: { user_id: { _eq: $userId } }) {
      role
      org {
        id
        name
        quota_calls_used
        quota_calls_allowed
      }
    }
  }
`;

// A workflow with its steps, triggers, and most-recent run status.
export const ORG_WORKFLOWS = `
  query OrgWorkflows($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      created_at
      workflow_steps(order_by: { position: asc }) {
        id
        position
        type
        name
        config
      }
      workflow_triggers {
        id
        type
        cron_schedule
        watch_table
        is_active
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
        finished_at
      }
    }
  }
`;

export const WORKFLOW_DETAIL = `
  query WorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      org_id
      workflow_steps(order_by: { position: asc }) {
        id
        position
        type
        name
        config
      }
      workflow_triggers {
        id
        type
        cron_schedule
        watch_table
        is_active
      }
      workflow_runs(order_by: { started_at: desc }, limit: 5) {
        id
        status
        started_at
        finished_at
        trigger_type
      }
    }
  }
`;

export const MY_ROLE_FOR_ORG = `
  query MyRoleForOrg($orgId: uuid!) {
    org_members(where: { org_id: { _eq: $orgId } }) {
      role
      user_id
    }
  }
`;

export const CREATE_WORKFLOW = `
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String, $createdBy: uuid!) {
    insert_workflows_one(object: { org_id: $orgId, name: $name, description: $description, created_by: $createdBy }) {
      id
    }
  }
`;

export const ADD_STEP = `
  mutation AddStep($workflowId: uuid!, $position: Int!, $type: step_type!, $name: String!, $config: jsonb!) {
    insert_workflow_steps_one(object: {
      workflow_id: $workflowId, position: $position, type: $type, name: $name, config: $config
    }) { id }
  }
`;

export const ADD_TRIGGER = `
  mutation AddTrigger($workflowId: uuid!, $type: trigger_type!, $cron: String, $watchTable: String) {
    insert_workflow_triggers_one(object: {
      workflow_id: $workflowId, type: $type, cron_schedule: $cron, watch_table: $watchTable
    }) { id }
  }
`;

export const TRIGGER_RUN = `
  mutation TriggerRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      workflow_run_id
      status
      message
    }
  }
`;

export const APPROVE_STEP = `
  mutation ApproveStep($stepRunId: uuid!, $approve: Boolean!) {
    approveStep(step_run_id: $stepRunId, approve: $approve) {
      workflow_run_id
      step_run_id
      status
      message
    }
  }
`;

// Live per-step progress for a run, including the paused/awaiting-approval state.
export const STEP_RUNS_SUBSCRIPTION = `
  subscription StepRuns($workflowRunId: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $workflowRunId } }, order_by: { started_at: asc }) {
      id
      status
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      finished_at
      workflow_step {
        position
        name
        type
      }
    }
  }
`;

export const RUN_STATUS_SUBSCRIPTION = `
  subscription RunStatus($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      status
      current_step_position
      finished_at
    }
  }
`;

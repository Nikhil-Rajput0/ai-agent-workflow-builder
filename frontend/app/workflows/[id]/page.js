"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "urql";
import { useUserId } from "@nhost/nextjs";
import {
  WORKFLOW_DETAIL,
  MY_ROLE_FOR_ORG,
  ADD_STEP,
  ADD_TRIGGER,
  TRIGGER_RUN,
  APPROVE_STEP,
} from "@/lib/graphql";
import StepStatusList from "@/components/StepStatusList";

const STEP_TYPES = ["llm_call", "http_request", "db_write", "notify", "conditional_branch", "approval_gate"];
const TRIGGER_TYPES = ["webhook", "scheduled", "database_event"];

export default function WorkflowPage({ params }) {
  const { id } = use(params);
  const userId = useUserId();

  const [{ data, fetching }, refetchWorkflow] = useQuery({ query: WORKFLOW_DETAIL, variables: { id } });
  const workflow = data?.workflows_by_pk;

  const [{ data: roleData }] = useQuery({
    query: MY_ROLE_FOR_ORG,
    variables: { orgId: workflow?.org_id },
    pause: !workflow?.org_id,
  });
  const myRole = roleData?.org_members?.find((m) => m.user_id === userId)?.role;
  const canEdit = myRole === "owner" || myRole === "editor";
  const canRun = canEdit; // viewers cannot trigger runs

  const [, addStep] = useMutation(ADD_STEP);
  const [, addTrigger] = useMutation(ADD_TRIGGER);
  const [, triggerRun] = useMutation(TRIGGER_RUN);
  const [, approveStep] = useMutation(APPROVE_STEP);

  const [activeRunId, setActiveRunId] = useState(null);
  const [runMessage, setRunMessage] = useState(null);

  const [stepForm, setStepForm] = useState({ type: "llm_call", name: "", config: "{}" });
  const [triggerForm, setTriggerForm] = useState({ type: "webhook", cron: "*/15 * * * *", watchTable: "orders" });

  if (fetching) return <main style={{ padding: 24 }}>Loading…</main>;
  if (!workflow) return <main style={{ padding: 24 }}>Workflow not found (or you don't have access to it).</main>;

  async function handleAddStep() {
    let config = {};
    try {
      config = JSON.parse(stepForm.config || "{}");
    } catch {
      alert("Config must be valid JSON");
      return;
    }
    const position = (workflow.workflow_steps.length ?? 0);
    await addStep({ workflowId: id, position, type: stepForm.type, name: stepForm.name || stepForm.type, config });
    setStepForm({ type: "llm_call", name: "", config: "{}" });
    refetchWorkflow({ requestPolicy: "network-only" });
  }

  async function handleAddTrigger() {
    await addTrigger({
      workflowId: id,
      type: triggerForm.type,
      cron: triggerForm.type === "scheduled" ? triggerForm.cron : null,
      watchTable: triggerForm.type === "database_event" ? triggerForm.watchTable : null,
    });
    refetchWorkflow({ requestPolicy: "network-only" });
  }

  async function handleRun() {
    setRunMessage(null);
    const res = await triggerRun({ workflowId: id });
    if (res.error) {
      setRunMessage(res.error.message);
      return;
    }
    const out = res.data?.triggerWorkflowRun;
    setActiveRunId(out?.workflow_run_id ?? null);
    setRunMessage(out?.message ?? out?.status ?? null);
  }

  async function handleApprove(stepRunId, approve) {
    const res = await approveStep({ stepRunId, approve });
    if (res.error) setRunMessage(res.error.message);
    else setRunMessage(res.data?.approveStep?.message ?? res.data?.approveStep?.status);
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <Link href="/dashboard" style={{ color: "#9aa3b5", fontSize: 13 }}>&larr; Back to dashboard</Link>
      <h1 style={{ fontSize: 22, marginTop: 8 }}>{workflow.name}</h1>
      <p style={{ color: "#9aa3b5" }}>Your role in this org: <strong>{myRole ?? "…"}</strong></p>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Steps</h2>
        <ol>
          {workflow.workflow_steps.map((s) => (
            <li key={s.id} style={{ marginBottom: 4 }}>
              <strong>{s.name}</strong> <span className="badge badge-pending">{s.type}</span>
            </li>
          ))}
        </ol>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <select value={stepForm.type} onChange={(e) => setStepForm({ ...stepForm, type: e.target.value })} style={selectStyle}>
              {STEP_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input placeholder="Step name" value={stepForm.name} onChange={(e) => setStepForm({ ...stepForm, name: e.target.value })} style={inputStyle} />
            <input placeholder='Config JSON e.g. {"prompt":"..."}' value={stepForm.config} onChange={(e) => setStepForm({ ...stepForm, config: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
            <button  type="button"  className="btn" onClick={handleAddStep}>Add step</button>
          </div>
        )}
        {(myRole === "editor") && (
          <p style={{ color: "#ffd27d", fontSize: 12, marginTop: 8 }}>
            Note: db_write and notify steps can only be added by an org owner.
          </p>
        )}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Triggers</h2>
        <ul>
          {workflow.workflow_triggers.map((t) => (
            <li key={t.id}>{t.type} {t.cron_schedule ? `(${t.cron_schedule})` : ""} {t.watch_table ? `(${t.watch_table})` : ""}</li>
          ))}
        </ul>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={triggerForm.type} onChange={(e) => setTriggerForm({ ...triggerForm, type: e.target.value })} style={selectStyle}>
              {TRIGGER_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {triggerForm.type === "scheduled" && (
              <input value={triggerForm.cron} onChange={(e) => setTriggerForm({ ...triggerForm, cron: e.target.value })} style={inputStyle} />
            )}
            {triggerForm.type === "database_event" && (
              <input value={triggerForm.watchTable} onChange={(e) => setTriggerForm({ ...triggerForm, watchTable: e.target.value })} style={inputStyle} />
            )}
            <button  type="button"  className="btn" onClick={handleAddTrigger}>Add trigger</button>
          </div>
        )}
        {myRole === "editor" && (
          <p style={{ color: "#ffd27d", fontSize: 12, marginTop: 8 }}>
            Note: webhook triggers can only be added by an org owner.
          </p>
        )}
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Run</h2>
          {canRun && <button className="btn btn-primary" onClick={handleRun}>Run workflow</button>}
        </div>
        {runMessage && <p style={{ color: "#9aa3b5", fontSize: 13 }}>{runMessage}</p>}

        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: "#9aa3b5" }}>Recent runs:</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {workflow.workflow_runs.map((r) => (
              <button key={r.id}  type="button"  className="btn" onClick={() => setActiveRunId(r.id)}>
                <span className={`badge badge-${r.status}`}>{r.status}</span> {r.trigger_type}
              </button>
            ))}
          </div>
        </div>

        {activeRunId && (
          <StepStatusList runId={activeRunId} canApprove={canEdit} onApprove={handleApprove} />
        )}
      </section>
    </main>
  );
}

const inputStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #2f3646",
  background: "#0b0d12",
  color: "#e6e8ec",
};
const selectStyle = { ...inputStyle };

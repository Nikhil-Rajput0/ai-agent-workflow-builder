"use client";

import { useSubscription } from "urql";
import { STEP_RUNS_SUBSCRIPTION } from "@/lib/graphql";

export default function StepStatusList({ runId, canApprove, onApprove }) {
  const [{ data, fetching }] = useSubscription({
    query: STEP_RUNS_SUBSCRIPTION,
    variables: { workflowRunId: runId },
  });

  if (fetching && !data) return <p style={{ color: "#9aa3b5" }}>Connecting to live status…</p>;

  const steps = [...(data?.step_runs ?? [])].sort((a, b) => a.workflow_step.position - b.workflow_step.position);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      {steps.map((sr) => (
        <div key={sr.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>{sr.workflow_step.name}</strong>{" "}
            <span style={{ color: "#9aa3b5", fontSize: 12 }}>({sr.workflow_step.type})</span>
            {sr.error && <div style={{ color: "#ff7d7d", fontSize: 12 }}>{sr.error}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`badge badge-${sr.status}`}>
              {sr.status === "paused" ? "paused, awaiting approval" : sr.status}
            </span>
            {sr.status === "paused" && canApprove && (
              <>
                <button className="btn btn-primary" onClick={() => onApprove(sr.id, true)}>Approve</button>
                <button className="btn btn-danger" onClick={() => onApprove(sr.id, false)}>Reject</button>
              </>
            )}
          </div>
        </div>
      ))}
      {steps.length === 0 && <p style={{ color: "#9aa3b5" }}>No step runs yet.</p>}
    </div>
  );
}

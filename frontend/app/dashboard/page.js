"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "urql";
import { useUserId, useSignOut, useAuthenticationStatus } from "@nhost/nextjs";
import { useRouter } from "next/navigation";
import { MY_MEMBERSHIPS, ORG_WORKFLOWS, CREATE_WORKFLOW } from "@/lib/graphql";
import QuotaBadge from "@/components/QuotaBadge";

export default function DashboardPage() {
  const userId = useUserId();
  const { signOut } = useSignOut();
const router = useRouter();
   const { isAuthenticated, isLoading } = useAuthenticationStatus();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);
  const [{ data: memData, fetching: memFetching }, refetchMemberships] = useQuery({
    query: MY_MEMBERSHIPS,
    variables: { userId },
    pause: !isAuthenticated || !userId,
    requestPolicy: "network-only",
  });
  const [selectedOrgId, setSelectedOrgId] = useState(null);

  useEffect(() => {
    if (!selectedOrgId && memData?.org_members?.length) {
      setSelectedOrgId(memData.org_members[0].org.id);
    }
  }, [memData, selectedOrgId]);

  const memberships = memData?.org_members ?? [];
  const current = memberships.find((m) => m.org.id === selectedOrgId);

  const [{ data: wfData, fetching: wfFetching }, refetchWorkflows] = useQuery({
    query: ORG_WORKFLOWS,
    variables: { orgId: selectedOrgId },
    pause: !selectedOrgId,
  });

  const [, createWorkflow] = useMutation(CREATE_WORKFLOW);
  const [newName, setNewName] = useState("");

  async function handleCreate() {
    if (!selectedOrgId || !userId || !newName.trim()) return;
    await createWorkflow({ orgId: selectedOrgId, name: newName, description: "", createdBy: userId });
    setNewName("");
    refetchWorkflows({ requestPolicy: "network-only" });
  }

 if (isLoading || !isAuthenticated) {
    return <main style={{ padding: 24 }}>Loading…</main>;
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22 }}>Workflows</h1>
        <button
          className="btn"
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
        >
          Sign out
        </button>
      </header>

      {memFetching && <p>Loading your organizations…</p>}

      {!memFetching && memberships.length === 0 && (
        <p style={{ color: "#9aa3b5" }}>
          You're not a member of any organization yet. Ask an owner to add you, or seed one via the DB for local dev.
        </p>
      )}

      {memberships.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {memberships.map((m) => (
              <button
                key={m.org.id}
                className="btn"
                style={{
                  borderColor: m.org.id === selectedOrgId ? "#4f7cff" : undefined,
                  background: m.org.id === selectedOrgId ? "#1c2130" : undefined,
                }}
                onClick={() => setSelectedOrgId(m.org.id)}
              >
                {m.org.name} <span style={{ opacity: 0.6 }}>({m.role})</span>
              </button>
            ))}
          </div>

          {current && (
            <div style={{ marginBottom: 20 }}>
              <QuotaBadge used={current.org.quota_calls_used} allowed={current.org.quota_calls_allowed} />
            </div>
          )}

          {current?.role !== "viewer" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <input
                placeholder="New workflow name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #2f3646", background: "#0b0d12", color: "#e6e8ec" }}
              />
              <button className="btn btn-primary" onClick={handleCreate}>Create workflow</button>
            </div>
          )}

          {wfFetching && <p>Loading workflows…</p>}

          <div style={{ display: "grid", gap: 12 }}>
            {wfData?.workflows?.map((wf) => (
              <Link key={wf.id} href={`/workflows/${wf.id}`} className="card" style={{ textDecoration: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{wf.name}</div>
                  <div style={{ color: "#9aa3b5", fontSize: 13 }}>
                    {wf.workflow_steps.length} steps · {wf.workflow_triggers.length} trigger(s)
                  </div>
                </div>
                {wf.workflow_runs[0] && (
                  <span className={`badge badge-${wf.workflow_runs[0].status}`}>{wf.workflow_runs[0].status}</span>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

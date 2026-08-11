"use client";

export default function QuotaBadge({ used, allowed }) {
  const pct = Math.min(100, Math.round((used / Math.max(allowed, 1)) * 100));
  const color = pct >= 90 ? "#ff7d7d" : pct >= 70 ? "#ffd27d" : "#7dffb0";
  return (
    <div className="card" style={{ maxWidth: 320 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span>Usage this period</span>
        <span>{used} / {allowed} calls</span>
      </div>
      <div style={{ height: 8, background: "#0b0d12", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

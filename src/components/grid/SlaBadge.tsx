"use client";

import { useEffect, useState } from "react";
import { formatRemaining, slaInfo } from "@/server/domain/sla";

// The SLA countdown for a case. Re-evaluated every 30 seconds so an open case turns red the
// moment it passes its due time without a reload. Closed cases show their fixed verdict.

const LABEL: Record<string, string> = {
  none: "No SLA",
  met: "SLA met",
  missed: "SLA missed",
  stopped: "Cancelled",
};
export function SlaBadge(props: {
  status: string;
  createdAt: string | Date;
  slaDueAt: string | Date | null;
  resolvedAt?: string | Date | null;
}) {
  // Only the clock is state; the verdict is derived from the current props on every render, so it
  // updates the moment the case changes (resolved, reactivated, new priority), not at the next tick.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const info = slaInfo(
    {
      status: props.status,
      createdAt: new Date(props.createdAt),
      slaDueAt: props.slaDueAt ? new Date(props.slaDueAt) : null,
      resolvedAt: props.resolvedAt ? new Date(props.resolvedAt) : null,
    },
    now,
  );

  const text =
    info.remainingMs !== null
      ? formatRemaining(info.remainingMs)
      : (LABEL[info.state] ?? info.state);
  return (
    <span
      className="crm-badge"
      data-sla={info.state}
      style={{ fontWeight: info.state === "breached" ? 700 : undefined }}
      title={info.state === "breached" ? "Past its SLA due time" : undefined}
    >
      {info.state === "breached" ? `Breached · ${text}` : text}
    </span>
  );
}

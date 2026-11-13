"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/format";
import { recordCommandAction } from "@/server/actions/entities";

type Item = { id: string; name: string; opportunityNumber: string; estRevenueCents: number };
type Col = { stage: string; count: number; estRevenueCents: number; items: Item[] };

/** Kanban pipeline. Drag a card to another column (or use its "Move to" menu) to change stage. */
export function Board({ columns }: { columns: Col[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>("");

  const move = (id: string, stage: string) =>
    start(async () => {
      const r = await recordCommandAction("stage", "opportunity", id, { stage });
      if (r.ok) {
        setError("");
        router.refresh();
      } else {
        setError(
          r.missing?.length
            ? `${r.message} Missing: ${r.missing.map((m) => m.label).join(", ")}.`
            : r.message,
        );
      }
    });

  return (
    <div>
      {error && (
        <div role="alert" className="crm-error">
          {error}
        </div>
      )}
      <div className="crm-board" aria-busy={pending}>
        {columns.map((c) => (
          <section
            key={c.stage}
            className="crm-col"
            aria-label={`${c.stage} stage`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/plain");
              if (id) move(id, c.stage);
            }}
          >
            <h2>
              {c.stage[0]!.toUpperCase() + c.stage.slice(1)} <small>({c.count})</small>
            </h2>
            <p>{formatMoney(c.estRevenueCents)}</p>
            {c.items.map((o) => (
              <article
                key={o.id}
                className="crm-card"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}
              >
                <Link href={`/app/deals/${o.id}`}>{o.name}</Link>
                <div>{formatMoney(o.estRevenueCents)}</div>
                <select
                  aria-label={`Move ${o.name} to stage`}
                  value={c.stage}
                  onChange={(e) => move(o.id, e.target.value)}
                >
                  {columns.map((x) => (
                    <option key={x.stage} value={x.stage}>
                      {x.stage}
                    </option>
                  ))}
                </select>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

"use client";

import { formatMoney } from "@/lib/format";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type BarDatum = { key: string; label: string; count: number; cents?: number };

/**
 * A titled bar chart with its numbers in a table underneath, so the figures are readable (and
 * testable) without the picture. `money` plots the dollar value instead of the count.
 */
export function BarCard(props: {
  title: string;
  data: BarDatum[];
  money?: boolean;
  empty: string;
  color?: string;
}) {
  const total = props.data.reduce((a, d) => a + d.count, 0);
  const value = (d: BarDatum) => (props.money ? (d.cents ?? 0) / 100 : d.count);
  return (
    <section className="crm-card dash-card" aria-label={props.title}>
      <h2>{props.title}</h2>
      {total === 0 ? (
        <p className="crm-muted">{props.empty}</p>
      ) : (
        <div
          role="img"
          aria-label={`${props.title}: ${props.data.map((d) => `${d.label} ${d.count}`).join(", ")}`}
          style={{ width: "100%", height: 200 }}
        >
          <ResponsiveContainer>
            <BarChart data={props.data.map((d) => ({ name: d.label, value: value(d) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={48} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
                cursor={{ fill: "var(--hover)" }}
              />
              <Bar dataKey="value" fill={props.color ?? "#0f6cbd"} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <table className="dash-table">
        <tbody>
          {props.data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{d.count}</td>
              {props.money && <td>{formatMoney(d.cents ?? 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

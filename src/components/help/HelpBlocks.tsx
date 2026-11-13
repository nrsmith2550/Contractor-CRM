import Link from "next/link";
import type { ReactNode } from "react";
import type { Block } from "@/help/types";

/** [label](/path) becomes a link, **text** bold and *text* italic. Everything else is plain text. */
export function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1])
      out.push(
        <Link key={i++} href={m[2]!}>
          {m[1]}
        </Link>,
      );
    else if (m[3]) out.push(<strong key={i++}>{m[3]}</strong>);
    else out.push(<em key={i++}>{m[4]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const CALLOUT = { tip: "Tip", note: "Good to know", warning: "Careful" } as const;

export function HelpBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "h":
            return <h2 key={i}>{b.text}</h2>;
          case "p":
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case "steps":
            return (
              <ol key={i} className="help-steps">
                {b.items.map((t, j) => (
                  <li key={j}>
                    <Inline text={t} />
                  </li>
                ))}
              </ol>
            );
          case "list":
            return (
              <ul key={i}>
                {b.items.map((t, j) => (
                  <li key={j}>
                    <Inline text={t} />
                  </li>
                ))}
              </ul>
            );
          case "tip":
          case "note":
          case "warning":
            return (
              <aside key={i} className={`help-callout help-${b.type}`} aria-label={CALLOUT[b.type]}>
                <strong>{CALLOUT[b.type]}: </strong>
                <Inline text={b.text} />
              </aside>
            );
          case "table":
            return (
              <div key={i} className="help-table-wrap">
                <table className="help-table">
                  <caption>{b.caption}</caption>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} scope="col">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) =>
                          k === 0 ? (
                            <th key={k} scope="row">
                              <Inline text={c} />
                            </th>
                          ) : (
                            <td key={k}>
                              <Inline text={c} />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "flow":
            return (
              <figure key={i} className="help-flow">
                <figcaption>{b.caption}</figcaption>
                <ol>
                  {b.steps.map((s, j) => (
                    <li key={j}>
                      <strong>{s.title}</strong>
                      <span>
                        <Inline text={s.text} />
                      </span>
                    </li>
                  ))}
                </ol>
              </figure>
            );
        }
      })}
    </>
  );
}

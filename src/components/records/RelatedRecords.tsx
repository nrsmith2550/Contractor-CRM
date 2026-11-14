import Link from "next/link";
import type { RelatedGroup } from "@/server/domain/related";

/** Everything this record is linked to, each one a link, so people can click through. */
export function RelatedRecords({ groups }: { groups: RelatedGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="related-heading" className="crm-related">
      <h2 id="related-heading">Related records</h2>
      <div className="crm-related-grid">
        {groups.map((g) => (
          <div key={g.title} className="crm-related-group">
            <h3>
              {g.title} <span className="crm-count">{g.items.length}</span>
            </h3>
            <ul>
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link href={i.href}>{i.label}</Link>
                  {i.detail && <span className="crm-muted"> {i.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

import { STAGES } from "@/server/domain/bpf";

const LABEL: Record<string, string> = {
  qualify: "Qualify",
  develop: "Develop",
  propose: "Propose",
  close: "Close",
};

/** The stage bar across the top of an opportunity. Read-only; moving is done by RecordCommands. */
export function BusinessProcessFlow({ stage, status }: { stage: string; status: string }) {
  const current = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <ol className="crm-bpf" aria-label="Progress bar">
      {STAGES.map((s, i) => (
        <li
          key={s}
          className={i < current || status === "won" ? "done" : i === current ? "active" : ""}
          aria-current={i === current ? "step" : undefined}
        >
          {LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

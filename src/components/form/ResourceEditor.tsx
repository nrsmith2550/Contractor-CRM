"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CmdResult } from "@/server/actions/entities";
import { WEEKDAYS, type WorkHours } from "@/server/domain/work-hours";

const DAY_LABEL: Record<(typeof WEEKDAYS)[number], string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};
const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const text = (h: WorkHours[(typeof WEEKDAYS)[number]]) =>
  h.map((i) => `${i.start}-${i.end}`).join(", ");

export type ResourceInit = {
  id?: string;
  name: string;
  resourceType: string;
  userId: string;
  color: string;
  workHours: WorkHours;
  skillIds: string[];
};

/** Create or edit a bookable resource: name, who it is, colour, weekly hours and skills. */
export function ResourceEditor(props: {
  init: ResourceInit;
  users: { id: string; label: string }[];
  skills: { id: string; name: string }[];
  action: (v: Record<string, string>) => Promise<CmdResult>;
  submitLabel: string;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(props.init.name);
  const [type, setType] = useState(props.init.resourceType);
  const [userId, setUserId] = useState(props.init.userId);
  const [color, setColor] = useState(props.init.color || "#3366cc");
  const [hours, setHours] = useState<Record<string, string>>(
    Object.fromEntries(WEEKDAYS.map((d) => [d, text(props.init.workHours[d])])),
  );
  const [skillIds, setSkillIds] = useState<string[]>(props.init.skillIds);
  const [res, setRes] = useState<CmdResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const v: Record<string, string> = {
            name,
            resourceType: type,
            userId,
            color,
            skillIds: skillIds.join(","),
          };
          for (const d of WEEKDAYS) v[`hours_${d}`] = hours[d] ?? "";
          const r = await props.action(v);
          setRes(r);
          if (r.ok) {
            if (props.resetOnSuccess) {
              setName("");
              setSkillIds([]);
            }
            router.refresh();
          }
        });
      }}
    >
      <fieldset className="crm-section">
        <legend>Resource</legend>
        <div className="crm-fields">
          <div className="crm-field">
            <label htmlFor="r-name">Name</label>
            <input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="crm-field">
            <label htmlFor="r-type">Type</label>
            <select id="r-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="user">Person</option>
              <option value="crew">Crew</option>
              <option value="equipment">Equipment</option>
            </select>
          </div>
          <div className="crm-field">
            <label htmlFor="r-user">Sign-in (for a person)</label>
            <select id="r-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">None</option>
              {props.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div className="crm-field">
            <label htmlFor="r-color">Colour</label>
            <input
              id="r-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </div>
      </fieldset>
      <fieldset className="crm-section">
        <legend>Working hours</legend>
        <p className="crm-muted">
          In your business&apos;s time zone. Leave a day blank for a day off. Two shifts:
          08:00-12:00, 13:00-17:00.
        </p>
        <div className="crm-fields">
          {ORDER.map((d) => (
            <div className="crm-field" key={d}>
              <label htmlFor={`h-${d}`}>{DAY_LABEL[d]}</label>
              <input
                id={`h-${d}`}
                value={hours[d] ?? ""}
                onChange={(e) => setHours({ ...hours, [d]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset className="crm-section">
        <legend>Skills</legend>
        {props.skills.length === 0 && (
          <p>No skills yet. Add some under Settings → Service settings.</p>
        )}
        <div className="crm-row" style={{ flexWrap: "wrap" }}>
          {props.skills.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={skillIds.includes(s.id)}
                onChange={(e) =>
                  setSkillIds(
                    e.target.checked ? [...skillIds, s.id] : skillIds.filter((x) => x !== s.id),
                  )
                }
              />{" "}
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>
      <button className="crm-btn crm-btn-primary" type="submit" disabled={pending}>
        {props.submitLabel}
      </button>
      {res && !res.ok && (
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      )}
      {res?.ok && res.message && (
        <div role="status" className="crm-ok">
          {res.message}
        </div>
      )}
    </form>
  );
}

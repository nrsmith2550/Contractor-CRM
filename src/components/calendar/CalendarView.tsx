"use client";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import type { EventInput } from "@fullcalendar/core";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CmdResult } from "@/server/actions/entities";
import { createAppointmentAction } from "@/server/actions/calendar";
import { humanize } from "@/lib/format";

// FullCalendar (the free standard views). It is told its time zone is UTC and the server sends
// wall-clock times in the business's zone, so events show exactly where the rest of the app says.

type Picked = {
  title: string;
  kind: string;
  status: string;
  when: string;
  owner: string | null;
  detail: string | null;
  href: string | null;
};

const wallMinute = (d: Date) => d.toISOString().slice(0, 16);

export function CalendarView(props: {
  nowWall: string;
  startDate?: string;
  canSeeOthers: boolean;
  users: { id: string; label: string }[];
  canCreate: boolean;
}) {
  const cal = useRef<FullCalendar>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Two things FullCalendar does that assistive technology trips over, fixed after each redraw:
  // the previous/next arrows are role="img" spans with no text (the buttons already carry their
  // names, so the icons become decorative), and each day cell is named with just its date, which
  // doesn't match the events written inside it. The date stays available on the day's number link.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const tidy = () => {
      el.querySelectorAll(".fc-icon:not([aria-hidden])").forEach((i) => {
        i.setAttribute("aria-hidden", "true");
        i.removeAttribute("role");
      });
      el.querySelectorAll("td.fc-daygrid-day[aria-labelledby]").forEach((td) =>
        td.removeAttribute("aria-labelledby"),
      );
    };
    tidy();
    const obs = new MutationObserver(tidy);
    obs.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-labelledby"],
    });
    return () => obs.disconnect();
  }, []);
  const [who, setWho] = useState("mine");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [form, setForm] = useState<{ subject: string; start: string; end: string } | null>(null);
  const [res, setRes] = useState<CmdResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Stable between renders (it changes only with the "whose calendar" choice), so FullCalendar
  // refetches exactly when the choice changes and not on every unrelated state update.
  const loadEvents = useCallback(
    (
      info: { startStr: string; endStr: string },
      success: (events: EventInput[]) => void,
      failure: (e: Error) => void,
    ) => {
      const q = new URLSearchParams({ start: info.startStr, end: info.endStr, user: who });
      fetch(`/app/calendar/events?${q}`)
        .then(async (r) => {
          if (!r.ok)
            throw new Error(
              ((await r.json().catch(() => null)) as { error?: string } | null)?.error ??
                "Couldn't load the calendar.",
            );
          return r.json();
        })
        .then((events) => {
          setError(null);
          success(events);
        })
        .catch((e: Error) => {
          setError(e.message);
          failure(e);
        });
    },
    [who],
  );

  return (
    <div>
      {props.canSeeOthers && (
        <div className="sb-toolbar">
          <label>
            Show{" "}
            <select
              value={who}
              aria-label="Whose calendar"
              onChange={(e) => {
                setWho(e.target.value);
                setPicked(null);
              }}
            >
              <option value="mine">My calendar</option>
              <option value="all">Everyone</option>
              {props.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error && (
        <div role="alert" className="crm-error">
          {error}
        </div>
      )}

      <div className="cal-wrap" data-testid="calendar" ref={wrap}>
        <FullCalendar
          ref={cal}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          timeZone="UTC"
          now={props.nowWall}
          initialDate={props.startDate ?? props.nowWall.slice(0, 10)}
          initialView="dayGridMonth"
          firstDay={1}
          nowIndicator
          height="auto"
          scrollTime="08:00:00"
          slotDuration="00:30:00"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
          }}
          buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day", list: "Agenda" }}
          selectable={props.canCreate}
          selectMirror
          dayMaxEvents={4}
          eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
          events={loadEvents}
          select={(info) => {
            // A click on a whole day (month view) suggests 9-10am; a time-grid selection is used as picked.
            const start = info.allDay
              ? `${info.startStr.slice(0, 10)}T09:00`
              : info.startStr.slice(0, 16);
            const end = info.allDay
              ? `${info.startStr.slice(0, 10)}T10:00`
              : info.endStr.slice(0, 16);
            setForm({ subject: "", start, end });
            setRes(null);
            setPicked(null);
            cal.current?.getApi().unselect();
          }}
          eventClick={(info) => {
            info.jsEvent.preventDefault();
            const p = info.event.extendedProps as {
              kind: string;
              status: string;
              owner: string | null;
              detail: string | null;
              href: string | null;
            };
            const s = info.event.start!;
            const e = info.event.end ?? s;
            const day = s.toISOString().slice(0, 10);
            setPicked({
              title: info.event.title,
              kind: p.kind,
              status: p.status,
              when: `${day} ${wallMinute(s).slice(11)}–${wallMinute(e).slice(11)}`,
              owner: p.owner,
              detail: p.detail,
              href: p.href,
            });
            setForm(null);
          }}
        />
      </div>

      {picked && (
        <section
          className="crm-panel"
          aria-label="Event details"
          style={{ flexDirection: "column", alignItems: "flex-start" }}
        >
          <strong>{picked.title}</strong>
          <span>
            {humanize(picked.kind)} · {picked.when} · {humanize(picked.status)}
          </span>
          {picked.owner && <span className="crm-muted">{picked.owner}</span>}
          {picked.detail && <span style={{ whiteSpace: "pre-wrap" }}>{picked.detail}</span>}
          {picked.href && <Link href={picked.href}>Open the record</Link>}
          <button className="crm-btn" onClick={() => setPicked(null)}>
            Close
          </button>
        </section>
      )}

      {form && (
        <form
          className="crm-panel"
          aria-label="New appointment"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              const r = await createAppointmentAction(form);
              setRes(r);
              if (r.ok) {
                setForm(null);
                cal.current?.getApi().refetchEvents();
              }
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            Subject
            <input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </label>
          <label>
            Starts
            <input
              type="datetime-local"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </label>
          <label>
            Ends
            <input
              type="datetime-local"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </label>
          <button className="crm-btn crm-btn-primary" type="submit" disabled={saving}>
            Add appointment
          </button>
          <button className="crm-btn" type="button" onClick={() => setForm(null)}>
            Cancel
          </button>
          {res && !res.ok && (
            <div role="alert" className="crm-error" style={{ flexBasis: "100%" }}>
              {res.message}
            </div>
          )}
        </form>
      )}
      {res?.ok && !form && (
        <div role="status" className="crm-ok">
          {res.message}
        </div>
      )}
    </div>
  );
}

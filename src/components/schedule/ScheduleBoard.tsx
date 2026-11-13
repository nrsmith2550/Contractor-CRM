"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  blockFor,
  layoutLanes,
  moveByPixels,
  resizeEndByPixels,
  resizeStartByPixels,
  rowAtY,
  timeAtX,
  type BoardRange,
} from "@/lib/board";
import { humanize } from "@/lib/format";
import { utcToZonedInput } from "@/lib/tz";
import { bookingStatusAction } from "@/server/actions/bookings";
import type { CmdResult } from "@/server/actions/entities";
import { rescheduleBookingAction, scheduleWorkOrderAction } from "@/server/actions/schedule";
import { nextBookingStatuses, type BookingStatus } from "@/server/domain/booking-status";

// The schedule board: resource rows by time. Everything is positioned from lib/board.ts. Blocks
// can be dragged (move, or to another row to reassign), resized from either edge, moved with the
// keyboard, and right-clicked for their status menu. Unscheduled work orders in the pane below
// are dragged onto a row to book them. The server returns warnings (overlap, hours, skills,
// window) and the board shows them after the change.

const LABEL_W = 170;
const HEADER_H = 34;
const BLOCK_H = 28;
const GAP = 4;
const MIN_ROW = 48;

export type BoardResource = { id: string; name: string; color: string | null; type: string };
export type BoardBooking = {
  id: string;
  resourceId: string;
  start: string;
  end: string;
  status: string;
  woId: string | null;
  woNumber: string | null;
  woTitle: string | null;
};
export type BoardUnscheduled = {
  id: string;
  woNumber: string;
  title: string;
  estDurationMin: number | null;
  priority: string;
};
export type RangeData = Omit<BoardRange, "start" | "end" | "ticks"> & {
  start: string;
  end: string;
  ticks: { at: string; label: string; major: boolean }[];
};

const STATUS_CLASS: Record<string, string> = {
  scheduled: "sb-scheduled",
  travelling: "sb-travelling",
  in_progress: "sb-progress",
  completed: "sb-done",
};

type Live = { id: string; start: Date; end: Date; resourceId: string };
type Menu = { id: string; x: number; y: number };

export function ScheduleBoard(props: {
  range: RangeData;
  resources: BoardResource[];
  bookings: BoardBooking[];
  unscheduled: BoardUnscheduled[];
  tz: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const range: BoardRange = useMemo(
    () => ({
      ...props.range,
      start: new Date(props.range.start),
      end: new Date(props.range.end),
      ticks: props.range.ticks.map((t) => ({ ...t, at: new Date(t.at) })),
    }),
    [props.range],
  );
  const bookings = useMemo(
    () => props.bookings.map((b) => ({ ...b, startD: new Date(b.start), endD: new Date(b.end) })),
    [props.bookings],
  );

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{
    kind: "ok" | "warn" | "error";
    text: string;
    warnings?: string[];
  } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [live, setLive] = useState<Live | null>(null); // a block being resized: drawn at its new size
  const interacting = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Rows: each is as tall as its busiest stack of overlapping blocks.
  const rows = useMemo(
    () =>
      props.resources.map((r) => {
        const mine = bookings
          .filter((b) => b.resourceId === r.id && b.status !== "cancelled")
          .map((b) => ({ id: b.id, start: b.startD, end: b.endD }));
        const { lanes, count } = layoutLanes(mine);
        return { resource: r, lanes, height: Math.max(MIN_ROW, GAP + count * (BLOCK_H + GAP)) };
      }),
    [props.resources, bookings],
  );
  const heights = rows.map((r) => r.height);

  // Live updates: refresh every 30 seconds, but never in the middle of a drag or while hidden.
  useEffect(() => {
    const id = setInterval(() => {
      if (!interacting.current && !document.hidden) router.refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const report = useCallback(
    (r: CmdResult) => {
      if (!r.ok) setMsg({ kind: "error", text: r.message });
      else if (r.warnings && r.warnings.length > 0)
        setMsg({ kind: "warn", text: r.message ?? "Saved.", warnings: r.warnings });
      else setMsg({ kind: "ok", text: r.message ?? "Saved." });
      router.refresh();
    },
    [router],
  );

  const reschedule = useCallback(
    async (id: string, to: { resourceId?: string; start: Date; end: Date }) => {
      setBusy(true);
      try {
        report(
          await rescheduleBookingAction(id, {
            resourceId: to.resourceId,
            startAt: to.start.toISOString(),
            endAt: to.end.toISOString(),
          }),
        );
      } finally {
        setBusy(false);
        setLive(null);
      }
    },
    [report],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    interacting.current = false;
    if (!props.canEdit) return;
    const grid = gridRef.current;
    const start = e.activatorEvent as PointerEvent;
    if (!grid || !("clientX" in start)) return;
    const box = grid.getBoundingClientRect();
    const px = start.clientX + e.delta.x;
    const py = start.clientY + e.delta.y;
    const rowIndex = rowAtY(py - box.top - HEADER_H + grid.scrollTop, heights);
    const data = e.active.data.current as
      { kind: "booking"; id: string } | { kind: "wo"; id: string; minutes: number };
    if (data.kind === "booking") {
      const b = bookings.find((x) => x.id === data.id)!;
      if (b.status !== "scheduled") {
        setMsg({
          kind: "error",
          text: `A ${humanize(b.status).toLowerCase()} booking can't be moved.`,
        });
        return;
      }
      const moved = moveByPixels({ start: b.startD, end: b.endD }, e.delta.x, range);
      const resourceId = rowIndex >= 0 ? rows[rowIndex]!.resource.id : b.resourceId;
      if (moved.start.getTime() === b.startD.getTime() && resourceId === b.resourceId) return;
      void reschedule(b.id, { resourceId, ...moved });
    } else if (rowIndex >= 0) {
      const x = px - box.left - LABEL_W + grid.scrollLeft;
      if (x < 0) return; // dropped on the name column
      const startAt = timeAtX(x, range);
      const endAt = new Date(startAt.getTime() + (data.minutes || 60) * 60_000);
      setBusy(true);
      void scheduleWorkOrderAction(data.id, {
        resourceId: rows[rowIndex]!.resource.id,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      })
        .then(report)
        .finally(() => setBusy(false));
    }
  };

  // Resizing: handled with plain pointer events on the block's edges.
  const startResize = (
    e: React.PointerEvent,
    b: (typeof bookings)[number],
    edge: "start" | "end",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (!props.canEdit || b.status !== "scheduled") return;
    interacting.current = true;
    const x0 = e.clientX;
    let last = { start: b.startD, end: b.endD };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      last =
        edge === "end"
          ? resizeEndByPixels({ start: b.startD, end: b.endD }, dx, range)
          : resizeStartByPixels({ start: b.startD, end: b.endD }, dx, range);
      setLive({ id: b.id, resourceId: b.resourceId, ...last });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      interacting.current = false;
      if (last.start.getTime() !== b.startD.getTime() || last.end.getTime() !== b.endD.getTime())
        void reschedule(b.id, last);
      else setLive(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const keyMove = (e: React.KeyboardEvent, b: (typeof bookings)[number], rowIndex: number) => {
    if (e.key === "Enter" || e.key === "ContextMenu") {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ id: b.id, x: r.left, y: r.bottom });
      return;
    }
    if (
      !props.canEdit ||
      busy ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    )
      return;
    e.preventDefault();
    if (b.status !== "scheduled") {
      setMsg({
        kind: "error",
        text: `A ${humanize(b.status).toLowerCase()} booking can't be moved.`,
      });
      return;
    }
    const step = range.snapMinutes * 60_000;
    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const end = new Date(b.endD.getTime() + (e.key === "ArrowRight" ? step : -step));
      if (end.getTime() - b.startD.getTime() >= step)
        void reschedule(b.id, { start: b.startD, end });
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const d = e.key === "ArrowRight" ? step : -step;
      void reschedule(b.id, {
        start: new Date(b.startD.getTime() + d),
        end: new Date(b.endD.getTime() + d),
      });
    } else {
      const next = rows[rowIndex + (e.key === "ArrowDown" ? 1 : -1)];
      if (next)
        void reschedule(b.id, { resourceId: next.resource.id, start: b.startD, end: b.endD });
    }
  };

  const menuBooking = menu ? bookings.find((b) => b.id === menu.id) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => (interacting.current = true)}
      onDragCancel={() => (interacting.current = false)}
      onDragEnd={onDragEnd}
    >
      <div aria-live="polite">
        {msg && msg.kind === "error" && (
          <div role="alert" className="crm-error">
            {msg.text}
          </div>
        )}
        {msg && msg.kind === "ok" && (
          <div role="status" className="crm-ok">
            {msg.text}
          </div>
        )}
        {msg && msg.kind === "warn" && (
          <div role="group" aria-label="Booking warnings" className="crm-warn">
            <strong>{msg.text} Check:</strong>
            <ul>
              {msg.warnings!.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div
        ref={gridRef}
        className="sb-grid"
        data-testid="schedule-grid"
        aria-busy={busy}
        role="group"
        aria-label="Schedule board"
      >
        <div className="sb-inner" style={{ width: LABEL_W + range.widthPx }}>
          <div className="sb-header" style={{ height: HEADER_H }}>
            <div className="sb-corner" style={{ width: LABEL_W }}>
              Resource
            </div>
            <div className="sb-axis" style={{ width: range.widthPx }}>
              {range.ticks.map((t) => (
                <div
                  key={t.at.getTime()}
                  className={`sb-tick${t.major ? " major" : ""}`}
                  style={{
                    left: ((t.at.getTime() - range.start.getTime()) / 3_600_000) * range.pxPerHour,
                  }}
                >
                  {t.label}
                </div>
              ))}
            </div>
          </div>

          {rows.length === 0 && (
            <p style={{ padding: 12 }}>No resources match. Add some under Resources.</p>
          )}
          {rows.map((row, ri) => (
            <div
              key={row.resource.id}
              className="sb-row"
              style={{ height: row.height }}
              data-resource={row.resource.name}
            >
              <div
                className="sb-label"
                style={{ width: LABEL_W, borderLeft: `4px solid ${row.resource.color ?? "#999"}` }}
              >
                <strong>{row.resource.name}</strong>
                <span className="crm-muted">
                  {" "}
                  {row.resource.type === "user" ? "" : row.resource.type}
                </span>
              </div>
              <div className="sb-lane" style={{ width: range.widthPx }}>
                {range.ticks.map((t) => (
                  <div
                    key={t.at.getTime()}
                    className={`sb-gridline${t.major ? " major" : ""}`}
                    style={{
                      left:
                        ((t.at.getTime() - range.start.getTime()) / 3_600_000) * range.pxPerHour,
                    }}
                  />
                ))}
                {bookings
                  .filter((b) => b.resourceId === row.resource.id && b.status !== "cancelled")
                  .map((b) => {
                    const l = live && live.id === b.id ? live : null;
                    const blk = blockFor(l?.start ?? b.startD, l?.end ?? b.endD, range);
                    if (!blk) return null;
                    return (
                      <Block
                        key={b.id}
                        b={b}
                        blk={blk}
                        top={GAP + (row.lanes.get(b.id) ?? 0) * (BLOCK_H + GAP)}
                        tz={props.tz}
                        draggable={props.canEdit && b.status === "scheduled" && !busy}
                        onResize={(e, edge) => startResize(e, b, edge)}
                        onKey={(e) => keyMove(e, b, ri)}
                        onMenu={(x, y) => setMenu({ id: b.id, x, y })}
                      />
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {menu && menuBooking && (
        <ul
          className="sb-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuBooking.woId && (
            <li role="none">
              <Link role="menuitem" href={`/app/work-orders/${menuBooking.woId}`}>
                Open work order
              </Link>
            </li>
          )}
          {props.canEdit &&
            nextBookingStatuses(menuBooking.status as BookingStatus).map((to) => (
              <li role="none" key={to}>
                <button
                  role="menuitem"
                  onClick={async () => {
                    setMenu(null);
                    setBusy(true);
                    try {
                      report(await bookingStatusAction(menuBooking.id, to));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {to === "cancelled" ? "Cancel booking" : `Mark ${humanize(to).toLowerCase()}`}
                </button>
              </li>
            ))}
        </ul>
      )}

      <section aria-label="Unscheduled work orders">
        <h2>Unscheduled work orders</h2>
        {props.unscheduled.length === 0 ? (
          <p>Nothing waiting to be scheduled.</p>
        ) : (
          <>
            <p className="crm-muted">
              {props.canEdit
                ? "Drag one onto a resource and time to book it."
                : "Only dispatchers can book work orders."}
            </p>
            <div className="sb-pane">
              {props.unscheduled.map((w) => (
                <UnscheduledCard key={w.id} w={w} draggable={props.canEdit && !busy} />
              ))}
            </div>
          </>
        )}
      </section>
    </DndContext>
  );
}

function Block(props: {
  b: BoardBooking & { startD: Date; endD: Date };
  blk: { left: number; width: number };
  top: number;
  tz: string;
  draggable: boolean;
  onResize: (e: React.PointerEvent, edge: "start" | "end") => void;
  onKey: (e: React.KeyboardEvent) => void;
  onMenu: (x: number, y: number) => void;
}) {
  const { b, blk } = props;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: b.id,
    data: { kind: "booking", id: b.id },
    disabled: !props.draggable,
  });
  const time = `${utcToZonedInput(b.startD, props.tz).slice(11)}–${utcToZonedInput(b.endD, props.tz).slice(11)}`;
  const label = `${b.woNumber ?? "Booking"} ${b.woTitle ?? ""}, ${time}, ${humanize(b.status).toLowerCase()}`;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      aria-label={label}
      title={label}
      data-booking={b.id}
      data-status={b.status}
      className={`sb-block ${STATUS_CLASS[b.status] ?? ""}${isDragging ? " dragging" : ""}`}
      style={{
        left: blk.left,
        width: blk.width,
        top: props.top,
        height: BLOCK_H,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 20 : 1,
      }}
      onKeyDown={props.onKey}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(e.clientX, e.clientY);
      }}
    >
      {props.draggable && (
        <span
          className="sb-handle start"
          data-handle="start"
          onPointerDown={(e) => props.onResize(e, "start")}
        />
      )}
      <span className="sb-text">
        {b.woNumber} {b.woTitle}
      </span>
      {props.draggable && (
        <span
          className="sb-handle end"
          data-handle="end"
          onPointerDown={(e) => props.onResize(e, "end")}
        />
      )}
    </div>
  );
}

function UnscheduledCard({ w, draggable }: { w: BoardUnscheduled; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `wo:${w.id}`,
    data: { kind: "wo", id: w.id, minutes: w.estDurationMin ?? 60 },
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`sb-card${isDragging ? " dragging" : ""}`}
      data-wo={w.id}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 30 : undefined,
      }}
    >
      <strong>{w.woNumber}</strong> {w.title}
      <div className="crm-muted">
        {w.estDurationMin ? `${w.estDurationMin} min` : "60 min (default)"} · {humanize(w.priority)}
      </div>
      <Link href={`/app/work-orders/${w.id}`} onPointerDown={(e) => e.stopPropagation()}>
        Open
      </Link>
    </div>
  );
}

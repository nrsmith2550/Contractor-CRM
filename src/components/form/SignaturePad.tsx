"use client";

import { useEffect, useRef } from "react";

/**
 * A finger/stylus/mouse signature pad. It reports a small PNG data URL (null when empty) each
 * time the stroke ends, and has a Clear button. The canvas keeps a fixed drawing size and scales
 * to the width of its container, so strokes land under the finger on any screen.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const ctx = ref.current!.getContext("2d")!;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  };

  return (
    <div>
      <canvas
        ref={ref}
        width={600}
        height={200}
        role="img"
        aria-label="Signature area. Draw the customer's signature here."
        data-testid="signature-pad"
        style={{
          width: "100%",
          height: "auto",
          aspectRatio: "3 / 1",
          border: "1px solid #888",
          borderRadius: 4,
          background: "#fff",
          touchAction: "none",
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const { x, y } = point(e);
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.beginPath();
          ctx.moveTo(x, y);
          // A tap leaves a dot.
          ctx.lineTo(x + 0.01, y);
          ctx.stroke();
          dirty.current = true;
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const { x, y } = point(e);
          const ctx = e.currentTarget.getContext("2d")!;
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          if (!drawing.current) return;
          drawing.current = false;
          onChange(dirty.current ? e.currentTarget.toDataURL("image/png") : null);
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <button
        type="button"
        className="crm-btn"
        onClick={() => {
          const c = ref.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          dirty.current = false;
          onChange(null);
        }}
      >
        Clear signature
      </button>
    </div>
  );
}

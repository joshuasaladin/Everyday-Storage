"use client";

import { useEffect, useRef, useState } from "react";

/** A canvas the signer draws on. The drawing travels with the form as a PNG data URL. */
export default function SignaturePad({ name = "signature" }: { name?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [value, setValue] = useState("");

  /** Match the bitmap to the box on screen. Called lazily, because inside a dialog the box has no size until it opens. */
  const fit = () => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.getBoundingClientRect();
    const w = Math.round(rect.width * ratio);
    const h = Math.round(rect.height * ratio);
    if (!w || !h || (c.width === w && c.height === h)) return;
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio);
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#111111";
    setValue("");
  };

  useEffect(() => {
    fit();
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div>
      <canvas
        ref={canvas}
        className="w-full rounded-[10px] touch-none"
        style={{ height: 150, background: "#fff", border: "1.5px dashed var(--line-2)", cursor: "crosshair" }}
        aria-label="Signature — draw with your finger or mouse"
        onPointerDown={(e) => {
          fit();
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const g = e.currentTarget.getContext("2d")!;
          const p = point(e);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x + 0.1, p.y + 0.1);
          g.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = e.currentTarget.getContext("2d")!;
          const p = point(e);
          g.lineTo(p.x, p.y);
          g.stroke();
        }}
        onPointerUp={(e) => {
          if (!drawing.current) return;
          drawing.current = false;
          setValue(e.currentTarget.toDataURL("image/png"));
        }}
      />
      <input type="hidden" name={name} value={value} />
      <div className="flex items-center justify-between mt-1.5">
        <span className="hint" style={{ marginTop: 0 }}>{value ? "Signature captured." : "Sign in the box above."}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            const c = canvas.current;
            if (!c) return;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setValue("");
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

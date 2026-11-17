"use client";

import { useEffect, useRef, useState } from "react";
import { compactMoney, money } from "@/lib/format";

export type Series = { name: string; color: string };
export type Point = { label: string; values: number[]; note?: string };
type Format = "money" | "percent" | "number";

function fmt(v: number, format: Format, currency: string, compact = false): string {
  if (format === "money") return compact ? compactMoney(v, currency) : money(v, currency);
  if (format === "percent") return `${Math.round(v * 100)}%`;
  return v.toLocaleString("en-US");
}

/** Round the top of the axis up to a clean number and return 4 even ticks. */
function scale(max: number, format: Format): number[] {
  if (format === "percent") return [0, 0.25, 0.5, 0.75, 1];
  const unit = format === "money" ? 100 : 1;
  const raw = Math.max(max / unit, 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= raw) ?? pow * 10;
  return [0, 1, 2, 3, 4].map((i) => i * step * unit);
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend mb-2">
      {series.map((s) => (
        <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
      ))}
    </div>
  );
}

function Tip({ x, width, point, series, format, currency }: { x: number; width: number; point: Point; series: Series[]; format: Format; currency: string }) {
  const left = Math.min(Math.max(x - 70, 0), Math.max(width - 150, 0));
  return (
    <div className="chart-tip" style={{ left, top: 0 }}>
      <div className="font-semibold mb-1" style={{ color: "var(--ink-3)" }}>{point.note ?? point.label}</div>
      {series.map((s, i) => (
        <div key={s.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: "var(--ink-2)" }}>
            <span style={{ width: 10, height: 2, background: s.color, display: "inline-block", borderRadius: 2 }} />
            {s.name}
          </span>
          <span className="font-semibold num">{fmt(point.values[i] ?? 0, format, currency)}</span>
        </div>
      ))}
    </div>
  );
}

const PAD = { top: 14, right: 8, bottom: 26, left: 46 };

/** Room for the widest y-axis label (e.g. "Afl. 10K" needs more than "$10K"). */
function leftPad(ticks: number[], format: Format, currency: string): number {
  const widest = Math.max(...ticks.map((t) => fmt(t, format, currency, true).length));
  return Math.max(PAD.left, Math.ceil(widest * 6.4) + 14);
}

/** Grouped columns: one group per label, up to three series. */
export function BarChart({ data, series, format = "money", currency = "USD", height = 240, ariaLabel }: {
  data: Point[]; series: Series[]; format?: Format; currency?: string; height?: number; ariaLabel: string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const ticks = scale(max, format);
  const top = ticks[ticks.length - 1];
  const L = leftPad(ticks, format, currency);
  const innerW = Math.max(width - L - PAD.right, 10);
  const innerH = height - PAD.top - PAD.bottom;
  const band = innerW / Math.max(data.length, 1);
  const gap = 2;
  const barW = Math.max(3, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => PAD.top + innerH - (Math.max(v, 0) / top) * innerH;
  const every = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 44)));

  return (
    <div>
      <Legend series={series} />
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                <text x={L - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--ink-3)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmt(t, format, currency, true)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = L + band * i + (band - groupW) / 2;
              return (
                <g key={d.label + i} opacity={hover === null || hover === i ? 1 : 0.45}>
                  {d.values.map((v, s) => {
                    const h = Math.max(PAD.top + innerH - y(v), v > 0 ? 2 : 0);
                    const r = Math.min(4, barW / 2, h);
                    const x = x0 + s * (barW + gap);
                    const yy = PAD.top + innerH - h;
                    return h > 0 ? (
                      <path key={s} fill={series[s].color}
                        d={`M${x},${yy + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${yy + h} Z`} />
                    ) : null;
                  })}
                  {i % every === 0 && (
                    <text x={L + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize={10.5} fill="var(--ink-3)">{d.label}</text>
                  )}
                  <rect x={L + band * i} y={PAD.top} width={band} height={innerH + PAD.bottom} fill="transparent"
                    tabIndex={0} aria-label={`${d.note ?? d.label}: ${series.map((s, k) => `${s.name} ${fmt(d.values[k] ?? 0, format, currency)}`).join(", ")}`}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} style={{ outline: "none" }} />
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && data[hover] && (
          <Tip x={L + band * hover + band / 2} width={width} point={data[hover]} series={series} format={format} currency={currency} />
        )}
      </div>
    </div>
  );
}

/** Lines over time with a crosshair; `area` washes the first series. */
export function LineChart({ data, series, format = "money", currency = "USD", height = 220, area, ariaLabel }: {
  data: Point[]; series: Series[]; format?: Format; currency?: string; height?: number; area?: boolean; ariaLabel: string;
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const ticks = scale(max, format);
  const top = ticks[ticks.length - 1];
  const L = leftPad(ticks, format, currency);
  const innerW = Math.max(width - L - PAD.right - 8, 10);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => L + 4 + (data.length > 1 ? (innerW * i) / (data.length - 1) : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (Math.max(v, 0) / top) * innerH;
  const every = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 48)));
  const path = (s: number) => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.values[s] ?? 0).toFixed(1)}`).join(" ");

  const move = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - rect.left - L - 4;
    const i = Math.round((rel / innerW) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div>
      <Legend series={series} />
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseMove={move} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                <text x={L - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--ink-3)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmt(t, format, currency, true)}
                </text>
              </g>
            ))}
            {data.map((d, i) => i % every === 0 && (
              <text key={d.label + i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={10.5} fill="var(--ink-3)">{d.label}</text>
            ))}
            {area && data.length > 1 && (
              <path d={`${path(0)} L${x(data.length - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`} fill={series[0].color} opacity={0.1} />
            )}
            {series.map((s, k) => (
              <path key={s.name} d={path(k)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--axis)" strokeWidth={1} />
                {series.map((s, k) => (
                  <circle key={s.name} cx={x(hover)} cy={y(data[hover].values[k] ?? 0)} r={4.5} fill={s.color} stroke="var(--panel)" strokeWidth={2} />
                ))}
              </g>
            )}
            {hover === null && data.length > 0 && series.map((s, k) => (
              <circle key={s.name} cx={x(data.length - 1)} cy={y(data[data.length - 1].values[k] ?? 0)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />
            ))}
          </svg>
        )}
        {hover !== null && data[hover] && <Tip x={x(hover)} width={width} point={data[hover]} series={series} format={format} currency={currency} />}
      </div>
    </div>
  );
}

/** One whole split into parts — a thin segmented bar with a legend that carries the numbers. */
export function SegmentBar({ parts, total }: { parts: { label: string; value: number; color: string }[]; total?: number }) {
  const sum = total ?? parts.reduce((a, p) => a + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="flex w-full overflow-hidden" style={{ height: 10, borderRadius: 99, gap: 2, background: sum ? "transparent" : "var(--muted-bg)" }} role="img"
        aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {shown.map((p) => (
          <div key={p.label} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / sum) * 100}%`, background: p.color, borderRadius: 99, minWidth: 4 }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 mt-3 text-xs">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 min-w-0" style={{ color: "var(--ink-2)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color, flexShrink: 0 }} />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="font-semibold num">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

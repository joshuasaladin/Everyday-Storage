"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";
import { placeUnitAction } from "@/lib/actions/units";
import { money } from "@/lib/format";

export type MapUnit = {
  id: string;
  number: string;
  status: "available" | "occupied" | "reserved" | "unavailable";
  type: string;
  size: string;
  dims: string;
  area: number;
  price: number;
  location: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  renter: string | null;
  renterId: string | null;
  agreementId: string | null;
  until: string | null;
  note: string | null;
};

const STATUS: { key: MapUnit["status"]; label: string; mark: string }[] = [
  { key: "available", label: "Available", mark: "" },
  { key: "occupied", label: "Occupied", mark: "●" },
  { key: "reserved", label: "Reserved", mark: "◐" },
  { key: "unavailable", label: "Unavailable", mark: "—" },
];

export default function FacilityMap({
  units, cols, rows, currency, canEdit, canAgreements, initial,
}: {
  units: MapUnit[]; cols: number; rows: number; currency: string; canEdit: boolean; canAgreements: boolean; initial?: string;
}) {
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [filter, setFilter] = useState<MapUnit["status"] | null>(null);
  const [edit, setEdit] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const current = units.find((u) => u.id === selected) ?? null;
  const counts = useMemo(() => Object.fromEntries(STATUS.map((s) => [s.key, units.filter((u) => u.status === s.key).length])), [units]);
  const taken = useMemo(() => {
    const set = new Set<string>();
    for (const u of units) for (let dx = 0; dx < u.w; dx++) for (let dy = 0; dy < u.h; dy++) set.add(`${u.x + dx},${u.y + dy}`);
    return set;
  }, [units]);

  const place = (u: MapUnit, x: number, y: number, w = u.w, h = u.h) =>
    start(async () => {
      const res = await placeUnitAction({ id: u.id, x, y, w, h });
      setMessage(res?.error ? { tone: "bad", text: res.error } : { tone: "good", text: res?.ok ?? "Saved." });
      if (!res?.error) router.refresh();
    });

  const empties: { x: number; y: number }[] = [];
  if (edit) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!taken.has(`${x},${y}`)) empties.push({ x, y });

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
      <div className="panel p-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {STATUS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`chip unit-${s.key} cursor-pointer`}
              style={{ border: "1.5px solid", opacity: filter && filter !== s.key ? 0.45 : 1, padding: ".25rem .65rem" }}
              aria-pressed={filter === s.key}
              onClick={() => setFilter(filter === s.key ? null : s.key)}
            >
              {s.mark && <span aria-hidden>{s.mark}</span>}
              {s.label} · {counts[s.key] ?? 0}
            </button>
          ))}
          {canEdit && (
            <button type="button" className={`btn btn-sm ml-auto ${edit ? "btn-accent" : ""}`} onClick={() => { setEdit(!edit); setMessage(null); }}>
              <Icon name="edit" className="w-3.5 h-3.5" />
              {edit ? "Done arranging" : "Arrange layout"}
            </button>
          )}
        </div>

        {edit && (
          <p className="text-xs mb-3" style={{ color: "var(--ink-3)" }}>
            Select a unit, then click an empty cell to move it there. Use the panel to change how many cells it covers.
          </p>
        )}
        {message && <div className={`notice notice-${message.tone} mb-3`} role="status">{message.text}</div>}

        <div className="scroll-x pb-1">
          <div
            role="grid"
            aria-label="Facility layout"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, minmax(38px, 1fr))`,
              gridAutoRows: "minmax(38px, auto)",
              gap: 5,
              minWidth: cols * 43,
              opacity: pending ? 0.6 : 1,
            }}
          >
            {empties.map((c) => (
              <button
                key={`${c.x},${c.y}`}
                type="button"
                className="map-empty"
                data-edit="true"
                aria-label={`Empty cell, column ${c.x + 1}, row ${c.y + 1}`}
                style={{ gridColumn: c.x + 1, gridRow: c.y + 1, aspectRatio: "1" }}
                onClick={() => current && place(current, c.x, c.y)}
              />
            ))}
            {units.map((u) => {
              const s = STATUS.find((x) => x.key === u.status)!;
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`unit-cell unit-${u.status}`}
                  data-selected={selected === u.id}
                  data-dim={filter !== null && filter !== u.status}
                  style={{ gridColumn: `${u.x + 1} / span ${u.w}`, gridRow: `${u.y + 1} / span ${u.h}`, aspectRatio: `${u.w} / ${u.h}` }}
                  aria-label={`Unit ${u.number}, ${s.label}${u.renter ? `, ${u.renter}` : ""}`}
                  onClick={() => setSelected(selected === u.id && !edit ? null : u.id)}
                >
                  <span>{u.number}</span>
                  {(u.w > 1 || u.h > 1) && <span style={{ fontWeight: 500, opacity: 0.85, fontSize: ".62rem" }}>{u.dims.replace(/ × [\d.]+ m$/, "").replace(" m", "")}</span>}
                  {s.mark && <span aria-hidden style={{ fontSize: ".6rem", lineHeight: 1 }}>{s.mark}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="panel p-4 xl:sticky xl:top-20" aria-live="polite">
        {!current ? (
          <div className="empty" style={{ padding: "2rem .5rem" }}>
            <Icon name="map" className="w-6 h-6 mx-auto mb-2" />
            <div className="font-medium" style={{ color: "var(--ink-2)" }}>Select a unit</div>
            <div className="mt-1">Click any unit on the map to see who rents it, its price and what you can do next.</div>
          </div>
        ) : (
          <div className="rise" key={current.id}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <div className="eyebrow mb-0.5">{current.location ?? "Unit"}</div>
                <h2 className="section-title">Unit {current.number}</h2>
              </div>
              <span className={`chip unit-${current.status}`}>{STATUS.find((s) => s.key === current.status)!.label}</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-4">
              <div><dt className="label">Size</dt><dd>{current.dims}</dd></div>
              <div><dt className="label">Area</dt><dd>{current.area} m²</dd></div>
              <div><dt className="label">Type</dt><dd>{current.type}</dd></div>
              <div><dt className="label">Price</dt><dd className="font-semibold">{money(current.price, currency)}<span style={{ color: "var(--ink-3)", fontWeight: 400 }}> /mo</span></dd></div>
              {current.renter && <div className="col-span-2"><dt className="label">{current.status === "reserved" ? "Held for" : "Renter"}</dt><dd>{current.renterId ? <Link className="link" href={`/renters/${current.renterId}`}>{current.renter}</Link> : current.renter}</dd></div>}
              {current.until && <div className="col-span-2"><dt className="label">{current.status === "reserved" ? "Hold" : "Term"}</dt><dd>{current.until}</dd></div>}
              {current.note && <div className="col-span-2"><dt className="label">Note</dt><dd style={{ color: "var(--ink-2)" }}>{current.note}</dd></div>}
            </dl>

            {edit ? (
              <div className="space-y-3">
                <div className="label">Cells covered</div>
                {(["w", "h"] as const).map((dim) => (
                  <div key={dim} className="flex items-center justify-between gap-2 text-sm">
                    <span>{dim === "w" ? "Width" : "Depth"}</span>
                    <span className="flex items-center gap-2">
                      <button type="button" className="btn btn-sm btn-icon" disabled={pending || current[dim] <= 1} aria-label="Smaller"
                        onClick={() => place(current, current.x, current.y, dim === "w" ? current.w - 1 : current.w, dim === "h" ? current.h - 1 : current.h)}>−</button>
                      <span className="num w-5 text-center font-semibold">{current[dim]}</span>
                      <button type="button" className="btn btn-sm btn-icon" disabled={pending} aria-label="Larger"
                        onClick={() => place(current, current.x, current.y, dim === "w" ? current.w + 1 : current.w, dim === "h" ? current.h + 1 : current.h)}>+</button>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Link href={`/units/${current.id}`} className="btn btn-primary">Open unit</Link>
                {current.agreementId && canAgreements && <Link href={`/agreements/${current.agreementId}`} className="btn">View agreement</Link>}
                {current.status === "available" && canAgreements && <Link href={`/agreements/new?unit=${current.id}`} className="btn">New agreement</Link>}
                {current.status === "available" && <Link href={`/reservations?new=1&unit=${current.id}`} className="btn">Reserve this unit</Link>}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

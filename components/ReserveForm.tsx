"use client";

import { useState } from "react";
import { ActionForm } from "./forms";
import { Field } from "./ui";
import { publicReserveAction } from "@/lib/actions/public";

export type ReserveOption = {
  key: "small" | "standard" | "warehouse";
  title: string;
  size: string;
  area: string | null;
  price: string;
  priceNote: string;
  note: string | null;
};

type Choice = "" | "small" | "standard" | "warehouse";

/** The public request form. Type comes first; Storage unit asks for a size, Warehouse asks for square metres. */
export default function ReserveForm({
  options, facilities, holdDays, today,
}: {
  options: ReserveOption[]; facilities: { id: string; name: string }[]; holdDays: number; today: string;
}) {
  const [type, setType] = useState<"" | "storage_unit" | "warehouse">("");
  const [size, setSize] = useState<"" | "small" | "standard">("");
  const chosen: Choice = type === "warehouse" ? "warehouse" : type === "storage_unit" ? size : "";

  const pick = (key: ReserveOption["key"]) => {
    if (key === "warehouse") {
      setType("warehouse");
      setSize("");
    } else {
      setType("storage_unit");
      setSize(key);
    }
    document.getElementById("request")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
      <section>
        <h2 className="section-title mb-1">Choose from</h2>
        <p className="text-sm mb-4" style={{ color: "var(--ink-3)" }}>
          Pick the option that suits you and send us your details. We will contact you to confirm a unit and your move-in date — no payment is needed to reserve.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {options.map((o) => {
            const active = chosen === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => pick(o.key)}
                aria-pressed={active}
                className="panel p-4 text-left flex flex-col gap-3 cursor-pointer hover:-translate-y-px transition-transform"
                style={active ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent)" } : undefined}
              >
                <div>
                  <div className="eyebrow mb-1">{o.key === "warehouse" ? "Warehouse" : "Storage unit"}</div>
                  <div className="section-title">{o.title}</div>
                </div>
                <div className="text-sm" style={{ color: "var(--ink-2)" }}>
                  <div className="font-medium" style={{ color: "var(--ink)" }}>{o.size}</div>
                  {o.area && <div>{o.area}</div>}
                </div>
                <div className="mt-auto">
                  <div className="stat-value" style={{ fontSize: "1.3rem" }}>{o.price}</div>
                  <div className="text-xs" style={{ color: "var(--ink-3)" }}>{o.priceNote}</div>
                  {o.note && <div className="text-xs mt-2" style={{ color: "var(--ink-3)" }}>{o.note}</div>}
                </div>
                <span className={`btn btn-sm ${active ? "btn-accent" : ""} w-full`}>{active ? "Selected" : "Choose"}</span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="panel p-5 lg:sticky lg:top-6" id="request">
        <h2 className="section-title mb-1">Request a unit</h2>
        <p className="text-sm mb-4" style={{ color: "var(--ink-3)" }}>
          We hold a matching unit for you for {holdDays} days once we confirm it with you.
        </p>
        <ActionForm action={publicReserveAction} submit="Send request" pendingLabel="Sending…" submitClass="btn btn-primary w-full" resetOnOk>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
          <div className="space-y-4">
            <Field label="Type">
              <select
                className="select"
                name="desired_type"
                required
                value={type}
                onChange={(e) => {
                  setType(e.target.value as typeof type);
                  setSize("");
                }}
              >
                <option value="" disabled>Choose a type…</option>
                <option value="storage_unit">Storage unit</option>
                <option value="warehouse">Warehouse</option>
              </select>
            </Field>

            {type === "storage_unit" && (
              <Field label="Size">
                <select className="select" name="desired_size" required value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
                  <option value="" disabled>Choose a size…</option>
                  {options.filter((o) => o.key !== "warehouse").map((o) => (
                    <option key={o.key} value={o.key}>{o.title} — {o.size}</option>
                  ))}
                </select>
              </Field>
            )}

            {type === "warehouse" && (
              <Field label="Square metres needed" hint="Roughly how much floor space you need.">
                <input className="input" name="desired_area_m2" type="number" inputMode="decimal" min={1} max={10000} step="0.5" placeholder="e.g. 40" required />
              </Field>
            )}

            {facilities.length > 1 ? (
              <Field label="Location">
                <select className="select" name="facility_id">{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
              </Field>
            ) : <input type="hidden" name="facility_id" value={facilities[0]?.id ?? ""} />}

            <Field label="Your name"><input className="input" name="name" required maxLength={120} autoComplete="name" /></Field>
            <Field label="Phone"><input className="input" name="phone" required maxLength={40} autoComplete="tel" placeholder="+297 …" /></Field>
            <Field label="Email"><input className="input" type="email" name="email" required autoComplete="email" /></Field>
            <Field label="When do you want to move in?"><input className="input" type="date" name="desired_start" min={today} /></Field>
            <Field label="Anything else?"><textarea className="textarea" name="notes" maxLength={600} style={{ minHeight: "4rem" }} /></Field>
          </div>
        </ActionForm>
        <p className="hint mt-3">We only use your details to arrange your storage.</p>
      </aside>
    </div>
  );
}

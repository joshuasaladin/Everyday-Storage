"use client";

import { useState } from "react";
import { ActionForm } from "./forms";
import { Check, Field } from "./ui";
import { saveUnitAction } from "@/lib/actions/units";
import { SIZE_PRESETS, UNIT_SIZES, UNIT_TYPES } from "@/lib/unit-options";
import { centsInput } from "@/lib/format";

const str = (v: unknown) => (v === null || v === undefined || v === "" || Number(v) === 0 ? "" : String(v));

export default function UnitForm({ unit, facilities, facilityId, currency, prices = {}, defaultLocation = "" }: {
  unit?: Record<string, any>; facilities: { id: string; name: string }[]; facilityId: string | null; currency: string;
  /** standard monthly price per size class, in cents (Settings → Prices) */
  prices?: Record<string, number>;
  /** location pre-filled on a new unit */
  defaultLocation?: string;
}) {
  const [type, setType] = useState<string>(unit?.type ?? "storage_unit");
  const [size, setSize] = useState<string>(unit?.size_label ?? "standard");
  const [width, setWidth] = useState(str(unit?.width_m ?? SIZE_PRESETS.standard?.width));
  const [depth, setDepth] = useState(str(unit?.depth_m ?? SIZE_PRESETS.standard?.depth));
  const [height, setHeight] = useState(str(unit?.height_m ?? SIZE_PRESETS.standard?.height));
  const [price, setPrice] = useState(unit ? centsInput(unit.monthly_price_cents) : prices.standard ? centsInput(prices.standard) : "");
  const preset = SIZE_PRESETS[size];

  const pickSize = (next: string) => {
    setSize(next);
    const p = SIZE_PRESETS[next];
    if (p) {
      setWidth(String(p.width));
      setDepth(String(p.depth));
      setHeight(String(p.height));
      setType("storage_unit");
      // use the standard price, unless this unit already has a price of its own
      const standardPrices = Object.values(prices).filter(Boolean).map((c) => centsInput(c));
      if (prices[next] && (!price || standardPrices.includes(price))) setPrice(centsInput(prices[next]));
    } else {
      // large: sizes vary, so start empty
      setWidth("");
      setDepth("");
      setHeight("");
    }
  };

  const pickType = (next: string) => {
    setType(next);
    if (next === "warehouse" && size !== "large") pickSize("large");
  };

  return (
    <ActionForm action={saveUnitAction} submit={unit ? "Save changes" : "Create unit"} cancelHref={unit ? `/units/${unit.id}` : "/units"} className="panel p-5 max-w-3xl">
      {unit && <input type="hidden" name="id" value={unit.id} />}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Unit number" hint="Unique within the facility, e.g. A12.">
          <input className="input" name="unit_number" defaultValue={unit?.unit_number} required maxLength={20} autoFocus={!unit} />
        </Field>
        {unit ? (
          <Field label="Facility"><input className="input" value={facilities.find((f) => f.id === unit.facility_id)?.name ?? ""} disabled readOnly /></Field>
        ) : (
          <Field label="Facility">
            <select className="select" name="facility_id" defaultValue={facilityId ?? facilities[0]?.id}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Type">
          <select className="select" name="type" value={type} onChange={(e) => pickType(e.target.value)}>
            {UNIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Size class" hint={preset ? `Fills in ${preset.width} × ${preset.depth} × ${preset.height} m.` : "Enter the measurements — large units and warehouses vary."}>
          <select className="select" name="size_label" value={size} onChange={(e) => pickSize(e.target.value)}>
            {UNIT_SIZES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <Field label="Width (m)"><input className="input" name="width_m" type="number" step="0.01" min="0.1" value={width} onChange={(e) => setWidth(e.target.value)} required /></Field>
          <Field label="Depth (m)"><input className="input" name="depth_m" type="number" step="0.01" min="0.1" value={depth} onChange={(e) => setDepth(e.target.value)} required /></Field>
          <Field label="Height (m)"><input className="input" name="height_m" type="number" step="0.01" min="0" value={height} onChange={(e) => setHeight(e.target.value)} /></Field>
        </div>
        <Field label={`Monthly price (${currency})`}>
          <input className="input" name="monthly_price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" required />
        </Field>
        <Field label="Location" hint="Building, row or floor.">
          <input className="input" name="location" defaultValue={unit?.location ?? defaultLocation} maxLength={120} />
        </Field>
        <Field label="Features" hint="Climate control, drive-up access, power…" className="sm:col-span-2">
          <input className="input" name="features" defaultValue={unit?.features ?? ""} maxLength={500} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea className="textarea" name="notes" defaultValue={unit?.notes ?? ""} />
        </Field>
        <div className="sm:col-span-2">
          <Check name="offline" label="Take this unit offline" defaultChecked={Boolean(unit?.offline)} hint="Marks it unavailable for rent. Occupancy and reservations still set the status automatically." />
        </div>
      </div>
    </ActionForm>
  );
}

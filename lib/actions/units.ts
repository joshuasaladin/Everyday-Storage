"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard, facilityOf } from "../guard";
import { audit } from "../audit";
import { nowIso } from "../clock";
import { act, Form, UserError, type ActionState } from "../validate";
import { createUnit, unitDeleteBlocker, updateUnit, UNIT_SIZES, UNIT_TYPES, type UnitInput } from "../units";

export async function saveUnitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("units.edit");
    const f = new Form(form);
    const unitId = f.str("id");
    const existing = unitId ? ctx.db.one<{ facility_id: string }>(`SELECT facility_id FROM units WHERE id = ?`, [unitId]) : null;
    if (unitId && !existing) throw new UserError("Unit not found.");
    const input: UnitInput = {
      facility_id: existing?.facility_id ?? facilityOf(ctx, form),
      unit_number: f.req("unit_number", { max: 20, label: "Unit number" }).toUpperCase(),
      type: f.oneOf("type", UNIT_TYPES.map((t) => t.value)),
      size_label: f.oneOf("size_label", UNIT_SIZES.map((t) => t.value), { label: "Size" }),
      width_ft: f.num("width_ft", { required: true, min: 0.5, max: 500, label: "Width" }) ?? 0,
      depth_ft: f.num("depth_ft", { required: true, min: 0.5, max: 500, label: "Depth" }) ?? 0,
      height_ft: f.num("height_ft", { min: 0, max: 100, label: "Height" }) ?? 0,
      location: f.str("location", { max: 120 }),
      monthly_price_cents: f.cents("monthly_price", { required: true, label: "Monthly price" }) ?? 0,
      offline: f.bool("offline") ? 1 : 0,
      available_from: f.date("available_from"),
      features: f.str("features", { max: 500 }),
      notes: f.text("notes", { max: 4000 }),
    };
    f.check();
    if (unitId) {
      updateUnit(ctx.db, unitId, input);
      audit(ctx.db, ctx.actor, "update", "unit", unitId, `Updated unit ${input.unit_number}`);
      redirect(`/units/${unitId}`);
    }
    const newId = createUnit(ctx.db, input);
    audit(ctx.db, ctx.actor, "create", "unit", newId, `Created unit ${input.unit_number}`);
    redirect(`/units/${newId}`);
  });
}

export async function deleteUnitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("units.edit");
    const unitId = String(form.get("id") ?? "");
    const unit = ctx.db.one<{ unit_number: string }>(`SELECT unit_number FROM units WHERE id = ?`, [unitId]);
    if (!unit) throw new UserError("Unit not found.");
    const blocker = unitDeleteBlocker(ctx.db, unitId);
    if (blocker) throw new UserError(blocker);
    ctx.db.run(`DELETE FROM units WHERE id = ?`, [unitId]);
    audit(ctx.db, ctx.actor, "delete", "unit", unitId, `Deleted unit ${unit.unit_number}`);
    redirect("/units");
  });
}

/** Facility map layout edits: move a unit to a cell, or change how many cells it covers. */
export async function placeUnitAction(input: { id: string; x: number; y: number; w: number; h: number }): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("units.edit");
    const unit = ctx.db.one<{ facility_id: string; unit_number: string }>(`SELECT facility_id, unit_number FROM units WHERE id = ?`, [input.id]);
    if (!unit) throw new UserError("Unit not found.");
    const fac = ctx.db.one<{ map_cols: number; map_rows: number }>(`SELECT map_cols, map_rows FROM facilities WHERE id = ?`, [unit.facility_id])!;
    const { x, y, w, h } = input;
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || w > 8 || h > 8) throw new UserError("That position is not valid.");
    if (x + w > fac.map_cols || y + h > fac.map_rows) throw new UserError("That does not fit on the grid.");
    const clash = ctx.db.one<{ unit_number: string }>(
      `SELECT unit_number FROM units WHERE facility_id = ? AND id <> ? AND map_x IS NOT NULL
          AND map_x < ? AND map_x + map_w > ? AND map_y < ? AND map_y + map_h > ? LIMIT 1`,
      [unit.facility_id, input.id, x + w, x, y + h, y],
    );
    if (clash) throw new UserError(`That space overlaps unit ${clash.unit_number}.`);
    ctx.db.run(`UPDATE units SET map_x = ?, map_y = ?, map_w = ?, map_h = ?, updated_at = ? WHERE id = ?`, [x, y, w, h, nowIso(), input.id]);
    revalidatePath("/map");
    return { ok: `Unit ${unit.unit_number} moved.` };
  });
}

export async function resizeGridAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("units.edit");
    const f = new Form(form);
    const facilityId = f.req("facility_id");
    const cols = f.int("map_cols", { required: true, min: 4, max: 40, label: "Columns" }) ?? 16;
    const rows = f.int("map_rows", { required: true, min: 2, max: 60, label: "Rows" }) ?? 10;
    f.check();
    const edge = ctx.db.one<{ mx: number | null; my: number | null }>(
      `SELECT MAX(map_x + map_w) AS mx, MAX(map_y + map_h) AS my FROM units WHERE facility_id = ? AND map_x IS NOT NULL`,
      [facilityId],
    );
    if ((edge?.mx ?? 0) > cols || (edge?.my ?? 0) > rows) throw new UserError(`Units already sit outside that size. The grid must be at least ${edge?.mx} × ${edge?.my}.`);
    ctx.db.run(`UPDATE facilities SET map_cols = ?, map_rows = ?, updated_at = ? WHERE id = ?`, [cols, rows, nowIso(), facilityId]);
    revalidatePath("/map");
    return { ok: "Grid resized." };
  });
}

"use client";

import { useState } from "react";
import { ActionForm } from "./forms";
import { reconcileAction } from "@/lib/actions/billing";
import { money } from "@/lib/format";

type Row = { id: string; no: string; date: string; renter: string; method: string; reference: string | null; amount: number; flag: string | null };

/** Tick the payments that appear on a bank statement; the running total should match the statement. */
export default function ReconcileForm({ rows, currency }: { rows: Row[]; currency: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const total = rows.filter((r) => picked.has(r.id)).reduce((a, r) => a + r.amount, 0);
  const all = picked.size === rows.length && rows.length > 0;

  return (
    <ActionForm action={reconcileAction} submit={`Mark ${picked.size || ""} as reconciled`} hideOk
      footer={<span className="text-sm ml-auto" style={{ color: "var(--ink-2)" }}>Selected total <strong className="num">{money(total, currency)}</strong></span>}>
      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th>Payment</th><th>Date</th><th>Renter</th><th>Method</th><th>Reference</th><th className="r">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => toggle(r.id)} style={{ cursor: "pointer" }}>
                <td><input type="checkbox" name="payment_id" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${r.no}`} /></td>
                <td className="primary">{r.no}{r.flag && <div className="text-xs font-normal" style={{ color: "var(--warn-fg)" }}>{r.flag}</div>}</td>
                <td className="whitespace-nowrap">{r.date}</td>
                <td>{r.renter}</td>
                <td>{r.method}</td>
                <td>{r.reference ?? "—"}</td>
                <td className="r num">{money(r.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 pt-4 max-w-sm">
        <label className="block">
          <span className="label">Statement reference</span>
          <input className="input" name="statement_ref" maxLength={80} placeholder="e.g. Bank statement Nov 2026" />
        </label>
      </div>
    </ActionForm>
  );
}

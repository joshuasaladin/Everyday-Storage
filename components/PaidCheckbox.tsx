"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markPaidAction } from "@/lib/actions/billing";

/** Tick when the renter has paid; untick to undo. Records (or removes) the payment for the balance. */
export default function PaidCheckbox({ invoiceId, invoiceNo, paid, disabled, withLabel }: {
  invoiceId: string; invoiceNo: string; paid: boolean; disabled?: boolean; withLabel?: boolean;
}) {
  const [checked, setChecked] = useState(paid);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <label className={`inline-flex items-center gap-2 text-sm select-none ${disabled ? "" : "cursor-pointer"}`} title={disabled ? undefined : checked ? "Untick to mark unpaid" : "Tick when this invoice has been paid"}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || pending}
          aria-label={`${invoiceNo} paid`}
          style={{ width: "1.15rem", height: "1.15rem" }}
          onChange={(e) => {
            const next = e.target.checked;
            if (!next && !window.confirm(`Mark ${invoiceNo} as unpaid again? The payment recorded when it was ticked will be removed.`)) return;
            setChecked(next);
            setError(null);
            start(async () => {
              const r = await markPaidAction(invoiceId, next);
              if (r?.error) {
                setChecked(!next);
                setError(r.error);
              } else router.refresh();
            });
          }}
        />
        {withLabel && <span className="font-medium">{pending ? "Saving…" : checked ? "Paid" : "Mark as paid"}</span>}
      </label>
      {error && <span className="text-xs max-w-[16rem]" style={{ color: "var(--bad-fg)" }} role="alert">{error}</span>}
    </span>
  );
}

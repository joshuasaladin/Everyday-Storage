"use client";

import { useRouter } from "next/navigation";

/**
 * A table row that opens its record when clicked anywhere. Links, buttons and
 * form controls inside the row keep their own behaviour.
 */
export default function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className="row-link"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, label, textarea")) return;
        if (window.getSelection()?.toString()) return; // let people select text
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
    >
      {children}
    </tr>
  );
}

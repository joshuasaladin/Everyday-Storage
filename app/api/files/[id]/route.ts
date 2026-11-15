import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth";
import { readDocument } from "@/lib/files";
import { can, type Cap } from "@/lib/roles";

export const dynamic = "force-dynamic";

const VIEW: Record<string, Cap> = { renter: "renters.view", agreement: "agreements.view", unit: "units.view", maintenance: "maintenance.view", expense: "finance.view" };
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/** The only way a stored document leaves the server. Checks the session and the record on every request. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new NextResponse("Not signed in", { status: 401 });
  const { id } = await params;
  const doc = ctx.db.one<Record<string, any>>(`SELECT * FROM documents WHERE id = ?`, [id]);
  if (!doc) return new NextResponse("Not found", { status: 404 });

  if (ctx.user.role === "renter") {
    // a renter sees only documents that are theirs and have been shared with them
    if (doc.renter_id !== ctx.user.renter_id || !doc.renter_visible) return new NextResponse("Not found", { status: 404 });
  } else {
    const cap = VIEW[doc.entity];
    if (!cap || !can(ctx.user.role, cap)) return new NextResponse("Not permitted", { status: 403 });
    // ID documents are as sensitive as the ID number itself
    if (doc.category === "id" && !can(ctx.user.role, "renters.sensitive")) return new NextResponse("Not permitted", { status: 403 });
  }

  try {
    const bytes = await readDocument(ctx.db, doc.storage_key);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mime_type,
        "Content-Disposition": `${INLINE.has(doc.mime_type) ? "inline" : "attachment"}; filename="${encodeURIComponent(doc.name)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new NextResponse("File is missing from storage", { status: 410 });
  }
}

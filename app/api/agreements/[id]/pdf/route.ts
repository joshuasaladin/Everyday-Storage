import { NextResponse } from "next/server";
import { authorize, pdfResponse } from "@/lib/api";
import { activeWorkspace } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { agreementPdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb(await activeWorkspace());
  const ag = db.one<{ renter_id: string }>(`SELECT renter_id FROM agreements WHERE id = ?`, [id]);
  const ctx = await authorize("agreements.view", ag?.renter_id);
  if (ctx instanceof NextResponse) return ctx;
  if (!ag) return new NextResponse("Not found", { status: 404 });
  const pdf = await agreementPdf(ctx.db, id);
  return pdfResponse(pdf.bytes, pdf.filename);
}

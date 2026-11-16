import { NextResponse } from "next/server";
import { authorize, pdfResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { receiptPdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const pay = db.one<{ renter_id: string }>(`SELECT renter_id FROM payments WHERE id = ?`, [id]);
  const ctx = await authorize("finance.view", pay?.renter_id);
  if (ctx instanceof NextResponse) return ctx;
  if (!pay) return new NextResponse("Not found", { status: 404 });
  const pdf = await receiptPdf(ctx.db, id);
  return pdfResponse(pdf.bytes, pdf.filename);
}

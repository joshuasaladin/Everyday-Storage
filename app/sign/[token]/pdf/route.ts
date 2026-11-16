import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { agreementBySignToken } from "@/lib/agreements";
import { agreementPdf } from "@/lib/pdf";
import { pdfResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The renter's own signed copy, reachable only through their personal signing link, once it is signed. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const ag = agreementBySignToken(db, token);
  if (ag) {
    if (!ag.signed_at) return new NextResponse("Not signed yet", { status: 404 });
    const pdf = await agreementPdf(db, ag.id);
    return pdfResponse(pdf.bytes, pdf.filename);
  }
  return new NextResponse("This link is no longer valid", { status: 404 });
}

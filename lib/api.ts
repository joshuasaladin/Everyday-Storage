import { NextResponse } from "next/server";
import { getCtx, type Ctx } from "./auth";
import { can, type Cap } from "./roles";

/**
 * Who may fetch a document over HTTP: staff with the capability, or the
 * renter the record belongs to. Returns the context or an error response.
 */
export async function authorize(cap: Cap, ownerRenterId?: string | null): Promise<Ctx | NextResponse> {
  const ctx = await getCtx();
  if (!ctx) return new NextResponse("Not signed in", { status: 401 });
  if (ctx.user.role === "renter") {
    if (ownerRenterId && ctx.user.renter_id === ownerRenterId) return ctx;
    return new NextResponse("Not found", { status: 404 });
  }
  if (!can(ctx.user.role, cap)) return new NextResponse("Not permitted", { status: 403 });
  return ctx;
}

export function pdfResponse(bytes: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function csvResponse(body: string, filename: string): NextResponse {
  return new NextResponse(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

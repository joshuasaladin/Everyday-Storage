import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handleWebhook, verifySignature } from "@/lib/gateway";

export const dynamic = "force-dynamic";

/**
 * Payment-gateway webhook. The body must carry a valid HMAC-SHA256 signature
 * (header x-signature) made with PAYMENT_WEBHOOK_SECRET; each event id is
 * processed once. This is the only automated path that can mark money as
 * received — and only for an event the gateway says succeeded.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-signature"))) return new NextResponse("Invalid signature", { status: 401 });
  const result = handleWebhook(getDb("live"), raw);
  return NextResponse.json({ result: result.message }, { status: result.status });
}

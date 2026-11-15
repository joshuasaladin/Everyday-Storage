import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { tick } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * Optional external trigger for the job runner (Render Cron, uptime pinger…):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron
 * It does the same idempotent tick the in-process scheduler does, so calling
 * it as well as — or instead of — the built-in scheduler is safe.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(secret, given)) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json({ live: await tick("live") });
}

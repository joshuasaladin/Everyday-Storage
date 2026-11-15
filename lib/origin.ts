import { headers } from "next/headers";

/**
 * The app's public address, e.g. https://everyday-storage-hq.onrender.com.
 * APP_URL wins when set; otherwise it is read from the incoming request
 * (Render passes the original host and protocol in x-forwarded-* headers).
 */
export async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

/**
 * Field-level encryption for the few values that should not sit in the
 * database in the clear (renter ID / passport numbers).
 *
 * The key comes from APP_SECRET. Without one, a key is generated once and
 * kept beside the data with owner-only permissions — fine for a single
 * server, but set APP_SECRET in production so backups of the disk alone
 * cannot be decrypted.
 */
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cachedKey = crypto.createHash("sha256").update(fromEnv).digest();
    return cachedKey;
  }
  const file = path.join(DATA_DIR, ".secret");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  cachedKey = crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").trim()).digest();
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}

export function decrypt(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, iv, tag, body] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hmac(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const b = Buffer.from(expected, "hex");
  return derived.length === b.length && crypto.timingSafeEqual(derived, b);
}

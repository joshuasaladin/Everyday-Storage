import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, id, type DB } from "./db";
import { nowIso } from "./clock";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { can, type Cap, type Role } from "./roles";
import { audit, type Actor } from "./audit";
import { getSettings, type Settings } from "./settings";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  renter_id: string | null;
  must_change_password: number;
};

export type Facility = { id: string; code: string; name: string };

export type Ctx = {
  db: DB;
  user: User;
  actor: Actor;
  settings: Settings;
  facilities: Facility[];
  /** the facility picked in the header, or null for "all facilities" */
  facilityId: string | null;
};

const TOKEN_COOKIE = "shq_live";
const FACILITY_COOKIE = "shq_facility";
const SESSION_DAYS = 14;
const MAX_FAILS = 6;
const WINDOW_MIN = 15;

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

const cookieOpts = (expires: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
  path: "/",
  expires,
});

export async function createSession(userId: string) {
  const db = getDb();
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  const h = await headers();
  db.run(`INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    sha256(token), userId, expires.toISOString(), await clientIp(), h.get("user-agent")?.slice(0, 250) ?? null, nowIso(),
  ]);
  db.run(`UPDATE users SET last_login_at = ? WHERE id = ?`, [nowIso(), userId]);
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, token, cookieOpts(expires));
  // the old demo/live switch cookies are no longer used
  jar.delete("shq_ws");
  jar.delete("shq_demo");
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(TOKEN_COOKIE)?.value;
  if (token) getDb().run(`DELETE FROM sessions WHERE token_hash = ?`, [sha256(token)]);
  jar.delete(TOKEN_COOKIE);
}

function userForToken(db: DB, token: string | undefined): User | null {
  if (!token) return null;
  const row = db.one<User & { expires_at: string; status: string }>(
    `SELECT u.id, u.email, u.name, u.role, u.renter_id, u.must_change_password, u.status, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    [sha256(token)],
  );
  if (!row) return null;
  // customers have no sign-in: a renter account can never hold a session
  if (new Date(row.expires_at) < new Date() || row.status !== "active" || row.role === "renter") {
    db.run(`DELETE FROM sessions WHERE token_hash = ?`, [sha256(token)]);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, renter_id: row.renter_id, must_change_password: row.must_change_password };
}

export async function getCtx(): Promise<Ctx | null> {
  const db = getDb();
  const jar = await cookies();
  const user = userForToken(db, jar.get(TOKEN_COOKIE)?.value);
  if (!user) return null;
  const facilities = db.all<Facility>(`SELECT id, code, name FROM facilities WHERE status = 'active' ORDER BY name`);
  const picked = jar.get(FACILITY_COOKIE)?.value;
  return {
    db,
    user,
    actor: { id: user.id, name: user.name, role: user.role, ip: await clientIp() },
    settings: getSettings(db),
    facilities,
    facilityId: facilities.some((f) => f.id === picked) ? picked! : null,
  };
}

/** Staff pages. Redirects to sign-in, or home with a notice when the role is too low. */
export async function requireStaff(cap?: Cap): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  if (cap && !can(ctx.user.role, cap)) redirect("/?denied=1");
  return ctx;
}

export async function setFacility(facilityId: string | null) {
  const jar = await cookies();
  if (facilityId) jar.set(FACILITY_COOKIE, facilityId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  else jar.delete(FACILITY_COOKIE);
}

/** SQL fragment that scopes a query to the selected facility. */
export function scope(ctx: Pick<Ctx, "facilityId">, column = "facility_id"): { sql: string; params: string[] } {
  return ctx.facilityId ? { sql: ` AND ${column} = ?`, params: [ctx.facilityId] } : { sql: "", params: [] };
}

export type LoginResult = { ok: true; role: Role } | { ok: false; error: string };

export async function login(emailRaw: string, password: string): Promise<LoginResult> {
  const db = getDb();
  const email = emailRaw.trim().toLowerCase();
  const ip = await clientIp();
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const fails = db.num(`SELECT COUNT(*) FROM login_attempts WHERE email = ? AND success = 0 AND at > ?`, [email, since]);
  const ipFails = ip ? db.num(`SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND success = 0 AND at > ?`, [ip, since]) : 0;
  if (fails >= MAX_FAILS || ipFails >= MAX_FAILS * 5) {
    return { ok: false, error: `Too many attempts. Try again in ${WINDOW_MIN} minutes.` };
  }
  const user = db.one<{ id: string; password_hash: string; status: string; role: Role; name: string }>(
    `SELECT id, password_hash, status, role, name FROM users WHERE email = ?`,
    [email],
  );
  // same work whether or not the account exists, so timing says nothing
  const valid = verifyPassword(password, user?.password_hash ?? "scrypt:00:00") && Boolean(user);
  db.run(`INSERT INTO login_attempts (email, ip, success, at) VALUES (?, ?, ?, ?)`, [email, ip, valid ? 1 : 0, nowIso()]);
  if (!valid || !user || user.role === "renter") return { ok: false, error: "That email and password do not match." };
  if (user.status !== "active") return { ok: false, error: "This account has been disabled." };
  await createSession(user.id);
  audit(db, { id: user.id, name: user.name, role: user.role, ip }, "login", "user", user.id, "Signed in");
  return { ok: true, role: user.role };
}

export function createUser(
  db: DB,
  input: { email: string; name: string; role: Role; password: string; renterId?: string | null; mustChange?: boolean },
): string {
  const userId = id();
  db.run(
    `INSERT INTO users (id, email, name, role, password_hash, status, renter_id, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    [userId, input.email.toLowerCase().trim(), input.name.trim(), input.role, hashPassword(input.password), input.renterId ?? null, input.mustChange ? 1 : 0, nowIso(), nowIso()],
  );
  return userId;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Use letters and at least one number.";
  return null;
}

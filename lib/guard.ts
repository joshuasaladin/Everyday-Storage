import { getCtx, type Ctx } from "./auth";
import { can, type Cap } from "./roles";
import { UserError } from "./validate";

/** Authorisation for server actions and API routes: every write passes through here. */
export async function guard(cap?: Cap): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new UserError("Your session has ended. Sign in again.");
  if (ctx.user.role === "renter") throw new UserError("This action is for staff accounts.");
  if (cap && !can(ctx.user.role, cap)) throw new UserError("Your role does not allow this.");
  return ctx;
}

/** A record must belong to the facility set the caller may see (all active facilities today). */
export function facilityOf(ctx: Ctx, form: FormData): string {
  const picked = String(form.get("facility_id") ?? "") || ctx.facilityId || ctx.facilities[0]?.id;
  if (!picked || !ctx.facilities.some((f) => f.id === picked)) throw new UserError("Choose a facility.");
  return picked;
}

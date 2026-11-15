import { id, type DB } from "./db";
import { nowIso } from "./clock";

export type Actor = { id: string | null; name: string; role: string; ip?: string | null };

export const SYSTEM: Actor = { id: null, name: "System", role: "system" };

/** Append-only record of who changed what. Never updated, never deleted by the app. */
export function audit(
  db: DB,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  summary: string,
  meta?: Record<string, unknown>,
) {
  db.run(
    `INSERT INTO audit_log (id, at, actor_id, actor_name, actor_role, action, entity, entity_id, summary, meta, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id(),
      nowIso(),
      actor.id,
      actor.name,
      actor.role,
      action,
      entity,
      entityId,
      summary,
      meta ? JSON.stringify(meta) : null,
      actor.ip ?? null,
    ],
  );
}

export function auditFor(db: DB, entity: string, entityId: string, limit = 30) {
  return db.all(
    `SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY at DESC LIMIT ?`,
    [entity, entityId, limit],
  );
}

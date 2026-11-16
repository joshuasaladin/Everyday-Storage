import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { id, UPLOAD_DIR, type DB } from "./db";
import { nowIso } from "./clock";
import { audit, type Actor } from "./audit";
import { UserError } from "./validate";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** What may be uploaded, with the magic bytes each file must actually start with. */
const ALLOWED: Record<string, { ext: string[]; magic?: number[][] }> = {
  "application/pdf": { ext: ["pdf"], magic: [[0x25, 0x50, 0x44, 0x46]] },
  "image/png": { ext: ["png"], magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: ["jpg", "jpeg"], magic: [[0xff, 0xd8, 0xff]] },
  "image/webp": { ext: ["webp"], magic: [[0x52, 0x49, 0x46, 0x46]] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ["docx"], magic: [[0x50, 0x4b]] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ["xlsx"], magic: [[0x50, 0x4b]] },
  "text/plain": { ext: ["txt"] },
  "text/csv": { ext: ["csv"] },
};

export const DOC_CATEGORIES = [
  { value: "agreement", label: "Signed agreement" },
  { value: "id", label: "ID document" },
  { value: "insurance", label: "Insurance" },
  { value: "photo", label: "Photo" },
  { value: "receipt", label: "Receipt" },
  { value: "other", label: "Other" },
];

/**
 * Documents live outside the web root under a random key (never the uploaded
 * name), are checked by type and content, and are only ever served through
 * /api/files/[id], which re-checks who is asking.
 */
export async function storeDocument(
  db: DB,
  actor: Actor,
  file: File,
  meta: { entity: string; entityId: string; renterId?: string | null; category?: string | null; renterVisible?: boolean },
): Promise<string> {
  if (!file || file.size === 0) throw new UserError("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UserError(`Files must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = Object.entries(ALLOWED).find(([, v]) => v.ext.includes(ext))?.[0];
  if (!mime) throw new UserError("That file type is not allowed. Upload a PDF, image, Word, Excel, CSV or text file.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const magic = ALLOWED[mime].magic;
  if (magic && !magic.some((m) => m.every((b, i) => bytes[i] === b))) {
    throw new UserError("That file's contents do not match its type.");
  }

  const docId = id();
  const key = `${crypto.randomBytes(16).toString("hex")}.bin`;
  const dir = UPLOAD_DIR;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, key), bytes, { mode: 0o600 });

  const name = file.name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "file";
  db.run(
    `INSERT INTO documents (id, entity, entity_id, renter_id, name, category, mime_type, size_bytes, sha256, storage_key, renter_visible, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      docId, meta.entity, meta.entityId, meta.renterId ?? null, name, meta.category ?? null, mime, bytes.length,
      crypto.createHash("sha256").update(bytes).digest("hex"), key, meta.renterVisible ? 1 : 0, actor.name, nowIso(),
    ],
  );
  audit(db, actor, "upload", meta.entity, meta.entityId, `Uploaded ${name}`);
  return docId;
}

export async function readDocument(db: DB, storageKey: string): Promise<Buffer> {
  if (!/^[a-f0-9]{32}\.bin$/.test(storageKey)) throw new Error("Invalid storage key");
  return fs.readFile(path.join(UPLOAD_DIR, storageKey));
}

export async function deleteDocument(db: DB, actor: Actor, docId: string): Promise<void> {
  const doc = db.one<Record<string, any>>(`SELECT * FROM documents WHERE id = ?`, [docId]);
  if (!doc) return;
  db.run(`DELETE FROM documents WHERE id = ?`, [docId]);
  await fs.unlink(path.join(UPLOAD_DIR, doc.storage_key)).catch(() => {});
  audit(db, actor, "delete", doc.entity, doc.entity_id, `Deleted document ${doc.name}`);
}

export function documentsFor(db: DB, entity: string, entityId: string) {
  return db.all(`SELECT * FROM documents WHERE entity = ? AND entity_id = ? ORDER BY created_at DESC`, [entity, entityId]);
}

import Icon from "./Icon";
import { Card, Check, EmptyState, Field } from "./ui";
import { ActionForm, ConfirmButton } from "./forms";
import type { DB } from "@/lib/db";
import { auditFor } from "@/lib/audit";
import { documentsFor, DOC_CATEGORIES } from "@/lib/files";
import { deleteDocumentAction, uploadDocumentAction } from "@/lib/actions/ops";
import { fileSize, formatDateTime, timeAgo } from "@/lib/format";
import { label } from "@/lib/units";

/** Documents attached to a record: stored privately, served only through the permission-checked route. */
export function DocumentsPanel({ db, entity, entityId, canEdit, shareable }: { db: DB; entity: string; entityId: string; canEdit: boolean; shareable?: boolean }) {
  const docs = documentsFor(db, entity, entityId);
  return (
    <Card title="Documents" dense>
      {docs.length === 0 ? (
        <EmptyState title="No documents yet" hint={canEdit ? "Upload a signed agreement, ID copy or photo below." : undefined} />
      ) : (
        <ul>
          {docs.map((d, i) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
              <Icon name="file" className="w-4 h-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <a href={`/api/files/${d.id}`} target="_blank" className="link-ink text-sm font-medium break-all">{d.name}</a>
                <div className="text-xs" style={{ color: "var(--ink-3)" }}>
                  {label(DOC_CATEGORIES, d.category)} · {fileSize(d.size_bytes)} · {d.uploaded_by} · {timeAgo(d.created_at)}
                </div>
              </div>
              {canEdit && (
                <span className="flex items-center gap-1">
                  {shareable && <ConfirmButton action={deleteDocumentAction} fields={{ id: d.id, op: "toggle" }} label={d.renter_visible ? "Unshare" : "Share"} className="btn btn-ghost btn-sm" title="quiet" />}
                  <ConfirmButton action={deleteDocumentAction} fields={{ id: d.id }} label="Delete" confirm={`Delete ${d.name}? This cannot be undone.`} className="btn btn-ghost btn-sm" title="quiet" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="p-4 hair">
          <ActionForm action={uploadDocumentAction} submit="Upload" pendingLabel="Uploading…" resetOnOk submitClass="btn">
            <input type="hidden" name="entity" value={entity} />
            <input type="hidden" name="entity_id" value={entityId} />
            <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
              <Field label="File" hint="PDF, image, Word, Excel, CSV or text — up to 10 MB.">
                <input type="file" name="file" className="input" required accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv,.txt" />
              </Field>
              <Field label="Type">
                <select name="category" className="select" defaultValue="other">
                  {DOC_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
            </div>
            {shareable && <div className="mt-3"><Check name="renter_visible" label="Show this document in the renter's portal" /></div>}
          </ActionForm>
        </div>
      )}
    </Card>
  );
}

/** The audit trail for one record. */
export function HistoryPanel({ db, entity, entityId }: { db: DB; entity: string; entityId: string }) {
  const rows = auditFor(db, entity, entityId, 25);
  return (
    <Card title="History" dense>
      {rows.length === 0 ? (
        <EmptyState title="No history yet" />
      ) : (
        <ul>
          {rows.map((e, i) => (
            <li key={e.id} className="px-4 py-2.5 text-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
              <span style={{ color: "var(--ink)" }}>{e.summary}</span>
              <div className="text-xs" style={{ color: "var(--ink-3)" }} title={formatDateTime(e.at)}>{e.actor_name} · {formatDateTime(e.at)}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

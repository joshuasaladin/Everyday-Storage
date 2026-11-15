import { id, type DB } from "./db";
import { nowIso, today } from "./clock";
import { decrypt, encrypt } from "./crypto";

export const RENTER_STATUSES = [
  { value: "active", label: "Active", tone: "good" },
  { value: "lead", label: "Lead", tone: "info" },
  { value: "former", label: "Former", tone: "muted" },
] as const;

export const ID_TYPES = [
  { value: "aruba_id", label: "Aruba ID (cedula)" },
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "kvk", label: "Chamber of Commerce (KvK)" },
];

export type RenterInput = {
  kind: "individual" | "business";
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  id_type: string | null;
  /** undefined = leave as is, "" = clear, otherwise replace */
  id_number?: string;
  address: string | null;
  status?: "lead" | "active" | "former";
  notes: string | null;
};

export function createRenter(db: DB, input: RenterInput): string {
  const renterId = id();
  const no = db.nextNumber("R", today().slice(0, 4));
  const stamp = nowIso();
  const idNumber = input.id_number?.trim();
  db.run(
    `INSERT INTO renters (id, renter_no, kind, first_name, last_name, company, email, phone, id_type,
                          id_number_enc, id_last4, address, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      renterId, no, input.kind, input.first_name, input.last_name, input.company, input.email, input.phone,
      input.id_type, idNumber ? encrypt(idNumber) : null, idNumber ? idNumber.slice(-4) : null,
      input.address, input.status ?? "lead", input.notes, stamp, stamp,
    ],
  );
  return renterId;
}

export function updateRenter(db: DB, renterId: string, input: RenterInput): void {
  db.run(
    `UPDATE renters SET kind = ?, first_name = ?, last_name = ?, company = ?, email = ?, phone = ?,
            id_type = ?, address = ?, notes = ?, updated_at = ?
      WHERE id = ?`,
    [
      input.kind, input.first_name, input.last_name, input.company, input.email, input.phone,
      input.id_type, input.address, input.notes, nowIso(), renterId,
    ],
  );
  if (input.id_number !== undefined) {
    const v = input.id_number.trim();
    db.run(`UPDATE renters SET id_number_enc = ?, id_last4 = ? WHERE id = ?`, [v ? encrypt(v) : null, v ? v.slice(-4) : null, renterId]);
  }
}

export function renterIdNumber(db: DB, renterId: string): string | null {
  const row = db.one<{ id_number_enc: string | null }>(`SELECT id_number_enc FROM renters WHERE id = ?`, [renterId]);
  return decrypt(row?.id_number_enc);
}

export function renterDeleteBlocker(db: DB, renterId: string): string | null {
  if (db.one(`SELECT 1 FROM agreements WHERE renter_id = ? LIMIT 1`, [renterId])) return "This renter has agreements on file and cannot be deleted.";
  if (db.one(`SELECT 1 FROM invoices WHERE renter_id = ? LIMIT 1`, [renterId])) return "This renter has invoices on file and cannot be deleted.";
  if (db.one(`SELECT 1 FROM payments WHERE renter_id = ? LIMIT 1`, [renterId])) return "This renter has payments on file and cannot be deleted.";
  return null;
}

import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { DB } from "./db";
import { getSettings, secondary, type Settings } from "./settings";
import { CURRENCIES, formatDate, formatDateTime, renterName, titleCase } from "./format";
import { displayStatus } from "./billing";

const GREEN = "#293221";
const ORANGE = "#e2711a";
const INK = "#1f241c";
const MUTED = "#6b7265";
const LINE = "#dfe2da";

/** PDF's built-in fonts have no U+2212 minus, so money is formatted with a plain hyphen here. */
function m(cents: number, currency: string): string {
  const n = cents / 100;
  const sym = CURRENCIES[currency]?.symbol ?? `${currency} `;
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}${sym.length > 1 ? `${sym} ` : sym}${body}`;
}

function render(build: (doc: PDFKit.PDFDocument) => void, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: title, Producer: "Everyday Storage HQ" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function header(doc: PDFKit.PDFDocument, s: Settings, title: string, number: string) {
  const logo = path.join(process.cwd(), "public", "logo-pdf.jpg");
  if (fs.existsSync(logo)) doc.image(logo, 48, 40, { width: 64 });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(s.business_name, 124, 44);
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  const lines = [s.business_address, [s.business_phone, s.business_email].filter(Boolean).join("  ·  "), s.business_website, s.chamber_no ? `KvK ${s.chamber_no}` : "", s.tax_id ? `Tax ID ${s.tax_id}` : ""].filter(Boolean);
  doc.text(lines.join("\n"), 124, 60, { width: 240, lineGap: 1.5 });
  doc.font("Helvetica-Bold").fontSize(20).fillColor(GREEN).text(title, 330, 42, { width: 217, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(number, 330, 68, { width: 217, align: "right" });
  doc.moveTo(48, 118).lineTo(547, 118).lineWidth(2).strokeColor(ORANGE).stroke();
  doc.y = 134;
}

function pair(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, w = 160) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text(label.toUpperCase(), x, y, { width: w, characterSpacing: 0.6 });
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(value, x, y + 11, { width: w });
}

function footer(doc: PDFKit.PDFDocument, text: string) {
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(text, 48, 778, { width: 499, align: "center", lineBreak: false, height: 10 });
}

export async function invoicePdf(db: DB, invoiceId: string): Promise<{ bytes: Buffer; filename: string }> {
  const inv = db.one<Record<string, any>>(
    `SELECT i.*, u.unit_number, f.name AS facility_name, a.agreement_no
       FROM invoices i LEFT JOIN units u ON u.id = i.unit_id
       JOIN facilities f ON f.id = i.facility_id LEFT JOIN agreements a ON a.id = i.agreement_id
      WHERE i.id = ?`,
    [invoiceId],
  );
  if (!inv) throw new Error("Invoice not found");
  const renter = db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [inv.renter_id])!;
  const lines = db.all<Record<string, any>>(`SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort`, [invoiceId]);
  const s = getSettings(db);
  const cur = inv.currency;
  const status = displayStatus(inv as never);

  const bytes = await render((doc) => {
    header(doc, s, "INVOICE", inv.invoice_no);

    doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text("BILLED TO", 48, 134, { characterSpacing: 0.6 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(renterName(renter), 48, 146, { width: 250 });
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(
      [renter.kind === "business" ? `Attn. ${renter.first_name} ${renter.last_name}`.trim() : "", renter.address, renter.email].filter(Boolean).join("\n"),
      { width: 250, lineGap: 1.5 },
    );
    pair(doc, "Issue date", formatDate(inv.issue_date), 330, 134, 100);
    pair(doc, "Due date", formatDate(inv.due_date), 447, 134, 100);
    pair(doc, "Unit", inv.unit_number ? `${inv.unit_number} · ${inv.facility_name}` : inv.facility_name, 330, 168, 110);
    pair(doc, "Status", titleCase(status), 447, 168, 100);
    if (inv.period_start) pair(doc, "Billing period", `${formatDate(inv.period_start)} - ${formatDate(inv.period_end)}`, 330, 202, 217);

    let y = 250;
    doc.rect(48, y, 499, 22).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
    doc.text("DESCRIPTION", 58, y + 7, { characterSpacing: 0.6 });
    doc.text("AMOUNT", 447, y + 7, { width: 90, align: "right", characterSpacing: 0.6 });
    y += 30;
    for (const l of lines) {
      const h = doc.font("Helvetica").fontSize(10).heightOfString(l.description, { width: 370 });
      doc.fillColor(INK).text(l.description, 58, y, { width: 370 });
      doc.text(m(l.amount_cents, cur), 447, y, { width: 90, align: "right" });
      y += Math.max(h, 12) + 9;
      doc.moveTo(48, y - 4).lineTo(547, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
    }

    y += 8;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor(bold ? INK : MUTED).text(label, 290, y, { width: 160, lineBreak: false });
      doc.fillColor(INK).text(value, 447, y, { width: 90, align: "right" });
      y += bold ? 20 : 16;
    };
    row("Subtotal", m(inv.subtotal_cents - inv.discount_cents, cur));
    if (inv.tax_cents > 0 || inv.tax_rate_bp > 0) row(`${inv.tax_label ?? "Tax"} (${(inv.tax_rate_bp / 100).toFixed(inv.tax_rate_bp % 100 ? 2 : 0)}%)`, m(inv.tax_cents, cur));
    doc.moveTo(290, y).lineTo(547, y).lineWidth(0.8).strokeColor(INK).stroke();
    y += 7;
    row("Total", m(inv.total_cents, cur), true);
    if (inv.paid_cents > 0) row("Paid", m(-inv.paid_cents, cur));
    if (inv.credited_cents > 0) row("Credit applied", m(-inv.credited_cents, cur));
    if (inv.status !== "void") {
      doc.rect(330, y, 217, 26).fill(inv.balance_cents > 0 ? "#fdf1e4" : "#e8f3ea");
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Balance due", 340, y + 8);
      doc.text(m(inv.balance_cents, cur), 447, y + 8, { width: 90, align: "right" });
      y += 34;
      if (s.show_secondary_currency && inv.balance_cents > 0) {
        const alt = secondary(s, inv.balance_cents);
        doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(`Equivalent to ${m(alt.cents, alt.currency)} at ${s.awg_per_usd} AWG per USD`, 330, y, { width: 217, align: "right" });
        y += 16;
      }
    } else {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#9c3226").text("VOID", 330, y);
      y += 20;
    }

    y = Math.max(y + 16, 250);
    if (s.payment_instructions && inv.status !== "void" && inv.balance_cents > 0) {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text("HOW TO PAY", 48, y, { characterSpacing: 0.6 });
      doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(s.payment_instructions, 48, y + 11, { width: 499, lineGap: 2 });
      y = doc.y + 12;
    }
    if (inv.notes) {
      doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text("NOTES", 48, y, { characterSpacing: 0.6 });
      doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(inv.notes, 48, y + 11, { width: 499 });
    }
    footer(doc, s.invoice_footer);
  }, `Invoice ${inv.invoice_no}`);
  return { bytes, filename: `${inv.invoice_no}.pdf` };
}

export async function receiptPdf(db: DB, paymentId: string): Promise<{ bytes: Buffer; filename: string }> {
  const pay = db.one<Record<string, any>>(`SELECT * FROM payments WHERE id = ?`, [paymentId]);
  if (!pay) throw new Error("Payment not found");
  const renter = db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [pay.renter_id])!;
  const allocs = db.all<Record<string, any>>(
    `SELECT pa.amount_cents, i.invoice_no, i.period_start, i.period_end, i.balance_cents
       FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = ? ORDER BY i.due_date`,
    [paymentId],
  );
  const s = getSettings(db);
  const cur = s.base_currency;
  const allocated = allocs.reduce((a, r) => a + r.amount_cents, 0);

  const bytes = await render((doc) => {
    header(doc, s, "RECEIPT", pay.payment_no);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text("RECEIVED FROM", 48, 134, { characterSpacing: 0.6 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(renterName(renter), 48, 146, { width: 250 });
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text([renter.address, renter.email].filter(Boolean).join("\n"), { width: 250 });
    pair(doc, "Date received", formatDate(pay.received_date), 330, 134, 100);
    pair(doc, "Method", titleCase(pay.method === "deposit" ? "Security deposit applied" : pay.method), 447, 134, 100);
    if (pay.reference) pair(doc, "Reference", pay.reference, 330, 168, 217);

    doc.rect(48, 214, 499, 44).fill("#e8f3ea");
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("Amount received", 62, 222);
    doc.font("Helvetica-Bold").fontSize(18).fillColor(GREEN).text(m(pay.amount_cents, cur), 62, 234);
    if (pay.tendered_currency && pay.tendered_currency !== cur) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Tendered as ${m(pay.tendered_cents, pay.tendered_currency)}`, 330, 238, { width: 207, align: "right" });
    }

    let y = 280;
    doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text("APPLIED TO", 48, y, { characterSpacing: 0.6 });
    y += 14;
    for (const a of allocs) {
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(`Invoice ${a.invoice_no}${a.period_start ? `  (${formatDate(a.period_start)} - ${formatDate(a.period_end)})` : ""}`, 48, y, { width: 380 });
      doc.text(m(a.amount_cents, cur), 447, y, { width: 100, align: "right" });
      y += 17;
    }
    if (pay.amount_cents - allocated - pay.refunded_cents > 0) {
      doc.font("Helvetica").fontSize(10).fillColor(INK).text("Held as credit on account", 48, y);
      doc.text(m(pay.amount_cents - allocated - pay.refunded_cents, cur), 447, y, { width: 100, align: "right" });
      y += 17;
    }
    if (pay.refunded_cents > 0) {
      doc.fillColor("#9c3226").text("Refunded", 48, y);
      doc.text(m(-pay.refunded_cents, cur), 447, y, { width: 100, align: "right" });
    }
    footer(doc, `${s.invoice_footer}  ·  Receipt generated ${formatDateTime(new Date().toISOString())}`);
  }, `Receipt ${pay.payment_no}`);
  return { bytes, filename: `${pay.payment_no}.pdf` };
}

export async function agreementPdf(db: DB, agreementId: string): Promise<{ bytes: Buffer; filename: string }> {
  const ag = db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ?`, [agreementId]);
  if (!ag) throw new Error("Agreement not found");
  const s = getSettings(db);
  const bytes = await render((doc) => {
    header(doc, s, "AGREEMENT", ag.agreement_no);
    const [head, ...rest] = String(ag.terms_snapshot ?? "").split("\n");
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(head, 48, 134);
    doc.moveDown(0.5).font("Helvetica").fontSize(9.5).fillColor(INK).text(rest.join("\n"), { width: 499, lineGap: 2.5 });
    doc.moveDown(1.5);
    if (doc.y > 640) doc.addPage();
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text("SIGNED BY THE RENTER", 48, y, { characterSpacing: 0.6 });
    if (ag.signed_at) {
      if (ag.signature_png) {
        try {
          doc.image(Buffer.from(String(ag.signature_png).split(",")[1], "base64"), 48, y + 12, { fit: [200, 70] });
        } catch {
          /* an unreadable signature image should not block the document */
        }
      }
      doc.moveTo(48, y + 86).lineTo(260, y + 86).lineWidth(0.5).strokeColor(INK).stroke();
      doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(ag.signed_name, 48, y + 91);
      doc.fontSize(8).fillColor(MUTED).text(
        `Signed ${formatDateTime(ag.signed_at)} (${ag.signed_method})${ag.signed_ip ? ` from ${ag.signed_ip}` : ""}\nDocument fingerprint (SHA-256): ${ag.terms_sha256}`,
        48, y + 104, { width: 499 },
      );
    } else {
      doc.font("Helvetica").fontSize(10).fillColor("#9c3226").text("Not yet signed", 48, y + 14);
    }
  }, `Agreement ${ag.agreement_no}`);
  return { bytes, filename: `${ag.agreement_no}.pdf` };
}

export type ReportTable = { title: string; columns: string[]; rows: (string | number)[][]; align?: ("left" | "right")[] };

export async function reportPdf(db: DB, title: string, subtitle: string, tables: ReportTable[]): Promise<Buffer> {
  const s = getSettings(db);
  return render((doc) => {
    header(doc, s, "REPORT", subtitle);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(title, 48, 134);
    doc.moveDown(0.8);
    for (const t of tables) {
      if (doc.y > 660) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(GREEN).text(t.title, 48);
      doc.moveDown(0.4);
      const w = 499 / t.columns.length;
      let y = doc.y;
      doc.rect(48, y, 499, 18).fill("#eef0ea");
      t.columns.forEach((c, i) =>
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(c.toUpperCase(), 52 + i * w, y + 6, { width: w - 8, align: t.align?.[i] ?? (i ? "right" : "left"), lineBreak: false }),
      );
      y += 23;
      for (const r of t.rows) {
        if (y > 760) {
          doc.addPage();
          y = 60;
        }
        r.forEach((c, i) =>
          doc.font("Helvetica").fontSize(9).fillColor(INK).text(String(c).replace(/−/g, "-"), 52 + i * w, y, { width: w - 8, align: t.align?.[i] ?? (i ? "right" : "left"), lineBreak: false }),
        );
        y += 15;
        doc.moveTo(48, y - 3).lineTo(547, y - 3).lineWidth(0.4).strokeColor(LINE).stroke();
      }
      doc.y = y + 14;
    }
    footer(doc, `${s.business_name}  ·  Generated ${formatDateTime(new Date().toISOString())}`);
  }, title);
}

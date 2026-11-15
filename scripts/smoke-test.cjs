/**
 * End-to-end check through the real UI, against the demo workspace.
 *   npm run dev            (in one terminal)
 *   npm run smoke          (in another)   — screenshots land in ./screenshots
 */
const { chromium } = require("playwright");
const fs = require("node:fs");

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? "./screenshots";
fs.mkdirSync(out, { recursive: true });
const stamp = String(Date.now()).slice(-6);

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = async (opts = {}) => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
    // only ever talk to the app under test (fonts fall back to the system stack)
    await c.route("**/*", (r) => (r.request().url().startsWith(base) || /^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
    return c;
  };
  const ctx = await context();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 200)}`));

  let failed = 0;
  const step = async (name, fn) => {
    try { await fn(); console.log(`PASS  ${name}`); }
    catch (e) { failed += 1; console.log(`FAIL  ${name}: ${String(e.message).split("\n")[0]}`); await page.screenshot({ path: `${out}/FAIL-${name.replace(/\W+/g, "-")}.png` }).catch(() => {}); }
  };
  const shot = (name, p = page) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const login = async (p, email, password) => {
    await p.goto(`${base}/login`);
    await p.fill('input[name="email"]', email);
    await p.fill('input[name="password"]', password);
    await p.click('button[type="submit"]');
  };

  await step("rejects a wrong password", async () => {
    await login(page, "demo@everydaystorage.aw", "wrong-password");
    await page.waitForSelector("text=do not match");
  });
  await step("signs in to the demo workspace", async () => {
    await login(page, "demo@everydaystorage.aw", "demo-storage");
    await page.waitForURL(`${base}/`);
    await page.waitForSelector("text=Recurring monthly revenue");
    await page.waitForSelector("text=Demo workspace");
  });
  await shot("01-dashboard");

  await step("facility map opens a unit's details", async () => {
    await page.goto(`${base}/map`);
    await page.click('a.btn:has-text("Oranjestad")');
    await page.click('button[aria-label^="Unit B03"]');
    await page.waitForSelector("text=Open unit");
  });
  await shot("02-facility-map");

  let unitUrl;
  await step("creates a storage unit", async () => {
    await page.goto(`${base}/units/new`);
    await page.fill('input[name="unit_number"]', `T${stamp}`);
    await page.fill('input[name="width_ft"]', "6");
    await page.fill('input[name="depth_ft"]', "8");
    await page.fill('input[name="monthly_price"]', "99.50");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/units\/[0-9a-f-]{36}$/);
    await page.waitForSelector("text=Available");
    unitUrl = page.url();
  });
  await step("refuses a duplicate unit number", async () => {
    await page.goto(`${base}/units/new`);
    await page.fill('input[name="unit_number"]', `T${stamp}`);
    await page.fill('input[name="width_ft"]', "6");
    await page.fill('input[name="depth_ft"]', "8");
    await page.fill('input[name="monthly_price"]', "99.50");
    await page.click('button[type="submit"]');
    await page.waitForSelector("text=already exists");
  });

  let renterUrl;
  await step("creates a renter", async () => {
    await page.goto(`${base}/renters/new`);
    await page.fill('input[name="first_name"]', "Smoke");
    await page.fill('input[name="last_name"]', `Test ${stamp}`);
    await page.fill('input[name="email"]', `smoke${stamp}@example.com`);
    await page.fill('input[name="phone"]', "+297 555 0100");
    await page.fill('input[name="id_number"]', "ID-998877");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/renters\/[0-9a-f-]{36}$/);
    renterUrl = page.url();
  });

  let agreementUrl;
  await step("creates a rental agreement that holds the unit", async () => {
    const unitId = unitUrl.split("/").pop();
    const renterId = renterUrl.split("/").pop();
    await page.goto(`${base}/agreements/new?unit=${unitId}&renter=${renterId}`);
    await page.waitForSelector("text=Contract value");
    await page.click('button:has-text("Create agreement")');
    await page.waitForURL(/\/agreements\/[0-9a-f-]{36}$/);
    await page.waitForSelector("text=Signature needed");
    agreementUrl = page.url();
    await page.goto(unitUrl);
    await page.waitForSelector("text=Reserved");
  });

  await step("signing on the device activates it and creates the first invoice", async () => {
    await page.goto(agreementUrl);
    await page.click('button:has-text("Sign now")');
    const canvas = page.locator("dialog[open] canvas");
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 80);
    await page.mouse.down();
    for (let i = 0; i < 12; i++) await page.mouse.move(box.x + 40 + i * 22, box.y + 80 + (i % 2 ? -30 : 30), { steps: 3 });
    await page.mouse.up();
    await page.click('dialog[open] button:has-text("Sign and activate")');
    await page.waitForSelector("text=Signed by", { timeout: 15000 });
    await page.waitForSelector("text=/INV-\\d{4}-\\d{4}/");
  });
  await shot("03-agreement");

  let invoiceUrl;
  await step("the invoice is open, with tax and a balance", async () => {
    await page.click("a:text-matches('INV-\\\\d{4}-\\\\d{4}')");
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    await page.waitForSelector("text=Balance due");
    invoiceUrl = page.url();
  });
  await step("a payment request leaves the invoice unpaid", async () => {
    await page.click('button:has-text("Send payment request")');
    await page.waitForSelector("text=stays unpaid until the money is actually received");
    await page.reload();
    if (await page.locator(".chip:has-text('Paid')").count()) throw new Error("invoice was marked paid by a payment request");
  });
  const pay = async (amount, reference) => {
    await page.click('button:has-text("Record payment")');
    await page.fill('dialog[open] input[name="amount"]', amount);
    await page.fill('dialog[open] input[name="reference"]', reference);
    await page.click('dialog[open] button[type="submit"]');
  };
  await step("a part payment leaves it part paid", async () => {
    await pay("20.00", `BT-${stamp}`);
    await page.waitForSelector(".chip:has-text('Part paid')");
  });
  await step("the same bank reference is refused", async () => {
    await pay("5.00", `BT-${stamp}`);
    await page.waitForSelector("text=cannot be recorded twice");
    await page.keyboard.press("Escape");
  });
  await step("paying the balance marks it paid", async () => {
    await page.reload();
    await page.click('button:has-text("Record payment")');
    await page.fill('dialog[open] input[name="reference"]', `BT-${stamp}-2`);
    await page.click('dialog[open] button[type="submit"]');
    await page.waitForSelector(".chip:has-text('Paid')");
  });
  await shot("04-invoice");

  await step("PDF invoice, receipt list and CSV export download", async () => {
    const pdf = await page.request.get(`${invoiceUrl.replace("/invoices/", "/api/invoices/")}/pdf`);
    if (pdf.status() !== 200 || !(await pdf.body()).subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error(`invoice pdf ${pdf.status()}`);
    const csv = await page.request.get(`${base}/api/export/invoices?status=unpaid`);
    if (csv.status() !== 200 || !(await csv.text()).includes("Invoice,Renter")) throw new Error(`csv ${csv.status()}`);
    const report = await page.request.get(`${base}/api/reports?format=pdf`);
    if (report.status() !== 200) throw new Error(`report pdf ${report.status()}`);
  });

  await step("uploads a document and serves it only to a signed-in user", async () => {
    await page.goto(renterUrl);
    await page.setInputFiles('input[name="file"]', { name: "id-copy.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% smoke test\n") });
    await page.click('button:has-text("Upload")');
    const link = page.locator('a:has-text("id-copy.pdf")');
    await link.waitFor();
    const href = await link.getAttribute("href");
    const anon = await (await context()).request.get(`${base}${href}`);
    if (anon.status() !== 401) throw new Error(`anonymous download returned ${anon.status()}`);
    const fake = await page.request.post(`${base}/api/webhooks/payments`, { data: { id: "evt_1", type: "payment.succeeded" } });
    if (fake.status() !== 401) throw new Error(`unsigned webhook returned ${fake.status()}`);
  });

  await step("an automation can be run twice without duplicating anything", async () => {
    await page.goto(`${base}/automations`);
    const card = page.locator(".panel", { hasText: "Monthly invoice generation" });
    await card.locator('button:has-text("Run now")').click();
    await card.locator("text=/invoices? created/").waitFor({ timeout: 20000 });
    await card.locator('button:has-text("Run now")').click();
    await card.locator("text=0 invoices created").first().waitFor({ timeout: 20000 });
  });
  for (const [path, name] of [["/units", "05-units"], ["/renters", "06-renters"], ["/invoices", "07-invoices"], ["/payments", "08-payments"], ["/reports", "09-reports"], ["/automations", "10-automations"], ["/maintenance", "11-maintenance"], ["/reservations", "12-reservations"], ["/settings?tab=billing", "13-settings"]]) {
    await step(`renders ${path}`, async () => {
      const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      if (res.status() !== 200) throw new Error(`status ${res.status()}`);
      await shot(name);
    });
  }

  const setTheme = async (want) => {
    for (let i = 0; i < 3; i++) {
      const now = await page.evaluate(() => document.documentElement.dataset.theme ?? "system");
      if (now === want) return;
      await page.click('button[aria-label^="Theme"]');
      await page.waitForFunction((prev) => (document.documentElement.dataset.theme ?? "system") !== prev, now);
    }
    throw new Error(`could not switch to ${want}`);
  };
  await step("dark mode", async () => {
    await page.goto(`${base}/`);
    await setTheme("dark");
    await page.waitForLoadState("networkidle");
    await shot("14-dashboard-dark");
    await page.goto(`${base}/map`, { waitUntil: "networkidle" });
    await shot("15-map-dark");
    await setTheme("system");
  });

  await step("staff cannot open financial pages", async () => {
    const c = await context();
    const p = await c.newPage();
    await login(p, "staff@everydaystorage.aw", "demo-storage");
    await p.waitForURL(`${base}/`);
    if (await p.locator("text=Recurring monthly revenue").count()) throw new Error("staff can see revenue");
    await p.goto(`${base}/invoices`);
    await p.waitForURL(/denied=1/);
    const csv = await p.request.get(`${base}/api/export/payments`);
    if (csv.status() !== 403) throw new Error(`export returned ${csv.status()}`);
    await c.close();
  });

  await step("a renter sees only their own portal", async () => {
    const c = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = await c.newPage();
    await login(p, "marisol.croes@example.com", "demo-renter");
    await p.waitForURL(`${base}/portal`);
    await p.waitForSelector("text=Your units");
    await shot("16-portal-mobile", p);
    await p.goto(`${base}/renters`);
    await p.waitForURL(`${base}/portal`);
    const other = await p.request.get(`${invoiceUrl.replace("/invoices/", "/api/invoices/")}/pdf`);
    if (other.status() !== 404) throw new Error(`another renter's invoice returned ${other.status()}`);
    await c.close();
  });

  await step("mobile layout", async () => {
    const c = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p = await c.newPage();
    await login(p, "demo@everydaystorage.aw", "demo-storage");
    await p.waitForURL(`${base}/`);
    await p.waitForLoadState("networkidle");
    await shot("17-dashboard-mobile", p);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`page scrolls sideways by ${overflow}px`);
    await p.click('button[aria-label="Open menu"]');
    await p.locator(".fixed aside >> text=Facility map").waitFor();
    await p.screenshot({ path: `${out}/18-menu-mobile.png` });
    await c.close();
  });

  await step("public pages", async () => {
    const c = await context();
    const p = await c.newPage();
    await p.goto(`${base}/reserve`, { waitUntil: "networkidle" });
    await p.waitForSelector("text=Reserve a storage unit");
    await shot("19-reserve", p);
    await p.goto(`${base}/sign/not-a-real-token`);
    await p.waitForSelector("text=no longer valid");
    await p.goto(`${base}/units`);
    await p.waitForURL(`${base}/login`);
    await c.close();
  });

  if (errors.length) { failed += 1; console.log(`\nBrowser errors:\n${[...new Set(errors)].join("\n")}`); }
  console.log(failed ? `\n${failed} problem(s).` : "\nAll checks passed.");
  await browser.close();
  process.exit(failed ? 1 : 0);
})();

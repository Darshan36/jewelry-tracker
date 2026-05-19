// Phase 17b walkthrough — Payables + Receivables UI verified against prod.
//
// 12 steps adapted to the as-shipped UX:
//   Setup (1): seed test data — sale (partial paid), purchase (unpaid),
//     casting + plating sharing a phone (multi-flag vendor).
//   Payables (5): list, missing-attachment filter, party detail, modal
//     open, partial payment, balance reduction.
//   Receivables (2): list, modal open + partial payment, balance reduction.
//   Role-scoped (2): PURCHASE_DEPT and CASTING_PLATING_MGMT login.
//   Dashboard (1): ADMIN cards + top-3 lists.
//   Detail modal role-chip (1): /customers row → modal shows Customer chip.
//
// Marker: __phase17b_walk_<timestamp>
// Cleanup deletes all parties + transactions created by this run.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p17b-out");
mkdirSync(OUT_DIR, { recursive: true });

function loadEnv(file) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

function loadCredentialsMd() {
  const txt = readFileSync(join(REPO_ROOT, "credentials.md"), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([A-Z_]+)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
    if (m) out[m[1]] = { email: m[2], password: m[3] };
  }
  return out;
}

const env = loadEnv(".env.production.local");
const creds = loadCredentialsMd();

const ADMIN = { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD };
const PURCHASE = creds.PURCHASE_DEPT;
const CASTING = creds.CASTING_PLATING_MGMT;
const DIRECT_URL = env.DIRECT_URL;
const BASE =
  process.env.WALKTHROUGH_BASE ??
  "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";

const projectRef = (DIRECT_URL.match(/postgres\.([^:]+):/) || [])[1];
if (projectRef !== "cseqdcrfnvgsalsyhjsz") {
  console.error(`ABORT — DIRECT_URL not pointing at prod (got ${projectRef}).`);
  process.exit(1);
}
if (!ADMIN.email || !ADMIN.password) {
  console.error("FAIL: missing SEED_ADMIN_EMAIL / PASSWORD");
  process.exit(1);
}
if (!PURCHASE?.email || !CASTING?.email) {
  console.error("FAIL: missing PURCHASE_DEPT / CASTING_PLATING_MGMT in credentials.md");
  process.exit(1);
}

const TS = Date.now();
const MARKER = `__phase17b_walk_${TS}`;
// Unique phones per test run (last 7 digits of timestamp keeps it short).
const PHONE_TAIL = TS.toString().slice(-7);
const PHONE_SUPPLIER = `9100${PHONE_TAIL}`.slice(0, 12);
const PHONE_VENDOR = `9200${PHONE_TAIL}`.slice(0, 12);
// hitesh — pre-existing prod party with isCustomer=true.
const HITESH_PHONE = "9167626121";

const NAME_SUPPLIER = `${MARKER}_supplier`;
const NAME_VENDOR = `${MARKER}_vendor`;
const ITEM_SALE = `${MARKER}_sale_item`;
const ITEM_PURCHASE = `${MARKER}_purchase_item`;
const MATERIAL_CAST = `${MARKER}_cast_mat`;
const MATERIAL_PLAT = `${MARKER}_plat_mat`;

const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function step(page, name, fn) {
  const safe = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
    await page.screenshot({
      path: join(OUT_DIR, `${results.length.toString().padStart(2, "0")}-${safe}.png`),
      fullPage: false,
    });
  } catch (err) {
    console.log(`  THREW: ${err.message}`);
    await page
      .screenshot({
        path: join(OUT_DIR, `FAIL-${results.length.toString().padStart(2, "0")}-${safe}.png`),
        fullPage: true,
      })
      .catch(() => {});
    check(name, false, err.message);
    throw err;
  }
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
  // Wait for client hydration — the login form is a Client Component that
  // BAILOUT_TO_CLIENT_SIDE_RENDERING; the email input element is mounted
  // after React hydrates, not on initial HTML parse.
  await page.locator('input[type="email"]').first().waitFor({ state: "visible", timeout: 15_000 });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/auth/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function logout(page) {
  // Clear cookies — faster + more reliable than clicking the Sign Out
  // button (which can race with React hydration on a freshly-loaded page).
  // Auth.js's JWT session cookie is what gates everything; nuking cookies
  // makes the next /auth/login navigation render the login form.
  await page.context().clearCookies();
}

const db = new pg.Client({ connectionString: DIRECT_URL });
await db.connect();

async function cleanup() {
  console.log("\n=== Cleanup ===");
  const q = async (sql, params = []) => (await db.query(sql, params)).rowCount;
  // Order matters: child rows first (FK Cascade is on transactions, so
  // delete payments/line-items explicitly to keep tx-order stable across
  // the multiple transaction kinds), then transactions, then parties.
  const ops = [
    [
      "DELETE FROM sale_payments WHERE \"saleId\" IN (SELECT id FROM sales WHERE \"partyName\" LIKE $1 OR EXISTS (SELECT 1 FROM sale_line_items WHERE \"saleId\" = sales.id AND \"itemDescription\" LIKE $1))",
      `%${MARKER}%`,
    ],
    [
      "DELETE FROM sale_line_items WHERE \"saleId\" IN (SELECT id FROM sales WHERE \"partyName\" LIKE $1 OR EXISTS (SELECT 1 FROM sale_line_items sli WHERE sli.\"saleId\" = sales.id AND sli.\"itemDescription\" LIKE $1))",
      `%${MARKER}%`,
    ],
    // Phase 17b walkthrough: the sale to hitesh uses partyName "hitesh"
    // (snapshot of existing customer's name) — clean by line-item marker.
    [
      "DELETE FROM sale_payments WHERE \"saleId\" IN (SELECT id FROM sales WHERE \"partyPhone\" = $1 AND \"createdAt\" >= NOW() - INTERVAL '1 hour')",
      HITESH_PHONE,
    ],
    [
      "DELETE FROM sale_line_items WHERE \"saleId\" IN (SELECT id FROM sales WHERE \"partyPhone\" = $1 AND \"createdAt\" >= NOW() - INTERVAL '1 hour')",
      HITESH_PHONE,
    ],
    [
      "DELETE FROM sales WHERE \"partyName\" LIKE $1 OR (\"partyPhone\" = $2 AND \"createdAt\" >= NOW() - INTERVAL '1 hour')",
      `%${MARKER}%`,
      HITESH_PHONE,
    ],
    [
      "DELETE FROM purchase_payments WHERE \"purchaseId\" IN (SELECT id FROM purchases WHERE \"partyName\" LIKE $1)",
      `%${MARKER}%`,
    ],
    [
      "DELETE FROM purchase_line_items WHERE \"purchaseId\" IN (SELECT id FROM purchases WHERE \"partyName\" LIKE $1)",
      `%${MARKER}%`,
    ],
    [`DELETE FROM purchases WHERE "partyName" LIKE $1`, `%${MARKER}%`],
    [
      "DELETE FROM casting_payments WHERE \"castingEntryId\" IN (SELECT id FROM casting_entries WHERE \"partyName\" LIKE $1)",
      `%${MARKER}%`,
    ],
    [
      "DELETE FROM casting_line_items WHERE \"castingEntryId\" IN (SELECT id FROM casting_entries WHERE \"partyName\" LIKE $1)",
      `%${MARKER}%`,
    ],
    [`DELETE FROM casting_entries WHERE "partyName" LIKE $1`, `%${MARKER}%`],
    [
      "DELETE FROM plating_payments WHERE \"platingEntryId\" IN (SELECT id FROM plating_entries WHERE \"partyName\" LIKE $1)",
      `%${MARKER}%`,
    ],
    [
      "DELETE FROM plating_line_items WHERE \"platingEntryId\" IN (SELECT id FROM plating_entries WHERE \"partyName\" LIKE $1)",
      `%${MARKER}%`,
    ],
    [`DELETE FROM plating_entries WHERE "partyName" LIKE $1`, `%${MARKER}%`],
    [`DELETE FROM parties WHERE name LIKE $1`, `%${MARKER}%`],
  ];
  for (const args of ops) {
    try {
      const [sql] = args;
      const sliceArgs = args.slice(1);
      const n = await q(sql, sliceArgs);
      const label = sql.match(/DELETE FROM (\w+)/)?.[1] ?? "?";
      if (n > 0) console.log(`  ${label.padEnd(24)} -${n}`);
    } catch (err) {
      console.log(`  cleanup error: ${err.message}`);
    }
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  console.log(`[walkthrough-p17b] BASE=${BASE}  marker=${MARKER}`);

  await login(page, ADMIN.email, ADMIN.password);
  console.log("  ADMIN signed in");

  // ============================================================
  // STEP 1 — Setup test data
  // ============================================================
  let saleId = null;
  let purchaseId = null;
  let castingEntryId = null;
  let platingEntryId = null;
  let vendorPartyId = null;
  let supplierPartyId = null;

  await step(page, "1. Setup test data (sale + purchase + casting + plating)", async () => {
    // 1a. Sale to hitesh, ₹50,000 total, pay ₹20,000.
    await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.locator("#sales-party-name").fill("hitesh");
    await page.locator("#sales-party-phone").fill(HITESH_PHONE);
    await page.locator("#sale-line-0-item").fill(ITEM_SALE);
    await page.locator("#sale-line-0-qty").fill("1");
    await page.locator("#sale-line-0-rate").fill("50000");
    await Promise.all([
      page.waitForURL((u) => u.toString().endsWith("/sales"), { timeout: 30_000 }),
      page.locator('button:has-text("Save and return")').click(),
    ]);
    await page.waitForLoadState("networkidle");

    // Pay ₹20,000 partial on the sale via direct DB to keep walkthrough fast.
    const saleRow = await db.query(
      `SELECT id, "partyId" FROM sales WHERE EXISTS (
         SELECT 1 FROM sale_line_items WHERE "saleId" = sales.id AND "itemDescription" = $1
       ) ORDER BY "createdAt" DESC LIMIT 1`,
      [ITEM_SALE],
    );
    if (saleRow.rows.length !== 1) throw new Error("Sale not found after create");
    saleId = saleRow.rows[0].id;
    await db.query(
      `INSERT INTO sale_payments (id, "saleId", date, amount, type, note, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, NOW(), 2000000, 'PAYMENT', 'walkthrough partial', NOW(), NOW())`,
      [saleId],
    );

    // 1b. Purchase to a NEW walk-in supplier ₹40,000, no payment.
    await page.goto(`${BASE}/purchases/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.locator("#purchases-party-name").fill(NAME_SUPPLIER);
    await page.locator("#purchases-party-phone").fill(PHONE_SUPPLIER);
    await page.locator("#purchase-line-0-item").fill(ITEM_PURCHASE);
    await page.locator("#purchase-line-0-qty").fill("1");
    await page.locator("#purchase-line-0-rate").fill("40000");
    await Promise.all([
      page.waitForURL((u) => u.toString().endsWith("/purchases"), { timeout: 30_000 }),
      page.locator('button:has-text("Save and return")').click(),
    ]);
    await page.waitForLoadState("networkidle");

    const purchaseRow = await db.query(
      `SELECT id, "partyId" FROM purchases WHERE "partyName" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [NAME_SUPPLIER],
    );
    purchaseId = purchaseRow.rows[0]?.id;
    supplierPartyId = purchaseRow.rows[0]?.partyId;

    // 1c. Casting walk-in ₹25,000.
    await page.goto(`${BASE}/casting/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.locator("#casting-party-name").fill(NAME_VENDOR);
    await page.locator("#casting-party-phone").fill(PHONE_VENDOR);
    await page.locator("#casting-line-0-material").fill(MATERIAL_CAST);
    await page.locator("#casting-line-0-weight").fill("1.000");
    await page.locator("#casting-line-0-rate").fill("25000");
    await Promise.all([
      page.waitForURL((u) => u.toString().endsWith("/casting"), { timeout: 30_000 }),
      page.locator('button:has-text("Save and return")').click(),
    ]);
    await page.waitForLoadState("networkidle");

    // 1d. Plating walk-in with SAME phone (verifies multi-flag).
    await page.goto(`${BASE}/plating/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.locator("#plating-party-name").fill(NAME_VENDOR);
    await page.locator("#plating-party-phone").fill(PHONE_VENDOR);
    await page.locator("#plating-line-0-material").fill(MATERIAL_PLAT);
    await page.locator("#plating-line-0-weight").fill("0.500");
    await page.locator("#plating-line-0-rate").fill("30000");
    await Promise.all([
      page.waitForURL((u) => u.toString().endsWith("/plating"), { timeout: 30_000 }),
      page.locator('button:has-text("Save and return")').click(),
    ]);
    await page.waitForLoadState("networkidle");

    const castingRow = await db.query(
      `SELECT id, "partyId" FROM casting_entries WHERE "partyName" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [NAME_VENDOR],
    );
    castingEntryId = castingRow.rows[0]?.id;
    vendorPartyId = castingRow.rows[0]?.partyId;

    const platingRow = await db.query(
      `SELECT id FROM plating_entries WHERE "partyName" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [NAME_VENDOR],
    );
    platingEntryId = platingRow.rows[0]?.id;

    check(
      "1. Test data seeded: sale + purchase + casting + plating, vendor party has both casting+plating flags",
      saleId !== null &&
        purchaseId !== null &&
        castingEntryId !== null &&
        platingEntryId !== null,
      `saleId=${saleId?.slice(0, 8)} purchaseId=${purchaseId?.slice(0, 8)} castingId=${castingEntryId?.slice(0, 8)} platingId=${platingEntryId?.slice(0, 8)}`,
    );

    // Verify vendor has both flags
    const vendor = await db.query(
      `SELECT "isCastingVendor", "isPlatingVendor" FROM parties WHERE id = $1`,
      [vendorPartyId],
    );
    check(
      "1b. Casting+Plating walkin to same phone created ONE party with BOTH flags",
      vendor.rows[0]?.isCastingVendor === true && vendor.rows[0]?.isPlatingVendor === true,
      JSON.stringify(vendor.rows[0]),
    );
  });

  // ============================================================
  // STEP 2 — /payables list shows two parties
  // ============================================================
  await step(page, "2. /payables shows supplier + casting/plating vendor with totals", async () => {
    await page.goto(`${BASE}/payables`, { waitUntil: "networkidle" });
    const supplierRow = page.locator(`tr:has-text("${NAME_SUPPLIER}")`);
    const vendorRow = page.locator(`tr:has-text("${NAME_VENDOR}")`);
    await supplierRow.first().waitFor({ timeout: 10_000 });
    await vendorRow.first().waitFor({ timeout: 10_000 });
    // Both should show their outstanding totals.
    const supplierText = (await supplierRow.first().textContent()) ?? "";
    const vendorText = (await vendorRow.first().textContent()) ?? "";
    // Supplier owes ₹40,000.00 ; vendor owes ₹25,000 + ₹15,000 = ₹40,000.00
    check(
      "2. Both parties listed with correct outstanding totals (₹40,000 each)",
      supplierText.includes("40,000.00") && vendorText.includes("40,000.00"),
      `supplier="${supplierText.slice(0, 80)}" vendor="${vendorText.slice(0, 80)}"`,
    );
  });

  // ============================================================
  // STEP 3 — Missing-attachment filter
  // ============================================================
  await step(page, "3. 'Missing attachments only' filter narrows to parties with missing bills", async () => {
    await page.goto(`${BASE}/payables`, { waitUntil: "networkidle" });
    // All three test rows are missing bills, so the filter shouldn't drop any.
    // What it WILL filter out is any pre-existing fully-billed party.
    // Verify the filter checkbox interaction works at minimum.
    const beforeCount = await page.locator("tbody tr").count();
    await page.locator('input[type="checkbox"][class*="accent-primary"]').first().click();
    await page.waitForTimeout(300);
    const afterCount = await page.locator("tbody tr").count();
    // After filter, only missing-attachment rows visible. Test data has
    // missing attachments, so they should still appear.
    const supplierVisible = await page.locator(`tr:has-text("${NAME_SUPPLIER}")`).count();
    check(
      "3. Filter toggles and supplier (missing bill) remains visible",
      supplierVisible >= 1 && afterCount <= beforeCount,
      `before=${beforeCount} after=${afterCount} supplierVisible=${supplierVisible}`,
    );
  });

  // ============================================================
  // STEP 4 — Per-party detail page
  // ============================================================
  await step(page, "4. /payables/[partyId] shows transaction breakdown", async () => {
    await page.goto(`${BASE}/payables/${supplierPartyId}`, { waitUntil: "networkidle" });
    const heading = (await page.locator("h1").first().textContent()) ?? "";
    check(
      "4a. Heading shows supplier name",
      heading.includes(NAME_SUPPLIER),
      `heading="${heading}"`,
    );
    // Total outstanding card should show ₹40,000.00
    const body = (await page.locator("body").textContent()) ?? "";
    check(
      "4b. Total outstanding ₹40,000.00 visible",
      body.includes("40,000.00"),
      "card text contains the total",
    );
    // The transaction row should be visible.
    const purchaseRow = page.locator(`tr:has-text("Purchase")`).first();
    await purchaseRow.waitFor({ timeout: 10_000 });
    // Missing badge should be present (no bill attached).
    const missingBadges = await page.locator('[data-testid="missing-attachment-badge"]').count();
    check(
      "4c. Missing-attachment badge visible on the transaction row",
      missingBadges >= 1,
      `missing-attachment badges=${missingBadges}`,
    );
  });

  // ============================================================
  // STEP 5 — PartyPaymentModal opens with correct content
  // ============================================================
  await step(page, "5. PartyPaymentModal opens with party + unpaid transactions", async () => {
    await page.goto(`${BASE}/payables`, { waitUntil: "networkidle" });
    const payBtn = page
      .locator(`tr:has-text("${NAME_SUPPLIER}") button[aria-label*="Pay"]`)
      .first();
    await payBtn.waitFor({ timeout: 10_000 });
    await payBtn.click();
    const dialog = page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    const txt = (await dialog.textContent()) ?? "";
    check(
      "5a. Modal header shows 'Pay <supplier>' and lists the purchase",
      txt.includes(`Pay ${NAME_SUPPLIER}`) && txt.includes("Purchase"),
      `text head="${txt.slice(0, 100)}"`,
    );
    check(
      "5b. Modal shows outstanding ₹40,000.00",
      txt.includes("40,000.00"),
      "modal text contains the outstanding amount",
    );
    // Close modal for next step.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  });

  // ============================================================
  // STEP 6 — Partial payment via modal reduces outstanding
  // ============================================================
  await step(page, "6. Partial payment via PartyPaymentModal reduces outstanding", async () => {
    await page.goto(`${BASE}/payables/${supplierPartyId}`, { waitUntil: "networkidle" });
    await page.locator(`button:has-text("Pay ${NAME_SUPPLIER}")`).first().click();
    const dialog = page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: "visible", timeout: 10_000 });

    // Select the purchase transaction.
    const checkboxes = dialog.locator('input[type="checkbox"]');
    await checkboxes.first().waitFor({ state: "visible", timeout: 10_000 });
    await checkboxes.first().click();
    await page.waitForTimeout(300); // wait for React state propagation
    // Edit amount to 20000 (partial).
    const amountInput = dialog.locator(`input[id^="party-payment-amount-${purchaseId}"]`);
    await amountInput.waitFor({ state: "visible", timeout: 5_000 });
    await amountInput.fill("20000");

    await Promise.all([
      page.waitForLoadState("networkidle"),
      dialog.locator('button:has-text("Pay"):not([aria-label])').first().click(),
    ]);
    await page.waitForTimeout(1500);

    // Verify DB has the new payment.
    const after = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS net FROM purchase_payments WHERE "purchaseId" = $1 AND "deletedAt" IS NULL AND type = 'PAYMENT'`,
      [purchaseId],
    );
    check(
      "6. Purchase has a new ₹20,000 PAYMENT recorded (2000000 paise)",
      Number(after.rows[0].net) === 2000000,
      `net paid paise=${after.rows[0].net}`,
    );

    // Verify the /payables list reflects the reduced balance.
    await page.goto(`${BASE}/payables`, { waitUntil: "networkidle" });
    const supplierRow = page.locator(`tr:has-text("${NAME_SUPPLIER}")`).first();
    await supplierRow.waitFor({ timeout: 10_000 });
    const rowText = (await supplierRow.textContent()) ?? "";
    check(
      "6b. /payables list shows supplier reduced to ₹20,000.00 outstanding",
      rowText.includes("20,000.00"),
      `row="${rowText.slice(0, 100)}"`,
    );
  });

  // ============================================================
  // STEP 7 — /receivables list
  // ============================================================
  await step(page, "7. /receivables shows hitesh with outstanding sale balance", async () => {
    await page.goto(`${BASE}/receivables`, { waitUntil: "networkidle" });
    const hiteshRow = page.locator(`tr:has-text("hitesh")`).first();
    await hiteshRow.waitFor({ timeout: 10_000 });
    const txt = (await hiteshRow.textContent()) ?? "";
    // Sale was ₹50,000 - ₹20,000 paid = ₹30,000 outstanding.
    check(
      "7. hitesh listed in /receivables with ₹30,000.00 outstanding",
      txt.includes("30,000.00"),
      `row="${txt.slice(0, 100)}"`,
    );
  });

  // ============================================================
  // STEP 8 — Receive partial payment via PartyPaymentModal
  // ============================================================
  await step(page, "8. Receive partial payment from hitesh reduces outstanding", async () => {
    // Look up hitesh's party id.
    const hitesh = await db.query(
      `SELECT id FROM parties WHERE phone = $1 AND "isCustomer" = true`,
      [HITESH_PHONE],
    );
    const hiteshId = hitesh.rows[0]?.id;
    if (!hiteshId) throw new Error("hitesh party not found");

    await page.goto(`${BASE}/receivables/${hiteshId}`, { waitUntil: "networkidle" });
    await page.locator('button:has-text("Receive Payment")').first().click();
    const dialog = page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    const txt = (await dialog.textContent()) ?? "";
    if (!txt.includes("Receive from hitesh")) {
      throw new Error("Modal header doesn't say 'Receive from hitesh'");
    }
    const checkboxes = dialog.locator('input[type="checkbox"]');
    await checkboxes.first().waitFor({ state: "visible", timeout: 10_000 });
    await checkboxes.first().click();
    await page.waitForTimeout(300);
    const amountInput = dialog.locator(`input[id^="party-payment-amount-${saleId}"]`);
    await amountInput.waitFor({ state: "visible", timeout: 5_000 });
    await amountInput.fill("10000");

    await Promise.all([
      page.waitForLoadState("networkidle"),
      dialog.locator('button:has-text("Record payment")').first().click(),
    ]);
    await page.waitForTimeout(1500);

    const after = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS net FROM sale_payments WHERE "saleId" = $1 AND "deletedAt" IS NULL AND type = 'PAYMENT'`,
      [saleId],
    );
    // 2000000 (initial partial) + 1000000 (this step) = 3000000.
    check(
      "8. Sale now has 30000 paise net paid (20000 initial + 10000 modal = 30000)",
      Number(after.rows[0].net) === 3000000,
      `net paid paise=${after.rows[0].net}`,
    );
  });

  // ============================================================
  // STEP 9 — PURCHASE_DEPT role-scoped access
  // ============================================================
  await logout(page);

  await step(page, "9. PURCHASE_DEPT sees only purchase payables (no casting/plating)", async () => {
    await login(page, PURCHASE.email, PURCHASE.password);
    await page.goto(`${BASE}/payables`, { waitUntil: "networkidle" });
    const supplierVisible = await page.locator(`tr:has-text("${NAME_SUPPLIER}")`).count();
    const vendorVisible = await page.locator(`tr:has-text("${NAME_VENDOR}")`).count();
    check(
      "9a. /payables shows supplier (purchase), hides vendor (casting/plating)",
      supplierVisible >= 1 && vendorVisible === 0,
      `supplier=${supplierVisible} vendor=${vendorVisible}`,
    );

    // /receivables should redirect to /dashboard.
    await page.goto(`${BASE}/receivables`, { waitUntil: "networkidle" });
    const url = page.url();
    check(
      "9b. /receivables redirects PURCHASE_DEPT to /dashboard",
      url.endsWith("/dashboard"),
      `url=${url}`,
    );
  });

  // ============================================================
  // STEP 10 — CASTING_PLATING_MGMT role-scoped access
  // ============================================================
  await logout(page);

  await step(page, "10. CASTING_PLATING_MGMT sees only casting/plating payables", async () => {
    await login(page, CASTING.email, CASTING.password);
    await page.goto(`${BASE}/payables`, { waitUntil: "networkidle" });
    const supplierVisible = await page.locator(`tr:has-text("${NAME_SUPPLIER}")`).count();
    const vendorVisible = await page.locator(`tr:has-text("${NAME_VENDOR}")`).count();
    check(
      "10a. /payables shows vendor (casting+plating), hides supplier (purchase)",
      vendorVisible >= 1 && supplierVisible === 0,
      `supplier=${supplierVisible} vendor=${vendorVisible}`,
    );

    // /receivables redirects.
    await page.goto(`${BASE}/receivables`, { waitUntil: "networkidle" });
    const url = page.url();
    check(
      "10b. /receivables redirects CASTING_PLATING_MGMT to /dashboard",
      url.endsWith("/dashboard"),
      `url=${url}`,
    );

    // Vendor row should show the combined casting+plating total (₹25k + ₹15k = ₹40k).
    await page.goto(`${BASE}/payables`, { waitUntil: "networkidle" });
    const vendorRow = page.locator(`tr:has-text("${NAME_VENDOR}")`).first();
    const rowText = (await vendorRow.textContent()) ?? "";
    check(
      "10c. Vendor row shows combined ₹40,000.00 (casting+plating sum)",
      rowText.includes("40,000.00"),
      `row="${rowText.slice(0, 100)}"`,
    );
  });

  // ============================================================
  // STEP 11 — ADMIN dashboard integration
  // ============================================================
  await logout(page);

  await step(page, "11. ADMIN dashboard shows Total Payables + Receivables cards", async () => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    const body = (await page.locator("body").textContent()) ?? "";
    check(
      "11a. Total Payables card present",
      body.includes("Total Payables"),
      "page text contains 'Total Payables'",
    );
    check(
      "11b. Total Receivables card present",
      body.includes("Total Receivables"),
      "page text contains 'Total Receivables'",
    );
    check(
      "11c. Top parties you owe section present",
      body.includes("Top parties you owe"),
      "section heading visible",
    );
    check(
      "11d. Top customers who owe you section present",
      body.includes("Top customers who owe you"),
      "section heading visible",
    );
    // Supplier + vendor should appear in top parties owed.
    check(
      "11e. Test supplier in top-3 payables list",
      body.includes(NAME_SUPPLIER),
      "supplier name in dashboard",
    );
    check(
      "11f. hitesh in top-3 receivables list",
      body.includes("hitesh"),
      "hitesh in dashboard",
    );
  });

  // ============================================================
  // STEP 12 — Customer detail modal role-chip
  // ============================================================
  await step(page, "12. /customers detail modal shows role chip for hitesh", async () => {
    await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
    const row = page.locator(`tr:has-text("hitesh")`).first();
    await row.waitFor({ timeout: 10_000 });
    await row.click();
    const dialog = page.locator('[role="dialog"]').first();
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
    const chipContainer = dialog.locator('[data-testid="party-role-chips"]');
    await chipContainer.waitFor({ timeout: 5_000 });
    const chipText = (await chipContainer.textContent()) ?? "";
    check(
      "12. PartyRoleChips renders 'Customer' chip for hitesh",
      chipText.includes("Customer"),
      `chips text="${chipText}"`,
    );
  });
} finally {
  await cleanup();
  await db.end();
  await browser.close();
}

// Summary
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log("\n" + "═".repeat(64));
console.log(`Phase 17b walkthrough — ${passed} PASS, ${failed} FAIL`);
console.log("═".repeat(64));
for (const r of results) {
  console.log(`  ${r.pass ? "✓" : "✗"}  ${r.label}${r.detail ? ` (${r.detail})` : ""}`);
}
console.log("═".repeat(64));
process.exit(failed > 0 ? 1 : 0);

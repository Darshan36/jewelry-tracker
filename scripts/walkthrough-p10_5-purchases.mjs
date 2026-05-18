// Phase 10.5 walkthrough — 10 purchases steps mirroring Phase 10's
// sales walkthrough + 2 sales bill-in-form retrofit verifications.
//
//   1.  URL /purchases/new (not modal)
//   2.  Save and add another keeps URL at /purchases/new
//   3.  Save and return lands at /purchases
//   4.  Read-only detail modal — ZERO mutation buttons inside
//   5.  Edit page prefilled, save persists
//   6.  Actions column has 3 icons
//   7.  PaymentActionModal — save + status chip updates
//   8.  BillActionModal first upload with preview
//   9.  Bill replace flow — old row.deletedAt set + old R2 404
//  10.  ReturnActionModal opens + return saves
//  11.  Sales /sales/new shows the inline bill section
//  12.  Sales form-page bill upload — pick file, save, bill row exists
//
// Marker: __phase10_5walk_

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { S3Client, HeadObjectCommand, NotFound } from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p10_5-out");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";
const MARKER = "__phase10_5walk_";

function loadEnvFile(file) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const prodEnv = loadEnvFile(".env.production.local");
const ADMIN = {
  email: prodEnv.SEED_ADMIN_EMAIL,
  password: prodEnv.SEED_ADMIN_PASSWORD,
};

// PNG fixture (1x1 red, ~70 bytes).
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0xb7, 0x49, 0x4f, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_PATH = join(OUT_DIR, "fixture.png");
writeFileSync(PNG_PATH, PNG_BYTES);
const PNG_BYTES_2 = Buffer.from(PNG_BYTES);
PNG_BYTES_2[20] = 0x02; // distinguishing byte
const PNG_PATH_2 = join(OUT_DIR, "fixture-2.png");
writeFileSync(PNG_PATH_2, PNG_BYTES_2);

const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/auth/login"), {
      timeout: 30_000,
    }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function r2HeadIs404(key) {
  const client = new S3Client({
    region: "auto",
    endpoint: prodEnv.R2_ENDPOINT_URL,
    credentials: {
      accessKeyId: prodEnv.R2_ACCESS_KEY_ID,
      secretAccessKey: prodEnv.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: prodEnv.R2_BUCKET_NAME, Key: key }),
    );
    return false;
  } catch (err) {
    if (err instanceof NotFound) return true;
    if (err?.$metadata?.httpStatusCode === 404) return true;
    throw err;
  }
}

// ============ run ============

const browser = await chromium.launch({ headless: true });
let createdPurchaseId = null;
let firstBillR2Key = null;
let firstBillRowId = null;

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  await login(page, ADMIN.email, ADMIN.password);

  // ========== Step 1: URL /purchases/new (not modal) ==========
  await page.goto(`${BASE}/purchases`);
  await page.waitForLoadState("networkidle");
  await page.locator('a:has-text("Add purchase")').click();
  await page.waitForURL((u) => u.toString().endsWith("/purchases/new"), {
    timeout: 10_000,
  });
  const hasModalA = await page.locator('[role="dialog"]').count();
  check(
    "Step 1 — /purchases/new is a full page (no modal)",
    hasModalA === 0 && page.url().endsWith("/purchases/new"),
    `url=${page.url()} dialogs=${hasModalA}`,
  );

  // ========== Step 2: Save and add another ==========
  const partyA = `${MARKER}Supplier A`;
  await page.locator("#purchase-date").waitFor({ timeout: 5_000 });
  await page.locator("#purchases-party-name").fill(partyA);
  await page.locator("#purchase-line-0-item").fill("Raw silver");
  await page.locator("#purchase-line-0-qty").fill("2");
  await page.locator("#purchase-line-0-rate").fill("250");
  await page.locator('button[aria-label="More save options"]').click();
  await page.waitForTimeout(150);
  await page
    .locator('button[role="menuitem"]:has-text("Save and add another")')
    .click();
  await page.waitForFunction(
    () =>
      window.location.pathname === "/purchases/new" &&
      document.querySelector("#purchases-party-name")?.value === "",
    null,
    { timeout: 20_000 },
  );
  check(
    "Step 2 — Save and add another: URL stays at /purchases/new, form cleared",
    true,
  );

  // ========== Step 3: Save and return ==========
  const partyB = `${MARKER}Supplier B`;
  await page.locator("#purchases-party-name").fill(partyB);
  await page.locator("#purchase-line-0-item").fill("Casting wax");
  await page.locator("#purchase-line-0-qty").fill("1");
  await page.locator("#purchase-line-0-rate").fill("800");
  await page.locator('button:has-text("Save and return")').first().click();
  await page.waitForURL((u) => u.toString().endsWith("/purchases"), {
    timeout: 15_000,
  });
  await page.waitForLoadState("networkidle");
  const partyBVisible = await page.locator(`tr:has-text("${partyB}")`).count();
  check(
    "Step 3 — Save and return lands at /purchases, new purchase visible",
    page.url().endsWith("/purchases") && partyBVisible > 0,
    `matchCount=${partyBVisible}`,
  );

  // ========== Step 4: Read-only detail modal ==========
  await page.locator(`tr:has-text("${partyB}")`).first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  const modal = page.locator('[role="dialog"]').first();
  const buttonTexts = await modal
    .locator("button, a")
    .evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ""));
  const flat = buttonTexts.join(" | ").toLowerCase();
  const mutationKeywords = [
    "add payment",
    "record payment",
    "add return",
    "record return",
    "issue refund",
    "record refund",
    "replace bill",
    "upload bill",
    "delete",
  ];
  const matches = mutationKeywords.filter((k) => flat.includes(k));
  const hasEditLink = await modal
    .locator('a:has-text("Edit"), button:has-text("Edit")')
    .count();
  check(
    "Step 4 — Detail modal read-only (no mutation buttons inside, only Edit link)",
    matches.length === 0 && hasEditLink > 0,
    `mutationMatches=${JSON.stringify(matches)} editLinks=${hasEditLink}`,
  );

  // ========== Step 5: Edit page prefilled, save persists ==========
  await modal.locator('a:has-text("Edit")').click();
  await page.waitForURL((u) => /\/purchases\/[^/]+\/edit$/.test(u.toString()), {
    timeout: 10_000,
  });
  const idMatch = page.url().match(/\/purchases\/([^/]+)\/edit$/);
  createdPurchaseId = idMatch ? idMatch[1] : null;
  await page.waitForSelector("#purchases-party-name", { timeout: 5_000 });
  const prefilledParty = await page.locator("#purchases-party-name").inputValue();
  await page.locator("#purchase-discount").fill("50");
  await page.locator('button:has-text("Save and return")').first().click();
  await page.waitForURL((u) => u.toString().endsWith("/purchases"), {
    timeout: 15_000,
  });
  await page.waitForLoadState("networkidle");
  const rowAfterEdit = await page
    .locator(`tr:has-text("${partyB}")`)
    .first()
    .innerText();
  check(
    "Step 5 — Edit page prefilled + save persists (₹50 discount applied → ₹750)",
    prefilledParty === partyB && /750\.00/.test(rowAfterEdit),
    `prefilled=${prefilledParty === partyB} rowText="${rowAfterEdit.replace(/\s+/g, " ")}"`,
  );

  // ========== Step 6: Actions column has 3 buttons ==========
  const rowForActions = page.locator(`tr:has-text("${partyB}")`).first();
  const payBtn = await rowForActions
    .locator('button[aria-label="Add payment"]')
    .count();
  const billBtn = await rowForActions
    .locator('button[aria-label="Manage bill"]')
    .count();
  const returnBtn = await rowForActions
    .locator('button[aria-label="Record return"]')
    .count();
  check(
    "Step 6 — Actions column has 3 icon buttons",
    payBtn === 1 && billBtn === 1 && returnBtn === 1,
    `pay=${payBtn} bill=${billBtn} return=${returnBtn}`,
  );

  // ========== Step 7: PaymentActionModal — save + status updates ==========
  await rowForActions.locator('button[aria-label="Add payment"]').click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await page.locator("#payment-amount").fill("300");
  await page
    .locator('[role="dialog"] button[type="submit"]:has-text("Save")')
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    (party) => {
      const rows = Array.from(document.querySelectorAll("tr"));
      const row = rows.find((r) => r.textContent?.includes(party));
      return row && /partial/i.test(row.textContent ?? "");
    },
    partyB,
    { timeout: 15_000 },
  );
  check("Step 7 — Payment saved, row status flips to Partial", true);

  // ========== Step 8: BillActionModal first upload with preview ==========
  await page
    .locator(`tr:has-text("${partyB}")`)
    .first()
    .locator('button[aria-label="Manage bill"]')
    .click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  const titleA = await page.locator('[role="dialog"] h2').first().innerText();
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles(PNG_PATH);
  await page.waitForSelector('[data-testid="bill-preview"]', { timeout: 5_000 });
  const previewVisibleA = await page
    .locator('[data-testid="bill-preview"] img')
    .count();
  await page.locator('[role="dialog"] button:has-text("Upload")').click();
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 60_000 },
  );
  check(
    "Step 8 — Bill modal: file picker → preview → upload OK",
    /upload bill/i.test(titleA) && previewVisibleA === 1,
    `title="${titleA}" previewImg=${previewVisibleA}`,
  );

  // Capture first bill from DB for step 9 verification.
  const pgClient = new pg.Client({ connectionString: prodEnv.DIRECT_URL });
  await pgClient.connect();
  const firstBillRes = await pgClient.query(
    `SELECT id, "r2Key" FROM bills WHERE "attachedToType" = 'PURCHASE' AND "attachedToId" = $1 AND "deletedAt" IS NULL AND status = 'READY'`,
    [createdPurchaseId],
  );
  firstBillRowId = firstBillRes.rows[0]?.id ?? null;
  firstBillR2Key = firstBillRes.rows[0]?.r2Key ?? null;

  // ========== Step 9: Bill replace flow ==========
  await page
    .locator(`tr:has-text("${partyB}")`)
    .first()
    .locator('button[aria-label="Manage bill"]')
    .click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await page.waitForSelector("text=fixture.png", { timeout: 10_000 });
  const titleB = await page.locator('[role="dialog"] h2').first().innerText();
  await page.locator('button:has-text("Replace with a new file")').click();
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles(PNG_PATH_2);
  await page.waitForSelector('[data-testid="bill-preview"]', { timeout: 5_000 });
  await page.locator('[role="dialog"] button:has-text("Upload")').click();
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 60_000 },
  );

  const oldBillAfter = await pgClient.query(
    `SELECT "deletedAt" FROM bills WHERE id = $1`,
    [firstBillRowId],
  );
  const oldDeletedAt = oldBillAfter.rows[0]?.deletedAt;
  const newBillRes = await pgClient.query(
    `SELECT id, "r2Key" FROM bills WHERE "attachedToType" = 'PURCHASE' AND "attachedToId" = $1 AND "deletedAt" IS NULL AND status = 'READY'`,
    [createdPurchaseId],
  );
  const newBillExists = newBillRes.rows.length === 1;
  const newR2KeyDifferent = newBillRes.rows[0]?.r2Key !== firstBillR2Key;
  await pgClient.end();
  let oldR2Gone = false;
  if (firstBillR2Key) oldR2Gone = await r2HeadIs404(firstBillR2Key);
  check(
    "Step 9 — Bill replace: old row.deletedAt set + new row exists + old R2 404",
    /replace bill/i.test(titleB) &&
      oldDeletedAt !== null &&
      newBillExists &&
      newR2KeyDifferent &&
      oldR2Gone,
    `title="${titleB}" oldDel=${oldDeletedAt?.toISOString?.() ?? "null"} newOK=${newBillExists} keyDiff=${newR2KeyDifferent} r2Gone=${oldR2Gone}`,
  );

  // ========== Step 10: ReturnActionModal ==========
  await page
    .locator(`tr:has-text("${partyB}")`)
    .first()
    .locator('button[aria-label="Record return"]')
    .click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await page.locator("#return-qty").fill("1");
  await page.locator("#return-refund").fill("100");
  await page
    .locator('[role="dialog"] button[type="submit"]:has-text("Save")')
    .click();
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 15_000 },
  );
  check("Step 10 — Return modal saves + modal closes", true);

  // ========== Step 11: Sales /sales/new shows the inline bill section ==========
  await page.goto(`${BASE}/sales/new`);
  await page.waitForLoadState("networkidle");
  // Bill section header "Attach bill (optional)" — added in Phase 10.5 retrofit.
  const hasBillSection = await page
    .locator("text=Attach bill (optional)")
    .count();
  check(
    "Step 11 — Sales /sales/new has inline 'Attach bill (optional)' section",
    hasBillSection > 0,
    `headerCount=${hasBillSection}`,
  );

  // ========== Step 12: Sales bill-in-form upload chain end-to-end ==========
  const salesParty = `${MARKER}Sales Test`;
  await page.locator("#sales-party-name").fill(salesParty);
  await page.locator("#sale-line-0-item").fill("Test sale");
  await page.locator("#sale-line-0-qty").fill("1");
  await page.locator("#sale-line-0-rate").fill("300");
  // Pick a file in the inline bill section.
  await page.locator('input[type="file"]').setInputFiles(PNG_PATH);
  await page.waitForSelector('[data-testid="bill-preview"]', { timeout: 5_000 });
  // Save and return — should run the bill upload chain inline.
  await page.locator('button:has-text("Save and return")').first().click();
  await page.waitForURL((u) => u.toString().endsWith("/sales"), {
    timeout: 60_000,
  });
  await page.waitForLoadState("networkidle");

  // Verify: the sale exists AND a Bill row exists for it.
  const verifyClient = new pg.Client({ connectionString: prodEnv.DIRECT_URL });
  await verifyClient.connect();
  const saleRes = await verifyClient.query(
    `SELECT id FROM sales WHERE "partyName" = $1 AND "deletedAt" IS NULL`,
    [salesParty],
  );
  const saleId = saleRes.rows[0]?.id;
  const salesBillRes = await verifyClient.query(
    `SELECT id, status FROM bills WHERE "attachedToType" = 'SALE' AND "attachedToId" = $1 AND "deletedAt" IS NULL`,
    [saleId],
  );
  await verifyClient.end();
  check(
    "Step 12 — Sales bill-in-form upload chain: sale created + READY bill attached via discriminator",
    saleId && salesBillRes.rows.length === 1 && salesBillRes.rows[0].status === "READY",
    `saleId=${saleId ?? "none"} billCount=${salesBillRes.rows.length} firstStatus=${salesBillRes.rows[0]?.status ?? "n/a"}`,
  );

  await ctx.close();
} finally {
  await browser.close();
}

// ============ cleanup ============
console.log("\nCleaning up walkthrough data via marker prefix...");
const cleanupClient = new pg.Client({ connectionString: prodEnv.DIRECT_URL });
await cleanupClient.connect();
try {
  await cleanupClient.query("BEGIN");

  // Purchases side
  const purchIds = await cleanupClient.query(
    `SELECT id FROM purchases WHERE "partyName" LIKE $1`,
    [`${MARKER}%`],
  );
  const pIds = purchIds.rows.map((r) => r.id);
  const purchBills = await cleanupClient.query(
    `SELECT id FROM bills WHERE "attachedToType" = 'PURCHASE' AND "attachedToId" = ANY($1)`,
    [pIds],
  );
  if (pIds.length > 0) {
    await cleanupClient.query(
      `DELETE FROM purchase_payments WHERE "purchaseId" = ANY($1)`,
      [pIds],
    );
    await cleanupClient.query(
      `DELETE FROM purchase_returns WHERE "purchaseId" = ANY($1)`,
      [pIds],
    );
    await cleanupClient.query(
      `DELETE FROM purchase_line_items WHERE "purchaseId" = ANY($1)`,
      [pIds],
    );
    await cleanupClient.query(`DELETE FROM purchases WHERE id = ANY($1)`, [pIds]);
  }
  if (purchBills.rows.length > 0) {
    await cleanupClient.query(`DELETE FROM bills WHERE id = ANY($1)`, [
      purchBills.rows.map((b) => b.id),
    ]);
  }
  await cleanupClient.query(`DELETE FROM suppliers WHERE name LIKE $1`, [
    `${MARKER}%`,
  ]);

  // Sales side
  const saleIds = await cleanupClient.query(
    `SELECT id FROM sales WHERE "partyName" LIKE $1`,
    [`${MARKER}%`],
  );
  const sIds = saleIds.rows.map((r) => r.id);
  const saleBills = await cleanupClient.query(
    `SELECT id FROM bills WHERE "attachedToType" = 'SALE' AND "attachedToId" = ANY($1)`,
    [sIds],
  );
  if (sIds.length > 0) {
    await cleanupClient.query(
      `DELETE FROM sale_payments WHERE "saleId" = ANY($1)`,
      [sIds],
    );
    await cleanupClient.query(
      `DELETE FROM sale_returns WHERE "saleId" = ANY($1)`,
      [sIds],
    );
    await cleanupClient.query(
      `DELETE FROM sale_line_items WHERE "saleId" = ANY($1)`,
      [sIds],
    );
    await cleanupClient.query(`DELETE FROM sales WHERE id = ANY($1)`, [sIds]);
  }
  if (saleBills.rows.length > 0) {
    await cleanupClient.query(`DELETE FROM bills WHERE id = ANY($1)`, [
      saleBills.rows.map((b) => b.id),
    ]);
  }
  await cleanupClient.query(`DELETE FROM customers WHERE name LIKE $1`, [
    `${MARKER}%`,
  ]);

  await cleanupClient.query("COMMIT");
  console.log(
    `  purchases=${pIds.length} sales=${sIds.length} bills=${purchBills.rows.length + saleBills.rows.length}`,
  );
} catch (err) {
  await cleanupClient.query("ROLLBACK");
  console.error("Cleanup failed:", err.message);
} finally {
  await cleanupClient.end();
}

const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass).length;
console.log(`\n${pass}/${results.length} PASS  ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

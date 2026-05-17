// Phase 10 UX walkthrough — sales-only scope (per the build-phase
// scope decision). Covers the 10 critical sales steps:
//
//   1. URL is /sales/new (not modal) after +Add Sale
//   2. Save and add another: form clears, URL stays at /sales/new
//   3. Save and return: lands at /sales
//   4. Read-only detail modal — ZERO mutation buttons inside, only Edit
//   5. Edit page: form prefilled, modify+save persists
//   6. Actions column has 3 icon buttons ($ / 📎 / ↩)
//   7. PaymentActionModal: opens, save, status chip updates
//   8. BillActionModal first upload: file picker → preview → upload
//   9. Bill replace flow: old bill row has deletedAt + old R2 obj 404
//  10. ReturnActionModal opens + return saves
//
// Marker pattern: __phase10walk_ on partyName / customer name.
// Cleanup at the end via the marker filter.

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import {
  S3Client,
  HeadObjectCommand,
  NotFound,
} from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p10-out");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";
const MARKER = "__phase10walk_";

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

// PNG fixture (same minimal 70-byte 1x1 used in Phase 8/9).
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0xb7, 0x49, 0x4f, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_PATH = join(OUT_DIR, "fixture.png");
const PNG_PATH_2 = join(OUT_DIR, "fixture-2.png");
writeFileSync(PNG_PATH, PNG_BYTES);
// Distinguish the "replace" file by mutating one byte (avoids hashing
// equal, makes the rows easy to tell apart in the DB audit).
const PNG_BYTES_2 = Buffer.from(PNG_BYTES);
PNG_BYTES_2[20] = 0x02; // change a non-critical byte
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
    page.waitForURL((u) => !u.toString().includes("/auth/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

// R2 HeadObject probe (returns 404 when the object is gone).
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
    return false; // object present
  } catch (err) {
    if (err instanceof NotFound) return true;
    const meta = err?.$metadata;
    if (meta?.httpStatusCode === 404) return true;
    throw err;
  }
}

// ============ run ============

const browser = await chromium.launch({ headless: true });
let createdSaleId = null;
let firstBillR2Key = null;
let firstBillRowId = null;

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept()); // confirm() prompts auto-accept

  await login(page, ADMIN.email, ADMIN.password);

  // ============ Step 1: /sales/new (URL, not modal) ============
  await page.goto(`${BASE}/sales`);
  await page.waitForLoadState("networkidle");
  await page.locator('a:has-text("Add sale")').click();
  await page.waitForURL((u) => u.toString().endsWith("/sales/new"), {
    timeout: 10_000,
  });
  // Sanity: there should NOT be a [role="dialog"] open — the form is a page.
  const hasModal = await page.locator('[role="dialog"]').count();
  check(
    "Step 1 — URL is /sales/new with no modal (form is a full page)",
    hasModal === 0 && page.url().endsWith("/sales/new"),
    `url=${page.url()} dialogs=${hasModal}`,
  );

  // ============ Step 2: Save and add another — form clears, URL stays ============
  // Fill walk-in party + one line. Use the marker prefix.
  const partyA = `${MARKER}Test Customer A`;
  await page.locator("#sale-date").waitFor({ timeout: 5_000 });
  await page.locator("#party-name-input").fill(partyA);
  await page.locator("#sale-line-0-item").fill("Test ring");
  await page.locator("#sale-line-0-qty").fill("2");
  await page.locator("#sale-line-0-rate").fill("100");
  // Open the dropdown menu and click "Save and add another"
  await page.locator('button[aria-label="More save options"]').click();
  // The click-outside catcher mounts after setOpen(true); give React one
  // frame to commit before clicking the menu item.
  await page.waitForTimeout(150);
  await page.locator('button[role="menuitem"]:has-text("Save and add another")').click();
  try {
    await page.waitForFunction(
      () => {
        const url = window.location.pathname;
        const inp = document.querySelector("#party-name-input");
        return url === "/sales/new" && inp && inp.value === "";
      },
      null,
      { timeout: 20_000 },
    );
    check("Step 2 — Save and add another: URL stays at /sales/new, form cleared", true);
  } catch (err) {
    const shotPath = join(OUT_DIR, "step2-fail.png");
    await page.screenshot({ path: shotPath, fullPage: true });
    const url = page.url();
    const partyVal = await page
      .locator("#party-name-input")
      .inputValue()
      .catch(() => "(input missing)");
    check(
      "Step 2 — Save and add another: URL stays at /sales/new, form cleared",
      false,
      `url=${url} partyInputValue="${partyVal}" screenshot=${shotPath}`,
    );
    throw err;
  }

  // ============ Step 3: Save and return — lands at /sales ============
  const partyB = `${MARKER}Test Customer B`;
  await page.locator("#party-name-input").fill(partyB);
  await page.locator("#sale-line-0-item").fill("Test bracelet");
  await page.locator("#sale-line-0-qty").fill("1");
  await page.locator("#sale-line-0-rate").fill("500");
  // Primary action — "Save and return"
  await page.locator('button:has-text("Save and return")').first().click();
  await page.waitForURL((u) => u.toString().endsWith("/sales"), {
    timeout: 15_000,
  });
  await page.waitForLoadState("networkidle");
  // Confirm partyB row visible in the table.
  const partyBVisible = await page
    .locator(`tr:has-text("${partyB}")`)
    .count();
  check(
    "Step 3 — Save and return: lands at /sales, new sale visible",
    page.url().endsWith("/sales") && partyBVisible > 0,
    `url=${page.url()} matchCount=${partyBVisible}`,
  );

  // ============ Step 4: Read-only detail modal ============
  // Open the partyB row's detail modal.
  const partyBRow = page.locator(`tr:has-text("${partyB}")`).first();
  await partyBRow.click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });

  // Read all button accessible names inside the modal — there should be
  // NO mutation buttons. Allowed: Edit (link), Close (Radix's built-in).
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
  const hasEditLink = await modal.locator('a:has-text("Edit"), button:has-text("Edit")').count();
  check(
    "Step 4 — Detail modal is read-only (no mutation buttons inside, only Edit)",
    matches.length === 0 && hasEditLink > 0,
    `mutationMatches=${JSON.stringify(matches)} editLinks=${hasEditLink}`,
  );

  // ============ Step 5: Edit page — prefilled, modify + save persists ============
  // Click Edit. Detail modal closes, lands at /sales/<id>/edit.
  await modal.locator('a:has-text("Edit")').click();
  await page.waitForURL((u) => /\/sales\/[^/]+\/edit$/.test(u.toString()), {
    timeout: 10_000,
  });
  // Capture the sale id from the URL for later steps.
  const editUrl = page.url();
  const idMatch = editUrl.match(/\/sales\/([^/]+)\/edit$/);
  createdSaleId = idMatch ? idMatch[1] : null;

  // Confirm form is prefilled with partyB.
  await page.waitForSelector("#party-name-input", { timeout: 5_000 });
  const partyNameVal = await page.locator("#party-name-input").inputValue();
  const partyMatches = partyNameVal === partyB;

  // Modify the discount to a non-zero value and save.
  await page.locator("#sale-discount").fill("50");
  await page.locator('button:has-text("Save and return")').first().click();
  await page.waitForURL((u) => u.toString().endsWith("/sales"), {
    timeout: 15_000,
  });
  await page.waitForLoadState("networkidle");

  // Verify the total updated (line was 1 × ₹500 = ₹500; discount ₹50 →
  // expected total ₹450).
  const partyBRowText = await page
    .locator(`tr:has-text("${partyB}")`)
    .first()
    .innerText();
  check(
    "Step 5 — Edit page prefilled, modify + save persists (discount ₹50 applied)",
    partyMatches && /450\.00/.test(partyBRowText),
    `partyMatches=${partyMatches} rowText="${partyBRowText.replace(/\s+/g, " ")}"`,
  );

  // ============ Step 6: Actions column has 3 icon buttons ============
  const rowForActions = page.locator(`tr:has-text("${partyB}")`).first();
  const payBtn = await rowForActions.locator('button[aria-label="Add payment"]').count();
  const billBtn = await rowForActions.locator('button[aria-label="Manage bill"]').count();
  const returnBtn = await rowForActions.locator('button[aria-label="Record return"]').count();
  check(
    "Step 6 — Actions column has 3 icon buttons (Pay / Bill / Return)",
    payBtn === 1 && billBtn === 1 && returnBtn === 1,
    `pay=${payBtn} bill=${billBtn} return=${returnBtn}`,
  );

  // ============ Step 7: PaymentActionModal — open, save, status chip updates ============
  await rowForActions.locator('button[aria-label="Add payment"]').click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await page.locator("#payment-amount").fill("200");
  await page.locator('[role="dialog"] button[type="submit"]:has-text("Save")').click();
  // Wait for modal to close + status chip update to "Partial".
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    (partyName) => {
      const rows = Array.from(document.querySelectorAll("tr"));
      const row = rows.find((r) => r.textContent?.includes(partyName));
      return row && /partial/i.test(row.textContent ?? "");
    },
    partyB,
    { timeout: 15_000 },
  );
  check(
    "Step 7 — Payment saved, status chip updated to Partial without page reload",
    true,
  );

  // ============ Step 8: BillActionModal — first upload with preview ============
  const rowForBill = page.locator(`tr:has-text("${partyB}")`).first();
  await rowForBill.locator('button[aria-label="Manage bill"]').click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  // Confirm file picker visible + no existing bill block (heading shows
  // "Upload bill" not "Replace bill").
  const titleA = await page.locator('[role="dialog"] h2').first().innerText();
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles(PNG_PATH);
  // Preview renders for the picked file.
  await page.waitForSelector('[data-testid="bill-preview"]', { timeout: 5_000 });
  const previewVisibleA = await page.locator('[data-testid="bill-preview"] img').count();
  // Upload.
  await page.locator('[role="dialog"] button:has-text("Upload")').click();
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 60_000 },
  );
  check(
    "Step 8 — Bill action modal: picker visible → preview renders → upload completes",
    /upload bill/i.test(titleA) && previewVisibleA === 1,
    `title="${titleA}" previewImg=${previewVisibleA}`,
  );

  // Capture the first bill's r2Key from the DB (we'll verify it's gone
  // after step 9).
  const pgClient = new pg.Client({ connectionString: prodEnv.DIRECT_URL });
  await pgClient.connect();
  const firstBillRes = await pgClient.query(
    `SELECT id, "r2Key" FROM bills WHERE "attachedToType" = 'SALE' AND "attachedToId" = $1 AND "deletedAt" IS NULL AND status = 'READY'`,
    [createdSaleId],
  );
  firstBillRowId = firstBillRes.rows[0]?.id ?? null;
  firstBillR2Key = firstBillRes.rows[0]?.r2Key ?? null;

  // ============ Step 9: Bill replace — old row deletedAt + old R2 gone ============
  await page.locator(`tr:has-text("${partyB}")`).first()
    .locator('button[aria-label="Manage bill"]').click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  // Wait for the existing-bill panel to render (it shows the filename of the prior upload).
  await page.waitForSelector('text=fixture.png', { timeout: 10_000 });
  const titleB = await page.locator('[role="dialog"] h2').first().innerText();
  // Click "Replace with a new file" affordance then pick a new file.
  await page.locator('button:has-text("Replace with a new file")').click();
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles(PNG_PATH_2);
  await page.waitForSelector('[data-testid="bill-preview"]', { timeout: 5_000 });
  await page.locator('[role="dialog"] button:has-text("Upload")').click();
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 60_000 },
  );

  // DB verification: the old bill row has deletedAt set; a new bill row
  // exists with status=READY for the same discriminator pair.
  const oldBillAfter = await pgClient.query(
    `SELECT "deletedAt" FROM bills WHERE id = $1`,
    [firstBillRowId],
  );
  const oldDeletedAt = oldBillAfter.rows[0]?.deletedAt;
  const newBillRes = await pgClient.query(
    `SELECT id, "r2Key" FROM bills WHERE "attachedToType" = 'SALE' AND "attachedToId" = $1 AND "deletedAt" IS NULL AND status = 'READY'`,
    [createdSaleId],
  );
  const newBillRowExists = newBillRes.rows.length === 1;
  const newR2KeyDifferent = newBillRes.rows[0]?.r2Key !== firstBillR2Key;
  await pgClient.end();

  // R2 verification: the old r2Key is now a 404.
  let oldR2Gone = false;
  if (firstBillR2Key) {
    oldR2Gone = await r2HeadIs404(firstBillR2Key);
  }

  check(
    "Step 9 — Bill replace: old row.deletedAt set, new row exists, old R2 object 404",
    /replace bill/i.test(titleB) &&
      oldDeletedAt !== null &&
      newBillRowExists &&
      newR2KeyDifferent &&
      oldR2Gone,
    `title="${titleB}" oldDeletedAt=${oldDeletedAt?.toISOString?.() ?? "null"} newExists=${newBillRowExists} keysDiffer=${newR2KeyDifferent} oldR2Gone=${oldR2Gone}`,
  );

  // ============ Step 10: ReturnActionModal — open + save ============
  await page
    .locator(`tr:has-text("${partyB}")`)
    .first()
    .locator('button[aria-label="Record return"]')
    .click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await page.locator("#return-qty").fill("1");
  await page.locator("#return-refund").fill("100");
  await page.locator('[role="dialog"] button[type="submit"]:has-text("Save")').click();
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 15_000 },
  );
  // Verify the row's status reflects the return + payment state.
  // partyB: total ₹500 → discount ₹50 → effective ₹450 → return ₹100 →
  // adjusted total ₹350. Paid ₹200. Status: partial.
  const rowAfterReturn = await page
    .locator(`tr:has-text("${partyB}")`)
    .first()
    .innerText();
  check(
    "Step 10 — Return modal opens + save closes modal; status reflects new state",
    /partial|completed|refund/i.test(rowAfterReturn),
    `rowText="${rowAfterReturn.replace(/\s+/g, " ")}"`,
  );

  await ctx.close();
} finally {
  await browser.close();
}

// ============ cleanup via marker pattern ============
console.log("\nCleaning up walkthrough data via marker prefix...");
const cleanupClient = new pg.Client({ connectionString: prodEnv.DIRECT_URL });
await cleanupClient.connect();
try {
  await cleanupClient.query("BEGIN");
  // Find the sale ids we created (any sale whose partyName carries the marker).
  const saleIds = await cleanupClient.query(
    `SELECT id FROM sales WHERE "partyName" LIKE $1`,
    [`${MARKER}%`],
  );
  const ids = saleIds.rows.map((r) => r.id);

  const billsForOurSales = await cleanupClient.query(
    `SELECT id, "r2Key" FROM bills WHERE "attachedToType" = 'SALE' AND "attachedToId" = ANY($1)`,
    [ids],
  );

  // Hard-delete payments, returns, line items, sales.
  if (ids.length > 0) {
    const p1 = await cleanupClient.query(
      `DELETE FROM sale_payments WHERE "saleId" = ANY($1)`,
      [ids],
    );
    const p2 = await cleanupClient.query(
      `DELETE FROM sale_returns WHERE "saleId" = ANY($1)`,
      [ids],
    );
    const p3 = await cleanupClient.query(
      `DELETE FROM sale_line_items WHERE "saleId" = ANY($1)`,
      [ids],
    );
    const p4 = await cleanupClient.query(
      `DELETE FROM sales WHERE id = ANY($1)`,
      [ids],
    );
    console.log(
      `  sale_payments=${p1.rowCount} sale_returns=${p2.rowCount} sale_line_items=${p3.rowCount} sales=${p4.rowCount}`,
    );
  }
  // Hard-delete the bill rows (their R2 objects were already deleted on
  // upload/replace/soft-delete).
  if (billsForOurSales.rows.length > 0) {
    const billIds = billsForOurSales.rows.map((b) => b.id);
    const bdel = await cleanupClient.query(
      `DELETE FROM bills WHERE id = ANY($1)`,
      [billIds],
    );
    console.log(`  bills=${bdel.rowCount}`);
  }
  // Hard-delete any customer we created via walk-in auto-promotion that
  // matches our marker.
  const cdel = await cleanupClient.query(
    `DELETE FROM customers WHERE name LIKE $1`,
    [`${MARKER}%`],
  );
  console.log(`  customers=${cdel.rowCount}`);
  await cleanupClient.query("COMMIT");
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

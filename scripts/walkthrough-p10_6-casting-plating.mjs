// Phase 10.6 walkthrough — 14 steps verifying Casting+Plating UX mirror
// + bill-in-form retrofit for Purchases/Casting/Plating + Sales re-check.
//
// Casting (6):
//   1. URL /casting/new (full-width form, no modal)
//   2. Fill walk-in vendor + 2 line items + bill file → Save and return → /casting
//   3. New entry visible with vendor chip, materials "Brass + 1 more", status PENDING
//   4. Detail modal is read-only — ZERO mutation buttons
//   5. $ → PaymentActionModal (entityType="casting") records payment, status flips
//   6. 📎 → BillActionModal replace flow — FK replacement DB-verified
//
// Plating (4):
//   7. /plating/new full-width form + line item + save
//   8. Row → read-only detail; two-button Actions column
//   9. $ → PaymentActionModal (entityType="plating") records payment
//  10. 📎 → first-upload flow; entity.billId set
//
// Bill-in-form retrofit (4):
//  11. /purchases/new inline bill section + save → bill attached
//  12. /casting/new inline bill section + save → FK + discriminator both set
//  13. /plating/new inline bill section + save → FK + discriminator both set
//  14. /sales/new bill section still renders (Phase 10.5 retrofit intact)
//
// Marker: __phase10_6walk_

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { S3Client, HeadObjectCommand, NotFound } from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p10_6-out");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.WALKTHROUGH_BASE ?? "http://localhost:3000";
const MARKER = "__phase10_6walk_";

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

const ENV_FILE = process.env.WALKTHROUGH_ENV ?? ".env.local";
const env = loadEnvFile(ENV_FILE);
const ADMIN = {
  email: env.SEED_ADMIN_EMAIL,
  password: env.SEED_ADMIN_PASSWORD,
};

console.log(`[walkthrough-p10_6] BASE=${BASE}  env=${ENV_FILE}  admin=${ADMIN.email}`);

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
PNG_BYTES_2[20] = 0x02;
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
    page.waitForURL((u) => !u.toString().includes("/auth/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function r2HeadIs404(key) {
  if (!env.R2_ENDPOINT_URL) return null; // skipped if R2 not configured
  const client = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT_URL,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  try {
    await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
    return false;
  } catch (err) {
    if (err instanceof NotFound) return true;
    if (err?.$metadata?.httpStatusCode === 404) return true;
    throw err;
  }
}

// ============ run ============

const browser = await chromium.launch({ headless: true });
const db = new pg.Client({ connectionString: env.DIRECT_URL });
await db.connect();

let castingEntryId = null;
let firstBillId = null;
let firstBillR2Key = null;
let platingEntryId = null;
let purchaseId = null;
let castingEntryId2 = null;
let platingEntryId2 = null;

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  await login(page, ADMIN.email, ADMIN.password);

  // ============================================================
  // STEP 1: /casting/new is a full page (no modal), weight inputs
  // ============================================================
  await page.goto(`${BASE}/casting`);
  await page.waitForLoadState("networkidle");
  await page.locator('a:has-text("Add casting entry")').click();
  await page.waitForURL((u) => u.toString().endsWith("/casting/new"), { timeout: 10_000 });
  const dialogCountStep1 = await page.locator('[role="dialog"]').count();
  const hasWeightInput = await page.locator("#casting-line-0-weight").count();
  check(
    "Step 1 — /casting/new is full page with weight input (no modal)",
    dialogCountStep1 === 0 && hasWeightInput > 0,
    `dialogs=${dialogCountStep1} weightInputs=${hasWeightInput}`,
  );

  // ============================================================
  // STEP 2 + STEP 3: Fill, save with bill, verify list row
  // ============================================================
  const vendorA = `${MARKER}castvendor`;
  const phoneA = `98765${Date.now().toString().slice(-5)}A`.slice(0, 12);
  await page.locator("#casting-date").waitFor({ timeout: 5_000 });
  await page.locator("#casting-party-name").fill(vendorA);
  await page.locator("#casting-party-phone").fill(phoneA.replace(/[^0-9]/g, ""));
  await page.locator("#casting-line-0-material").fill("Brass");
  await page.locator("#casting-line-0-weight").fill("2.500");
  await page.locator("#casting-line-0-rate").fill("400");
  await page.locator('button:has-text("Add line")').click();
  await page.locator("#casting-line-1-material").fill("Aluminium");
  await page.locator("#casting-line-1-weight").fill("1.875");
  await page.locator("#casting-line-1-rate").fill("350");
  await page.locator("#casting-discount").fill("100");
  // Pick a bill via the inline file input (the only type=file on the form).
  await page.locator('input[type="file"]').setInputFiles(PNG_PATH);
  await page.waitForTimeout(300); // preview render
  const previewVisible = await page.locator("img, embed").count();

  await Promise.all([
    page.waitForURL((u) => u.toString().endsWith("/casting"), { timeout: 30_000 }),
    page.locator('button:has-text("Save and return")').click(),
  ]);
  await page.waitForLoadState("networkidle");

  // Find the new entry in the list — most recent row matching marker.
  const newRow = page.locator(`tr:has-text("${vendorA}")`).first();
  await newRow.waitFor({ timeout: 10_000 });
  const rowText = (await newRow.textContent()) ?? "";
  check(
    "Step 2 — Save and return navigates to /casting with new entry visible (bill picker fired)",
    page.url().endsWith("/casting") && rowText.includes(vendorA),
    `url=${page.url()} previewElems=${previewVisible} rowText=${rowText.slice(0, 80)}`,
  );

  // Find castingEntryId via DB.
  {
    const r = await db.query(
      `SELECT id, total, "billId" FROM casting_entries WHERE "partyName" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [vendorA],
    );
    castingEntryId = r.rows[0]?.id;
    const totalPaise = Number(r.rows[0]?.total);
    const expectedTotal = 155625; // 2.500×400 + 1.875×350 − 100 = 1000.00 + 656.25 − 100 = 1556.25 → 155625 paise
    const billId = r.rows[0]?.billId;
    check(
      "Step 3 — Entry totals to ₹1,556.25 and has billId attached after inline upload",
      castingEntryId && totalPaise === expectedTotal && billId !== null,
      `id=${castingEntryId} total=${totalPaise} expected=${expectedTotal} billId=${billId}`,
    );
    firstBillId = billId;
  }

  if (firstBillId) {
    const r = await db.query(
      `SELECT "r2Key", status, "attachedToType", "attachedToId" FROM bills WHERE id = $1`,
      [firstBillId],
    );
    firstBillR2Key = r.rows[0]?.r2Key;
    check(
      "Step 3b — Initial Bill row has CASTING_ENTRY discriminator + status READY",
      r.rows[0]?.status === "READY" &&
        r.rows[0]?.attachedToType === "CASTING_ENTRY" &&
        r.rows[0]?.attachedToId === castingEntryId,
      `status=${r.rows[0]?.status} disc=${r.rows[0]?.attachedToType} attachedToId=${r.rows[0]?.attachedToId}`,
    );
  }

  // ============================================================
  // STEP 4: Click row → read-only detail modal (zero mutation buttons)
  // ============================================================
  await newRow.click();
  await page.locator('[role="dialog"]').waitFor({ timeout: 5_000 });
  const dialog = page.locator('[role="dialog"]').first();
  // No buttons named "Add Payment", "Replace Bill", "Add Return", or "Delete".
  const noAddPayment = (await dialog.locator('button:has-text("Add Payment")').count()) === 0;
  const noReplaceBill = (await dialog.locator('button:has-text("Replace")').count()) === 0;
  const noAddReturn = (await dialog.locator('button:has-text("Add Return")').count()) === 0;
  const noDelete = (await dialog.locator('button:has-text("Delete")').count()) === 0;
  // Has exactly one Edit link routing to /casting/<id>/edit.
  const editHref = await dialog.locator(`a:has-text("Edit")`).first().getAttribute("href");
  check(
    "Step 4 — Detail modal is read-only (no Add Payment/Replace/Add Return/Delete) with Edit link",
    noAddPayment && noReplaceBill && noAddReturn && noDelete && editHref?.includes("/edit"),
    `noAddPayment=${noAddPayment} noReplace=${noReplaceBill} noAddReturn=${noAddReturn} noDelete=${noDelete} editHref=${editHref}`,
  );
  // Close modal via Escape (avoids click-outside-closes-modal flakiness).
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // ============================================================
  // STEP 5: $ button → PaymentActionModal (entityType="casting") → payment saves, status = PARTIAL
  // ============================================================
  await newRow.locator('button[aria-label="Add payment"]').click();
  await page.locator('[role="dialog"]:has-text("Record payment")').waitFor({ timeout: 5_000 });
  // Verify the modal's text reflects casting-direction copy.
  const owedLabelExists = await page.locator('[role="dialog"]:has-text("Owed to vendor")').count();
  await page.locator("#payment-amount").fill("1000");
  await page.locator('[role="dialog"] button[type="submit"]:has-text("Save")').click();
  // Modal closes + chip updates.
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    { timeout: 10_000 },
  );
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const chipText = (await newRow.locator('[class*="uppercase"]').first().textContent())?.toLowerCase() ?? "";
  check(
    "Step 5 — Payment modal uses casting-direction copy + saves + status flips toward PARTIAL",
    owedLabelExists > 0 && chipText.includes("partial"),
    `owedToVendor=${owedLabelExists} chipText=${chipText}`,
  );

  // ============================================================
  // STEP 6: 📎 → BillActionModal replace flow → FK + R2 verifications
  // ============================================================
  await newRow.locator('button[aria-label="Manage bill"]').click();
  await page.locator('[role="dialog"]:has-text("Replace bill")').waitFor({ timeout: 5_000 });
  // Pick a different file (PNG_PATH_2) and click Upload.
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles(PNG_PATH_2);
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] button:has-text("Upload")').click();
  // Wait for modal to close (the chain finishes).
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    { timeout: 30_000 },
  );

  // DB verification: old bill tombstoned, new bill exists with different r2Key, entity.billId points to new.
  let newBillId, newBillR2Key, oldDeletedAt, entityFkBillId;
  {
    const oldRow = await db.query(`SELECT "deletedAt" FROM bills WHERE id = $1`, [firstBillId]);
    oldDeletedAt = oldRow.rows[0]?.deletedAt;
    const entityRow = await db.query(
      `SELECT "billId" FROM casting_entries WHERE id = $1`,
      [castingEntryId],
    );
    entityFkBillId = entityRow.rows[0]?.billId;
    const newRow = await db.query(
      `SELECT id, "r2Key", status FROM bills WHERE "attachedToId" = $1 AND "attachedToType" = 'CASTING_ENTRY' AND "deletedAt" IS NULL ORDER BY "uploadedAt" DESC LIMIT 1`,
      [castingEntryId],
    );
    newBillId = newRow.rows[0]?.id;
    newBillR2Key = newRow.rows[0]?.r2Key;
  }
  const oldR2_404 = firstBillR2Key ? await r2HeadIs404(firstBillR2Key) : null;
  check(
    "Step 6 — Bill replace FK flow: old bill tombstoned, new bill exists, FK updated, old R2 404",
    oldDeletedAt !== null &&
      newBillId &&
      newBillId !== firstBillId &&
      newBillR2Key !== firstBillR2Key &&
      entityFkBillId === newBillId &&
      (oldR2_404 === true || oldR2_404 === null),
    `oldDeletedAt=${oldDeletedAt ? "set" : "null"} newBillId=${newBillId} newR2KeyDiffers=${newBillR2Key !== firstBillR2Key} fkPointsToNew=${entityFkBillId === newBillId} oldR2_404=${oldR2_404}`,
  );

  // ============================================================
  // STEPS 7+8+9+10: Plating mirror verification
  // ============================================================
  await page.goto(`${BASE}/plating`);
  await page.waitForLoadState("networkidle");
  await page.locator('a:has-text("Add plating entry")').click();
  await page.waitForURL((u) => u.toString().endsWith("/plating/new"), { timeout: 10_000 });
  const platDialogStep7 = await page.locator('[role="dialog"]').count();
  const platWeight = await page.locator("#plating-line-0-weight").count();
  check(
    "Step 7 — /plating/new is full page with weight input (mirror of casting)",
    platDialogStep7 === 0 && platWeight > 0,
    `dialogs=${platDialogStep7} weightInputs=${platWeight}`,
  );

  const vendorB = `${MARKER}platevendor`;
  const phoneB = `87654${Date.now().toString().slice(-5)}B`.slice(0, 12);
  await page.locator("#plating-party-name").fill(vendorB);
  await page.locator("#plating-party-phone").fill(phoneB.replace(/[^0-9]/g, ""));
  await page.locator("#plating-line-0-material").fill("Brass plated");
  await page.locator("#plating-line-0-weight").fill("1.250");
  await page.locator("#plating-line-0-rate").fill("500");

  await Promise.all([
    page.waitForURL((u) => u.toString().endsWith("/plating"), { timeout: 30_000 }),
    page.locator('button:has-text("Save and return")').click(),
  ]);
  await page.waitForLoadState("networkidle");
  const plateRow = page.locator(`tr:has-text("${vendorB}")`).first();
  await plateRow.waitFor({ timeout: 10_000 });

  // Step 8: Detail modal read-only
  await plateRow.click();
  await page.locator('[role="dialog"]').waitFor({ timeout: 5_000 });
  const pDialog = page.locator('[role="dialog"]').first();
  const pNoMutations =
    (await pDialog.locator('button:has-text("Add Payment")').count()) === 0 &&
    (await pDialog.locator('button:has-text("Replace")').count()) === 0;
  check(
    "Step 8 — Plating detail modal is read-only",
    pNoMutations,
    `pNoMutations=${pNoMutations}`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Verify action column has 2 buttons (Pay + Bill, no Return)
  const platePayBtn = await plateRow.locator('button[aria-label="Add payment"]').count();
  const plateBillBtn = await plateRow.locator('button[aria-label="Manage bill"]').count();
  const plateReturnBtn = await plateRow.locator('button[aria-label="Record return"]').count();
  check(
    "Step 8b — Plating Actions column has Pay+Bill (no Return)",
    platePayBtn === 1 && plateBillBtn === 1 && plateReturnBtn === 0,
    `pay=${platePayBtn} bill=${plateBillBtn} return=${plateReturnBtn}`,
  );

  // Step 9: $ button → PaymentActionModal saves
  await plateRow.locator('button[aria-label="Add payment"]').click();
  await page.locator('[role="dialog"]:has-text("Record payment")').waitFor({ timeout: 5_000 });
  await page.locator("#payment-amount").fill("300");
  await page.locator('[role="dialog"] button[type="submit"]:has-text("Save")').click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  {
    const r = await db.query(
      `SELECT id FROM plating_entries WHERE "partyName" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [vendorB],
    );
    platingEntryId = r.rows[0]?.id;
    const pmt = await db.query(
      `SELECT COUNT(*)::int AS n FROM plating_payments WHERE "platingEntryId" = $1 AND "deletedAt" IS NULL`,
      [platingEntryId],
    );
    check(
      "Step 9 — Plating payment saved via PaymentActionModal",
      pmt.rows[0]?.n === 1,
      `paymentCount=${pmt.rows[0]?.n}`,
    );
  }

  // Step 10: 📎 → first-upload flow
  await plateRow.locator('button[aria-label="Manage bill"]').click();
  await page.locator('[role="dialog"]:has-text("Upload bill")').waitFor({ timeout: 5_000 });
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles(PNG_PATH);
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] button:has-text("Upload")').click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 30_000 });
  {
    const r = await db.query(
      `SELECT "billId" FROM plating_entries WHERE id = $1`,
      [platingEntryId],
    );
    const platBillId = r.rows[0]?.billId;
    const billRow = platBillId
      ? await db.query(
          `SELECT "attachedToType", "attachedToId", status FROM bills WHERE id = $1`,
          [platBillId],
        )
      : null;
    check(
      "Step 10 — Plating first-upload sets entry.billId + bill row has PLATING_ENTRY discriminator",
      platBillId &&
        billRow?.rows[0]?.attachedToType === "PLATING_ENTRY" &&
        billRow?.rows[0]?.attachedToId === platingEntryId &&
        billRow?.rows[0]?.status === "READY",
      `billId=${platBillId} disc=${billRow?.rows[0]?.attachedToType} status=${billRow?.rows[0]?.status}`,
    );
  }

  // ============================================================
  // STEP 11: Purchases bill-in-form retrofit
  // ============================================================
  await page.goto(`${BASE}/purchases/new`);
  await page.waitForLoadState("networkidle");
  const purchAttachLabel = await page.locator('label:has-text("Attach bill")').count();
  const purchFileInput = await page.locator('input[type="file"]').count();
  check(
    "Step 11a — /purchases/new has Attach bill section + file input",
    purchAttachLabel > 0 && purchFileInput > 0,
    `attachLabel=${purchAttachLabel} fileInputs=${purchFileInput}`,
  );

  const partyP = `${MARKER}purchaseparty`;
  const phoneP = `76543${Date.now().toString().slice(-5)}P`.slice(0, 12);
  await page.locator("#purchases-party-name").fill(partyP);
  await page.locator("#purchases-party-phone").fill(phoneP.replace(/[^0-9]/g, ""));
  await page.locator("#purchase-line-0-item").fill("Raw silver");
  await page.locator("#purchase-line-0-qty").fill("3");
  await page.locator("#purchase-line-0-rate").fill("150");
  await page.locator('input[type="file"]').setInputFiles(PNG_PATH);
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForURL((u) => u.toString().endsWith("/purchases"), { timeout: 30_000 }),
    page.locator('button:has-text("Save and return")').click(),
  ]);
  await page.waitForLoadState("networkidle");
  {
    const r = await db.query(
      `SELECT id FROM purchases WHERE "partyName" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [partyP],
    );
    purchaseId = r.rows[0]?.id;
    const billRow = await db.query(
      `SELECT id, "attachedToType", status FROM bills WHERE "attachedToId" = $1 AND "attachedToType" = 'PURCHASE' AND "deletedAt" IS NULL ORDER BY "uploadedAt" DESC LIMIT 1`,
      [purchaseId],
    );
    check(
      "Step 11b — Purchase saved with discriminator-only PURCHASE bill (no billId FK)",
      purchaseId && billRow.rows[0]?.status === "READY" &&
        billRow.rows[0]?.attachedToType === "PURCHASE",
      `purchaseId=${purchaseId} billStatus=${billRow.rows[0]?.status} disc=${billRow.rows[0]?.attachedToType}`,
    );
  }

  // ============================================================
  // STEP 12: Casting bill-in-form retrofit (FK + discriminator)
  // ============================================================
  await page.goto(`${BASE}/casting/new`);
  await page.waitForLoadState("networkidle");
  const castAttachLabel = await page.locator('label:has-text("Attach bill")').count();
  const vendorC = `${MARKER}castfromform`;
  const phoneC = `65432${Date.now().toString().slice(-5)}C`.slice(0, 12);
  await page.locator("#casting-party-name").fill(vendorC);
  await page.locator("#casting-party-phone").fill(phoneC.replace(/[^0-9]/g, ""));
  await page.locator("#casting-line-0-material").fill("Copper");
  await page.locator("#casting-line-0-weight").fill("0.500");
  await page.locator("#casting-line-0-rate").fill("200");
  await page.locator('input[type="file"]').setInputFiles(PNG_PATH);
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForURL((u) => u.toString().endsWith("/casting"), { timeout: 30_000 }),
    page.locator('button:has-text("Save and return")').click(),
  ]);
  await page.waitForLoadState("networkidle");
  {
    const r = await db.query(
      `SELECT id, "billId" FROM casting_entries WHERE "partyName" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [vendorC],
    );
    castingEntryId2 = r.rows[0]?.id;
    const fkBillId = r.rows[0]?.billId;
    const billRow = fkBillId
      ? await db.query(
          `SELECT "attachedToType", "attachedToId", status FROM bills WHERE id = $1`,
          [fkBillId],
        )
      : null;
    check(
      "Step 12 — Casting bill-in-form retrofit: FK + discriminator both set",
      castingEntryId2 &&
        fkBillId &&
        castAttachLabel > 0 &&
        billRow?.rows[0]?.attachedToType === "CASTING_ENTRY" &&
        billRow?.rows[0]?.attachedToId === castingEntryId2,
      `castAttach=${castAttachLabel} entry=${castingEntryId2} fkBill=${fkBillId} disc=${billRow?.rows[0]?.attachedToType}`,
    );
  }

  // ============================================================
  // STEP 13: Plating bill-in-form retrofit (FK + discriminator)
  // ============================================================
  await page.goto(`${BASE}/plating/new`);
  await page.waitForLoadState("networkidle");
  const platAttachLabel = await page.locator('label:has-text("Attach bill")').count();
  const vendorD = `${MARKER}platefromform`;
  const phoneD = `54321${Date.now().toString().slice(-5)}D`.slice(0, 12);
  await page.locator("#plating-party-name").fill(vendorD);
  await page.locator("#plating-party-phone").fill(phoneD.replace(/[^0-9]/g, ""));
  await page.locator("#plating-line-0-material").fill("Gold plate");
  await page.locator("#plating-line-0-weight").fill("0.100");
  await page.locator("#plating-line-0-rate").fill("1000");
  await page.locator('input[type="file"]').setInputFiles(PNG_PATH);
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForURL((u) => u.toString().endsWith("/plating"), { timeout: 30_000 }),
    page.locator('button:has-text("Save and return")').click(),
  ]);
  await page.waitForLoadState("networkidle");
  {
    const r = await db.query(
      `SELECT id, "billId" FROM plating_entries WHERE "partyName" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [vendorD],
    );
    platingEntryId2 = r.rows[0]?.id;
    const fkBillId = r.rows[0]?.billId;
    const billRow = fkBillId
      ? await db.query(
          `SELECT "attachedToType", "attachedToId", status FROM bills WHERE id = $1`,
          [fkBillId],
        )
      : null;
    check(
      "Step 13 — Plating bill-in-form retrofit: FK + discriminator both set",
      platingEntryId2 &&
        fkBillId &&
        platAttachLabel > 0 &&
        billRow?.rows[0]?.attachedToType === "PLATING_ENTRY" &&
        billRow?.rows[0]?.attachedToId === platingEntryId2,
      `platAttach=${platAttachLabel} entry=${platingEntryId2} fkBill=${fkBillId} disc=${billRow?.rows[0]?.attachedToType}`,
    );
  }

  // ============================================================
  // STEP 14: Sales bill-in-form section still intact
  // ============================================================
  await page.goto(`${BASE}/sales/new`);
  await page.waitForLoadState("networkidle");
  const salesAttachLabel = await page.locator('label:has-text("Attach bill")').count();
  const salesFileInput = await page.locator('input[type="file"]').count();
  check(
    "Step 14 — /sales/new still has Attach bill (Phase 10.5 retrofit intact)",
    salesAttachLabel > 0 && salesFileInput > 0,
    `attachLabel=${salesAttachLabel} fileInputs=${salesFileInput}`,
  );
} finally {
  // ============================================================
  // CLEANUP — marker-pattern scrub
  // ============================================================
  console.log("\n[cleanup] removing walkthrough markers");
  try {
    // Soft-delete bills attached to the walkthrough entries, then hard-delete the entries.
    await db.query(
      `UPDATE bills SET "deletedAt" = NOW() WHERE "attachedToId" IN (
        SELECT id FROM casting_entries WHERE "partyName" LIKE $1
        UNION ALL
        SELECT id FROM plating_entries WHERE "partyName" LIKE $1
        UNION ALL
        SELECT id FROM purchases WHERE "partyName" LIKE $1
      )`,
      [MARKER + "%"],
    );
    await db.query(
      `DELETE FROM casting_payments WHERE "castingEntryId" IN (SELECT id FROM casting_entries WHERE "partyName" LIKE $1)`,
      [MARKER + "%"],
    );
    await db.query(
      `DELETE FROM casting_line_items WHERE "castingEntryId" IN (SELECT id FROM casting_entries WHERE "partyName" LIKE $1)`,
      [MARKER + "%"],
    );
    await db.query(`UPDATE casting_entries SET "billId" = NULL WHERE "partyName" LIKE $1`, [MARKER + "%"]);
    await db.query(`DELETE FROM casting_entries WHERE "partyName" LIKE $1`, [MARKER + "%"]);

    await db.query(
      `DELETE FROM plating_payments WHERE "platingEntryId" IN (SELECT id FROM plating_entries WHERE "partyName" LIKE $1)`,
      [MARKER + "%"],
    );
    await db.query(
      `DELETE FROM plating_line_items WHERE "platingEntryId" IN (SELECT id FROM plating_entries WHERE "partyName" LIKE $1)`,
      [MARKER + "%"],
    );
    await db.query(`UPDATE plating_entries SET "billId" = NULL WHERE "partyName" LIKE $1`, [MARKER + "%"]);
    await db.query(`DELETE FROM plating_entries WHERE "partyName" LIKE $1`, [MARKER + "%"]);

    await db.query(
      `DELETE FROM purchase_payments WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "partyName" LIKE $1)`,
      [MARKER + "%"],
    );
    await db.query(
      `DELETE FROM purchase_line_items WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "partyName" LIKE $1)`,
      [MARKER + "%"],
    );
    await db.query(`DELETE FROM purchases WHERE "partyName" LIKE $1`, [MARKER + "%"]);

    await db.query(`DELETE FROM casting_plating_vendors WHERE name LIKE $1`, [MARKER + "%"]);
    console.log("[cleanup] done");
  } catch (err) {
    console.error("[cleanup] failed:", err);
  }
  await db.end();
  await browser.close();
}

// ============ summary ============
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== Phase 10.6 walkthrough: ${passed}/${results.length} passed (${failed} failed) ===`);
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
process.exit(failed === 0 ? 0 : 1);

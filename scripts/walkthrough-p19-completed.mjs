// Phase 19 walkthrough — /completed tabbed history view, verified against prod.
//
// 12 steps:
//   Setup (1): seed test data (1 party, 1 employee, 1 sale + payment,
//     1 purchase + payment, 1 casting + payment, 1 plating + payment,
//     1 employee payment) — direct DB for speed (matches p17b pattern).
//   Completed page basics (3): default render, sales tab shows test row,
//     out-of-range filter → empty state.
//   Per-tab navigation (4): all 5 tabs show their rows, sale row click →
//     SaleDetailModal, payroll row data visible inline (no detail modal
//     on this iteration — see plan deviation), filters persist across
//     tab switches.
//   Filter behavior (3): party search shows test rows, nonexistent
//     search empties all tabs, today-only range filters down.
//   Role-scoping (1): non-ADMIN roles redirect from /completed +
//     sidebar excludes the nav item.
//
// Marker: __phase19_walk_<timestamp>
// Cleanup deletes everything created.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p19-out");
mkdirSync(OUT_DIR, { recursive: true });

function loadEnv(file) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
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
    const m = line.match(
      /^\|\s*([A-Z_]+)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/,
    );
    if (m) out[m[1]] = { email: m[2], password: m[3] };
  }
  return out;
}

const env = loadEnv(".env.production.local");
const creds = loadCredentialsMd();

const ADMIN = { email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD };
const PURCHASE = creds.PURCHASE_DEPT;
const LABOUR = creds.LABOUR_MGMT;
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
if (!PURCHASE?.email || !LABOUR?.email || !CASTING?.email) {
  console.error("FAIL: missing role test accounts in credentials.md");
  process.exit(1);
}

const TS = Date.now();
const MARKER = `__phase19_walk_${TS}`;
const PHONE_TAIL = TS.toString().slice(-7);
const PHONE_PARTY = `9300${PHONE_TAIL}`.slice(0, 12);
const PHONE_EMPLOYEE = `9400${PHONE_TAIL}`.slice(0, 12);

const NAME_PARTY = `${MARKER}_party`;
const NAME_EMPLOYEE = `${MARKER}_emp`;
const ITEM_SALE = `${MARKER}_sale`;
const ITEM_PURCHASE = `${MARKER}_purchase`;
const MATERIAL_CAST = `${MARKER}_cast`;
const MATERIAL_PLAT = `${MARKER}_plat`;

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
      path: join(
        OUT_DIR,
        `${results.length.toString().padStart(2, "0")}-${safe}.png`,
      ),
      fullPage: false,
    });
  } catch (err) {
    console.log(`  THREW: ${err.message}`);
    await page
      .screenshot({
        path: join(
          OUT_DIR,
          `FAIL-${results.length.toString().padStart(2, "0")}-${safe}.png`,
        ),
        fullPage: true,
      })
      .catch(() => {});
    check(name, false, err.message);
    throw err;
  }
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
  await page
    .locator('input[type="email"]')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/auth/login"), {
      timeout: 30_000,
    }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function logout(page) {
  await page.context().clearCookies();
}

const db = new pg.Client({ connectionString: DIRECT_URL });
await db.connect();

async function cleanup() {
  console.log("\n=== Cleanup ===");
  const q = async (sql, params = []) => (await db.query(sql, params)).rowCount;
  const ops = [
    // EmployeePayments first (FK to employees with RESTRICT).
    [
      `DELETE FROM employee_payments WHERE "employeeId" IN (SELECT id FROM employees WHERE name LIKE $1)`,
      `%${MARKER}%`,
    ],
    [
      `DELETE FROM piece_entries WHERE "employeeId" IN (SELECT id FROM employees WHERE name LIKE $1)`,
      `%${MARKER}%`,
    ],
    [`DELETE FROM employees WHERE name LIKE $1`, `%${MARKER}%`],
    // Sale chain
    [
      `DELETE FROM sale_payments WHERE "saleId" IN (SELECT id FROM sales WHERE "partyName" LIKE $1)`,
      `%${MARKER}%`,
    ],
    [
      `DELETE FROM sale_line_items WHERE "saleId" IN (SELECT id FROM sales WHERE "partyName" LIKE $1)`,
      `%${MARKER}%`,
    ],
    [`DELETE FROM sales WHERE "partyName" LIKE $1`, `%${MARKER}%`],
    // Purchase chain
    [
      `DELETE FROM purchase_payments WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "partyName" LIKE $1)`,
      `%${MARKER}%`,
    ],
    [
      `DELETE FROM purchase_line_items WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "partyName" LIKE $1)`,
      `%${MARKER}%`,
    ],
    [`DELETE FROM purchases WHERE "partyName" LIKE $1`, `%${MARKER}%`],
    // Casting chain
    [
      `DELETE FROM casting_payments WHERE "castingEntryId" IN (SELECT id FROM casting_entries WHERE "partyName" LIKE $1)`,
      `%${MARKER}%`,
    ],
    [
      `DELETE FROM casting_line_items WHERE "castingEntryId" IN (SELECT id FROM casting_entries WHERE "partyName" LIKE $1)`,
      `%${MARKER}%`,
    ],
    [`DELETE FROM casting_entries WHERE "partyName" LIKE $1`, `%${MARKER}%`],
    // Plating chain
    [
      `DELETE FROM plating_payments WHERE "platingEntryId" IN (SELECT id FROM plating_entries WHERE "partyName" LIKE $1)`,
      `%${MARKER}%`,
    ],
    [
      `DELETE FROM plating_line_items WHERE "platingEntryId" IN (SELECT id FROM plating_entries WHERE "partyName" LIKE $1)`,
      `%${MARKER}%`,
    ],
    [`DELETE FROM plating_entries WHERE "partyName" LIKE $1`, `%${MARKER}%`],
    // Party last
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

// ============================================================
// SETUP — direct DB inserts to seed test data
// ============================================================
async function seedTestData() {
  console.log("\n=== Seeding test data (direct DB) ===");

  // 1 party with all role flags. Phone has globally-unique constraint.
  const partyRow = await db.query(
    `INSERT INTO parties (id, name, phone, "isCustomer", "isSupplier", "isCastingVendor", "isPlatingVendor", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, true, true, true, true, NOW(), NOW())
     RETURNING id`,
    [NAME_PARTY, PHONE_PARTY],
  );
  const partyId = partyRow.rows[0].id;

  // 1 LABOUR employee with ratePerPiece for the EmployeePayment.
  const empRow = await db.query(
    `INSERT INTO employees (id, name, phone, type, "ratePerPiece", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'LABOUR', 5000, NOW(), NOW())
     RETURNING id`,
    [NAME_EMPLOYEE, PHONE_EMPLOYEE],
  );
  const employeeId = empRow.rows[0].id;

  // Sale: total 10000 paise (₹100), fully paid → status COMPLETED.
  const saleRow = await db.query(
    `INSERT INTO sales (id, date, "partyId", "partyName", "partyPhone", discount, total, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, NOW(), $1, $2, $3, 0, 10000, NOW(), NOW())
     RETURNING id`,
    [partyId, NAME_PARTY, PHONE_PARTY],
  );
  const saleId = saleRow.rows[0].id;
  await db.query(
    `INSERT INTO sale_line_items (id, "saleId", "itemDescription", qty, rate, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, 1, 10000, NOW())`,
    [saleId, ITEM_SALE],
  );
  await db.query(
    `INSERT INTO sale_payments (id, "saleId", date, amount, type, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, NOW(), 10000, 'PAYMENT', NOW(), NOW())`,
    [saleId],
  );

  // Purchase: total 20000 paise (₹200), fully paid → COMPLETED.
  const purchaseRow = await db.query(
    `INSERT INTO purchases (id, date, "partyId", "partyName", "partyPhone", discount, total, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, NOW(), $1, $2, $3, 0, 20000, NOW(), NOW())
     RETURNING id`,
    [partyId, NAME_PARTY, PHONE_PARTY],
  );
  const purchaseId = purchaseRow.rows[0].id;
  await db.query(
    `INSERT INTO purchase_line_items (id, "purchaseId", "itemDescription", qty, rate, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, 1, 20000, NOW())`,
    [purchaseId, ITEM_PURCHASE],
  );
  await db.query(
    `INSERT INTO purchase_payments (id, "purchaseId", date, amount, type, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, NOW(), 20000, 'PAYMENT', NOW(), NOW())`,
    [purchaseId],
  );

  // Casting: 1.000 kg × ₹300/kg = 30000 paise (₹300), fully paid.
  const castingRow = await db.query(
    `INSERT INTO casting_entries (id, date, "partyId", "partyName", "partyPhone", discount, total, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, NOW(), $1, $2, $3, 0, 30000, NOW(), NOW())
     RETURNING id`,
    [partyId, NAME_PARTY, PHONE_PARTY],
  );
  const castingEntryId = castingRow.rows[0].id;
  await db.query(
    `INSERT INTO casting_line_items (id, "castingEntryId", "materialDescription", "weightKg", "ratePerKg", "lineTotal", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, 1.000, 30000, 30000, NOW())`,
    [castingEntryId, MATERIAL_CAST],
  );
  await db.query(
    `INSERT INTO casting_payments (id, "castingEntryId", date, amount, type, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, NOW(), 30000, 'PAYMENT', NOW(), NOW())`,
    [castingEntryId],
  );

  // Plating: 1.000 kg × ₹400/kg = 40000 paise (₹400), fully paid.
  const platingRow = await db.query(
    `INSERT INTO plating_entries (id, date, "partyId", "partyName", "partyPhone", discount, total, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, NOW(), $1, $2, $3, 0, 40000, NOW(), NOW())
     RETURNING id`,
    [partyId, NAME_PARTY, PHONE_PARTY],
  );
  const platingEntryId = platingRow.rows[0].id;
  await db.query(
    `INSERT INTO plating_line_items (id, "platingEntryId", "materialDescription", "weightKg", "ratePerKg", "lineTotal", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, 1.000, 40000, 40000, NOW())`,
    [platingEntryId, MATERIAL_PLAT],
  );
  await db.query(
    `INSERT INTO plating_payments (id, "platingEntryId", date, amount, type, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, NOW(), 40000, 'PAYMENT', NOW(), NOW())`,
    [platingEntryId],
  );

  // EmployeePayment — WAGE for the LABOUR employee, ₹500 over a 7-day window.
  await db.query(
    `INSERT INTO employee_payments (id, "employeeId", type, "paidAt", amount, "periodStart", "periodEnd", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 'WAGE', NOW(), 50000, NOW() - INTERVAL '6 days', NOW(), NOW(), NOW())`,
    [employeeId],
  );

  console.log(`  Party: ${partyId}`);
  console.log(`  Employee: ${employeeId}`);
  console.log(`  Sale (₹100 paid): ${saleId}`);
  console.log(`  Purchase (₹200 paid): ${purchaseId}`);
  console.log(`  Casting (₹300 paid): ${castingEntryId}`);
  console.log(`  Plating (₹400 paid): ${platingEntryId}`);
  console.log(`  EmployeePayment (WAGE ₹500) inserted`);

  return { partyId, employeeId, saleId, purchaseId, castingEntryId, platingEntryId };
}

// ============================================================
// MAIN
// ============================================================
const browser = await chromium.launch({ headless: true });
let exitCode = 0;
try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  console.log(`[walkthrough-p19] BASE=${BASE}  marker=${MARKER}`);

  const seeded = await seedTestData();

  await login(page, ADMIN.email, ADMIN.password);
  console.log("  ADMIN signed in");

  // ============================================================
  // STEP 1 — Setup test data (done via direct DB above; this step
  // documents it in the walkthrough flow + asserts via DB queries
  // that the inserts succeeded.
  // ============================================================
  await step(page, "1. Test data seeded", async () => {
    const counts = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM sales WHERE "partyName" LIKE $1) AS sales,
         (SELECT COUNT(*) FROM purchases WHERE "partyName" LIKE $1) AS purchases,
         (SELECT COUNT(*) FROM casting_entries WHERE "partyName" LIKE $1) AS casting,
         (SELECT COUNT(*) FROM plating_entries WHERE "partyName" LIKE $1) AS plating,
         (SELECT COUNT(*) FROM employee_payments WHERE "employeeId" = $2) AS payroll`,
      [`%${MARKER}%`, seeded.employeeId],
    );
    const row = counts.rows[0];
    const ok =
      row.sales === "1" &&
      row.purchases === "1" &&
      row.casting === "1" &&
      row.plating === "1" &&
      row.payroll === "1";
    check(
      "1. Test data seeded",
      ok,
      `sales=${row.sales} purchases=${row.purchases} casting=${row.casting} plating=${row.plating} payroll=${row.payroll}`,
    );
  });

  // ============================================================
  // STEP 2 — /completed renders, 5 tabs visible, default range
  // ============================================================
  await step(page, "2. /completed renders with 5 tabs", async () => {
    await page.goto(`${BASE}/completed`, { waitUntil: "networkidle" });
    // Wait for client hydration.
    await page
      .locator('[data-testid="tab-sales"]')
      .waitFor({ state: "visible", timeout: 15_000 });
    const tabsVisible = await Promise.all([
      page.locator('[data-testid="tab-sales"]').isVisible(),
      page.locator('[data-testid="tab-purchases"]').isVisible(),
      page.locator('[data-testid="tab-casting"]').isVisible(),
      page.locator('[data-testid="tab-plating"]').isVisible(),
      page.locator('[data-testid="tab-payroll"]').isVisible(),
    ]);
    const allTabsVisible = tabsVisible.every(Boolean);
    const fromValue = await page.locator('[data-testid="completed-from"]').inputValue();
    const toValue = await page.locator('[data-testid="completed-to"]').inputValue();
    // Default range = current IST month.
    const expectedMonthIso = new Date()
      .toLocaleString("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .slice(0, 7); // "YYYY-MM"
    const rangeOk =
      fromValue.startsWith(expectedMonthIso) && toValue.startsWith(expectedMonthIso);
    check(
      "2. /completed renders with 5 tabs + default month range",
      allTabsVisible && rangeOk,
      `tabs=${tabsVisible.join(",")} from=${fromValue} to=${toValue} expected=${expectedMonthIso}`,
    );
  });

  // ============================================================
  // STEP 3 — Sales tab shows the test sale row
  // ============================================================
  await step(page, "3. Sales tab shows test sale", async () => {
    // Sales tab is the default; the row should already be rendered.
    await page
      .locator(`[data-testid="completed-sale-row-${seeded.saleId}"]`)
      .waitFor({ state: "visible", timeout: 10_000 });
    const text = await page
      .locator(`[data-testid="completed-sale-row-${seeded.saleId}"]`)
      .textContent();
    const hasName = (text ?? "").includes(NAME_PARTY);
    const hasItem = (text ?? "").includes(ITEM_SALE);
    check(
      "3. Sales tab shows test sale",
      hasName && hasItem,
      `text contains partyName=${hasName} itemDescription=${hasItem}`,
    );
  });

  // ============================================================
  // STEP 4 — Out-of-range filter → empty state
  // ============================================================
  await step(page, "4. Out-of-range date → empty state", async () => {
    // Set to a date range in 2020 — far before any test data.
    await page.locator('[data-testid="completed-from"]').fill("2020-01-01");
    await page.locator('[data-testid="completed-to"]').fill("2020-01-31");
    // Wait for navigation (router.replace fires immediately on date change).
    await page.waitForURL(/from=2020-01-01/);
    await page.waitForLoadState("networkidle");
    const empty = await page
      .locator('[data-testid="completed-empty"]')
      .first()
      .textContent({ timeout: 10_000 });
    check(
      "4. Out-of-range range shows empty state",
      (empty ?? "").toLowerCase().includes("no completed sales"),
      `empty="${empty}"`,
    );
  });

  // ============================================================
  // STEP 5 — Reset range, click each tab, verify rows
  // ============================================================
  let allTabsOk = true;
  await step(page, "5. All 5 tabs show test rows after range reset", async () => {
    // Reset the from/to range to a wide window covering the test data.
    const today = new Date().toLocaleString("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    await page.locator('[data-testid="completed-from"]').fill("2024-01-01");
    await page.locator('[data-testid="completed-to"]').fill(today);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    // Visit each tab. Tabs are stateful but click sequentially with a
    // brief settle so the row visibility check is deterministic.
    const tabRowMap = [
      ["tab-sales", `completed-sale-row-${seeded.saleId}`],
      ["tab-purchases", `completed-purchase-row-${seeded.purchaseId}`],
      ["tab-casting", `completed-casting-row-${seeded.castingEntryId}`],
      ["tab-plating", `completed-plating-row-${seeded.platingEntryId}`],
      ["tab-payroll", null], // payroll uses a different row testid (one per payment); just verify the table renders the employee name
    ];
    for (const [tabId, rowId] of tabRowMap) {
      await page.locator(`[data-testid="${tabId}"]`).click();
      await page.waitForTimeout(300);
      if (rowId) {
        const rowVisible = await page
          .locator(`[data-testid="${rowId}"]`)
          .isVisible();
        if (!rowVisible) {
          allTabsOk = false;
          console.log(`    ${tabId}: row ${rowId} NOT visible`);
        }
      } else {
        // Payroll: assert the employee name appears in the table.
        const empVisible = await page
          .locator(`text=${NAME_EMPLOYEE}`)
          .first()
          .isVisible();
        if (!empVisible) {
          allTabsOk = false;
          console.log(`    ${tabId}: employee ${NAME_EMPLOYEE} NOT visible`);
        }
      }
    }
    check("5. All 5 tabs show their test rows", allTabsOk);
  });

  // ============================================================
  // STEP 6 — Sale row click → SaleDetailModal opens
  // ============================================================
  await step(page, "6. Sale row click opens SaleDetailModal", async () => {
    await page.locator('[data-testid="tab-sales"]').click();
    await page.waitForTimeout(300);
    await page
      .locator(`[data-testid="completed-sale-row-${seeded.saleId}"]`)
      .click();
    // Detail modal is a Radix dialog; wait for its content.
    await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
    const modalText = (await page.locator('[role="dialog"]').textContent()) ?? "";
    const ok = modalText.includes(NAME_PARTY) && modalText.includes(ITEM_SALE);
    check(
      "6. Sale row click opens detail modal with sale data",
      ok,
      `modal contains partyName=${modalText.includes(NAME_PARTY)} itemDescription=${modalText.includes(ITEM_SALE)}`,
    );
    // Close modal via Escape.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  });

  // ============================================================
  // STEP 7 — Payroll tab shows employee + amount inline (no modal)
  // ============================================================
  await step(page, "7. Payroll tab shows EmployeePayment data inline", async () => {
    await page.locator('[data-testid="tab-payroll"]').click();
    await page.waitForTimeout(400);
    const tableText =
      (await page
        .locator('[data-testid="responsive-table-desktop"], [data-testid="responsive-table-mobile"]')
        .first()
        .textContent()) ?? "";
    const hasEmployee = tableText.includes(NAME_EMPLOYEE);
    const hasAmount = tableText.includes("500"); // ₹500 amount
    const hasType = /wage/i.test(tableText);
    check(
      "7. Payroll row data visible inline",
      hasEmployee && hasAmount && hasType,
      `employee=${hasEmployee} amount=${hasAmount} type=${hasType}`,
    );
  });

  // ============================================================
  // STEP 8 — Filters persist across tab switches
  // ============================================================
  await step(page, "8. Filters persist across tab switches", async () => {
    // Set a specific known range, switch tabs, verify range preserved.
    await page.locator('[data-testid="completed-from"]').fill("2023-06-15");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await page.locator('[data-testid="tab-purchases"]').click();
    await page.waitForTimeout(300);
    const fromOnPurchases = await page
      .locator('[data-testid="completed-from"]')
      .inputValue();
    check(
      "8. Filter persists when switching tabs",
      fromOnPurchases === "2023-06-15",
      `from on purchases tab = ${fromOnPurchases}`,
    );
  });

  // ============================================================
  // STEP 9 — Party search with marker shows test rows
  // ============================================================
  await step(page, "9. Party search with marker prefix", async () => {
    // Reset range first.
    const today = new Date().toLocaleString("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    await page.locator('[data-testid="completed-from"]').fill("2024-01-01");
    await page.locator('[data-testid="completed-to"]').fill(today);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.locator('[data-testid="completed-query"]').fill("__phase19_walk");
    // Debounced 300ms; wait for URL update.
    await page.waitForURL(/q=__phase19_walk/, { timeout: 5_000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    // Verify the Sales tab still shows the test sale row.
    await page.locator('[data-testid="tab-sales"]').click();
    await page.waitForTimeout(300);
    const saleVisible = await page
      .locator(`[data-testid="completed-sale-row-${seeded.saleId}"]`)
      .isVisible();
    check(
      "9. Party search with marker prefix matches test sale",
      saleVisible,
      `sale row visible = ${saleVisible}`,
    );
  });

  // ============================================================
  // STEP 10 — Party search with nonexistent → all tabs empty
  // ============================================================
  await step(page, "10. Nonexistent search empties all tabs", async () => {
    await page.locator('[data-testid="completed-query"]').fill("zzzzzz_nonexistent_xxx");
    await page.waitForURL(/q=zzzzzz_nonexistent_xxx/, { timeout: 5_000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    let allEmpty = true;
    for (const tabId of ["tab-sales", "tab-purchases", "tab-casting", "tab-plating", "tab-payroll"]) {
      await page.locator(`[data-testid="${tabId}"]`).click();
      await page.waitForTimeout(300);
      const empty = await page
        .locator('[data-testid="completed-empty"]')
        .first()
        .isVisible();
      if (!empty) {
        allEmpty = false;
        console.log(`    ${tabId}: empty state NOT showing`);
      }
    }
    check(
      "10. Nonexistent search produces empty state on all tabs",
      allEmpty,
    );
  });

  // ============================================================
  // STEP 11 — Today-only range filters down
  // ============================================================
  await step(page, "11. Today-only range filters", async () => {
    // Clear the query first.
    await page.locator('[data-testid="completed-query"]').fill("");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const today = new Date().toLocaleString("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    await page.locator('[data-testid="completed-from"]').fill(today);
    await page.locator('[data-testid="completed-to"]').fill(today);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    // Today's window should still include the test data (inserts used NOW()).
    await page.locator('[data-testid="tab-sales"]').click();
    await page.waitForTimeout(300);
    const saleVisible = await page
      .locator(`[data-testid="completed-sale-row-${seeded.saleId}"]`)
      .isVisible();
    check(
      "11. Today-only range still shows today's test data",
      saleVisible,
      `sale visible = ${saleVisible}`,
    );
  });

  // ============================================================
  // STEP 12 — Non-ADMIN roles redirect from /completed
  // ============================================================
  await step(page, "12. Non-ADMIN roles redirect", async () => {
    let allRedirected = true;
    let sidebarOk = true;
    for (const role of [
      { name: "PURCHASE_DEPT", c: PURCHASE },
      { name: "LABOUR_MGMT", c: LABOUR },
      { name: "CASTING_PLATING_MGMT", c: CASTING },
    ]) {
      await logout(page);
      await login(page, role.c.email, role.c.password);
      // Hit /completed directly via URL.
      await page.goto(`${BASE}/completed`, { waitUntil: "networkidle" });
      const finalUrl = page.url();
      if (!finalUrl.endsWith("/dashboard")) {
        allRedirected = false;
        console.log(`    ${role.name}: did not redirect (final=${finalUrl})`);
      }
      // Sidebar should NOT contain a "Completed" entry (the nav item filter
      // excludes ADMIN-only items for non-ADMIN roles).
      const completedNav = await page
        .locator('a[href="/completed"]')
        .count();
      if (completedNav !== 0) {
        sidebarOk = false;
        console.log(
          `    ${role.name}: sidebar still contains /completed link (count=${completedNav})`,
        );
      }
    }
    check(
      "12. Non-ADMIN roles redirected + sidebar excludes /completed",
      allRedirected && sidebarOk,
      `redirected=${allRedirected} sidebar=${sidebarOk}`,
    );
  });
} catch (err) {
  console.error("Walkthrough threw:", err.message);
  exitCode = 1;
} finally {
  await cleanup().catch((e) => console.log(`Cleanup error: ${e.message}`));
  await db.end();
  await browser.close();
}

// ============================================================
// REPORT
// ============================================================
console.log("\n=== Phase 19 walkthrough summary ===");
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.label}`);
}
console.log(`\n${passed}/${results.length} steps passed (${failed} failed)`);

if (failed > 0 || exitCode !== 0) {
  process.exit(1);
}
process.exit(0);

// Phase 18 walkthrough — labour management.
// Playwright-driven, production-only.
//
// 12 steps covering:
//   - Setup: create FIXED + LABOUR test employees with __phase18_walk_<ts>
//   - Bulk piece entry: enter count for the LABOUR employee
//   - Outstanding wages: verify it appears
//   - Salary payment: open modal, save, verify section empties
//   - Wage payment: open modal, save, verify section empties
//   - Role-scoped access: LABOUR_MGMT allowed, PURCHASE_DEPT redirected
//   - Dashboard integration: cards render correctly
//   - Cleanup: tombstone test employees + their children
//
// Credentials:
//   - ADMIN  ← .env.production.local (SEED_ADMIN_EMAIL/PASSWORD)
//   - rest   ← credentials.md at project root (gitignored)
//
// Pre-flight checklist (run these BEFORE this script):
//   1. `prisma migrate deploy` against production DB has applied
//      20260519145247_labour_management (creates piece_entries +
//      employee_payments + adds employees.ratePerPiece column).
//   2. Code from this branch has been pushed to main and Vercel has
//      finished the production redeploy.
//
// Run: node scripts/walkthrough-p18.mjs

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p18-out");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";

const MARKER = `__phase18_walk_${Date.now()}`;

// ---------- env loaders (same as walkthrough-rbac.mjs) ----------

function loadEnvFile(file) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
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

const prodEnv = loadEnvFile(".env.production.local");
const testCreds = loadCredentialsMd();

const ADMIN = { email: prodEnv.SEED_ADMIN_EMAIL, password: prodEnv.SEED_ADMIN_PASSWORD };

// ---------- helpers ----------

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

async function screenshot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, name), fullPage: true });
}

async function createEmployee(page, { name, type, monthlySalary, ratePerPiece }) {
  await page.goto(`${BASE}/employees`, { waitUntil: "networkidle" });
  // The Add button has a unique label "Add employee" — use the exact
  // accessible name rather than a substring to avoid the sidebar's
  // role-chip text inadvertently matching.
  await page.getByRole("button", { name: /add employee/i }).click();
  await page.waitForSelector('input#employee-name', { timeout: 15_000 });

  await page.fill('input#employee-name', name);
  // Segmented type selector: two role="radio" buttons inside the
  // radiogroup labelled "Employee type". Click by text content.
  await page
    .getByRole("radiogroup", { name: /employee type/i })
    .getByRole("radio", { name: type === "FIXED" ? "Fixed" : "Labour" })
    .click();
  if (type === "FIXED" && monthlySalary !== undefined) {
    await page.fill('input#employee-salary', String(monthlySalary));
  }
  if (type === "LABOUR" && ratePerPiece !== undefined) {
    await page.fill('input#employee-rate', String(ratePerPiece));
  }
  await page.click('button[type="submit"]:has-text("Save")');
  // Wait for modal close.
  await page
    .waitForSelector('input#employee-name', { state: "detached", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(750);
}

function fixedName() {
  return `${MARKER}_fixed`;
}
function labourName() {
  return `${MARKER}_labour`;
}

// ---------- walkthrough ----------

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

console.log(`\n=== Phase 18 walkthrough — marker: ${MARKER} ===\n`);

try {
  // ----- SETUP -----
  console.log("Step 1: Login as ADMIN + create test employees");
  await login(page, ADMIN.email, ADMIN.password);
  await screenshot(page, "00-admin-dashboard.png");

  await createEmployee(page, {
    name: fixedName(),
    type: "FIXED",
    monthlySalary: 15000, // ₹15,000
  });
  await createEmployee(page, {
    name: labourName(),
    type: "LABOUR",
    ratePerPiece: 50, // ₹50 / piece
  });
  await screenshot(page, "01-employees-created.png");

  // ----- PIECE ENTRY FLOW -----
  console.log("Step 2: Navigate to /labour, verify three sections");
  await page.goto(`${BASE}/labour`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="pending-salaries-section"]');
  await page.waitForSelector('[data-testid="outstanding-wages-section"]');
  await page.waitForSelector('[data-testid="bulk-piece-entry-section"]');
  await screenshot(page, "02-labour-page.png");

  console.log("Step 3: Bulk piece entry — count 10 for LABOUR test");
  const labourRow = page.locator(
    `[data-testid="bulk-entry-row"]:has-text("${labourName()}")`,
  );
  // Grab the row's employee id so we can target inputs by id (avoids
  // ambiguity from the md:contents grid layout's input ordering).
  const labourEmpId = await labourRow.getAttribute("data-employee-id");
  if (!labourEmpId) throw new Error("Could not read data-employee-id for labour test row");
  // Click into the count input first to focus, then type — fill() on
  // React controlled inputs occasionally races with React's render.
  const countInput = page.locator(`input#bulk-count-${labourEmpId}`);
  await countInput.click();
  await countInput.fill("10");
  // Wait for the Save button to enable (it's disabled while activeCount===0).
  await page.waitForFunction(
    () => {
      const btn = document.querySelector(
        '[data-testid="bulk-save-button"]',
      );
      return btn instanceof HTMLButtonElement && !btn.disabled;
    },
    { timeout: 10_000 },
  );
  await page.click('[data-testid="bulk-save-button"]');
  await page.waitForTimeout(2000);
  await screenshot(page, "03-piece-entry-saved.png");

  console.log("Step 4: Verify Outstanding wages now shows the LABOUR employee");
  await page.waitForSelector(
    `[data-testid="outstanding-wage-row"]:has-text("${labourName()}")`,
  );
  await screenshot(page, "04-outstanding-wage-row.png");

  // ----- SALARY PAYMENT FLOW -----
  console.log("Step 5: Pay salary modal for FIXED test");
  const fixedRow = page.locator(
    `[data-testid="pending-salary-row"]:has-text("${fixedName()}")`,
  );
  await fixedRow.locator('[data-testid="pay-salary-button"]').click();
  await page.waitForSelector('[data-testid="employee-payment-modal"]');
  await screenshot(page, "05-salary-payment-modal.png");

  console.log("Step 6: Save salary payment");
  await page.click('[data-testid="employee-payment-save"]');
  await page.waitForTimeout(1500);
  await screenshot(page, "06-salary-payment-saved.png");

  console.log("Step 7: Verify FIXED test no longer in pending salaries");
  const stillPending = await page
    .locator(`[data-testid="pending-salary-row"]:has-text("${fixedName()}")`)
    .count();
  if (stillPending > 0) {
    throw new Error("FIXED employee still in pending salaries after payment");
  }

  // ----- WAGE PAYMENT FLOW -----
  console.log("Step 8: Pay wage modal for LABOUR test");
  await page
    .locator(`[data-testid="outstanding-wage-row"]:has-text("${labourName()}")`)
    .locator('[data-testid="pay-wage-button"]')
    .click();
  await page.waitForSelector('[data-testid="employee-payment-modal"]');
  await screenshot(page, "08-wage-payment-modal.png");

  console.log("Step 9: Save wage payment");
  await page.click('[data-testid="employee-payment-save"]');
  await page.waitForTimeout(1500);
  const stillOutstanding = await page
    .locator(`[data-testid="outstanding-wage-row"]:has-text("${labourName()}")`)
    .count();
  if (stillOutstanding > 0) {
    throw new Error(
      "LABOUR employee still in outstanding wages after WAGE payment",
    );
  }
  await screenshot(page, "09-wage-payment-saved.png");

  // ----- DASHBOARD VERIFY -----
  console.log("Step 10: Dashboard labour section");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="dashboard-labour-section"]');
  await screenshot(page, "10-admin-dashboard-labour.png");

  // ----- ROLE ACCESS -----
  console.log("Step 11: LABOUR_MGMT — /labour allowed");
  await ctx.clearCookies();
  await login(page, testCreds.LABOUR_MGMT.email, testCreds.LABOUR_MGMT.password);
  await page.goto(`${BASE}/labour`, { waitUntil: "domcontentloaded" });
  const labourFinal = new URL(page.url()).pathname;
  if (labourFinal !== "/labour") {
    throw new Error(`LABOUR_MGMT redirected from /labour to ${labourFinal}`);
  }
  await screenshot(page, "11-labour-mgmt-labour-page.png");

  console.log("Step 12: PURCHASE_DEPT — /labour redirects to /dashboard");
  await ctx.clearCookies();
  await login(page, testCreds.PURCHASE_DEPT.email, testCreds.PURCHASE_DEPT.password);
  await page.goto(`${BASE}/labour`, { waitUntil: "domcontentloaded" });
  const purchaseFinal = new URL(page.url()).pathname;
  if (purchaseFinal !== "/dashboard") {
    throw new Error(
      `PURCHASE_DEPT not redirected from /labour — landed on ${purchaseFinal}`,
    );
  }
  await screenshot(page, "12-purchase-dept-redirected.png");

  console.log("\n✓ All 12 walkthrough steps passed.\n");
} catch (err) {
  console.error("\n✗ Walkthrough failed:", err.message);
  await screenshot(page, "FAIL.png");
  process.exitCode = 1;
} finally {
  // ----- CLEANUP -----
  console.log("\nCleanup: removing test data via SQL (requires DIRECT_URL)");
  await ctx.clearCookies();
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/employees`, { waitUntil: "domcontentloaded" });

  // Cleanup is best-effort via the UI (delete each test employee).
  // The DELETE button is inside the detail modal.
  for (const name of [fixedName(), labourName()]) {
    try {
      const row = page.locator(`tr:has-text("${name}")`).first();
      if ((await row.count()) > 0) {
        await row.click();
        await page.waitForTimeout(500);
        await page.click('button:has-text("Delete")');
        await page.waitForTimeout(300);
        await page.click('button:has-text("Delete")'); // confirm
        await page.waitForTimeout(1000);
      }
    } catch {
      // Best-effort — log and continue.
      console.warn(`Cleanup: couldn't delete ${name} via UI`);
    }
  }

  console.log(
    `\nNOTE: piece_entries and employee_payments for the test employees are\n` +
      `tombstoned only at the parent (soft-delete cascades aren't wired up).\n` +
      `Run this SQL on prod to fully clean up:\n\n` +
      `  UPDATE piece_entries SET "deletedAt"=NOW() WHERE "employeeId" IN\n` +
      `    (SELECT id FROM employees WHERE name LIKE '${MARKER}%');\n` +
      `  UPDATE employee_payments SET "deletedAt"=NOW() WHERE "employeeId" IN\n` +
      `    (SELECT id FROM employees WHERE name LIKE '${MARKER}%');\n`,
  );

  await browser.close();
}

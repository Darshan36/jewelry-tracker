// Phase 4.5 production smoke walkthrough — Playwright headed,
// hits the deployed Vercel URL. Creates ONE customer + ONE sale +
// ONE payment + ONE return, verifies each landed, then deletes
// the test rows directly via Prisma so prod stays clean.
//
// Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / DIRECT_URL from
// .env.production.local. Credentials never appear in stdout.
//
// Run with:  node scripts/walkthrough-prod.mjs

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-prod-out");
mkdirSync(OUT_DIR, { recursive: true });

function loadEnv(file) {
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

const env = loadEnv(".env.production.local");
const EMAIL = env.SEED_ADMIN_EMAIL;
const PASSWORD = env.SEED_ADMIN_PASSWORD;
const DIRECT_URL = env.DIRECT_URL;
const BASE = "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";

if (!EMAIL || !PASSWORD || !DIRECT_URL) {
  console.error("FAIL: missing required env in .env.production.local");
  process.exit(1);
}

const TEST_MARKER = `__walkthrough_${Date.now()}`;
const TEST_CUSTOMER = `${TEST_MARKER}_customer`;
const TEST_ITEM = `${TEST_MARKER}_item`;

const consoleEntries = [];
const pageErrors = [];
const results = [];

async function step(page, name, fn) {
  const safeName = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
    console.log(`  PASS`);
    await page.screenshot({
      path: join(OUT_DIR, `${results.length.toString().padStart(2, "0")}-${safeName}.png`),
      fullPage: false,
    });
    results.push({ name, status: "PASS" });
  } catch (err) {
    console.log(`  FAIL: ${err.message}`);
    await page.screenshot({
      path: join(OUT_DIR, `FAIL-${results.length.toString().padStart(2, "0")}-${safeName}.png`),
      fullPage: true,
    });
    results.push({ name, status: "FAIL", error: err.message });
    throw err;
  }
}

async function cleanup() {
  console.log("\n=== Cleanup ===");
  const client = new Client({ connectionString: DIRECT_URL });
  await client.connect();
  try {
    // Delete in dependency order (children first).
    // Prisma columns are camelCase with no @map override, so SQL columns are
    // case-sensitive: "itemDescription" and "saleId".
    const r1 = await client.query(
      `DELETE FROM sale_payments WHERE "saleId" IN (SELECT id FROM sales WHERE "itemDescription" LIKE $1)`,
      [`%${TEST_MARKER}%`],
    );
    const r2 = await client.query(
      `DELETE FROM sale_returns WHERE "saleId" IN (SELECT id FROM sales WHERE "itemDescription" LIKE $1)`,
      [`%${TEST_MARKER}%`],
    );
    const r3 = await client.query(
      `DELETE FROM sales WHERE "itemDescription" LIKE $1`,
      [`%${TEST_MARKER}%`],
    );
    const r4 = await client.query(`DELETE FROM customers WHERE name LIKE $1`, [
      `%${TEST_MARKER}%`,
    ]);
    console.log(
      `  deleted: sale_payments=${r1.rowCount} sale_returns=${r2.rowCount} sales=${r3.rowCount} customers=${r4.rowCount}`,
    );
  } finally {
    await client.end();
  }
}

(async () => {
  let browser;
  let didCleanup = false;
  try {
    browser = await chromium.launch({
      headless: false,
      devtools: true,
      slowMo: 150,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.on("console", (msg) =>
      consoleEntries.push({ type: msg.type(), text: msg.text() }),
    );
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // ---------- Sign in ----------
    console.log("\n=== Sign in ===");
    await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
        timeout: 30000,
      }),
      page.click('button[type="submit"]'),
    ]);
    console.log(`  Signed in, landed at ${page.url()}`);

    // ---------- 1. Dashboard renders ----------
    await step(page, "1. Dashboard renders", async () => {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      // Confirm sidebar nav exists
      await page.waitForSelector('a[href="/sales"]');
      await page.waitForSelector('a[href="/customers"]');
    });

    // ---------- 2. Create a customer ----------
    await step(page, "2. Create customer", async () => {
      await page.goto(`${BASE}/customers`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      await page.click('button:has-text("Add customer")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      await page.fill('input[name="name"]', TEST_CUSTOMER);
      await page.fill('input[name="phone"]', "+91 9999999999");
      await page.click('[role="dialog"] button[type="submit"]');
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await page.waitForSelector(`text=${TEST_CUSTOMER}`, { timeout: 10000 });
    });

    // ---------- 3. Create a sale (linked to the customer above) ----------
    await step(page, "3. Create sale", async () => {
      await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      await page.click('button:has-text("Add sale")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      await page.fill("#sales-party-name", TEST_CUSTOMER);
      // Allow dropdown to populate
      await page.waitForTimeout(500);
      // Click the existing-customer row (not the walk-in row)
      const customerRow = page
        .locator('[role="dialog"] .absolute button')
        .filter({ hasText: TEST_CUSTOMER })
        .first();
      if (await customerRow.count()) {
        await customerRow.click();
      } else {
        // Fallback to walk-in
        await page.click('button:has-text("Use as walk-in:")');
        await page.fill("#sales-party-phone", "+91 9999999999");
      }
      await page.fill("#sale-item", `${TEST_ITEM} bangle set`);
      await page.fill("#sale-qty", "1");
      await page.fill("#sale-rate", "5000");
      // discount left at 0
      await page.click('[role="dialog"] button[type="submit"]');
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await page.waitForSelector(`text=${TEST_ITEM}`, { timeout: 10000 });
    });

    // ---------- 4. Add a payment via the detail modal ----------
    await step(page, "4. Add payment", async () => {
      const row = page.locator(`tr:has-text("${TEST_ITEM}")`).first();
      await row.click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      // Click the "Record payment" trigger inside the modal
      await dialog.locator('button:has-text("Record payment")').click();
      await page.waitForSelector("#payment-amount", { timeout: 5000 });
      await page.fill("#payment-amount", "2000");
      // The form's submit button shows "Save" (or "Saving…" while pending)
      await dialog.locator('button[type="submit"]:has-text("Save")').click();
      // Wait for the payments list inside the modal to reflect the new row
      await dialog.locator('text=/2,000\\.00|2000\\.00/').first().waitFor({ timeout: 8000 });
    });

    // ---------- 5. Add a return via the detail modal ----------
    await step(page, "5. Add return", async () => {
      const dialog = page.locator('[role="dialog"]');
      await dialog.locator('button:has-text("Record return")').click();
      await page.waitForSelector("#return-qty", { timeout: 5000 });
      await page.fill("#return-qty", "1");
      await page.fill("#return-refund", "5000");
      await page.fill("#return-note", "smoke test return");
      await dialog.locator('button[type="submit"]:has-text("Save")').click();
      // Wait for the return row to appear in the modal's returns list
      await dialog
        .locator('text=/smoke test return/i')
        .first()
        .waitFor({ timeout: 8000 });
      // Close the modal so subsequent assertions see the table
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
      // refund_due status chip should now show on the table row
      const row = page.locator(`tr:has-text("${TEST_ITEM}")`).first();
      await row.locator('text=/refund/i').waitFor({ timeout: 5000 });
    });

    // ---------- 6. Sign out ----------
    await step(page, "6. Sign out", async () => {
      const signOutBtn = page.locator('button:has-text("Sign out"), a:has-text("Sign out")').first();
      if (await signOutBtn.count()) {
        await signOutBtn.click();
        await page.waitForURL(/\/auth\/login/, { timeout: 10000 });
      } else {
        // No visible sign-out — call the API directly
        await page.evaluate(async () => {
          const csrfRes = await fetch("/api/auth/csrf");
          const { csrfToken } = await csrfRes.json();
          await fetch("/api/auth/signout", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ csrfToken, callbackUrl: "/auth/login" }),
          });
        });
        await page.goto(`${BASE}/dashboard`);
        await page.waitForURL(/\/auth\/login/, { timeout: 10000 });
      }
    });

    console.log("\n=== Browser console summary ===");
    const errors = consoleEntries.filter((e) => e.type === "error");
    const warnings = consoleEntries.filter((e) => e.type === "warning");
    console.log(`  errors: ${errors.length}, warnings: ${warnings.length}, page errors: ${pageErrors.length}`);
    errors.slice(0, 5).forEach((e) => console.log(`    [error] ${e.text.substring(0, 200)}`));
    pageErrors.slice(0, 5).forEach((e) => console.log(`    [pageerror] ${e.substring(0, 200)}`));
  } catch (err) {
    console.error("FAILED:", err.message);
  } finally {
    try {
      await cleanup();
      didCleanup = true;
    } catch (e) {
      console.error("Cleanup failed:", e.message);
    }
    if (browser) await browser.close();

    console.log("\n=== Final summary ===");
    results.forEach((r) =>
      console.log(`  ${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name}${r.error ? " — " + r.error : ""}`),
    );
    if (!didCleanup) {
      console.log("\n  ⚠ cleanup did not complete — check for orphan rows with");
      console.log(`    DELETE FROM ... WHERE name|item LIKE '%${TEST_MARKER}%'`);
    }
    process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
  }
})();

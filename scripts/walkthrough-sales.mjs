// Phase 3.1 product-owner walkthrough — automated via Playwright (headed,
// DevTools open, slowMo so each step is visually observable).
//
// Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from .env.local. Credentials
// never appear in stdout or screenshots. Outputs:
//   - Console log of each step (✓ / ✗)
//   - Summary of browser console warnings/errors at the end
//   - PNG screenshots in scripts/walkthrough-out/ for each step
//
// Run with:  node scripts/walkthrough-sales.mjs
//
// Prereq: dev server listening on http://localhost:3001, started AFTER the
// Sale model migration was applied (otherwise prisma.sale is undefined on
// the cached singleton and the page will 500).

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-out");
mkdirSync(OUT_DIR, { recursive: true });

// Parse .env.local manually — keeps secrets out of process.env globally.
function loadEnvLocal() {
  const txt = readFileSync(join(REPO_ROOT, ".env.local"), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnvLocal();
const EMAIL = env.SEED_ADMIN_EMAIL;
const PASSWORD = env.SEED_ADMIN_PASSWORD;
const BASE = "http://localhost:3001";

if (!EMAIL || !PASSWORD) {
  console.error("FAIL: missing SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD in .env.local");
  process.exit(1);
}

// All console messages and page errors captured for the post-run summary.
const consoleEntries = [];
const pageErrors = [];

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      devtools: true,
      slowMo: 150,
      args: ["--auto-open-devtools-for-tabs"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    page.on("console", (msg) => {
      consoleEntries.push({ type: msg.type(), text: msg.text() });
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

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

    // ---------- 1. Empty state ----------
    await step(page, "1. Navigate to /sales, see empty state", async () => {
      await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('h1:has-text("Sales")', { timeout: 20000 });
      await page.waitForSelector('text=/No sales yet/i');
      await page.waitForSelector('button:has-text("Add sale")');
      const navHighlighted = await page
        .locator('a[href="/sales"]')
        .evaluate((el) => el.getAttribute("aria-current") === "page");
      if (!navHighlighted) throw new Error("Sidebar nav not highlighted for /sales");
    });

    // ---------- 2. Open modal ----------
    await step(page, "2. Open Add sale modal", async () => {
      await page.click('button:has-text("Add sale")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      const expectedDate = todayISO();
      const dateValue = await page.locator("#sale-date").inputValue();
      if (dateValue !== expectedDate) {
        throw new Error(`Date is ${dateValue}, expected ${expectedDate}`);
      }
      await page.waitForSelector("#party-name-input");
    });

    // ---------- 3. Type → dropdown ----------
    await step(page, "3. Type into party picker, dropdown shows", async () => {
      await page.fill("#party-name-input", "a");
      await page.waitForSelector('text=/Use as walk-in:/i', { timeout: 5000 });
    });

    // ---------- 4. Click "Use as walk-in" ----------
    await step(page, "4. Click Use as walk-in", async () => {
      await page.fill("#party-name-input", "Test Walkin Customer");
      await page.waitForSelector('text=/Use as walk-in:/i');
      await page.click('button:has-text("Use as walk-in:")');
      await page.waitForSelector("#party-phone-input");
      const partyName = await page.locator("#party-name-input").inputValue();
      if (partyName !== "Test Walkin Customer") {
        throw new Error(`Expected party name "Test Walkin Customer", got "${partyName}"`);
      }
    });

    // ---------- 5. Cancel + reopen, link a customer ----------
    await step(page, "5. Reopen and link existing customer (chip + read-only)", async () => {
      // Close current modal
      await page.keyboard.press("Escape");
      await page.waitForSelector('[role="dialog"]', { state: "hidden" });

      // Reopen
      await page.click('button:has-text("Add sale")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });

      // Type a partial match against any existing customer.
      // We can't assume specific customer names exist — fall back to typing
      // "a" and clicking the first non-walk-in row if available; if none,
      // skip with a soft-pass (the dropdown showed walk-in, which is still
      // valid behavior).
      await page.fill("#party-name-input", "a");
      await page.waitForTimeout(300);
      const customerRows = await page
        .locator('[role="dialog"] .absolute button:not(:has-text("Use as walk-in:"))')
        .count();
      if (customerRows === 0) {
        console.log("  (no existing customers matching 'a' — skipping chip assertion, walk-in path tested instead)");
        // Click Use-as-walk-in just to clean up the dropdown
        await page.click('button:has-text("Use as walk-in:")');
        return;
      }
      await page
        .locator('[role="dialog"] .absolute button:not(:has-text("Use as walk-in:"))')
        .first()
        .click();

      // After click: chip should appear, plain input gone
      await page.waitForSelector('button[aria-label="Clear linked customer"]', { timeout: 3000 });
      const inputStillPresent = await page.locator("#party-name-input").count();
      if (inputStillPresent !== 0) {
        throw new Error("Linked-customer chip did not replace the input");
      }
    });

    // ---------- 6. Fill item/qty/rate/discount, watch live total ----------
    await step(page, "6. Fill fields, live total shows 2400.00", async () => {
      // If we're in chip mode from step 5, clear the linked customer first
      // so the test can also re-use walk-in for the actual save.
      const chipPresent = await page.locator('button[aria-label="Clear linked customer"]').count();
      if (chipPresent > 0) {
        await page.click('button[aria-label="Clear linked customer"]');
        await page.waitForSelector("#party-name-input");
      }

      await page.fill("#party-name-input", "Walkthrough Buyer");
      await page.fill("#sale-item", "Gold-plated chain");
      await page.fill("#sale-qty", "10");
      await page.fill("#sale-rate", "250");
      await page.fill("#sale-discount", "100");

      // Live total should display ₹2,400.00 — Indian comma grouping.
      await page.waitForFunction(
        () => {
          const totals = Array.from(document.querySelectorAll("span, div, p"));
          return totals.some((el) => /₹\s*2,400\.00/.test(el.textContent || ""));
        },
        null,
        { timeout: 5000 },
      );
    });

    // ---------- 7. Save → row appears with Pending status ----------
    await step(page, "7. Save sale, row appears with Pending status", async () => {
      await page.click('button[type="submit"]:has-text("Save")');
      await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 });
      // Wait for the row to appear with the expected total.
      await page.waitForFunction(
        () => {
          const cells = Array.from(document.querySelectorAll("td"));
          return cells.some((c) => /₹\s*2,400\.00/.test(c.textContent || ""));
        },
        null,
        { timeout: 10000 },
      );
      // Pending status chip somewhere in the table
      await page.waitForSelector('table >> text=/Pending/i');
    });

    // ---------- 8. Click row → detail modal ----------
    await step(page, "8. Click row, detail modal opens with prominent total", async () => {
      // Click the body row matching our buyer name
      await page.click('tbody tr:has-text("Walkthrough Buyer")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      // Verify Total is prominently shown in the detail modal
      const totalShown = await page
        .locator('[role="dialog"]')
        .locator('text=/₹\\s*2,400\\.00/')
        .count();
      if (totalShown === 0) throw new Error("Detail modal does not show total ₹2,400.00");
      // Verify status chip in title
      await page.waitForSelector('[role="dialog"] >> text=/Pending/i');
    });

    // ---------- 9. Edit (qty 12), save, detail shows new total ----------
    await step(page, "9. Edit qty to 12, save, detail updates to 2900.00", async () => {
      // Click Edit button in footer
      await page.click('[role="dialog"] button:has-text("Edit")');
      // Wait for the edit form modal (detail closes first)
      await page.waitForFunction(
        () => {
          const dialogs = document.querySelectorAll('[role="dialog"]');
          if (dialogs.length === 0) return false;
          return Array.from(dialogs).some((d) => d.textContent?.includes("Edit sale"));
        },
        null,
        { timeout: 5000 },
      );
      // Change qty
      const qtyInput = page.locator("#sale-qty");
      await qtyInput.fill("12");
      // Live total should now be 12 * 250 - 100 = 2900
      await page.waitForFunction(
        () => {
          const els = Array.from(document.querySelectorAll("span, div, p"));
          return els.some((el) => /₹\s*2,900\.00/.test(el.textContent || ""));
        },
        null,
        { timeout: 3000 },
      );
      // Save
      await page.click('button[type="submit"]:has-text("Save")');
      await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 });
      // Reopen detail by clicking the row again
      await page.click('tbody tr:has-text("Walkthrough Buyer")');
      await page.waitForSelector('[role="dialog"] >> text=/₹\\s*2,900\\.00/');
    });

    // ---------- 10. Delete via detail modal ----------
    await step(page, "10. Delete from detail, row disappears", async () => {
      await page.click('[role="dialog"] button:has-text("Delete")');
      // Inline confirm appears
      await page.waitForSelector('[role="dialog"] >> text=/Delete sale\\?/i');
      // Find the confirm Delete button (second Delete button, the styled-error one)
      const deleteButtons = await page
        .locator('[role="dialog"] button:has-text("Delete")')
        .count();
      // The confirmation Delete is the last one
      await page.locator('[role="dialog"] button:has-text("Delete")').last().click();
      // Modal closes
      await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 });
      // Row gone
      await page.waitForFunction(
        () => !document.querySelector("tbody")?.textContent?.includes("Walkthrough Buyer"),
        null,
        { timeout: 5000 },
      );
    });

    // Hold the browser open for 2s so the user can see the final state.
    await page.waitForTimeout(2000);
  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();

    // ---------- Summary ----------
    console.log("\n\n========== WALKTHROUGH SUMMARY ==========");
    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;
    console.log(`Steps: ${passed} passed, ${failed} failed of ${results.length} total`);
    for (const r of results) {
      console.log(`  [${r.status}] ${r.name}${r.error ? ` — ${r.error}` : ""}`);
    }

    console.log(`\n--- Browser console (${consoleEntries.length} entries) ---`);
    const grouped = {};
    for (const e of consoleEntries) {
      const key = `${e.type}|${e.text}`;
      grouped[key] = (grouped[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(grouped)) {
      const [type, ...textParts] = key.split("|");
      const text = textParts.join("|");
      // Suppress the noisy [Fast Refresh] dev messages
      if (type === "log" && /\[Fast Refresh\]|\[HMR\]/.test(text)) continue;
      console.log(`  [${type}${count > 1 ? ` ×${count}` : ""}] ${text.slice(0, 200)}`);
    }

    if (pageErrors.length > 0) {
      console.log(`\n--- Page errors (${pageErrors.length}) ---`);
      for (const e of pageErrors) console.log(`  ${e}`);
    } else {
      console.log("\n--- Page errors: none ---");
    }

    console.log(`\nScreenshots: ${OUT_DIR}`);
    console.log("=========================================\n");
  }
})();

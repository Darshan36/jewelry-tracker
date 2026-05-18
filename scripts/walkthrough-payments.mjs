// Phase 3.2 product-owner walkthrough — Sale payments + inline panel UX.
//
// Verifies (per spec):
//   - Step 4: "Pay full balance" amount-input math precision (exact rupees,
//     no off-by-paise).
//   - Step 5: Status chip live-update in the detail modal title WITHOUT
//     closing/reopening (router.refresh + viewingSaleId-driven re-render).
//   - Step 7: Partial vs Completed chip distinguishability (both currently
//     blue per Phase 3.1 deferred design-token gap — reports the visual
//     state for human judgement).
//   - Step 10: Soft-delete recomputation — × on a payment flips status back.
//
// Self-bootstrapping: if /sales is empty, creates a fresh walk-in sale of
// known total (₹2,400.00) for testing. Cleans up its test rows at the end.
//
// Run with:  node scripts/walkthrough-payments.mjs
// Prereq: dev server on http://localhost:3001 with SalePayment model loaded.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-payments-out");
mkdirSync(OUT_DIR, { recursive: true });

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

const consoleEntries = [];
const pageErrors = [];
const results = [];

async function step(page, name, fn) {
  const safeName = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  console.log(`\n=== ${name} ===`);
  try {
    const detail = await fn();
    console.log(`  PASS${detail ? `  (${detail})` : ""}`);
    await page.screenshot({
      path: join(
        OUT_DIR,
        `${results.length.toString().padStart(2, "0")}-${safeName}.png`,
      ),
    });
    results.push({ name, status: "PASS", detail });
  } catch (err) {
    console.log(`  FAIL: ${err.message}`);
    await page.screenshot({
      path: join(
        OUT_DIR,
        `FAIL-${results.length.toString().padStart(2, "0")}-${safeName}.png`,
      ),
      fullPage: true,
    });
    results.push({ name, status: "FAIL", error: err.message });
    throw err;
  }
}

async function closeAnyOpenDialog(page) {
  const open = await page.locator('[role="dialog"]').count();
  if (open > 0) {
    await page.keyboard.press("Escape");
    await page
      .locator('[role="dialog"]')
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => {});
  }
}

async function createSaleViaUI(page, { partyName, item, qty, rate }) {
  await page.click('button:has-text("Add sale")');
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
  await page.fill("#sales-party-name", partyName);
  await page.waitForSelector('text=/Use as walk-in:/i');
  await page.click('button:has-text("Use as walk-in:")');
  await page.fill("#sale-item", item);
  await page.fill("#sale-qty", String(qty));
  await page.fill("#sale-rate", String(rate));
  await page.click('button[type="submit"]:has-text("Save")');
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });
}

async function deleteSaleByPartyName(page, partyName) {
  const rowSelector = `tbody tr:has-text("${partyName}")`;
  const rowCount = await page.locator(rowSelector).count();
  if (rowCount === 0) return;
  await page.click(rowSelector);
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
  await page.click('[role="dialog"] button:has-text("Delete")');
  await page.waitForSelector('[role="dialog"] >> text=/Delete sale\\?/i');
  // The second Delete button is the styled-error confirm one
  await page
    .locator('[role="dialog"] button:has-text("Delete")')
    .last()
    .click();
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });
}

// Read the status chip text inside the currently-open detail dialog.
// Title chip lives inside the dialog title; we look for one of the four
// known status labels.
async function readDialogStatus(page) {
  return await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const txt = dialog.textContent || "";
    for (const label of ["Refund due", "Completed", "Partial", "Pending"]) {
      if (txt.includes(label)) return label;
    }
    return null;
  });
}

// Read the "Outstanding: ₹X" text from the dialog's payment panel.
async function readDialogOutstanding(page) {
  const el = await page
    .locator('[role="dialog"] >> text=/Outstanding:/i')
    .first();
  return (await el.textContent()) ?? "";
}

(async () => {
  let browser;
  let testPartyName = `Pmt3.2 Buyer ${Date.now()}`;
  let secondPartyName = `Pmt3.2 Partial ${Date.now()}`;

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

    // ---------- Sign in + navigate to /sales ----------
    console.log("\n=== Sign in ===");
    await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
        timeout: 30000,
      }),
      page.click('button[type="submit"]'),
    ]);
    await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('h1:has-text("Sales")', { timeout: 20000 });

    // ---------- Bootstrap: create two test sales ----------
    // Sale A: ₹2,400 total — used for partial → completed flow + reverse.
    // Sale B: ₹2,400 total — used for "Pay full balance" + overpayment.
    console.log("\n=== Bootstrap ===");
    await createSaleViaUI(page, {
      partyName: testPartyName,
      item: "Phase 3.2 test gold chain",
      qty: 10,
      rate: 240,
    });
    await createSaleViaUI(page, {
      partyName: secondPartyName,
      item: "Phase 3.2 test silver bracelet",
      qty: 10,
      rate: 240,
    });
    console.log(`  Created two test sales (₹2,400 each)`);

    // ---------- Step 1: navigate, status chips visible, both Pending ----------
    await step(page, "1. Status chips visible, both new sales Pending", async () => {
      // Both test rows should show "Pending"
      const rowA = page.locator(`tbody tr:has-text("${testPartyName}")`);
      const rowB = page.locator(`tbody tr:has-text("${secondPartyName}")`);
      await rowA.locator("text=/Pending/i").waitFor({ timeout: 5000 });
      await rowB.locator("text=/Pending/i").waitFor({ timeout: 5000 });
    });

    // ---------- Step 2: open detail, payment panel empty, outstanding = total ----------
    await step(page, "2. Detail modal — payment panel empty, outstanding = total", async () => {
      await page.click(`tbody tr:has-text("${testPartyName}")`);
      await page.locator('[role="dialog"]').waitFor({ state: "visible" });
      await page.waitForSelector('[role="dialog"] >> text=/Payment history/i');
      await page.waitForSelector('[role="dialog"] >> text=/No payments yet/i');
      // Outstanding should be ₹2,400.00
      const outstandingText = await readDialogOutstanding(page);
      if (!/₹\s*2,400\.00/.test(outstandingText)) {
        throw new Error(`Outstanding text "${outstandingText}" does not contain ₹2,400.00`);
      }
      await page.waitForSelector('[role="dialog"] button:has-text("Record payment")');
    });

    // ---------- Step 3: click "+ Record payment", form expands ----------
    await step(page, "3. Click + Record payment, inline form expands", async () => {
      await page.click('[role="dialog"] button:has-text("Record payment")');
      await page.waitForSelector("#payment-amount", { timeout: 3000 });
      await page.waitForSelector("#payment-date");
      await page.waitForSelector('button:has-text("Pay full balance")');
      // Date should default to today
      const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();
      const dateVal = await page.locator("#payment-date").inputValue();
      if (dateVal !== today) {
        throw new Error(`Date defaulted to "${dateVal}", expected "${today}"`);
      }
    });

    // ---------- Step 4: "Pay full balance" math — CRITICAL CHECK ----------
    await step(page, "4. Pay full balance fills amount with exact remaining (CRITICAL)", async () => {
      // First, partially pay ₹500 to leave a non-trivial remaining balance.
      // Actually for step 4, we want to verify "Pay full balance" on a fresh
      // sale (outstanding = total). Use Sale B (second one), which is still
      // pristine. But we're currently on Sale A — let me close and go to B.
      // Actually easier: just verify pay-full on the current (pristine) Sale A.
      // The outstanding is ₹2,400.00 → button should fill 2400.
      await page.click('button:has-text("Pay full balance")');
      const amountVal = await page.locator("#payment-amount").inputValue();
      // Accept "2400", "2400.00", or "2400.0"
      const acceptable = /^2400(?:\.0+)?$/.test(amountVal);
      if (!acceptable) {
        throw new Error(
          `Pay full balance gave amount="${amountVal}", expected exactly 2400 (or 2400.00)`,
        );
      }
      return `amount input = "${amountVal}"`;
    });

    // ---------- Step 5: Save → status chip live-updates without close/reopen ----------
    await step(page, "5. Save full payment, status chip flips to Completed LIVE", async () => {
      // Modal is still open from step 4 with amount=2400 filled. Click Save.
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
      // Wait for the payment to appear in history (form closes, payment row visible)
      await page.waitForFunction(
        () => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return false;
          // Payment row contains ₹2,400.00 in tabular cell
          return /₹\s*2,400\.00/.test(dialog.textContent || "");
        },
        null,
        { timeout: 10000 },
      );

      // CRITICAL: status chip in title should now read "Completed" without
      // closing/reopening the modal.
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Completed") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Completed") {
        throw new Error(
          `Status chip in modal title is "${status}" after Save; expected "Completed". This is the live-update bug.`,
        );
      }

      // Outstanding should now be ₹0.00
      const outstanding = await readDialogOutstanding(page);
      if (!/₹\s*0\.00/.test(outstanding)) {
        throw new Error(`Outstanding "${outstanding}" did not drop to ₹0.00 after full payment`);
      }
      return "chip live-updated to Completed";
    });

    // ---------- Step 6: Close modal → table row also shows Completed ----------
    await step(page, "6. Close detail, table row Status column shows Completed", async () => {
      await closeAnyOpenDialog(page);
      // The row for Sale A should now show "Completed" in the Status column
      const rowA = page.locator(`tbody tr:has-text("${testPartyName}")`);
      await rowA.locator("text=/Completed/i").waitFor({ timeout: 5000 });
    });

    // ---------- Step 7: Different sale → partial payment, chip = Partial ----------
    await step(page, "7. Partial payment on Sale B — chip = Partial (visual)", async () => {
      // Open Sale B (the second one, still pristine ₹2,400 outstanding)
      await page.click(`tbody tr:has-text("${secondPartyName}")`);
      await page.locator('[role="dialog"]').waitFor({ state: "visible" });
      await page.click('[role="dialog"] button:has-text("Record payment")');
      await page.waitForSelector("#payment-amount");
      await page.fill("#payment-amount", "500");
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');

      // Wait for outstanding to update to ₹1,900
      await page.waitForFunction(
        () => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return false;
          return /Outstanding:\s*₹\s*1,900\.00/.test(dialog.textContent || "");
        },
        null,
        { timeout: 10000 },
      );

      // Status should be Partial
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 5000) {
        status = await readDialogStatus(page);
        if (status === "Partial") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Partial") {
        throw new Error(`Status is "${status}", expected "Partial"`);
      }

      // Visual check: compare Partial chip vs Completed chip. Both currently
      // use bg-secondary-container (blue) per Phase 3.1 lineage. Capture the
      // dot's class for the report — caller can eyeball the screenshot.
      const partialChipInfo = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return null;
        const chips = Array.from(dialog.querySelectorAll("span")).filter((el) =>
          /Partial/i.test(el.textContent || ""),
        );
        if (chips.length === 0) return null;
        const chip = chips[0];
        const dot = chip.querySelector("span[class*='size-']");
        return {
          chipClasses: chip.className,
          dotClasses: dot?.className ?? null,
        };
      });
      return `Partial chip dot classes: ${partialChipInfo?.dotClasses ?? "n/a"}`;
    });

    // ---------- Step 8: Overpayment attempt → inline error ----------
    await step(page, "8. Overpayment ₹3,000 on ₹1,900 remaining — server error", async () => {
      // Currently in Sale B detail with form possibly closed. Re-open form.
      const formOpen = await page.locator("#payment-amount").count();
      if (formOpen === 0) {
        await page.click('[role="dialog"] button:has-text("Record payment")');
        await page.waitForSelector("#payment-amount");
      }
      await page.fill("#payment-amount", "3000");
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
      await page.waitForSelector(
        '[role="dialog"] >> text=/Exceeds remaining balance/i',
        { timeout: 8000 },
      );
      // Verify the error message includes the outstanding amount
      const errText = await page.locator(
        '[role="dialog"] >> text=/Exceeds remaining balance/i',
      ).first().textContent();
      if (!/₹\s*1,900\.00/.test(errText || "")) {
        throw new Error(`Error text "${errText}" missing the ₹1,900.00 outstanding amount`);
      }
      // Form should still be open
      await page.waitForSelector("#payment-amount");
      return "error: " + errText?.slice(0, 80);
    });

    // ---------- Step 9: Adjust to remaining → Completed ----------
    await step(page, "9. Adjust to ₹1,900 — save → Completed live-update", async () => {
      await page.click('[role="dialog"] button:has-text("Pay full balance")');
      const filled = await page.locator("#payment-amount").inputValue();
      if (!/^1900(\.0+)?$/.test(filled)) {
        throw new Error(`Pay full balance gave "${filled}", expected 1900`);
      }
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');

      // Wait for status flip to Completed
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Completed") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Completed") {
        throw new Error(`Status is "${status}" after final payment; expected "Completed"`);
      }
    });

    // ---------- Step 10: × on payment → Confirm → status flips back ----------
    await step(page, "10. Reverse last payment → status flips back live", async () => {
      // The detail modal is still open. There are 2 payments visible (₹500 + ₹1,900).
      // Hover over a payment to reveal the × button, then click it.
      // The × button is the per-row "Reverse payment" button.
      const reverseButtons = page.locator(
        '[role="dialog"] button[aria-label="Reverse payment"]',
      );
      const reverseCount = await reverseButtons.count();
      if (reverseCount === 0) {
        throw new Error("No reverse-payment × buttons found in dialog");
      }
      // Click the first one (most recent payment, since list is ordered as inserted)
      // Force-click since the button is opacity-0 by default until hover.
      await reverseButtons.first().click({ force: true });
      await page.waitForSelector('[role="dialog"] >> text=/Reverse\\?/i', {
        timeout: 3000,
      });
      // Click Confirm
      await page.click('[role="dialog"] button:has-text("Confirm")');

      // After router.refresh, status should flip back (Completed → Partial since
      // one of the two payments was reversed). Outstanding should rise.
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status !== "Completed") break;
        await page.waitForTimeout(200);
      }
      if (status === "Completed") {
        throw new Error("Status stayed 'Completed' after reversing a payment");
      }
      if (status !== "Partial" && status !== "Pending") {
        throw new Error(
          `Status after reversal is "${status}", expected "Partial" or "Pending"`,
        );
      }
      return `status flipped to ${status}`;
    });

    // ---------- Cleanup ----------
    await step(page, "Cleanup test sales", async () => {
      await closeAnyOpenDialog(page);
      await deleteSaleByPartyName(page, testPartyName);
      await deleteSaleByPartyName(page, secondPartyName);
    });

    await page.waitForTimeout(1500);
  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();

    console.log("\n\n========== PHASE 3.2 WALKTHROUGH SUMMARY ==========");
    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;
    console.log(`Steps: ${passed} passed, ${failed} failed of ${results.length} total`);
    for (const r of results) {
      const tag = r.detail ? ` (${r.detail})` : r.error ? ` — ${r.error}` : "";
      console.log(`  [${r.status}] ${r.name}${tag}`);
    }

    const interesting = consoleEntries.filter((e) => {
      if (e.type === "log" && /prisma:query|\[Fast Refresh\]|\[HMR\]/.test(e.text)) return false;
      if (e.type === "info" && /React DevTools/.test(e.text)) return false;
      return true;
    });
    console.log(`\n--- Browser console (${interesting.length} of ${consoleEntries.length} total) ---`);
    const grouped = {};
    for (const e of interesting) {
      const key = `${e.type}|${e.text.slice(0, 180)}`;
      grouped[key] = (grouped[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(grouped)) {
      const [type, ...textParts] = key.split("|");
      console.log(`  [${type}${count > 1 ? ` ×${count}` : ""}] ${textParts.join("|")}`);
    }
    if (pageErrors.length > 0) {
      console.log(`\n--- Page errors (${pageErrors.length}) ---`);
      for (const e of pageErrors) console.log(`  ${e}`);
    } else {
      console.log("\n--- Page errors: none ---");
    }

    console.log(`\nScreenshots: ${OUT_DIR}`);
    console.log("===================================================\n");
  }
})();

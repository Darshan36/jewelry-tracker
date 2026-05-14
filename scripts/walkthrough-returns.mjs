// Phase 3.3 product-owner walkthrough — Sale returns + REFUND-type payments +
// refund_due status. Verifies the 12-step flow from the build spec.
//
// Critical assertions:
//   - Step 5: status chip flips Completed → Refund due (red) live, no
//     close/reopen.
//   - Step 6: PaymentPanel indicator changes to "Refund owed: ₹400.00" in red.
//   - Step 7: autofill button reads "Refund full amount" and fills exactly 400.
//   - Step 8: REFUND entry renders with "−₹400.00" minus prefix and red styling.
//   - Step 9: server rejects qty=11 with the formatted message.
//   - Step 12: soft-deleting the REFUND flips status back to Refund due
//     (return still active, refund undone).
//
// Self-bootstrapping: creates two test sales (₹2,400 each) + pays Sale A in
// full + pays Sale B partially. Cleans up at the end via soft-delete.
//
// Run with:  node scripts/walkthrough-returns.mjs
// Prereq: dev server on http://localhost:3001 with SaleReturn model loaded
// (i.e., AFTER the .next/ nuke + restart that fixed Phase 3.3 schema cache).

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-returns-out");
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
      path: join(OUT_DIR, `${results.length.toString().padStart(2, "0")}-${safeName}.png`),
    });
    results.push({ name, status: "PASS", detail });
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

async function closeAnyOpenDialog(page) {
  const open = await page.locator('[role="dialog"]').count();
  if (open > 0) {
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

async function createSaleViaUI(page, { partyName, qty, rate }) {
  await page.click('button:has-text("Add sale")');
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
  await page.fill("#party-name-input", partyName);
  await page.waitForSelector('text=/Use as walk-in:/i');
  await page.click('button:has-text("Use as walk-in:")');
  await page.fill("#sale-item", "Phase 3.3 test gold chain");
  await page.fill("#sale-qty", String(qty));
  await page.fill("#sale-rate", String(rate));
  await page.click('button[type="submit"]:has-text("Save")');
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });
}

async function openSaleDetail(page, partyName) {
  await page.click(`tbody tr:has-text("${partyName}")`);
  await page.locator('[role="dialog"]').waitFor({ state: "visible", timeout: 5000 });
}

async function recordPaymentInOpenDetail(page, amount) {
  // Click whichever trigger is visible. Playwright doesn't reliably combine
  // `has-text` selectors with commas, so probe each.
  const recordBtn = page.locator('[role="dialog"] button:has-text("Record payment")');
  const refundBtn = page.locator('[role="dialog"] button:has-text("Issue refund")');
  if ((await recordBtn.count()) > 0) {
    await recordBtn.click();
  } else {
    await refundBtn.click();
  }
  await page.waitForSelector("#payment-amount");
  await page.fill("#payment-amount", String(amount));
  await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
  await page.waitForFunction(
    () => !document.querySelector("#payment-amount"),
    null,
    { timeout: 10000 },
  );
}

async function deleteSaleByPartyName(page, partyName) {
  const rowSelector = `tbody tr:has-text("${partyName}")`;
  if ((await page.locator(rowSelector).count()) === 0) return;
  await page.click(rowSelector);
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
  // The footer Delete button — pick the one before the inline confirm fires.
  // Sale-detail-modal has a single "Delete" footer button initially.
  await page.click('[role="dialog"] .border-t button:has-text("Delete")').catch(async () => {
    // Some Delete buttons exist deeper (inside payment/return rows); fall
    // back to the last one in the modal footer.
    await page.locator('[role="dialog"] button:has-text("Delete")').last().click();
  });
  await page.waitForSelector('[role="dialog"] >> text=/Delete sale\\?/i', { timeout: 3000 });
  await page.locator('[role="dialog"] button:has-text("Delete")').last().click();
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });
}

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

async function readDialogIndicator(page) {
  // Reads the "Outstanding: ₹X" or "Refund owed: ₹X" label in PaymentPanel.
  return await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const match = (dialog.textContent || "").match(/(Outstanding|Refund owed):\s*([₹\s\d,.\-−]+)/);
    return match ? { label: match[1], value: match[2].trim() } : null;
  });
}

(async () => {
  let browser;
  const ts = Date.now();
  const saleA = `Pmt3.3 A ${ts}`;
  const saleB = `Pmt3.3 B ${ts}`;

  try {
    browser = await chromium.launch({
      headless: false,
      devtools: true,
      slowMo: 150,
      args: ["--auto-open-devtools-for-tabs"],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on("console", (msg) => consoleEntries.push({ type: msg.type(), text: msg.text() }));
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // ---------- Sign in ----------
    console.log("\n=== Sign in ===");
    await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 30000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('h1:has-text("Sales")', { timeout: 20000 });

    // ---------- Bootstrap ----------
    // Sale A: ₹2,400 total (qty=10, rate=240), paid fully.
    // Sale B: ₹2,400 total, paid partially (₹1,000).
    console.log("\n=== Bootstrap: 2 sales + pre-paid ===");
    await createSaleViaUI(page, { partyName: saleA, qty: 10, rate: 240 });
    await createSaleViaUI(page, { partyName: saleB, qty: 10, rate: 240 });

    // Pay Sale A in full
    await openSaleDetail(page, saleA);
    await recordPaymentInOpenDetail(page, 2400);
    await closeAnyOpenDialog(page);

    // Pay Sale B partially
    await openSaleDetail(page, saleB);
    await recordPaymentInOpenDetail(page, 1000);
    await closeAnyOpenDialog(page);
    console.log(`  Bootstrap complete: A=fully paid (Completed), B=partial 1000/2400`);

    // ---------- Step 1: Sale A row shows Completed; Sale B shows Partial ----------
    await step(page, "1. Sale A=Completed, Sale B=Partial", async () => {
      const rowA = page.locator(`tbody tr:has-text("${saleA}")`);
      const rowB = page.locator(`tbody tr:has-text("${saleB}")`);
      await rowA.locator("text=/Completed/i").waitFor({ timeout: 5000 });
      await rowB.locator("text=/Partial/i").waitFor({ timeout: 5000 });
    });

    // ---------- Step 2/3: Open Sale A detail — payment panel + empty returns ----------
    await step(page, "2-3. Open Sale A — payments visible, Returns panel empty", async () => {
      await openSaleDetail(page, saleA);
      // PaymentPanel section visible
      await page.waitForSelector('[role="dialog"] >> text=/Payment history/i');
      // Returns panel visible with empty state
      await page.waitForSelector('[role="dialog"] >> text=/^Returns$/i');
      await page.waitForSelector('[role="dialog"] >> text=/No returns recorded/i');
      await page.waitForSelector('[role="dialog"] button:has-text("Record return")');
    });

    // ---------- Step 4: Click + Record return, fill form ----------
    await step(page, "4. Click + Record return, qty=2 refund=400", async () => {
      await page.click('[role="dialog"] button:has-text("Record return")');
      await page.waitForSelector("#return-qty");
      // Verify the hint shows "Up to 10 available"
      await page.waitForSelector('[role="dialog"] >> text=/Up to 10 available/i');
      await page.fill("#return-qty", "2");
      await page.fill("#return-refund", "400");
    });

    // ---------- Step 5: Save → status flips to Refund due (LIVE) ----------
    await step(page, "5. Save return → status chip flips Completed → Refund due LIVE", async () => {
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
      // Wait for the form to close (return-qty input disappears)
      await page.waitForFunction(() => !document.querySelector("#return-qty"), null, { timeout: 8000 });
      // Poll the dialog title chip for "Refund due"
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Refund due") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Refund due") {
        throw new Error(`Status chip = "${status}" after return save; expected "Refund due"`);
      }
      return `chip live-updated to Refund due`;
    });

    // ---------- Step 6: Indicator shows "Refund owed: ₹400.00" in red ----------
    await step(page, "6. PaymentPanel indicator = Refund owed: ₹400.00", async () => {
      const indicator = await readDialogIndicator(page);
      if (!indicator) throw new Error("Could not parse outstanding/refund indicator");
      if (indicator.label !== "Refund owed") {
        throw new Error(`Indicator label = "${indicator.label}", expected "Refund owed"`);
      }
      if (!/₹\s*400\.00/.test(indicator.value)) {
        throw new Error(`Indicator value = "${indicator.value}", expected ₹400.00`);
      }
      // Verify it's styled with text-error (red) — find the element with both
      // text-error class and "Refund owed" text.
      const hasRedIndicator = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return false;
        const errorEls = Array.from(dialog.querySelectorAll(".text-error"));
        return errorEls.some((el) => /Refund owed/.test(el.textContent || ""));
      });
      if (!hasRedIndicator) {
        throw new Error("Refund owed indicator is not styled with text-error (red)");
      }
      return `${indicator.label}: ${indicator.value}`;
    });

    // ---------- Step 7: Click + Issue refund, autofill = Refund full amount ----------
    await step(page, "7. + Issue refund button + Refund full amount autofills 400", async () => {
      // Button label should now be "Issue refund" (not "Record payment")
      await page.waitForSelector('[role="dialog"] button:has-text("Issue refund")');
      await page.click('[role="dialog"] button:has-text("Issue refund")');
      await page.waitForSelector("#payment-amount");
      // Autofill button label
      await page.waitForSelector('button:has-text("Refund full amount")', { timeout: 3000 });
      await page.click('button:has-text("Refund full amount")');
      const amount = await page.locator("#payment-amount").inputValue();
      if (!/^400(\.0+)?$/.test(amount)) {
        throw new Error(`Refund full amount filled "${amount}", expected 400`);
      }
      return `autofill = ${amount}`;
    });

    // ---------- Step 8: Save refund → REFUND entry red + "−" prefix; status Completed ----------
    await step(page, "8. Save refund → red REFUND entry; status Completed", async () => {
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
      await page.waitForFunction(() => !document.querySelector("#payment-amount"), null, { timeout: 8000 });

      // router.refresh() is fire-and-forget — the form closes immediately
      // but the new REFUND row appears only after the parent re-fetches.
      // Poll for the "Refund" badge to confirm the panel re-rendered.
      await page.waitForFunction(
        () => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return false;
          // Look for a list item whose text contains "Refund" badge (uppercase
          // via CSS but text is literally "Refund").
          const rows = Array.from(dialog.querySelectorAll("li"));
          return rows.some((r) => /Refund/.test(r.textContent || ""));
        },
        null,
        { timeout: 8000 },
      );

      // REFUND row should be in the payment history with red styling + minus
      // prefix. Three independent checks (so one brittle selector doesn't
      // hide the others): (1) "Refund" badge text, (2) some text-error
      // element containing the refund amount, (3) some text-error element
      // containing a minus-class character anywhere.
      const refundDiagnostics = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return null;
        const errorEls = Array.from(dialog.querySelectorAll(".text-error"));
        const errorTexts = errorEls.map((el) => el.textContent || "");
        // U+2212 MINUS SIGN, U+002D HYPHEN-MINUS, U+2013 EN DASH, U+2014 EM DASH
        const hasMinusPrefix = errorTexts.some((t) =>
          /[-–—−]\s*₹/.test(t),
        );
        const hasAmount = errorTexts.some((t) => /₹\s*400\.00/.test(t));
        const hasRefundBadge = errorTexts.some((t) => /^Refund$/i.test(t.trim()));
        return { hasMinusPrefix, hasAmount, hasRefundBadge, errorTexts };
      });
      if (!refundDiagnostics) throw new Error("Dialog not found");
      if (!refundDiagnostics.hasRefundBadge) {
        throw new Error(
          `No "Refund" badge in red. text-error elements seen: ${JSON.stringify(refundDiagnostics.errorTexts)}`,
        );
      }
      if (!refundDiagnostics.hasAmount) {
        throw new Error(
          `No text-error element with ₹400.00. text-error elements: ${JSON.stringify(refundDiagnostics.errorTexts)}`,
        );
      }
      if (!refundDiagnostics.hasMinusPrefix) {
        throw new Error(
          `No minus-prefixed ₹ amount found. text-error elements: ${JSON.stringify(refundDiagnostics.errorTexts)}`,
        );
      }

      // Status should flip to Completed (paid 2400 - refunded 400 = 2000 net,
      // effective = 2400 - 400 returned = 2000, so 2000 === 2000 → completed).
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Completed") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Completed") {
        throw new Error(`Status after refund = "${status}", expected "Completed"`);
      }
      return `REFUND rendered with badge+minus+red amount; status=Completed`;
    });

    // ---------- Step 9: Sale B, qty=11 → error ----------
    await step(page, "9. Sale B over-return (qty=11) → server error", async () => {
      await closeAnyOpenDialog(page);
      await openSaleDetail(page, saleB);
      await page.click('[role="dialog"] button:has-text("Record return")');
      await page.waitForSelector("#return-qty");
      await page.fill("#return-qty", "11");
      await page.fill("#return-refund", "100");
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
      // Wait for error message
      await page.waitForSelector(
        '[role="dialog"] >> text=/Cannot return more than the original quantity/i',
        { timeout: 8000 },
      );
      const errText = await page
        .locator('[role="dialog"] >> text=/Cannot return more than/i')
        .first()
        .textContent();
      if (!/Already returned: 0 of 10/.test(errText || "")) {
        throw new Error(`Error text "${errText}" missing "Already returned: 0 of 10"`);
      }
      return errText?.slice(0, 80);
    });

    // ---------- Step 10: Adjust qty=3, refund=900 → entry, still Partial ----------
    await step(page, "10. qty=3 refund=900 → return saved; status still Partial", async () => {
      await page.fill("#return-qty", "3");
      await page.fill("#return-refund", "900");
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
      await page.waitForFunction(() => !document.querySelector("#return-qty"), null, { timeout: 8000 });
      // Returns panel shows the new entry
      await page.waitForSelector('[role="dialog"] >> text=/₹\\s*900\\.00/');
      // Status: paid=1000, effective=2400-900=1500, 1000<1500 → Partial
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 5000) {
        status = await readDialogStatus(page);
        if (status === "Partial") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Partial") {
        throw new Error(`Status after Sale B return = "${status}", expected "Partial"`);
      }
    });

    // ---------- Step 11: Soft-delete return on Sale B; status recomputes ----------
    await step(page, "11. Soft-delete return on B → empty returns; still Partial", async () => {
      // Find the Reverse-return × button. Force-click since opacity-0 until hover.
      const reverseBtn = page.locator('[role="dialog"] button[aria-label="Reverse return"]').first();
      await reverseBtn.click({ force: true });
      await page.waitForSelector('[role="dialog"] >> text=/Reverse\\?/i');
      // Click the Confirm button inside the return row (last one in dialog)
      await page.locator('[role="dialog"] button:has-text("Confirm")').last().click();
      // Wait for the return amount to disappear from the dialog
      await page.waitForFunction(
        () => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return true;
          // After soft-delete + refresh, the ₹900.00 entry should be gone
          // (we look for the return-row pattern: "qty" + "900")
          return !/3\s*qty/.test(dialog.textContent || "");
        },
        null,
        { timeout: 8000 },
      );
      // Status: paid=1000, effective=2400 (no returns), 1000<2400 → Partial
      const status = await readDialogStatus(page);
      if (status !== "Partial") {
        throw new Error(`Status after soft-delete return on B = "${status}", expected "Partial"`);
      }
    });

    // ---------- Step 12: Soft-delete REFUND on A → status flips back to Refund due ----------
    await step(page, "12. Soft-delete REFUND on Sale A → status flips back to Refund due", async () => {
      await closeAnyOpenDialog(page);
      await openSaleDetail(page, saleA);
      // Find the Reverse-payment × on the REFUND row (there are 2 entries: PAYMENT 2400 + REFUND 400)
      // The REFUND row has red text on the amount. We just click the last Reverse-payment button
      // (newest = REFUND, since payments appended).
      // Actually we want the REFUND specifically — find by the "Refund" label cell.
      const refundRow = page.locator('[role="dialog"] li').filter({ hasText: /Refund/ }).first();
      const reverseBtn = refundRow.locator('button[aria-label="Reverse payment"]');
      await reverseBtn.click({ force: true });
      await page.waitForSelector('[role="dialog"] >> text=/Reverse\\?/i');
      await page.locator('[role="dialog"] button:has-text("Confirm")').last().click();

      // Status: paid=2400 (refund undone), effective=2000 (return still active),
      // 2400>2000 → refund_due again
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Refund due") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Refund due") {
        throw new Error(`Status after undoing refund = "${status}", expected "Refund due"`);
      }
      return "status flipped back to Refund due";
    });

    // ---------- Cleanup ----------
    await step(page, "Cleanup: delete both test sales", async () => {
      await closeAnyOpenDialog(page);
      await deleteSaleByPartyName(page, saleA);
      await deleteSaleByPartyName(page, saleB);
    });

    await page.waitForTimeout(1500);
  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();

    console.log("\n\n========== PHASE 3.3 WALKTHROUGH SUMMARY ==========");
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

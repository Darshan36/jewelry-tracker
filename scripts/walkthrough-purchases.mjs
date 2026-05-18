// Phase 4 product-owner walkthrough — Purchases (entry + payments + returns
// + refund_due) with supplier-direction label inversions.
//
// 12 steps from the build spec. Bootstrap creates a fresh supplier via the
// Suppliers UI if none exist, then exercises the full purchase lifecycle.
//
// Critical UI inversions verified explicitly:
//   - "Owed to supplier" (not "Outstanding")
//   - "Refund expected" (not "Refund owed")
//   - "Record refund received" trigger (not "Issue refund")
//   - REFUND row: text-secondary (blue), "Refund received" badge, "+" prefix
//   - Refund expected indicator: text-secondary (NOT text-error)
//
// Run with: node scripts/walkthrough-purchases.mjs

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-purchases-out");
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
  // Match "Owed to supplier: ₹X" or "Refund expected: ₹X" or "Outstanding: ₹X"
  return await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const match = (dialog.textContent || "").match(
      /(Owed to supplier|Refund expected|Outstanding):\s*(₹\s*[\d,]+\.\d{2})/,
    );
    return match ? { label: match[1], value: match[2].trim() } : null;
  });
}

async function recordPaymentInOpenDetail(page, amount) {
  const recordBtn = page.locator('[role="dialog"] button:has-text("Record payment")');
  const refundBtn = page.locator(
    '[role="dialog"] button:has-text("Record refund received")',
  );
  if ((await recordBtn.count()) > 0) {
    await recordBtn.click();
  } else {
    await refundBtn.click();
  }
  await page.waitForSelector("#payment-amount");
  await page.fill("#payment-amount", String(amount));
  await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
  await page.waitForFunction(() => !document.querySelector("#payment-amount"), null, { timeout: 10000 });
}

async function recordReturnInOpenDetail(page, qty, refund) {
  await page.click('[role="dialog"] button:has-text("Record return to supplier")');
  await page.waitForSelector("#return-qty");
  await page.fill("#return-qty", String(qty));
  await page.fill("#return-refund", String(refund));
  await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
  await page.waitForFunction(() => !document.querySelector("#return-qty"), null, { timeout: 10000 });
}

(async () => {
  let browser;
  const ts = Date.now();
  const supplierName = `P4 Supplier ${ts}`;
  const itemDesc = `20kg raw gold-plated wire ${ts}`;

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

    // ---------- Bootstrap: create supplier via /suppliers UI ----------
    console.log("\n=== Bootstrap: create supplier ===");
    await page.goto(`${BASE}/suppliers`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('h1:has-text("Suppliers")', { timeout: 20000 });
    await page.click('button:has-text("Add supplier")');
    await page.locator('[role="dialog"]').waitFor({ state: "visible" });
    await page.fill('input[id$="-name"], input[name="name"]', supplierName);
    await page.fill('input[id$="-phone"], input[name="phone"], input[type="tel"]', "9000111222");
    await page.click('[role="dialog"] button[type="submit"]:has-text("Save")');
    await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });
    await page.waitForSelector(`tbody tr:has-text("${supplierName}")`);
    console.log(`  Created supplier: ${supplierName}`);

    // ---------- Step 1: /purchases empty + nav highlighted ----------
    await step(page, "1. Navigate to /purchases — empty state + nav highlighted", async () => {
      await page.goto(`${BASE}/purchases`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('h1:has-text("Purchases")', { timeout: 20000 });
      await page.waitForSelector('text=/No purchases yet/i');
      await page.waitForSelector('button:has-text("Add purchase")');
      // Subtitle inversion
      await page.waitForSelector('text=/Supplier transactions and outstanding payables/i');
      // Nav active
      const navHighlighted = await page
        .locator('a[href="/purchases"]')
        .evaluate((el) => el.getAttribute("aria-current") === "page");
      if (!navHighlighted) throw new Error("Sidebar nav not highlighted for /purchases");
      // "Soon" badge should be gone
      const soonOnPurchases = await page.locator('a[href="/purchases"] >> text=/Soon/i').count();
      if (soonOnPurchases > 0) throw new Error("'Soon' badge still present on Purchases nav");
    });

    // ---------- Step 2: open form modal ----------
    await step(page, "2. Open + Add purchase modal", async () => {
      await page.click('button:has-text("Add purchase")');
      await page.locator('[role="dialog"]').waitFor({ state: "visible" });
      const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();
      const dateVal = await page.locator("#purchase-date").inputValue();
      if (dateVal !== today) throw new Error(`Date defaulted to ${dateVal}, expected ${today}`);
      // Party picker placeholder reflects "supplier"
      const placeholder = await page
        .locator("#purchases-party-name")
        .getAttribute("placeholder");
      if (!placeholder?.toLowerCase().includes("supplier")) {
        throw new Error(`Party picker placeholder is "${placeholder}", expected to contain "supplier"`);
      }
    });

    // ---------- Step 3: type into picker, dropdown shows ----------
    await step(page, "3. Type into party picker → dropdown shows supplier + walk-in", async () => {
      await page.fill("#purchases-party-name", "P4");
      await page.waitForSelector('text=/Use as walk-in:/i');
      await page.waitForSelector(`text=${supplierName}`);
    });

    // ---------- Step 4: click supplier → blue chip ----------
    await step(page, "4. Click supplier → blue chip with name + ×", async () => {
      await page.click(
        `[role="dialog"] .absolute button:has-text("${supplierName}")`,
      );
      await page.waitForSelector('button[aria-label="Clear linked supplier"]');
      // Party name input is gone (chip replaced it)
      const inputCount = await page.locator("#purchases-party-name").count();
      if (inputCount !== 0) throw new Error("Input still present while supplier linked");
    });

    // ---------- Step 5: fill item/qty/rate/discount → live total ----------
    await step(page, "5. Fill fields, live total = ₹9,800.00", async () => {
      await page.fill("#purchase-item", itemDesc);
      await page.fill("#purchase-qty", "20");
      await page.fill("#purchase-rate", "500");
      await page.fill("#purchase-discount", "200");
      // Live total: 20 * 500 - 200 = 9800
      await page.waitForFunction(
        () => {
          const els = Array.from(document.querySelectorAll("span, div, p"));
          return els.some((el) => /₹\s*9,800\.00/.test(el.textContent || ""));
        },
        null,
        { timeout: 5000 },
      );
    });

    // ---------- Step 6: save → row Pending ----------
    await step(page, "6. Save → row appears with Pending status", async () => {
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
      await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });
      // Row with ₹9,800.00 should be visible
      await page.waitForFunction(
        () => {
          const cells = Array.from(document.querySelectorAll("td"));
          return cells.some((c) => /₹\s*9,800\.00/.test(c.textContent || ""));
        },
        null,
        { timeout: 10000 },
      );
      await page.waitForSelector('table >> text=/Pending/i');
    });

    // ---------- Step 7: open detail → "Owed to supplier" indicator ----------
    await step(page, "7. Open detail → 'Owed to supplier: ₹9,800.00' (inversion)", async () => {
      await page.click(`tbody tr:has-text("${itemDesc}")`);
      await page.locator('[role="dialog"]').waitFor({ state: "visible" });
      const indicator = await readDialogIndicator(page);
      if (!indicator) throw new Error("No indicator label found");
      if (indicator.label !== "Owed to supplier") {
        throw new Error(`Indicator label = "${indicator.label}", expected "Owed to supplier"`);
      }
      if (!/₹\s*9,800\.00/.test(indicator.value)) {
        throw new Error(`Indicator value = "${indicator.value}", expected ₹9,800.00`);
      }
      // "+ Record payment" button visible (not "Issue refund")
      await page.waitForSelector('[role="dialog"] button:has-text("Record payment")');
      return `${indicator.label}: ${indicator.value}`;
    });

    // ---------- Step 8: partial ₹5,000 → Partial ----------
    await step(page, "8. Partial payment ₹5,000 → Partial, owed = ₹4,800.00", async () => {
      await recordPaymentInOpenDetail(page, 5000);
      // Wait for status flip
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Partial") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Partial") throw new Error(`Status = "${status}", expected "Partial"`);
      // Indicator now ₹4,800.00
      const indicator = await readDialogIndicator(page);
      if (!/₹\s*4,800\.00/.test(indicator?.value ?? "")) {
        throw new Error(`Indicator value = "${indicator?.value}", expected ₹4,800.00`);
      }
    });

    // ---------- Step 9: return qty=3, refund=1500 → still Partial ----------
    await step(page, "9. Record return to supplier qty=3 refund=1500 → still Partial", async () => {
      await recordReturnInOpenDetail(page, 3, 1500);
      // Returns panel shows ₹1,500.00 entry
      await page.waitForSelector('[role="dialog"] >> text=/₹\\s*1,500\\.00/');
      // Status: paid 5000, effective 9800-1500=8300, 5000<8300 → Partial
      const status = await readDialogStatus(page);
      if (status !== "Partial") throw new Error(`Status = "${status}", expected "Partial"`);
    });

    // ---------- Step 10: payment ₹3,300 → Completed ----------
    await step(page, "10. Payment ₹3,300 → Completed (net 8300 = effective 8300)", async () => {
      await recordPaymentInOpenDetail(page, 3300);
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Completed") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Completed") throw new Error(`Status = "${status}", expected "Completed"`);
    });

    // ---------- Step 11: another return qty=2 refund=2000 → Refund due ----------
    await step(page, "11. Return qty=2 refund=2000 → Refund due (red), 'Refund expected: ₹2,000' (blue)", async () => {
      await recordReturnInOpenDetail(page, 2, 2000);
      // Status: net paid 8300, effective 8300-2000=6300, 8300>6300 → refund_due
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Refund due") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Refund due") throw new Error(`Status = "${status}", expected "Refund due"`);
      // Indicator: "Refund expected: ₹2,000.00" in text-secondary (BLUE, not red)
      const indicator = await readDialogIndicator(page);
      if (indicator?.label !== "Refund expected") {
        throw new Error(`Indicator label = "${indicator?.label}", expected "Refund expected"`);
      }
      if (!/₹\s*2,000\.00/.test(indicator.value)) {
        throw new Error(`Indicator value = "${indicator.value}", expected ₹2,000.00`);
      }
      // Verify color: indicator span should have text-secondary class, NOT text-error
      const indicatorIsBlue = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return false;
        const secondaryEls = Array.from(dialog.querySelectorAll(".text-secondary"));
        return secondaryEls.some((el) => /Refund expected/.test(el.textContent || ""));
      });
      if (!indicatorIsBlue) {
        throw new Error("'Refund expected' indicator NOT styled with text-secondary (blue)");
      }
      const indicatorIsRed = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return false;
        const errorEls = Array.from(dialog.querySelectorAll(".text-error"));
        return errorEls.some((el) => /Refund expected/.test(el.textContent || ""));
      });
      if (indicatorIsRed) {
        throw new Error("'Refund expected' is using text-error (red); should be text-secondary (blue)");
      }
      return "Refund expected ₹2,000.00 in blue (text-secondary)";
    });

    // ---------- Step 12: + Record refund received → autofill 2000 → save → Completed; REFUND row blue + "+" prefix ----------
    await step(page, "12. + Record refund received, autofill, save → Completed; REFUND row blue + '+' prefix", async () => {
      // Button label is "Record refund received" (NOT "Issue refund")
      await page.waitForSelector('[role="dialog"] button:has-text("Record refund received")');
      await page.click('[role="dialog"] button:has-text("Record refund received")');
      await page.waitForSelector("#payment-amount");
      // Autofill button "Refund full amount"
      await page.click('button:has-text("Refund full amount")');
      const amount = await page.locator("#payment-amount").inputValue();
      if (!/^2000(\.0+)?$/.test(amount)) {
        throw new Error(`Refund full amount filled "${amount}", expected 2000`);
      }
      await page.click('[role="dialog"] form button[type="submit"]:has-text("Save")');
      await page.waitForFunction(() => !document.querySelector("#payment-amount"), null, { timeout: 8000 });

      // Wait for REFUND row to appear in payment history
      await page.waitForFunction(
        () => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return false;
          return /Refund received/.test(dialog.textContent || "");
        },
        null,
        { timeout: 8000 },
      );

      // REFUND entry: blue (text-secondary) + "+" prefix + amount
      const refundDiagnostics = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return null;
        const secondaryEls = Array.from(dialog.querySelectorAll(".text-secondary"));
        const texts = secondaryEls.map((el) => (el.textContent || "").trim());
        const hasRefundBadge = texts.some((t) => /^Refund received$/i.test(t));
        const hasPlusPrefix = texts.some((t) => /\+\s*₹/.test(t));
        const hasAmount = texts.some((t) => /₹\s*2,000\.00/.test(t));
        // Defensive: ensure not red
        const redEls = Array.from(dialog.querySelectorAll(".text-error"));
        const redContainsRefundReceived = redEls.some((el) =>
          /Refund received/.test(el.textContent || ""),
        );
        return {
          hasRefundBadge,
          hasPlusPrefix,
          hasAmount,
          redContainsRefundReceived,
          secondaryTexts: texts,
        };
      });
      if (!refundDiagnostics) throw new Error("Dialog not found");
      if (!refundDiagnostics.hasRefundBadge) {
        throw new Error(
          `'Refund received' badge in text-secondary not found. text-secondary elements: ${JSON.stringify(refundDiagnostics.secondaryTexts)}`,
        );
      }
      if (refundDiagnostics.redContainsRefundReceived) {
        throw new Error(
          "'Refund received' is styled with text-error (red); should be text-secondary (blue)",
        );
      }
      if (!refundDiagnostics.hasPlusPrefix) {
        throw new Error(
          `No '+₹X' prefix on a text-secondary element. text-secondary elements: ${JSON.stringify(refundDiagnostics.secondaryTexts)}`,
        );
      }

      // Status flips to Completed
      let status = null;
      const start = Date.now();
      while (Date.now() - start < 8000) {
        status = await readDialogStatus(page);
        if (status === "Completed") break;
        await page.waitForTimeout(200);
      }
      if (status !== "Completed") throw new Error(`Status = "${status}", expected "Completed"`);
      return "REFUND row blue + '+' prefix; status=Completed";
    });

    // ---------- Cleanup ----------
    await step(page, "Cleanup: delete purchase + supplier", async () => {
      // Close detail modal first, then delete the purchase row.
      await closeAnyOpenDialog(page);
      await page.click(`tbody tr:has-text("${itemDesc}")`);
      await page.locator('[role="dialog"]').waitFor({ state: "visible" });
      await page.click('[role="dialog"] .border-t button:has-text("Delete")');
      await page.waitForSelector('[role="dialog"] >> text=/Delete purchase\\?/i');
      await page.locator('[role="dialog"] button:has-text("Delete")').last().click();
      await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });

      // Delete the supplier
      await page.goto(`${BASE}/suppliers`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('h1:has-text("Suppliers")');
      const supplierRow = page.locator(`tbody tr:has-text("${supplierName}")`);
      const supplierExists = await supplierRow.count();
      if (supplierExists > 0) {
        await supplierRow.hover();
        await supplierRow.locator('button[aria-label="Delete supplier"]').click({ force: true });
        await page.waitForSelector('text=/Delete\\?/i');
        await page.locator('button:has-text("Delete")').last().click();
        await page.waitForTimeout(800);
      }
    });

    await page.waitForTimeout(1500);
  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();

    console.log("\n\n========== PHASE 4 WALKTHROUGH SUMMARY ==========");
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
    console.log("=================================================\n");
  }
})();

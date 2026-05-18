// Phase 3.1 product-owner walkthrough — EDGE CASES.
//
// Exercises three specific scenarios called out post-walkthrough:
//   1. Discount exceeds qty × rate → live total goes negative & red, server
//      rejects with errors.discount = ["Discount cannot exceed line total"].
//   2. Clearing a linked customer via × button — chip disappears, input
//      reappears, customerId becomes null, partyName cleared.
//   3. Detail-modal chip indicator — link icon visible only for FK-linked
//      sales, absent for walk-ins.
//
// Run with:  node scripts/walkthrough-sales-edge.mjs
//
// Prereq: dev server on http://localhost:3001 with the new Sale model
// loaded (i.e., AFTER the .next/ nuke + restart that fixed the main run).

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-edge-out");
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
    await fn();
    console.log(`  PASS`);
    await page.screenshot({
      path: join(OUT_DIR, `${results.length.toString().padStart(2, "0")}-${safeName}.png`),
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

async function openAddSaleModal(page) {
  await page.click('button:has-text("Add sale")');
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
}

async function deleteRowByPartyName(page, partyName) {
  const rowSelector = `tbody tr:has-text("${partyName}")`;
  const rowCount = await page.locator(rowSelector).count();
  if (rowCount === 0) return; // already gone
  await page.click(rowSelector);
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
  // Click Delete in footer → inline confirm → confirm Delete
  await page.click('[role="dialog"] button:has-text("Delete")');
  await page.waitForSelector('[role="dialog"] >> text=/Delete sale\\?/i');
  await page.locator('[role="dialog"] button:has-text("Delete")').last().click();
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });
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
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
        timeout: 30000,
      }),
      page.click('button[type="submit"]'),
    ]);
    await page.goto(`${BASE}/sales`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('h1:has-text("Sales")');

    // ===========================================================
    // EDGE CASE 1: Discount exceeds line total
    // ===========================================================
    await step(page, "E1. Discount exceeds total — form red + server reject", async () => {
      await openAddSaleModal(page);
      await page.fill("#sales-party-name", "Edge1 Bad Discount");
      await page.waitForSelector('text=/Use as walk-in:/i');
      await page.click('button:has-text("Use as walk-in:")');
      await page.fill("#sale-item", "Discount overflow test");
      await page.fill("#sale-qty", "2");
      await page.fill("#sale-rate", "100");
      await page.fill("#sale-discount", "500");

      // Live total should be 2 * 100 - 500 = -300 paise rendering as -₹3.00
      // Wait, no — those are RUPEE inputs, total paise = (2 * 100 * 100) - (500 * 100) = -30000 paise = -₹300
      // formatCurrency renders Indian "en-IN" currency style — negative values
      // typically format as "-₹300.00" or "(₹300.00)" depending on Intl impl.
      await page.waitForFunction(
        () => {
          const els = Array.from(document.querySelectorAll("span, div, p"));
          return els.some((el) =>
            /-\s*₹\s*300\.00|₹\s*-\s*300\.00|\(₹\s*300\.00\)/.test(
              el.textContent || "",
            ),
          );
        },
        null,
        { timeout: 3000 },
      );

      // Verify the hint text appears
      await page.waitForSelector('text=/Discount exceeds line total/i', {
        timeout: 2000,
      });

      // Verify the negative total is styled with the error color.
      // The live-total span gets `text-error` class when negative.
      const negativeStyled = await page.evaluate(() => {
        const errorEls = Array.from(document.querySelectorAll(".text-error"));
        return errorEls.some((el) =>
          /-?\s*₹\s*-?\s*300\.00|\(₹\s*300\.00\)/.test(el.textContent || ""),
        );
      });
      if (!negativeStyled) {
        // Soft-check — Intl format may not match exactly. Confirm at least
        // SOME element shows text-error class with "Discount exceeds"
        const hintIsError = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll(".text-error"));
          return els.some((el) =>
            /Discount exceeds line total/i.test(el.textContent || ""),
          );
        });
        if (!hintIsError) {
          throw new Error("Neither the negative total nor the hint are styled with text-error");
        }
      }

      // Now try to save → server should reject with action-level error
      await page.click('button[type="submit"]:has-text("Save")');

      // Wait for the server's error message to surface beneath the discount field.
      await page.waitForSelector('text=/Discount cannot exceed line total/i', {
        timeout: 8000,
      });

      // Modal should still be open (save failed, not dismissed)
      const dialogStillOpen = await page.locator('[role="dialog"]').isVisible();
      if (!dialogStillOpen) throw new Error("Modal closed despite server reject");

      await closeAnyOpenDialog(page);
    });

    // ===========================================================
    // EDGE CASE 2: Clear a linked customer via the × chip button
    // ===========================================================
    await step(page, "E2. Clear linked customer — chip × returns to typing mode", async () => {
      await openAddSaleModal(page);

      // Type to surface a matching customer
      await page.fill("#sales-party-name", "a");
      await page.waitForSelector('text=/Use as walk-in:/i');

      const customerMatchCount = await page
        .locator('[role="dialog"] .absolute button:not(:has-text("Use as walk-in:"))')
        .count();
      if (customerMatchCount === 0) {
        throw new Error(
          "No existing customers matched 'a' — cannot test chip clear. Add a customer to your DB first.",
        );
      }
      // Click first customer match → chip appears
      await page
        .locator('[role="dialog"] .absolute button:not(:has-text("Use as walk-in:"))')
        .first()
        .click();
      await page.waitForSelector('button[aria-label="Clear linked customer"]');

      // Sanity: while linked, the party-name input is gone (chip replaces it)
      const inputWhileLinkedCount = await page.locator("#sales-party-name").count();
      if (inputWhileLinkedCount !== 0) {
        throw new Error("Input still present while customer linked (chip should replace it)");
      }

      // Click × on the chip
      await page.click('button[aria-label="Clear linked customer"]');

      // After click: input reappears, chip gone
      await page.waitForSelector("#sales-party-name", { timeout: 3000 });
      const chipStillCount = await page
        .locator('button[aria-label="Clear linked customer"]')
        .count();
      if (chipStillCount !== 0) {
        throw new Error("Chip did not disappear after clicking ×");
      }

      // partyName should be empty
      const partyName = await page.locator("#sales-party-name").inputValue();
      if (partyName !== "") {
        throw new Error(`Expected empty partyName after clear, got "${partyName}"`);
      }

      // partyPhone should also be empty
      const partyPhone = await page.locator("#sales-party-phone").inputValue();
      if (partyPhone !== "") {
        throw new Error(`Expected empty partyPhone after clear, got "${partyPhone}"`);
      }

      await closeAnyOpenDialog(page);
    });

    // ===========================================================
    // EDGE CASE 3a: Walk-in sale → detail modal shows NO link icon
    // ===========================================================
    await step(page, "E3a. Walk-in detail modal — no link icon", async () => {
      await openAddSaleModal(page);
      await page.fill("#sales-party-name", "Edge3Walkin");
      await page.waitForSelector('text=/Use as walk-in:/i');
      await page.click('button:has-text("Use as walk-in:")');
      await page.fill("#sale-item", "Walk-in detail test");
      await page.fill("#sale-qty", "1");
      await page.fill("#sale-rate", "100");
      await page.fill("#sale-discount", "0");
      await page.click('button[type="submit"]:has-text("Save")');
      await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });

      // Open the row's detail modal
      await page.click('tbody tr:has-text("Edge3Walkin")');
      await page.locator('[role="dialog"]').waitFor({ state: "visible" });

      // The link icon has aria-label="Linked customer" — scope to dialog title.
      const linkIconInDialog = await page
        .locator('[role="dialog"]')
        .locator('svg[aria-label="Linked customer"]')
        .count();
      if (linkIconInDialog !== 0) {
        throw new Error(
          `Walk-in detail shows ${linkIconInDialog} link icon(s); expected 0`,
        );
      }
    });

    // ===========================================================
    // EDGE CASE 3b: Linked-customer sale → detail modal SHOWS link icon
    // ===========================================================
    let linkedSaleParty = null;
    await step(page, "E3b. Linked-customer detail modal — link icon visible", async () => {
      // Close any open dialog from 3a
      await closeAnyOpenDialog(page);

      await openAddSaleModal(page);
      await page.fill("#sales-party-name", "a");
      await page.waitForSelector('text=/Use as walk-in:/i');
      const matchCount = await page
        .locator('[role="dialog"] .absolute button:not(:has-text("Use as walk-in:"))')
        .count();
      if (matchCount === 0) {
        throw new Error("No existing customers matched — can't create linked-customer sale");
      }
      await page
        .locator('[role="dialog"] .absolute button:not(:has-text("Use as walk-in:"))')
        .first()
        .click();
      await page.waitForSelector('button[aria-label="Clear linked customer"]');

      // Capture the linked customer's name from the chip
      linkedSaleParty = await page
        .locator('[role="dialog"] .bg-secondary-container .font-medium')
        .first()
        .textContent();
      if (!linkedSaleParty) throw new Error("Could not capture linked party name");
      linkedSaleParty = linkedSaleParty.trim();

      await page.fill("#sale-item", "Linked detail test");
      await page.fill("#sale-qty", "1");
      await page.fill("#sale-rate", "100");
      await page.fill("#sale-discount", "0");
      await page.click('button[type="submit"]:has-text("Save")');
      await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 10000 });

      // Open the row's detail modal (use partyName which mirrors customer.name)
      await page.click(`tbody tr:has-text("${linkedSaleParty}")`);
      await page.locator('[role="dialog"]').waitFor({ state: "visible" });

      const linkIconInDialog = await page
        .locator('[role="dialog"]')
        .locator('svg[aria-label="Linked customer"]')
        .count();
      if (linkIconInDialog < 1) {
        throw new Error(
          `Linked-customer detail shows 0 link icons; expected ≥1 (party=${linkedSaleParty})`,
        );
      }

      // Bonus: verify chip color class is on the icon (text-secondary)
      const hasSecondaryColor = await page
        .locator('[role="dialog"]')
        .locator('svg[aria-label="Linked customer"]')
        .first()
        .evaluate((el) => el.classList.contains("text-secondary"));
      if (!hasSecondaryColor) {
        console.log("    (note: link icon has aria-label but not text-secondary class — visual only)");
      }
    });

    // ---------- Cleanup ----------
    await step(page, "Cleanup test rows", async () => {
      await closeAnyOpenDialog(page);
      await deleteRowByPartyName(page, "Edge3Walkin");
      if (linkedSaleParty) {
        await deleteRowByPartyName(page, linkedSaleParty);
      }
    });

    await page.waitForTimeout(1500);
  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();

    console.log("\n\n========== EDGE CASES SUMMARY ==========");
    const passed = results.filter((r) => r.status === "PASS").length;
    const failed = results.filter((r) => r.status === "FAIL").length;
    console.log(`Steps: ${passed} passed, ${failed} failed of ${results.length} total`);
    for (const r of results) {
      console.log(`  [${r.status}] ${r.name}${r.error ? ` — ${r.error}` : ""}`);
    }

    // Filter noisy logs (Prisma query logs, fast refresh, React DevTools hint)
    const interestingConsole = consoleEntries.filter((e) => {
      if (e.type === "log" && /prisma:query|\[Fast Refresh\]/.test(e.text)) return false;
      if (e.type === "info" && /React DevTools/.test(e.text)) return false;
      return true;
    });
    console.log(
      `\n--- Browser console (${interestingConsole.length} interesting of ${consoleEntries.length} total) ---`,
    );
    const grouped = {};
    for (const e of interestingConsole) {
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
    console.log("========================================\n");
  }
})();

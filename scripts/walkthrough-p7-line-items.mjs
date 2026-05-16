// Phase 7 multi-item walkthrough — Playwright headed, against production.
// 12 steps covering the multi-item sale lifecycle + 7-step purchase mirror.
//
// Every row this script touches is tagged with partyName / itemDescription
// starting with __phase7walk_ so cleanup catches it via marker pattern
// instead of hand-tracking. Lesson from the Phase 6 → Phase 7 stray row.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p7-out");
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
  console.error("FAIL: missing SEED_ADMIN_EMAIL / PASSWORD / DIRECT_URL");
  process.exit(1);
}

const MARKER = "__phase7walk_";
const SALE_PARTY = `${MARKER}sale_party`;
const PURCHASE_PARTY = `${MARKER}purchase_party`;
const SALE_PHONE = "9876700001";
const PURCHASE_PHONE = "9876700002";
const ITEM_1 = `${MARKER}gold_plated_chains`;
const ITEM_2 = `${MARKER}silver_bracelets`;
const P_ITEM_1 = `${MARKER}raw_gold_wire`;
const P_ITEM_2 = `${MARKER}clasp_findings`;

const results = [];

async function step(page, name, fn) {
  const safeName = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
    console.log(`  PASS`);
    await page.screenshot({
      path: join(
        OUT_DIR,
        `${results.length.toString().padStart(2, "0")}-${safeName}.png`,
      ),
      fullPage: false,
    });
    results.push({ name, status: "PASS" });
  } catch (err) {
    console.log(`  FAIL: ${err.message}`);
    await page
      .screenshot({
        path: join(
          OUT_DIR,
          `FAIL-${results.length.toString().padStart(2, "0")}-${safeName}.png`,
        ),
        fullPage: true,
      })
      .catch(() => {});
    results.push({ name, status: "FAIL", error: err.message });
    throw err;
  }
}

async function cleanup() {
  console.log("\n=== Cleanup (marker-pattern match) ===");
  const c = new Client({ connectionString: DIRECT_URL });
  await c.connect();
  try {
    const r1 = await c.query(
      `DELETE FROM sale_line_items WHERE "saleId" IN (SELECT id FROM sales WHERE "partyName" LIKE $1)`,
      [`${MARKER}%`],
    );
    const r2 = await c.query(
      `DELETE FROM sale_payments WHERE "saleId" IN (SELECT id FROM sales WHERE "partyName" LIKE $1)`,
      [`${MARKER}%`],
    );
    const r3 = await c.query(
      `DELETE FROM sale_returns WHERE "saleId" IN (SELECT id FROM sales WHERE "partyName" LIKE $1)`,
      [`${MARKER}%`],
    );
    const r4 = await c.query(`DELETE FROM sales WHERE "partyName" LIKE $1`, [
      `${MARKER}%`,
    ]);
    const r5 = await c.query(
      `DELETE FROM purchase_line_items WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "partyName" LIKE $1)`,
      [`${MARKER}%`],
    );
    const r6 = await c.query(
      `DELETE FROM purchase_payments WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "partyName" LIKE $1)`,
      [`${MARKER}%`],
    );
    const r7 = await c.query(
      `DELETE FROM purchase_returns WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "partyName" LIKE $1)`,
      [`${MARKER}%`],
    );
    const r8 = await c.query(
      `DELETE FROM purchases WHERE "partyName" LIKE $1`,
      [`${MARKER}%`],
    );
    const r9 = await c.query(`DELETE FROM customers WHERE name LIKE $1`, [
      `${MARKER}%`,
    ]);
    const r10 = await c.query(`DELETE FROM suppliers WHERE name LIKE $1`, [
      `${MARKER}%`,
    ]);
    console.log(
      `  sale_line_items=${r1.rowCount} sale_payments=${r2.rowCount} sale_returns=${r3.rowCount} sales=${r4.rowCount}`,
    );
    console.log(
      `  purchase_line_items=${r5.rowCount} purchase_payments=${r6.rowCount} purchase_returns=${r7.rowCount} purchases=${r8.rowCount}`,
    );
    console.log(`  customers=${r9.rowCount} suppliers=${r10.rowCount}`);

    const remain = await c.query(`
      SELECT
        (SELECT count(*)::int FROM sales WHERE "partyName" LIKE $1) AS sales,
        (SELECT count(*)::int FROM sale_line_items WHERE "saleId" IN (SELECT id FROM sales WHERE "partyName" LIKE $1)) AS sale_lines,
        (SELECT count(*)::int FROM purchases WHERE "partyName" LIKE $1) AS purchases,
        (SELECT count(*)::int FROM customers WHERE name LIKE $1) AS customers,
        (SELECT count(*)::int FROM suppliers WHERE name LIKE $1) AS suppliers
    `, [`${MARKER}%`]);
    console.log("  post-cleanup leftover:", JSON.stringify(remain.rows[0]));
  } finally {
    await c.end();
  }
}

async function getLineCount(dialog) {
  return dialog.locator('[role="group"][aria-label^="Line "]').count();
}

async function fillLine(page, idx, { item, qty, rate }) {
  // Try sale-line first then purchase-line (one of the two will exist).
  const isSale = await page.locator(`#sale-line-${idx}-qty`).count();
  const prefix = isSale ? "sale-line" : "purchase-line";
  if (item !== undefined) {
    const desc = page.locator(`#${prefix}-${idx}-item`);
    await desc.click();
    await desc.fill(item);
  }
  if (qty !== undefined) {
    const qInput = page.locator(`#${prefix}-${idx}-qty`);
    await qInput.click();
    await qInput.fill("");
    await qInput.fill(String(qty));
  }
  if (rate !== undefined) {
    const rInput = page.locator(`#${prefix}-${idx}-rate`);
    await rInput.click();
    await rInput.fill("");
    await rInput.fill(String(rate));
    // Blur via Tab so the dialog isn't dismissed by an outside-click.
    await rInput.press("Tab");
  }
}

(async () => {
  let browser;
  let didCleanup = false;
  try {
    browser = await chromium.launch({ headless: true, slowMo: 50 });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Sign in.
    console.log("\n=== Sign in ===");
    await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
        timeout: 30000,
      }),
      page.click('button[type="submit"]'),
    ]);
    console.log("  signed in");

    // ------- Step 1: modal opens with one empty line row already present ---
    let createdSaleId = null;
    await step(page, "1. SALE modal opens with one empty line row", async () => {
      await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
      await page.click('button:has-text("Add sale")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      const count = await getLineCount(dialog);
      if (count !== 1) {
        throw new Error(`Expected 1 line row on open, got ${count}`);
      }
      // Subtotal + Final total in the footer should both be ₹0.00.
      const dialogText = (await dialog.textContent()) ?? "";
      if (!/Subtotal/.test(dialogText) || !/₹0\.00/.test(dialogText)) {
        throw new Error("Subtotal/₹0.00 not visible in dialog body");
      }
    });

    // ------- Step 2: Fill line 1 ------------------------------------------
    await step(page, "2. SALE fill line 1, line total updates to ₹2,500.00", async () => {
      // First fill the party fields.
      await page.fill("#party-name-input", SALE_PARTY);
      await page.waitForTimeout(300);
      // Click "Use as walk-in" to confirm walk-in mode.
      const walkin = page.locator(
        '[role="dialog"] button:has-text("Use as walk-in:")',
      );
      if (await walkin.count()) await walkin.first().click();
      await page.fill("#party-phone-input", SALE_PHONE);

      await fillLine(page, 0, { item: ITEM_1, qty: 10, rate: 250 });

      // The line total appears in the line row; the form's grand subtotal
      // updates simultaneously. We assert on the grand total text.
      const dialog = page.locator('[role="dialog"]');
      const text = (await dialog.textContent()) ?? "";
      // The "₹2,500.00" should appear at least twice (line total + subtotal).
      const occurrences = (text.match(/₹2,500\.00/g) ?? []).length;
      if (occurrences < 2) {
        throw new Error(
          `Expected ₹2,500.00 to appear ≥2 times, got ${occurrences}`,
        );
      }
    });

    // ------- Step 3: Click "+ Add line" -----------------------------------
    await step(page, "3. SALE + Add line creates row 2", async () => {
      await page.click('[role="dialog"] button:has-text("Add line")');
      await page.waitForTimeout(150);
      const dialog = page.locator('[role="dialog"]');
      const count = await getLineCount(dialog);
      if (count !== 2) throw new Error(`Expected 2 line rows, got ${count}`);
    });

    // ------- Step 4: Fill line 2 ------------------------------------------
    await step(page, "4. SALE fill line 2, subtotal → ₹4,500.00", async () => {
      await fillLine(page, 1, { item: ITEM_2, qty: 5, rate: 400 });
      const text = (await page.locator('[role="dialog"]').textContent()) ?? "";
      if (!text.includes("₹4,500.00")) {
        throw new Error("Subtotal ₹4,500.00 not in dialog text");
      }
    });

    // ------- Step 5: Discount 500 → final total ₹4,000.00 -----------------
    await step(page, "5. SALE discount 500 → final total ₹4,000.00", async () => {
      const disc = page.locator("#sale-discount");
      await disc.click();
      await disc.fill("");
      await disc.fill("500");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(150);
      const text = (await page.locator('[role="dialog"]').textContent()) ?? "";
      if (!text.includes("₹4,000.00")) {
        throw new Error("Final total ₹4,000.00 not in dialog text");
      }
    });

    // ------- Step 6: Save → table shows summary + total --------------------
    await step(page, "6. SALE save → table shows summary + ₹4,000.00", async () => {
      const dialog = page.locator('[role="dialog"]');
      await page.click('[role="dialog"] button[type="submit"]');
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      await page.reload({ waitUntil: "networkidle" });

      // Row exists with summary
      const row = page.locator(`tr:has-text("${SALE_PARTY}")`).first();
      await row.waitFor({ timeout: 10000 });
      const rowText = (await row.textContent()) ?? "";
      if (!rowText.includes("+ 1 more")) {
        throw new Error(`Row missing "+ 1 more" summary: ${rowText}`);
      }
      if (!rowText.includes("4,000.00")) {
        throw new Error(`Row missing total 4,000.00: ${rowText}`);
      }
      // Capture the sale ID for later steps via the DB; safer than DOM digging.
      const c = new Client({ connectionString: DIRECT_URL });
      await c.connect();
      try {
        const r = await c.query(
          `SELECT id FROM sales WHERE "partyName" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
          [SALE_PARTY],
        );
        createdSaleId = r.rows[0]?.id ?? null;
        if (!createdSaleId) throw new Error("Couldn't read back created sale id");
      } finally {
        await c.end();
      }
    });

    // ------- Step 7: Detail modal shows both lines + totals --------------
    await step(page, "7. SALE detail modal — both lines + totals correct", async () => {
      const row = page.locator(`tr:has-text("${SALE_PARTY}")`).first();
      await row.click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      const t = (await dialog.textContent()) ?? "";
      const required = [
        ITEM_1,
        ITEM_2,
        "₹4,500.00",
        "₹500.00",
        "₹4,000.00",
      ];
      for (const r of required) {
        if (!t.includes(r)) throw new Error(`Detail missing "${r}"`);
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    });

    // ------- Step 8: Edit, change line 2 qty to 6, save → ₹4,400.00 -------
    await step(page, "8. SALE edit line 2 qty 5→6, save, total → ₹4,400.00", async () => {
      const row = page.locator(`tr:has-text("${SALE_PARTY}")`).first();
      await row.click();
      let dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      await dialog.locator('button:has-text("Edit")').click();
      await page.waitForTimeout(300);
      // Form modal should now be open; locate line 2 (idx=1) qty input
      const qty1 = page.locator("#sale-line-1-qty");
      await qty1.waitFor({ timeout: 5000 });
      await qty1.click();
      await qty1.fill("");
      await qty1.fill("6");
      await page.keyboard.press("Tab");

      await page.click('[role="dialog"] button[type="submit"]');
      // Wait for form modal hidden — note the detail modal may snap back
      // open via the live-updating-modal pattern, so we wait for the form's
      // dialog title disappearance instead of generic dialog state.
      await page.waitForTimeout(1000);
      await page.reload({ waitUntil: "networkidle" });

      // Verify via DB: line items now have qty 10 and 6, total = 10*250 + 6*400 - 500 = 2500 + 2400 - 500 = 4400
      const c = new Client({ connectionString: DIRECT_URL });
      await c.connect();
      try {
        const r = await c.query(
          `SELECT qty FROM sale_line_items WHERE "saleId" = $1 ORDER BY "createdAt" ASC`,
          [createdSaleId],
        );
        const qtys = r.rows.map((x) => x.qty).sort((a, b) => a - b);
        if (JSON.stringify(qtys) !== JSON.stringify([6, 10])) {
          throw new Error(
            `Expected line qtys [6,10] after edit, got ${JSON.stringify(qtys)}`,
          );
        }
        const t = await c.query(`SELECT total FROM sales WHERE id = $1`, [
          createdSaleId,
        ]);
        const totalPaise = BigInt(t.rows[0].total);
        if (totalPaise !== 440000n) {
          throw new Error(
            `Expected total 440000 paise, got ${totalPaise}`,
          );
        }
      } finally {
        await c.end();
      }
    });

    // ------- Step 9: Edit, remove line 2, save → total ₹2,000.00 ---------
    await step(page, "9. SALE edit, remove line 2, save → ₹2,000.00", async () => {
      const row = page.locator(`tr:has-text("${SALE_PARTY}")`).first();
      await row.click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      await dialog.locator('button:has-text("Edit")').click();
      await page.waitForTimeout(300);

      // Remove line 2 via its × (aria-label="Remove line 2")
      await page.click('button[aria-label="Remove line 2"]');
      await page.waitForTimeout(150);

      // Confirm only line 1 remains in the form
      const formDialog = page.locator('[role="dialog"]');
      const count = await getLineCount(formDialog);
      if (count !== 1) throw new Error(`Expected 1 line after remove, got ${count}`);

      await page.click('[role="dialog"] button[type="submit"]');
      await page.waitForTimeout(1000);
      await page.reload({ waitUntil: "networkidle" });

      // DB verify: 1 line, total = 10*250 - 500 = 2000
      const c = new Client({ connectionString: DIRECT_URL });
      await c.connect();
      try {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM sale_line_items WHERE "saleId" = $1`,
          [createdSaleId],
        );
        if (r.rows[0].n !== 1) {
          throw new Error(`Expected 1 line item, got ${r.rows[0].n}`);
        }
        const t = await c.query(`SELECT total FROM sales WHERE id = $1`, [
          createdSaleId,
        ]);
        if (BigInt(t.rows[0].total) !== 200000n) {
          throw new Error(`Expected total 200000 paise, got ${t.rows[0].total}`);
        }
      } finally {
        await c.end();
      }
    });

    // ------- Step 10: × on last line is DISABLED -------------------------
    await step(page, "10. SALE × on last remaining line is disabled", async () => {
      const row = page.locator(`tr:has-text("${SALE_PARTY}")`).first();
      await row.click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });
      await dialog.locator('button:has-text("Edit")').click();
      await page.waitForTimeout(300);

      const removeBtn = page.locator('button[aria-label="Remove line 1"]');
      await removeBtn.waitFor({ timeout: 5000 });
      const isDisabled = await removeBtn.isDisabled();
      if (!isDisabled) {
        throw new Error("× button on the sole line should be disabled but isn't");
      }
      // Cancel out — don't save
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    });

    // ------- Step 11: Empty itemDescription on save → inline error -------
    await step(page, "11. SALE empty itemDescription → inline error, sale not saved", async () => {
      await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
      await page.click('button:has-text("Add sale")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });

      // Fill party fields so they don't shadow the line error.
      await page.fill("#party-name-input", `${MARKER}empty_item_test`);
      await page.waitForTimeout(300);
      const walkin = page.locator(
        '[role="dialog"] button:has-text("Use as walk-in:")',
      );
      if (await walkin.count()) await walkin.first().click();

      // Leave the itemDescription empty, but fill qty + rate.
      await page.locator("#sale-line-0-qty").fill("1");
      await page.locator("#sale-line-0-rate").fill("100");

      await page.click('[role="dialog"] button[type="submit"]');
      await page.waitForTimeout(500);

      // Dialog should still be open
      const stillOpen = await dialog.isVisible();
      if (!stillOpen) {
        throw new Error("Dialog closed despite invalid itemDescription");
      }

      // Inline error under the line
      const errorText = await dialog
        .locator('[role="group"][aria-label="Line 1"]')
        .textContent();
      if (
        !errorText ||
        !/required/i.test(errorText)
      ) {
        throw new Error(`No "required" error visible on line 1: ${errorText}`);
      }

      // DB verify: nothing saved with this marker
      const c = new Client({ connectionString: DIRECT_URL });
      await c.connect();
      try {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM sales WHERE "partyName" = $1`,
          [`${MARKER}empty_item_test`],
        );
        if (r.rows[0].n !== 0) {
          throw new Error(`Sale was saved despite validation error`);
        }
      } finally {
        await c.end();
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    });

    // ------- Step 12: Mirror 1-7 on purchases -----------------------------
    await step(page, "12. PURCHASE mirror — create multi-item, verify table + detail", async () => {
      await page.goto(`${BASE}/purchases`, { waitUntil: "networkidle" });
      await page.click('button:has-text("Add purchase")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.waitFor({ state: "visible" });

      // 1. Modal opens with one line row
      let cnt = await getLineCount(dialog);
      if (cnt !== 1) throw new Error(`Expected 1 line on purchase open, got ${cnt}`);

      // Party fields
      await page.fill("#party-name-input", PURCHASE_PARTY);
      await page.waitForTimeout(300);
      const walkin = page.locator(
        '[role="dialog"] button:has-text("Use as walk-in:")',
      );
      if (await walkin.count()) await walkin.first().click();
      await page.fill("#party-phone-input", PURCHASE_PHONE);

      // 2-4. Fill line 1, add line 2, fill line 2
      await fillLine(page, 0, { item: P_ITEM_1, qty: 10, rate: 250 });
      await page.click('[role="dialog"] button:has-text("Add line")');
      await page.waitForTimeout(200);
      await fillLine(page, 1, { item: P_ITEM_2, qty: 5, rate: 400 });

      // 5. Discount 500 → 4000
      const disc = page.locator("#purchase-discount");
      await disc.click();
      await disc.fill("");
      await disc.fill("500");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(150);
      const dt = (await dialog.textContent()) ?? "";
      if (!dt.includes("₹4,000.00")) {
        throw new Error("Purchase final total ₹4,000.00 missing");
      }

      // 6. Save → table summary + total
      await page.click('[role="dialog"] button[type="submit"]');
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      await page.reload({ waitUntil: "networkidle" });

      const row = page.locator(`tr:has-text("${PURCHASE_PARTY}")`).first();
      await row.waitFor({ timeout: 10000 });
      const rowText = (await row.textContent()) ?? "";
      if (!rowText.includes("+ 1 more"))
        throw new Error(`Purchase row missing "+ 1 more": ${rowText}`);
      if (!rowText.includes("4,000.00"))
        throw new Error(`Purchase row missing 4,000.00: ${rowText}`);

      // 7. Detail modal
      await row.click();
      await dialog.waitFor({ state: "visible" });
      const detailText = (await dialog.textContent()) ?? "";
      for (const r of [P_ITEM_1, P_ITEM_2, "₹4,500.00", "₹500.00", "₹4,000.00"]) {
        if (!detailText.includes(r)) {
          throw new Error(`Purchase detail missing "${r}"`);
        }
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
    });

    console.log("\n=== Browser diagnostics ===");
    console.log(`  page errors: ${pageErrors.length}`);
    pageErrors.slice(0, 5).forEach((e) =>
      console.log(`    [pageerror] ${e.substring(0, 200)}`),
    );
  } catch (err) {
    console.error("\nFAILED early:", err.message);
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
      console.log(
        `  ${r.status === "PASS" ? "PASS" : "FAIL"}  ${r.name}${r.error ? " — " + r.error : ""}`,
      ),
    );
    if (!didCleanup) {
      console.log(
        `\n  cleanup did not complete — check for orphan rows with WHERE partyName LIKE '${MARKER}%'`,
      );
    }
    process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
  }
})();

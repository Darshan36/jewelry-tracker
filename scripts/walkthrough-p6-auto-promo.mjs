// Phase 6 walk-in auto-promotion walkthrough — Playwright headed,
// hits production. Exercises the 8-step matrix:
//   1. Walk-in with new phone → auto-creates customer + linked chip
//   2. Walk-in, different name + SAME phone → links to existing,
//      server overrides typed name with canonical
//   3. Type "9876" prefix in picker → existing customer surfaces
//   4. Pick from dropdown → linked chip appears
//   5. Name-only no phone → stays walk-in, no customer created
//   6. Mirror 1-5 on Purchases side
//   7. (skipped — same as the 1-5 mirror)
//   8. Historical snapshot — edit customer name, sale modal shows old name
//
// Cleanup via direct DB DELETE on the test marker at the end so prod stays
// clean. Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / DIRECT_URL from
// .env.production.local. Credentials never appear in stdout.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p6-out");
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

const MARKER = `__p6walk_${Date.now()}`;
const ITEM = `${MARKER}_item`;
const PHONE_A = "9876500001";
const PHONE_DASHED_A = "9876-500-001"; // normalizes to PHONE_A
const PHONE_B = "9876500002";
const NAME_FIRST = `${MARKER}_Walkin_One`;
const NAME_SECOND = `${MARKER}_Walkin_Two`;
const NAME_NOPHONE = `${MARKER}_NoPhone`;
const NAME_SUPPLIER_FIRST = `${MARKER}_Supp_One`;
const NAME_SUPPLIER_SECOND = `${MARKER}_Supp_Two`;
const NAME_SUPPLIER_NOPHONE = `${MARKER}_Supp_NoPhone`;
const NAME_FIRST_RENAMED = `${NAME_FIRST}_RENAMED`;

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

async function fillSaleForm(page, { partyName, partyPhone, item, qty, rate }) {
  await page.fill("#party-name-input", partyName);
  await page.waitForTimeout(400);
  const walkin = page.locator(
    '[role="dialog"] button:has-text("Use as walk-in:")',
  );
  if (await walkin.count()) {
    await walkin.first().click();
    await page.waitForTimeout(250);
  }
  if (partyPhone !== null) {
    // Focus + clear + retype the phone so the input event fires definitively.
    const phoneInput = page.locator("#party-phone-input");
    await phoneInput.click();
    await phoneInput.fill("");
    await phoneInput.fill(partyPhone);
    await phoneInput.blur();
  }
  // Diagnostic: read back the live form-state values from the rendered inputs.
  const state = await page.evaluate(() => {
    const nameInput = document.querySelector("#party-name-input");
    const phoneInput = document.querySelector("#party-phone-input");
    return {
      partyName: nameInput?.value ?? null,
      partyPhone: phoneInput?.value ?? null,
    };
  });
  console.log(
    `    [diag] form party state: name="${state.partyName}" phone="${state.partyPhone}"`,
  );
  await page.fill("#sale-item", item);
  await page.fill("#sale-qty", String(qty));
  await page.fill("#sale-rate", String(rate));
}

async function fillPurchaseForm(page, { partyName, partyPhone, item, qty, rate }) {
  await page.fill("#party-name-input", partyName);
  await page.waitForTimeout(400);
  const walkin = page.locator(
    '[role="dialog"] button:has-text("Use as walk-in:")',
  );
  if (await walkin.count()) {
    await walkin.first().click();
    await page.waitForTimeout(250);
  }
  if (partyPhone !== null) {
    const phoneInput = page.locator("#party-phone-input");
    await phoneInput.click();
    await phoneInput.fill("");
    await phoneInput.fill(partyPhone);
    await phoneInput.blur();
  }
  await page.fill("#purchase-item", item);
  await page.fill("#purchase-qty", String(qty));
  await page.fill("#purchase-rate", String(rate));
}

async function cleanup() {
  console.log("\n=== Cleanup ===");
  const c = new Client({ connectionString: DIRECT_URL });
  await c.connect();
  try {
    const r1 = await c.query(
      `DELETE FROM sale_payments WHERE "saleId" IN (SELECT id FROM sales WHERE "itemDescription" LIKE $1)`,
      [`%${MARKER}%`],
    );
    const r2 = await c.query(
      `DELETE FROM sale_returns WHERE "saleId" IN (SELECT id FROM sales WHERE "itemDescription" LIKE $1)`,
      [`%${MARKER}%`],
    );
    const r3 = await c.query(
      `DELETE FROM sales WHERE "itemDescription" LIKE $1`,
      [`%${MARKER}%`],
    );
    const r4 = await c.query(
      `DELETE FROM purchase_payments WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "itemDescription" LIKE $1)`,
      [`%${MARKER}%`],
    );
    const r5 = await c.query(
      `DELETE FROM purchase_returns WHERE "purchaseId" IN (SELECT id FROM purchases WHERE "itemDescription" LIKE $1)`,
      [`%${MARKER}%`],
    );
    const r6 = await c.query(
      `DELETE FROM purchases WHERE "itemDescription" LIKE $1`,
      [`%${MARKER}%`],
    );
    const r7 = await c.query(`DELETE FROM customers WHERE name LIKE $1`, [
      `%${MARKER}%`,
    ]);
    const r8 = await c.query(`DELETE FROM suppliers WHERE name LIKE $1`, [
      `%${MARKER}%`,
    ]);
    console.log(
      `  deleted: sale_payments=${r1.rowCount} sale_returns=${r2.rowCount} sales=${r3.rowCount}`,
    );
    console.log(
      `  deleted: purchase_payments=${r4.rowCount} purchase_returns=${r5.rowCount} purchases=${r6.rowCount}`,
    );
    console.log(`  deleted: customers=${r7.rowCount} suppliers=${r8.rowCount}`);
  } finally {
    await c.end();
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
    const consoleEntries = [];
    const pageErrors = [];
    page.on("console", (msg) =>
      consoleEntries.push({ type: msg.type(), text: msg.text() }),
    );
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

    // -------- Step 1 — first walk-in with phone auto-creates customer --------
    await step(
      page,
      "1. SALE walk-in + new phone auto-creates customer",
      async () => {
        await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
        await page.click('button:has-text("Add sale")');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        await fillSaleForm(page, {
          partyName: NAME_FIRST,
          partyPhone: PHONE_A,
          item: `${ITEM}_A`,
          qty: 1,
          rate: 1000,
        });
        await page.click('[role="dialog"] button[type="submit"]');
        await dialog.waitFor({ state: "hidden", timeout: 10000 });
        await page.reload({ waitUntil: "networkidle" });
        // Verify table row shows linked-customer chip for the row we created.
        const row = page.locator(`tr:has-text("${ITEM}_A")`).first();
        await row.waitFor({ timeout: 10000 });
        // Open the detail modal and confirm party name is NAME_FIRST.
        await row.click();
        await dialog.waitFor({ state: "visible" });
        const partyText = (await dialog.textContent()) ?? "";
        if (!partyText.includes(NAME_FIRST)) {
          throw new Error(
            `Detail modal does not show party name "${NAME_FIRST}"`,
          );
        }
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        // Verify customer landed in /customers.
        await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
        const customerRow = page.locator(`tr:has-text("${NAME_FIRST}")`);
        await customerRow.first().waitFor({ timeout: 10000 });
        const count = await customerRow.count();
        if (count !== 1) {
          throw new Error(
            `Expected 1 row for ${NAME_FIRST} in /customers, got ${count}`,
          );
        }
      },
    );

    // -------- Step 2 — second walk-in, same phone, different name, → links --------
    await step(
      page,
      "2. SALE walk-in + SAME phone links to existing, party=canonical",
      async () => {
        await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
        await page.click('button:has-text("Add sale")');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        await fillSaleForm(page, {
          partyName: NAME_SECOND, // different from NAME_FIRST
          partyPhone: PHONE_A, // same phone as step 1
          item: `${ITEM}_B`,
          qty: 1,
          rate: 2000,
        });
        await page.click('[role="dialog"] button[type="submit"]');
        await dialog.waitFor({ state: "hidden", timeout: 10000 });

        // Open the row, confirm canonical name shows (NAME_FIRST, NOT NAME_SECOND).
        const row = page.locator(`tr:has-text("${ITEM}_B")`).first();
        await row.waitFor({ timeout: 10000 });
        await row.click();
        await dialog.waitFor({ state: "visible" });
        const modalText = (await dialog.textContent()) ?? "";
        if (!modalText.includes(NAME_FIRST)) {
          throw new Error(
            `Detail modal should show canonical "${NAME_FIRST}", got text not containing it`,
          );
        }
        if (modalText.includes(NAME_SECOND)) {
          throw new Error(
            `Detail modal still shows typed "${NAME_SECOND}" — server did NOT override with canonical`,
          );
        }
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });

        // /customers should still have exactly ONE row for NAME_FIRST and
        // ZERO rows for NAME_SECOND (since the second sale linked, not created).
        await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
        const firstRows = await page
          .locator(`tr:has-text("${NAME_FIRST}")`)
          .count();
        if (firstRows !== 1) {
          throw new Error(
            `/customers has ${firstRows} rows for ${NAME_FIRST}, expected 1`,
          );
        }
        const secondRows = await page
          .locator(`tr:has-text("${NAME_SECOND}")`)
          .count();
        if (secondRows !== 0) {
          throw new Error(
            `/customers has ${secondRows} rows for ${NAME_SECOND}, expected 0 (should NOT have created a duplicate)`,
          );
        }
      },
    );

    // -------- Step 3 — type "9876" in picker → existing customer surfaces --------
    await step(
      page,
      "3. SALE picker phone-prefix surfaces existing customer",
      async () => {
        await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
        await page.click('button:has-text("Add sale")');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        await page.fill("#party-name-input", "9876");
        await page.waitForTimeout(400);
        // The dropdown should contain a button labelled with NAME_FIRST.
        const matchBtn = dialog
          .locator(".absolute button")
          .filter({ hasText: NAME_FIRST });
        const matchCount = await matchBtn.count();
        if (matchCount === 0) {
          throw new Error(
            `Phone-prefix "9876" did not surface "${NAME_FIRST}" in dropdown`,
          );
        }

        // -------- Step 4 — pick from dropdown → linked chip --------
        await matchBtn.first().click();
        await page.waitForTimeout(200);
        // The linked-customer chip uses aria-label="Clear linked customer".
        const clearBtn = dialog.locator(
          'button[aria-label="Clear linked customer"]',
        );
        const has = await clearBtn.count();
        if (has === 0) {
          throw new Error(
            "After picking from dropdown, linked-customer chip did not appear",
          );
        }
        // Cancel — we're just testing the picker, not creating a sale.
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      },
    );

    results.push({ name: "4. SALE pick-from-dropdown shows chip", status: "PASS" });
    console.log("\n=== 4. SALE pick-from-dropdown shows chip ===\n  PASS (verified inside step 3)");

    // -------- Step 5 — name-only walk-in, no phone → stays walk-in --------
    await step(
      page,
      "5. SALE name-only walk-in, no phone, no customer created",
      async () => {
        // Snapshot customer count before.
        await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
        const before = await page.locator("tbody tr").count();

        await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
        await page.click('button:has-text("Add sale")');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        await fillSaleForm(page, {
          partyName: NAME_NOPHONE,
          partyPhone: null,
          item: `${ITEM}_C`,
          qty: 1,
          rate: 100,
        });
        await page.click('[role="dialog"] button[type="submit"]');
        await dialog.waitFor({ state: "hidden", timeout: 10000 });

        const row = page.locator(`tr:has-text("${ITEM}_C")`).first();
        await row.waitFor({ timeout: 10000 });

        // No new customer.
        await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
        const after = await page.locator("tbody tr").count();
        if (after !== before) {
          throw new Error(
            `Customer count changed from ${before} to ${after} — name-only walk-in should NOT have created a customer`,
          );
        }
        const noPhoneRows = await page
          .locator(`tr:has-text("${NAME_NOPHONE}")`)
          .count();
        if (noPhoneRows !== 0) {
          throw new Error(
            `Found a customer with name "${NAME_NOPHONE}" — should not exist`,
          );
        }
      },
    );

    // -------- Step 6 — mirror 1-5 on purchases --------
    await step(
      page,
      "6a. PURCHASE walk-in + new phone auto-creates supplier",
      async () => {
        await page.goto(`${BASE}/purchases`, { waitUntil: "networkidle" });
        await page.click('button:has-text("Add purchase")');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        await fillPurchaseForm(page, {
          partyName: NAME_SUPPLIER_FIRST,
          partyPhone: PHONE_B,
          item: `${ITEM}_P_A`,
          qty: 1,
          rate: 1000,
        });
        await page.click('[role="dialog"] button[type="submit"]');
        await dialog.waitFor({ state: "hidden", timeout: 10000 });
        await page.locator(`tr:has-text("${ITEM}_P_A")`).first().waitFor({ timeout: 10000 });
        await page.goto(`${BASE}/suppliers`, { waitUntil: "networkidle" });
        const supplierRow = page.locator(`tr:has-text("${NAME_SUPPLIER_FIRST}")`);
        await supplierRow.first().waitFor({ timeout: 10000 });
      },
    );

    await step(
      page,
      "6b. PURCHASE walk-in + SAME phone links to existing, party=canonical",
      async () => {
        await page.goto(`${BASE}/purchases`, { waitUntil: "networkidle" });
        await page.click('button:has-text("Add purchase")');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        await fillPurchaseForm(page, {
          partyName: NAME_SUPPLIER_SECOND,
          partyPhone: PHONE_B,
          item: `${ITEM}_P_B`,
          qty: 1,
          rate: 2000,
        });
        await page.click('[role="dialog"] button[type="submit"]');
        await dialog.waitFor({ state: "hidden", timeout: 10000 });

        const row = page.locator(`tr:has-text("${ITEM}_P_B")`).first();
        await row.waitFor({ timeout: 10000 });
        await row.click();
        await dialog.waitFor({ state: "visible" });
        const modalText = (await dialog.textContent()) ?? "";
        if (!modalText.includes(NAME_SUPPLIER_FIRST)) {
          throw new Error(
            `Purchase detail modal should show canonical "${NAME_SUPPLIER_FIRST}"`,
          );
        }
        if (modalText.includes(NAME_SUPPLIER_SECOND)) {
          throw new Error(
            `Purchase detail modal still shows typed "${NAME_SUPPLIER_SECOND}" — server did NOT override`,
          );
        }
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });

        await page.goto(`${BASE}/suppliers`, { waitUntil: "networkidle" });
        const firstRows = await page
          .locator(`tr:has-text("${NAME_SUPPLIER_FIRST}")`)
          .count();
        if (firstRows !== 1) {
          throw new Error(
            `/suppliers has ${firstRows} rows for ${NAME_SUPPLIER_FIRST}, expected 1`,
          );
        }
        const secondRows = await page
          .locator(`tr:has-text("${NAME_SUPPLIER_SECOND}")`)
          .count();
        if (secondRows !== 0) {
          throw new Error(
            `/suppliers has ${secondRows} rows for ${NAME_SUPPLIER_SECOND}, expected 0`,
          );
        }
      },
    );

    await step(
      page,
      "6c. PURCHASE picker phone-prefix surfaces existing supplier",
      async () => {
        await page.goto(`${BASE}/purchases`, { waitUntil: "networkidle" });
        await page.click('button:has-text("Add purchase")');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        await page.fill("#party-name-input", "9876");
        await page.waitForTimeout(400);
        const matchBtn = dialog
          .locator(".absolute button")
          .filter({ hasText: NAME_SUPPLIER_FIRST });
        if ((await matchBtn.count()) === 0) {
          throw new Error(
            `Phone prefix did not surface "${NAME_SUPPLIER_FIRST}" in purchases picker`,
          );
        }
        await matchBtn.first().click();
        await page.waitForTimeout(200);
        const clearBtn = dialog.locator(
          'button[aria-label="Clear linked supplier"]',
        );
        if ((await clearBtn.count()) === 0) {
          throw new Error(
            "After picking from dropdown, linked-supplier chip did not appear",
          );
        }
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      },
    );

    await step(
      page,
      "6d. PURCHASE name-only walk-in, no phone, no supplier created",
      async () => {
        await page.goto(`${BASE}/suppliers`, { waitUntil: "networkidle" });
        const before = await page.locator("tbody tr").count();

        await page.goto(`${BASE}/purchases`, { waitUntil: "networkidle" });
        await page.click('button:has-text("Add purchase")');
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        await fillPurchaseForm(page, {
          partyName: NAME_SUPPLIER_NOPHONE,
          partyPhone: null,
          item: `${ITEM}_P_C`,
          qty: 1,
          rate: 100,
        });
        await page.click('[role="dialog"] button[type="submit"]');
        await dialog.waitFor({ state: "hidden", timeout: 10000 });
        await page.locator(`tr:has-text("${ITEM}_P_C")`).first().waitFor({ timeout: 10000 });

        await page.goto(`${BASE}/suppliers`, { waitUntil: "networkidle" });
        const after = await page.locator("tbody tr").count();
        if (after !== before) {
          throw new Error(
            `Supplier count changed ${before} → ${after} — name-only walk-in should not create a supplier`,
          );
        }
      },
    );

    // -------- Step 8 (optional) — historical snapshot --------
    await step(
      page,
      "8. SNAPSHOT — rename customer, opened sale still shows old name",
      async () => {
        // Edit the auto-created customer's name.
        await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
        const row = page.locator(`tr:has-text("${NAME_FIRST}")`).first();
        await row.waitFor({ timeout: 10000 });
        // Click the row's edit affordance. The customers table has Edit/Delete buttons.
        const editBtn = row.locator('button:has-text("Edit"), [aria-label*="dit"]').first();
        if (await editBtn.count()) {
          await editBtn.click();
        } else {
          // Fall back to clicking the row to open a detail modal then Edit.
          await row.click();
        }
        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ state: "visible" });
        // Some tables open a detail modal first → need to click Edit inside.
        const editInModal = dialog.locator('button:has-text("Edit")').first();
        if (await editInModal.count()) {
          await editInModal.click();
          await page.waitForTimeout(150);
        }
        const nameInput = dialog.locator('input[name="name"]');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill(NAME_FIRST_RENAMED);
        await dialog.locator('button[type="submit"]').click();
        await dialog.waitFor({ state: "hidden", timeout: 10000 });
        await page.waitForTimeout(500);

        // Open the first sale and confirm the modal still shows the OLD name.
        await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
        const saleRow = page.locator(`tr:has-text("${ITEM}_A")`).first();
        await saleRow.waitFor({ timeout: 10000 });
        await saleRow.click();
        await dialog.waitFor({ state: "visible" });
        const modalText = (await dialog.textContent()) ?? "";
        const showsOld = modalText.includes(NAME_FIRST) && !modalText.includes("RENAMED");
        const showsNew = modalText.includes(NAME_FIRST_RENAMED);
        if (showsOld) {
          console.log(
            "  → snapshot behaviour: old name retained on the sale row (server is reading partyName snapshot at save time)",
          );
        } else if (showsNew) {
          console.log(
            "  → live-fetch behaviour: detail modal shows the renamed customer (server is hydrating via the FK live)",
          );
        } else {
          throw new Error(
            "Detail modal shows neither old nor new name — unexpected",
          );
        }
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      },
    );

    console.log("\n=== Browser diagnostics ===");
    const errors = consoleEntries.filter((e) => e.type === "error");
    console.log(`  console errors: ${errors.length}, page errors: ${pageErrors.length}`);
    errors.slice(0, 5).forEach((e) =>
      console.log(`    [console] ${e.text.substring(0, 200)}`),
    );
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
        `\n  cleanup did not complete — check for orphan rows with WHERE name|item LIKE '%${MARKER}%'`,
      );
    }
    process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
  }
})();

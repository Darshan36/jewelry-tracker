// Phase 9 casting + plating walkthrough — Playwright-driven against
// production. Covers all 15 steps from the Phase 9 plan, including the
// critical-check items called out explicitly:
//   Step 6  — Decimal × BigInt rounding (1.875 × ₹350/kg = ₹656.25)
//   Step 9  — kg displayed with 3 decimal places (2.500 not 2.5)
//   Step 10 — bill upload integration (entry → R2 → presigned URL)
//   Step 15 — CASTING_PLATING_MGMT dashboard with REAL data, not placeholder
//
// All walkthrough data is tagged with the marker prefix __phase9walk_
// (per the prompt's cleanup-pattern guidance). Vendor name + entry
// partyName both carry the marker so the post-walkthrough cleanup can
// scrub everything via a single LIKE filter.
//
// Credentials:
//   ADMIN ← .env.production.local (SEED_ADMIN_EMAIL / PASSWORD)
//   CASTING_PLATING_MGMT ← credentials.md (gitignored)
//
// Stdout never logs raw passwords. Test fixtures (PDF + PNG) generated
// into scripts/walkthrough-p9-out/.

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p9-out");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";
const MARKER = "__phase9walk_";

// ---------- env / cred loaders (mirrors walkthrough-p8-bills.mjs) ----------

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
const CASTING_MGMT = testCreds.CASTING_PLATING_MGMT;

// ---------- fixtures ----------

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0xb7, 0x49, 0x4f, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);
const PNG_PATH = join(OUT_DIR, "fixture.png");
writeFileSync(PNG_PATH, PNG_BYTES);

// ---------- runner state ----------

const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/auth/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

function putToR2(presignedUrl, file, contentType) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 PUT failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

// ---------- main ----------

const browser = await chromium.launch({ headless: true });
let createdVendorName = "";
let createdEntryFingerprint = "";

try {
  // ============ ADMIN session — steps 1-13 ============
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  admin.on("dialog", (d) => d.accept());

  await login(admin, ADMIN.email, ADMIN.password);

  // ===== Step 1 — Vendor master CRUD =====
  await admin.goto(`${BASE}/vendors`);
  await admin.waitForLoadState("networkidle");
  await admin.locator('button:has-text("Add vendor")').click();
  await admin.waitForSelector('[role="dialog"]');

  createdVendorName = `${MARKER}Mahesh Casting Works`;
  await admin.locator('#vendor-name').fill(createdVendorName);
  await admin.locator('#vendor-phone').fill("9876511001");
  await admin.locator('[role="dialog"] button:has-text("Save")').click();
  await admin.waitForFunction(
    (name) =>
      !document.querySelector('[role="dialog"]') &&
      Array.from(document.querySelectorAll("td")).some((td) =>
        td.textContent?.includes(name),
      ),
    createdVendorName,
    { timeout: 15_000 },
  );
  check("Step 1 — Vendor created in /vendors", true, createdVendorName);

  // ===== Step 2 — Edit vendor =====
  // Find the row and click the edit button (action cluster appears on hover;
  // Playwright's click handles hover-then-click automatically).
  const vendorRow = admin
    .locator("tr", { hasText: createdVendorName })
    .first();
  await vendorRow.hover();
  await vendorRow.locator('button[aria-label="Edit vendor"]').click();
  await admin.waitForSelector('[role="dialog"]');
  await admin.locator('#vendor-phone').fill("9876511002");
  await admin.locator('[role="dialog"] button:has-text("Save")').click();
  await admin.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 15_000 },
  );
  await admin.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("td")).some((td) =>
        td.textContent?.includes("9876511002"),
      ),
    null,
    { timeout: 15_000 },
  );
  check("Step 2 — Vendor phone updated", true, "9876511002");

  // ===== Step 3 — Empty casting list (relative to our marker) =====
  await admin.goto(`${BASE}/casting`);
  await admin.waitForLoadState("networkidle");
  await admin.locator('button:has-text("Add casting entry")').click();
  await admin.waitForSelector('[role="dialog"]');

  // ===== Step 4 — Pick the vendor =====
  // Type into the party-picker name input until the autocomplete row appears,
  // then click it.
  const partyInput = admin.locator('#casting-party-name');
  await partyInput.click();
  await partyInput.fill(createdVendorName.slice(MARKER.length, MARKER.length + 6));
  await admin.waitForSelector(
    `text="${createdVendorName}"`,
    { timeout: 5000 },
  );
  await admin.locator(`button:has-text("${createdVendorName}")`).first().click();
  check("Step 4 — Vendor picked, form open with line row", true);

  // ===== Step 5 — Fill line 1: Brass 2.5 kg × ₹400/kg =====
  await admin.locator('#casting-line-0-material').fill("Brass");
  await admin.locator('#casting-line-0-weight').fill("2.5");
  await admin.locator('#casting-line-0-rate').fill("400");
  // Tab off the rate so the live total updates.
  await admin.locator('#casting-line-0-rate').press("Tab");
  // Read the live line total cell (4th column on the line row).
  const line0Total = await admin
    .locator('div[role="group"][aria-label="Line 1"]')
    .locator(".tabular-nums")
    .last()
    .innerText();
  // Normalize: the rendered string is "₹1,000.00" (Indian comma grouping).
  // Accept either "₹1,000.00" or "₹1000.00" defensively.
  const line0Ok = /₹\s*1,?000\.00/.test(line0Total);
  check(
    "Step 5 — Line 1 (Brass 2.5×400) live total = ₹1,000.00",
    line0Ok,
    `got=${line0Total}`,
  );

  // ===== Step 6 — CRITICAL: 1.875 × ₹350/kg = ₹656.25 (Decimal arithmetic) =====
  await admin.locator('button:has-text("Add line")').click();
  await admin.locator('#casting-line-1-material').fill("Aluminium");
  await admin.locator('#casting-line-1-weight').fill("1.875");
  await admin.locator('#casting-line-1-rate').fill("350");
  await admin.locator('#casting-line-1-rate').press("Tab");
  const line1Total = await admin
    .locator('div[role="group"][aria-label="Line 2"]')
    .locator(".tabular-nums")
    .last()
    .innerText();
  const line1Ok = /₹\s*656\.25/.test(line1Total);
  check(
    "Step 6 — CRITICAL Decimal: 1.875 × ₹350 = ₹656.25",
    line1Ok,
    `got=${line1Total}`,
  );

  // ===== Step 7 — Discount ₹100 → Total ₹1,556.25 =====
  await admin.locator('#casting-discount').fill("100");
  await admin.locator('#casting-discount').press("Tab");
  const finalTotal = await admin
    .locator('span:has-text("Total")')
    .last()
    .evaluate((el) => {
      // The total amount lives in the next sibling span on the same row.
      const row = el.parentElement;
      return row?.querySelector("span:last-child")?.textContent ?? "";
    });
  const totalOk = /₹\s*1,?556\.25/.test(finalTotal);
  check(
    "Step 7 — Final total ₹1,556.25 (₹1,000 + ₹656.25 − ₹100)",
    totalOk,
    `got=${finalTotal}`,
  );

  // ===== Step 8 — Save without bill, row appears =====
  await admin
    .locator('[role="dialog"] button[type="submit"]:has-text("Save")')
    .click();
  await admin.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 30_000 },
  );
  await admin.waitForFunction(
    (vname) =>
      Array.from(document.querySelectorAll("td")).some((td) =>
        td.textContent?.includes(vname),
      ),
    createdVendorName,
    { timeout: 10_000 },
  );
  // Confirm the row has the expected material summary + total.
  const rowMatch = await admin
    .locator("tr", { hasText: createdVendorName })
    .first()
    .innerText();
  const step8RowOk =
    /Brass/.test(rowMatch) &&
    /\+ 1 more/.test(rowMatch) &&
    /1,?556\.25/.test(rowMatch);
  check(
    "Step 8 — Casting entry row visible with materials summary + ₹1,556.25",
    step8RowOk,
    rowMatch.replace(/\s+/g, " "),
  );

  // ===== Step 9 — CRITICAL: line items show 2.500 / 1.875 kg with 3 decimals =====
  // Click the row to open the detail modal.
  await admin
    .locator("tr", { hasText: createdVendorName })
    .first()
    .click();
  await admin.waitForSelector('[role="dialog"]');
  const detailBody = await admin.locator('[role="dialog"]').first().innerText();
  const has2500 = /2\.500\s*kg/.test(detailBody);
  const has1875 = /1\.875\s*kg/.test(detailBody);
  const hasRate400 = /₹400\.00\/kg/.test(detailBody);
  const hasRate350 = /₹350\.00\/kg/.test(detailBody);
  const hasLine1Total = /₹1,?000\.00/.test(detailBody);
  const hasLine2Total = /₹656\.25/.test(detailBody);
  const hasSubtotal = /₹1,?656\.25/.test(detailBody);
  const hasFinal = /₹1,?556\.25/.test(detailBody);
  check(
    "Step 9 — CRITICAL: weights 2.500/1.875 kg, rates ₹400/₹350 per kg, line totals + subtotal correct",
    has2500 &&
      has1875 &&
      hasRate400 &&
      hasRate350 &&
      hasLine1Total &&
      hasLine2Total &&
      hasSubtotal &&
      hasFinal,
    `2.500=${has2500} 1.875=${has1875} rate400=${hasRate400} rate350=${hasRate350}` +
      ` lt1=${hasLine1Total} lt2=${hasLine2Total} sub=${hasSubtotal} final=${hasFinal}`,
  );
  // Verify the "No bill uploaded" affordance is visible (no bill yet).
  const noBillSection = /No bill uploaded/.test(detailBody);
  check("Step 9b — Bill section shows 'No bill uploaded'", noBillSection);

  // Capture the entry's "fingerprint" — for later filtering. The detail
  // modal's title contains `Casting entry — <partyName>`. We use the
  // vendor name to find the row again.
  createdEntryFingerprint = createdVendorName;

  // ===== Step 10 — Edit, upload bill =====
  await admin.locator('[role="dialog"] button:has-text("Edit")').click();
  await admin.waitForSelector('[role="dialog"] form');
  // Wait for the file input to be present in the bill section.
  await admin.setInputFiles('[role="dialog"] input[type="file"]', PNG_PATH);
  // Save — this triggers the multi-stage flow: update entry → prepareUpload
  // → browser PUT → confirmUpload → attachBillToCastingEntry.
  await admin
    .locator('[role="dialog"] button[type="submit"]')
    .first()
    .click();
  await admin.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 60_000 },
  );

  // Re-open detail modal and verify the bill is now attached.
  await admin
    .locator("tr", { hasText: createdVendorName })
    .first()
    .click();
  await admin.waitForSelector('[role="dialog"]');
  const detailAfterBill = await admin
    .locator('[role="dialog"]')
    .first()
    .innerText();
  const hasFilename = /fixture\.png/.test(detailAfterBill);
  const hasViewButton = await admin
    .locator('[role="dialog"] button:has-text("View")')
    .count();
  check(
    "Step 10 — Bill uploaded & attached: filename visible + View button rendered",
    hasFilename && hasViewButton > 0,
    `filename=${hasFilename} viewBtns=${hasViewButton}`,
  );

  // ===== Step 11 — CRITICAL: click View → opens R2 presigned URL =====
  const [viewPage] = await Promise.all([
    adminCtx.waitForEvent("page", { timeout: 10_000 }),
    admin.locator('[role="dialog"] button:has-text("View")').click(),
  ]);
  await viewPage.waitForLoadState();
  const viewUrl = viewPage.url();
  const viewResp = await fetch(viewUrl);
  const viewCT = viewResp.headers.get("content-type") || "";
  check(
    "Step 11 — CRITICAL: View → presigned R2 URL returns 200 image/*",
    viewResp.status === 200 && viewCT.startsWith("image/"),
    `status=${viewResp.status} ct=${viewCT}`,
  );
  await viewPage.close();

  // ===== Step 12 — Add ₹1,000 payment → status PARTIAL =====
  await admin
    .locator('[role="dialog"] button:has-text("Record payment")')
    .click();
  await admin.locator('[role="dialog"] #cp-amount').waitFor({ timeout: 5000 });
  await admin.locator('[role="dialog"] #cp-amount').fill("1000");
  // Click the form-scoped submit button. Wait briefly to let React process
  // the RHF state update from .fill() before submitting.
  await admin.waitForTimeout(200);
  await admin
    .locator('[role="dialog"] form button[type="submit"]')
    .first()
    .click();
  // Wait directly for the status chip to flip to Partial. The intermediate
  // "form closed" check is racy on slow networks — go straight for the
  // post-state signal.
  try {
    await admin.waitForFunction(
      () => {
        const text = document.querySelector('[role="dialog"]')?.textContent ?? "";
        return /Partial/i.test(text);
      },
      null,
      { timeout: 20_000 },
    );
    check("Step 12 — After ₹1,000 payment: status flips to Partial", true);
  } catch (err) {
    // Capture diagnostics so we can see why the chip didn't flip.
    const shotPath = join(OUT_DIR, "step12-fail.png");
    await admin.screenshot({ path: shotPath, fullPage: true });
    const dialogText = await admin
      .locator('[role="dialog"]')
      .first()
      .innerText()
      .catch(() => "(no dialog visible)");
    const formStillThere = await admin
      .locator('[role="dialog"] #cp-amount')
      .count();
    check(
      "Step 12 — After ₹1,000 payment: status flips to Partial",
      false,
      `screenshot=${shotPath} formInputCount=${formStillThere} dialogText[0..200]="${dialogText.replace(/\s+/g, " ").slice(0, 200)}"`,
    );
    throw err;
  }

  // ===== Step 13 — Add ₹556.25 → status COMPLETED =====
  await admin
    .locator('[role="dialog"] button:has-text("Record payment")')
    .click();
  // The "Pay full balance" affordance writes the exact remaining balance.
  await admin
    .locator('[role="dialog"] button:has-text("Pay full balance")')
    .click();
  await admin
    .locator('[role="dialog"] form button[type="submit"]:has-text("Save")')
    .click();
  await admin.waitForFunction(
    () => {
      const text = document.querySelector('[role="dialog"]')?.textContent ?? "";
      return /Completed/i.test(text);
    },
    null,
    { timeout: 10_000 },
  );
  check("Step 13 — After full-balance payment: status flips to Completed", true);
  // Close the detail modal.
  await admin.keyboard.press("Escape");

  // ===== Step 14 — Plating mirror smoke test =====
  await admin.goto(`${BASE}/plating`);
  await admin.waitForLoadState("networkidle");
  await admin.locator('button:has-text("Add plating entry")').click();
  await admin.waitForSelector('[role="dialog"]');
  await admin
    .locator('#plating-party-name')
    .fill(createdVendorName.slice(MARKER.length, MARKER.length + 6));
  await admin.waitForSelector(`text="${createdVendorName}"`, { timeout: 5000 });
  await admin.locator(`button:has-text("${createdVendorName}")`).first().click();
  await admin.locator('#plating-line-0-material').fill("Brass plated");
  await admin.locator('#plating-line-0-weight').fill("1.000");
  await admin.locator('#plating-line-0-rate').fill("500");
  await admin.locator('#plating-line-0-rate').press("Tab");
  // No discount; final should be ₹500.00.
  await admin
    .locator('[role="dialog"] button[type="submit"]:has-text("Save")')
    .click();
  await admin.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    null,
    { timeout: 30_000 },
  );
  // Row visible with the right total.
  const platingRowMatch = await admin
    .locator("tr", { hasText: createdVendorName })
    .first()
    .innerText();
  const step14Ok =
    /Brass plated/.test(platingRowMatch) && /500\.00/.test(platingRowMatch);
  check(
    "Step 14 — Plating mirror: entry creates, line item + total render",
    step14Ok,
    platingRowMatch.replace(/\s+/g, " "),
  );

  await adminCtx.close();

  // ============ CASTING_PLATING_MGMT session — step 15 ============
  if (!CASTING_MGMT?.email || !CASTING_MGMT?.password) {
    check(
      "Step 15 — CASTING_PLATING_MGMT dashboard",
      false,
      "credentials.md missing CASTING_PLATING_MGMT row",
    );
  } else {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, CASTING_MGMT.email, CASTING_MGMT.password);
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState("networkidle");

    const dashboardText = await page.locator("body").innerText();
    const hasCastingCard =
      /Casting \(this month\)/i.test(dashboardText) &&
      /1\s*entries/i.test(dashboardText);
    const hasPlatingCard =
      /Plating \(this month\)/i.test(dashboardText) &&
      /1\s*entries/i.test(dashboardText);
    const hasOwedCard = /Total owed/i.test(dashboardText);
    const hasVendorCard =
      /Vendors/i.test(dashboardText);
    const hasPlaceholderCleared =
      !/Coming soon/i.test(dashboardText) && !/—\s*$/.test(dashboardText);

    check(
      "Step 15a — CASTING_PLATING_MGMT dashboard: 4 cards with real data",
      hasCastingCard && hasPlatingCard && hasOwedCard && hasVendorCard && hasPlaceholderCleared,
      `casting=${hasCastingCard} plating=${hasPlatingCard} owed=${hasOwedCard} vendor=${hasVendorCard} noPlaceholder=${hasPlaceholderCleared}`,
    );

    // Sidebar should show: Dashboard, Casting, Plating, Vendors (4 items
    // total for this role).
    const sidebarItems = await page
      .locator("aside nav ul li")
      .allInnerTexts();
    const visible = sidebarItems
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const expectedSet = new Set(["Dashboard", "Casting", "Plating", "Vendors"]);
    const sidebarOk =
      visible.every((label) => {
        // First word matches one of the expected labels (the sidebar may
        // render badges or icons; we match on the leading word).
        const first = label.split(/\s/)[0];
        return expectedSet.has(first);
      }) && visible.length === expectedSet.size;
    check(
      "Step 15b — Sidebar shows ONLY Dashboard, Casting, Plating, Vendors for this role",
      sidebarOk,
      `visible=${JSON.stringify(visible)}`,
    );

    // Forbidden route check — /sales should redirect to /dashboard.
    await page.goto(`${BASE}/sales`);
    await page.waitForLoadState("networkidle");
    const finalPath = new URL(page.url()).pathname;
    check(
      "Step 15c — /sales redirects to /dashboard for CASTING_PLATING_MGMT",
      finalPath === "/dashboard",
      `final=${finalPath}`,
    );

    // And /casting / /plating / /vendors should all load 200.
    for (const route of ["/casting", "/plating", "/vendors"]) {
      await page.goto(`${BASE}${route}`);
      await page.waitForLoadState("networkidle");
      const p = new URL(page.url()).pathname;
      check(
        `Step 15d — ${route} loads for CASTING_PLATING_MGMT`,
        p === route,
        `final=${p}`,
      );
    }

    await ctx.close();
  }
} finally {
  await browser.close();
}

// ---------- cleanup ----------

console.log("\nCleaning up walkthrough data via marker prefix...");
const client = new pg.Client({ connectionString: prodEnv.DIRECT_URL });
await client.connect();
try {
  await client.query("BEGIN");
  // Delete payments before entries before line items before parents (Cascade
  // handles children but we go top-down for clarity).
  const cp = await client.query(
    `DELETE FROM casting_payments WHERE "castingEntryId" IN
       (SELECT id FROM casting_entries WHERE "partyName" LIKE $1)`,
    [`${MARKER}%`],
  );
  const cli = await client.query(
    `DELETE FROM casting_line_items WHERE "castingEntryId" IN
       (SELECT id FROM casting_entries WHERE "partyName" LIKE $1)`,
    [`${MARKER}%`],
  );
  const ce = await client.query(
    `DELETE FROM casting_entries WHERE "partyName" LIKE $1`,
    [`${MARKER}%`],
  );
  const pp = await client.query(
    `DELETE FROM plating_payments WHERE "platingEntryId" IN
       (SELECT id FROM plating_entries WHERE "partyName" LIKE $1)`,
    [`${MARKER}%`],
  );
  const pli = await client.query(
    `DELETE FROM plating_line_items WHERE "platingEntryId" IN
       (SELECT id FROM plating_entries WHERE "partyName" LIKE $1)`,
    [`${MARKER}%`],
  );
  const pe = await client.query(
    `DELETE FROM plating_entries WHERE "partyName" LIKE $1`,
    [`${MARKER}%`],
  );
  // Bills attached to deleted entries — find by attachedToType + sweep any
  // marker-tagged uploads. (The entries' FK was set to bills.id; after the
  // entries are gone we can drop the bills.)
  const billRows = await client.query(
    `DELETE FROM bills WHERE "originalFilename" = 'fixture.png' AND "attachedToType" IN ('CASTING_ENTRY','PLATING_ENTRY') AND "attachedToId" IS NOT NULL`,
  );
  const v = await client.query(
    `DELETE FROM casting_plating_vendors WHERE name LIKE $1`,
    [`${MARKER}%`],
  );
  await client.query("COMMIT");
  console.log(
    `  casting_payments=${cp.rowCount} casting_line_items=${cli.rowCount} casting_entries=${ce.rowCount}`,
  );
  console.log(
    `  plating_payments=${pp.rowCount} plating_line_items=${pli.rowCount} plating_entries=${pe.rowCount}`,
  );
  console.log(`  bills=${billRows.rowCount} vendors=${v.rowCount}`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Cleanup failed:", err.message);
} finally {
  await client.end();
}

// ---------- summary ----------

const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass).length;
console.log(`\n${pass}/${results.length} PASS  ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

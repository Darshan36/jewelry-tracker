// Phase 21c.1.1 prod walkthrough — category tabs + ?tab= deep-link +
// dashboard per-category boxes.
//
// The headline checks the user explicitly asked to verify live:
//   1. ADMIN dashboard shows 4 individual clickable category boxes
//      (replacing the single Go-to-Ledger card).
//   2. Clicking each lands on /ledger with the right tab pre-selected
//      (Receivables → Sales, Payables → Purchase, etc.).
//   3. /ledger ADMIN shows 5 tabs (All default) filtering correctly.
//   4. LIVE DRIFT-PROOF: dashboard box total === /ledger box total for
//      the same category — read the same number off both surfaces.
//   5. Scoped-role (PURCHASE_DEPT) login: exactly 1 dashboard box + NO
//      /ledger tabs + only their category — live no-leak.
//   6. ?tab= deep-link lands right (incl. invalid → All).
//   7. Mobile 390×844 spot-check (dashboard grid + /ledger tabs).
//   8. Regression — /payables, /receivables, /completed still render.
// Marker cleanup after.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p21c1_1-out");
mkdirSync(OUT_DIR, { recursive: true });

function loadEnv(file) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = v;
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

const env = loadEnv(".env.production.local");
const ADMIN_EMAIL = env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = env.SEED_ADMIN_PASSWORD;
const DIRECT_URL = env.DIRECT_URL;
const creds = loadCredentialsMd();

const BASE = process.env.WALKTHROUGH_BASE ?? "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";
const MARKER = `__phase21c1_1_walk_${Date.now()}`;

let pass = 0;
let fail = 0;
const failures = [];
function check(label, cond, info = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${info ? "  — " + info : ""}`);
    fail++;
    failures.push(label + (info ? " — " + info : ""));
  }
}

const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
function cuid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function withDb(fn) {
  const c = new pg.Client({ connectionString: DIRECT_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

// Pull the rupee number out of an element's text, normalised to paise (BigInt).
function parseRupees(text) {
  if (!text) return 0n;
  const stripped = text.replace(/[^\d.−-]/g, "").replace(/[−–—]/, "-");
  const negative = stripped.startsWith("-");
  const num = stripped.replace("-", "");
  const [r, p] = num.split(".");
  const paise = BigInt(r.replace(/[^\d]/g, "") || "0") * 100n + BigInt((p ?? "00").padEnd(2, "0").slice(0, 2) || "0");
  return negative ? -paise : paise;
}

console.log(`\n=== Phase 21c.1.1 prod walkthrough ===`);
console.log(`BASE: ${BASE}`);
console.log(`Marker: ${MARKER}`);

const browser = await chromium.launch({ headless: true });

// Marker seeds — created so the boxes have something to show that
// isn't dependent on Hitesh's prod state. Cleanup at the end.
let karigarMarkerId;
let dualMarkerId;
let dualSaleId;

try {
  // Seed: 1 LABOUR karigar with +₹5,000 piece work (so Karigar box is non-zero
  // and a click into the Karigar tab shows the seeded owner).
  // 1 dual-role party (isCustomer + isSupplier) with SALE +₹12k + PURCHASE +₹4k
  // (so the dual-role-in-two-tabs case is reachable from the live UI).
  console.log(`\nSEED — Marker karigar + dual-role party`);
  await withDb(async (c) => {
    karigarMarkerId = cuid("emp_");
    await c.query(
      `INSERT INTO employees (id, name, type, notes, "createdAt", "updatedAt")
       VALUES ($1, $2, 'LABOUR', $3, NOW(), NOW())`,
      [karigarMarkerId, `${MARKER} Karigar`, MARKER],
    );
    const peId = cuid("pe_");
    await c.query(
      `INSERT INTO piece_entries (id, "employeeId", date, count, "ratePerPiece", "totalAmount", note, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 50, 10000, 500000, $4, NOW(), NOW())`,
      [peId, karigarMarkerId, today, `${MARKER} piece`],
    );
    await c.query(
      `INSERT INTO ledger_entries (id, "employeeId", date, direction, amount, description, "entryType", "sourceType", "sourceId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'INCREASE', 500000, '50 pcs @ ₹100/pc', 'TRANSACTION_LINKED', 'PIECE_ENTRY', $4, NOW(), NOW())`,
      [cuid("le_"), karigarMarkerId, today, peId],
    );

    dualMarkerId = cuid("party_");
    await c.query(
      `INSERT INTO parties (id, name, phone, "isCustomer", "isSupplier", notes, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, true, $4, NOW(), NOW())`,
      [dualMarkerId, `${MARKER} Dual`, `9${Date.now().toString().slice(-9)}`, MARKER],
    );
    dualSaleId = cuid("sale_");
    await c.query(
      `INSERT INTO sales (id, date, "partyId", "partyName", "partyPhone", discount, total, notes, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NULL, 0, 1200000, $5, NOW(), NOW())`,
      [dualSaleId, today, dualMarkerId, `${MARKER} Dual`, `${MARKER}_sale`],
    );
    await c.query(
      `INSERT INTO ledger_entries (id, "partyId", date, direction, amount, description, "entryType", "sourceType", "sourceId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'INCREASE', 1200000, 'Sale - 1 item', 'TRANSACTION_LINKED', 'SALE', $4, NOW(), NOW())`,
      [cuid("le_"), dualMarkerId, today, dualSaleId],
    );
    await c.query(
      `INSERT INTO ledger_entries (id, "partyId", date, direction, amount, description, "entryType", "sourceType", "sourceId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'INCREASE', 400000, 'Purchase - 1 item', 'TRANSACTION_LINKED', 'PURCHASE', $4, NOW(), NOW())`,
      [cuid("le_"), dualMarkerId, today, cuid("pu_")],
    );
  });
  console.log(`  karigar=${karigarMarkerId}, dual=${dualMarkerId}`);

  // ============================================================
  // S1 — ADMIN dashboard: 4 individual clickable category boxes
  // ============================================================
  console.log(`\nS1 — ADMIN dashboard: 4 individual clickable category boxes`);
  const dashboardBoxValues = {}; // capture for LIVE drift-proof check
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const boxes = await page.locator('[data-testid="dashboard-ledger-box"]').all();
    check(`ADMIN sees 4 dashboard boxes (got ${boxes.length})`, boxes.length === 4);

    const hrefs = [];
    for (const b of boxes) {
      const href = await b.getAttribute("href");
      const key = await b.getAttribute("data-box-key");
      const big = await b.locator("p.font-display").first().innerText();
      hrefs.push({ key, href, big });
      dashboardBoxValues[key] = parseRupees(big);
    }
    check(
      `each box links to /ledger?tab=<slug>`,
      hrefs.every((h) => h.href && h.href.startsWith("/ledger?tab=")),
      `hrefs: ${hrefs.map((h) => h.href).join(", ")}`,
    );

    const expectedHrefByKey = {
      receivables: "/ledger?tab=sales",
      purchase_payables: "/ledger?tab=purchase",
      casting_plating_payables: "/ledger?tab=casting-plating",
      karigar: "/ledger?tab=karigar",
    };
    for (const h of hrefs) {
      check(`${h.key} box → ${expectedHrefByKey[h.key]}`, h.href === expectedHrefByKey[h.key]);
    }

    // Old single GoToLedgerCard should NOT be present anymore.
    const oldCard = await page.locator('[data-testid="dashboard-ledger-card"]').count();
    check(`old single GoToLedgerCard removed (count=${oldCard})`, oldCard === 0);

    await page.screenshot({ path: join(OUT_DIR, "s1-admin-dashboard.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S2 — Click each dashboard box → /ledger with correct tab pre-selected
  // ============================================================
  console.log(`\nS2 — Each dashboard box click lands on correct /ledger tab`);
  {
    const clicks = [
      { key: "receivables", expectedTabKey: "receivables", expectedSlugInUrl: "sales" },
      { key: "purchase_payables", expectedTabKey: "purchase_payables", expectedSlugInUrl: "purchase" },
      { key: "casting_plating_payables", expectedTabKey: "casting_plating_payables", expectedSlugInUrl: "casting-plating" },
      { key: "karigar", expectedTabKey: "karigar", expectedSlugInUrl: "karigar" },
    ];

    for (const c of clicks) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);

      const box = page
        .locator('[data-testid="dashboard-ledger-box"]')
        .filter({ has: page.locator(`[data-box-key="${c.key}"]`) })
        .first();
      // Fallback if the filter doesn't work — locator by attribute directly:
      const directBox = page.locator(`[data-testid="dashboard-ledger-box"][data-box-key="${c.key}"]`);
      const useDirect = (await directBox.count()) > 0;
      await (useDirect ? directBox : box).click();
      await page.waitForURL(/\/ledger\?tab=/, { timeout: 10000 });

      const url = new URL(page.url());
      check(
        `${c.key} → URL has ?tab=${c.expectedSlugInUrl}`,
        url.searchParams.get("tab") === c.expectedSlugInUrl,
        `actual: ${url.toString()}`,
      );

      // The active tab pill should match c.expectedTabKey.
      await page.waitForTimeout(500);
      const activeTab = await page
        .locator('[data-testid="ledger-tab"][data-active="true"]')
        .first()
        .getAttribute("data-tab-key");
      check(
        `${c.key} → /ledger active tab = ${c.expectedTabKey} (got ${activeTab})`,
        activeTab === c.expectedTabKey,
      );

      await ctx.close();
    }
  }

  // ============================================================
  // S3 — /ledger ADMIN shows 5 tabs (All default) + filters correctly
  // ============================================================
  console.log(`\nS3 — /ledger ADMIN: 5 tabs, All default, filtering`);
  const ledgerBoxValues = {}; // for LIVE drift-proof check
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const tabs = await page.locator('[data-testid="ledger-tab"]').all();
    check(`ADMIN sees 5 tabs (got ${tabs.length})`, tabs.length === 5);

    const tabKeys = [];
    for (const t of tabs) tabKeys.push(await t.getAttribute("data-tab-key"));
    check(
      `tabs in order: all / receivables / purchase_payables / casting_plating_payables / karigar`,
      JSON.stringify(tabKeys) ===
        JSON.stringify(["all", "receivables", "purchase_payables", "casting_plating_payables", "karigar"]),
      `got: ${tabKeys.join(",")}`,
    );

    const activeOnLoad = tabs.find(async (t) => (await t.getAttribute("data-active")) === "true");
    // Just check "All" is active:
    const allActiveStr = await tabs[0].getAttribute("data-active");
    check(`"All" is the default active tab`, allActiveStr === "true");

    // Capture /ledger box values for LIVE drift-proof check.
    const ledgerBoxes = await page.locator('[data-testid="ledger-box"]').all();
    for (const b of ledgerBoxes) {
      const key = await b.getAttribute("data-box-key");
      const big = await b.locator("p.font-display").first().innerText();
      ledgerBoxValues[key] = parseRupees(big);
    }

    // Click Karigar tab → karigar owner list should include the marker karigar.
    const karigarTab = page.locator('[data-testid="ledger-tab"][data-tab-key="karigar"]');
    await karigarTab.click();
    await page.waitForTimeout(400);
    const karigarRowMarker = await page
      .locator('[data-testid="ledger-owner-row"]')
      .filter({ hasText: MARKER })
      .count();
    check(`Karigar tab shows marker karigar after filter`, karigarRowMarker === 1);

    // Click Sales tab → owner list should contain the dual-role marker party (Sales slice).
    await page.locator('[data-testid="ledger-tab"][data-tab-key="receivables"]').click();
    await page.waitForTimeout(400);
    const dualInSales = await page
      .locator('[data-testid="ledger-owner-row"]')
      .filter({ hasText: MARKER })
      .count();
    check(`Sales tab shows marker dual-role party (Sales slice present)`, dualInSales === 1);

    // Click Purchase tab → SAME dual-role marker party should also appear (Purchase slice).
    await page.locator('[data-testid="ledger-tab"][data-tab-key="purchase_payables"]').click();
    await page.waitForTimeout(400);
    const dualInPurch = await page
      .locator('[data-testid="ledger-owner-row"]')
      .filter({ hasText: MARKER })
      .count();
    check(`Purchase tab ALSO shows marker dual-role party (Purchase slice)`, dualInPurch === 1);

    // Click All tab → marker dual-role party appears with FULL balance
    await page.locator('[data-testid="ledger-tab"][data-tab-key="all"]').click();
    await page.waitForTimeout(400);
    const dualInAll = await page
      .locator('[data-testid="ledger-owner-row"]')
      .filter({ hasText: MARKER })
      .filter({ hasText: /party/i }) // owner-kind-chip says "Party"
      .count();
    check(`All tab also shows the dual-role marker party`, dualInAll === 1);

    await page.screenshot({ path: join(OUT_DIR, "s3-admin-ledger-tabs.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S4 — LIVE DRIFT-PROOF: dashboard box total === /ledger box total
  // ============================================================
  console.log(`\nS4 — LIVE DRIFT-PROOF: dashboard box total === /ledger box total per category`);
  for (const key of ["receivables", "purchase_payables", "casting_plating_payables", "karigar"]) {
    const dashVal = dashboardBoxValues[key];
    const ledgerVal = ledgerBoxValues[key];
    check(
      `${key}: dashboard ${dashVal}p === /ledger ${ledgerVal}p (live)`,
      dashVal === ledgerVal,
      `dash=${dashVal}, ledger=${ledgerVal}`,
    );
  }

  // ============================================================
  // S5 — Scoped role: PURCHASE_DEPT login (live no-leak)
  // ============================================================
  console.log(`\nS5 — PURCHASE_DEPT login: 1 dashboard box + NO /ledger tabs + only suppliers`);
  if (!creds.PURCHASE_DEPT) {
    check("PURCHASE_DEPT credentials not found — skip", false, "missing in credentials.md");
  } else {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, creds.PURCHASE_DEPT.email, creds.PURCHASE_DEPT.password);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    const dashBoxes = await page.locator('[data-testid="dashboard-ledger-box"]').count();
    check(`PURCHASE_DEPT dashboard shows exactly 1 box (got ${dashBoxes})`, dashBoxes === 1);

    const dashBox = page.locator('[data-testid="dashboard-ledger-box"]').first();
    const dashKey = await dashBox.getAttribute("data-box-key");
    const dashHref = await dashBox.getAttribute("href");
    check(`PURCHASE_DEPT dashboard box key = purchase_payables`, dashKey === "purchase_payables");
    check(`PURCHASE_DEPT dashboard box href = /ledger?tab=purchase`, dashHref === "/ledger?tab=purchase");

    // Click → /ledger
    await dashBox.click();
    await page.waitForURL(/\/ledger\?tab=purchase/, { timeout: 10000 });
    await page.waitForTimeout(600);

    // No tab bar on /ledger for scoped role.
    const tabBar = await page.locator('[data-testid="ledger-tab-bar"]').count();
    check(`PURCHASE_DEPT /ledger has NO tab bar (count=${tabBar})`, tabBar === 0);

    // Owner kinds: ZERO karigars (live no-leak).
    const ownerKinds = await page
      .locator('[data-testid="ledger-owner-row"]')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-owner-kind")));
    const hasKarigar = ownerKinds.includes("karigar");
    check(
      `PURCHASE_DEPT /ledger owner list has ZERO karigars (live no-leak)`,
      !hasKarigar,
      `kinds: ${[...new Set(ownerKinds)].join(", ") || "(empty)"}`,
    );

    // Marker karigar from SEED must NOT be visible.
    const karMarker = await page
      .locator('[data-testid="ledger-owner-row"]')
      .filter({ hasText: MARKER })
      .filter({ has: page.locator('[data-owner-kind="karigar"]') })
      .count();
    check(`PURCHASE_DEPT does NOT see marker karigar (cross-category no-leak)`, karMarker === 0);

    await page.screenshot({ path: join(OUT_DIR, "s5-purchase-dept.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S6 — Scoped role: LABOUR_MGMT login (additional live no-leak)
  // ============================================================
  console.log(`\nS6 — LABOUR_MGMT login: 1 dashboard box + only karigars`);
  if (!creds.LABOUR_MGMT) {
    check("LABOUR_MGMT credentials not found — skip", false, "missing in credentials.md");
  } else {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, creds.LABOUR_MGMT.email, creds.LABOUR_MGMT.password);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    const dashBoxes = await page.locator('[data-testid="dashboard-ledger-box"]').count();
    check(`LABOUR_MGMT dashboard shows exactly 1 box`, dashBoxes === 1);
    const dashKey = await page.locator('[data-testid="dashboard-ledger-box"]').first().getAttribute("data-box-key");
    check(`LABOUR_MGMT dashboard box = karigar`, dashKey === "karigar");

    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const tabBar = await page.locator('[data-testid="ledger-tab-bar"]').count();
    check(`LABOUR_MGMT /ledger has NO tab bar`, tabBar === 0);

    const ownerKinds = await page
      .locator('[data-testid="ledger-owner-row"]')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-owner-kind")));
    const hasParty = ownerKinds.includes("party");
    check(`LABOUR_MGMT /ledger has ZERO parties (live no-leak)`, !hasParty);

    // Marker karigar IS visible to LABOUR_MGMT.
    const karMarker = await page
      .locator('[data-testid="ledger-owner-row"]')
      .filter({ hasText: MARKER })
      .count();
    check(`LABOUR_MGMT sees the marker karigar`, karMarker === 1);

    await ctx.close();
  }

  // ============================================================
  // S7 — ?tab= deep-link lands correctly (incl. invalid → All)
  // ============================================================
  console.log(`\nS7 — ?tab= deep-link parsing live`);
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const cases = [
      { url: `${BASE}/ledger?tab=sales`, expectedActive: "receivables" },
      { url: `${BASE}/ledger?tab=karigar`, expectedActive: "karigar" },
      { url: `${BASE}/ledger?tab=invalid`, expectedActive: "all" },
      { url: `${BASE}/ledger`, expectedActive: "all" },
    ];
    for (const c of cases) {
      await page.goto(c.url, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const activeKey = await page
        .locator('[data-testid="ledger-tab"][data-active="true"]')
        .first()
        .getAttribute("data-tab-key");
      check(
        `${c.url.replace(BASE, "")} → active tab = ${c.expectedActive} (got ${activeKey})`,
        activeKey === c.expectedActive,
      );
    }
    await ctx.close();
  }

  // ============================================================
  // S8 — Mobile 390x844 spot-check
  // ============================================================
  console.log(`\nS8 — Mobile 390x844: dashboard grid + /ledger tabs, no horizontal scroll`);
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Dashboard mobile
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const dashScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`mobile dashboard: no horizontal scroll (${dashScrollW} <= 391)`, dashScrollW <= 391);
    const dashBoxesM = await page.locator('[data-testid="dashboard-ledger-box"]').count();
    check(`mobile dashboard: 4 boxes render`, dashBoxesM === 4);
    await page.screenshot({ path: join(OUT_DIR, "s8-mobile-dashboard.png"), fullPage: true });

    // /ledger mobile
    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const ledgerScrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`mobile /ledger: no horizontal scroll (${ledgerScrollW} <= 391)`, ledgerScrollW <= 391);
    const tabBar = await page.locator('[data-testid="ledger-tab-bar"]').count();
    check(`mobile /ledger: tab bar renders`, tabBar === 1);
    await page.screenshot({ path: join(OUT_DIR, "s8-mobile-ledger.png"), fullPage: true });

    await ctx.close();
  }

  // ============================================================
  // S9 — Regression: old routes still render
  // ============================================================
  console.log(`\nS9 — Regression: /payables, /receivables, /completed still render`);
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    for (const route of ["/payables", "/receivables", "/completed"]) {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const status = resp ? resp.status() : 0;
      check(`${route} returns 200 (got ${status})`, status === 200);
      const url = new URL(page.url());
      check(`${route} URL not redirected (current: ${url.pathname})`, url.pathname === route);
    }
    await ctx.close();
  }
} finally {
  // Cleanup all marker rows
  console.log(`\nCleanup — remove marker rows`);
  await withDb(async (c) => {
    await c.query(`DELETE FROM ledger_entries WHERE "employeeId" IN (SELECT id FROM employees WHERE notes LIKE '%${MARKER}%')`);
    await c.query(`DELETE FROM piece_entries WHERE "employeeId" IN (SELECT id FROM employees WHERE notes LIKE '%${MARKER}%')`);
    await c.query(`DELETE FROM employees WHERE notes LIKE '%${MARKER}%'`);
    await c.query(`DELETE FROM ledger_entries WHERE "partyId" IN (SELECT id FROM parties WHERE notes LIKE '%${MARKER}%')`);
    await c.query(`DELETE FROM sale_line_items WHERE "saleId" IN (SELECT id FROM sales WHERE notes LIKE '%${MARKER}%')`);
    await c.query(`DELETE FROM sales WHERE notes LIKE '%${MARKER}%'`);
    await c.query(`DELETE FROM purchases WHERE notes LIKE '%${MARKER}%'`);
    await c.query(`DELETE FROM parties WHERE notes LIKE '%${MARKER}%'`);
  });
  console.log(`  ✓ marker rows removed`);
  await browser.close();
}

console.log(`\n=== Phase 21c.1.1 walkthrough: ${pass}/${pass + fail} PASS ===`);
if (fail > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

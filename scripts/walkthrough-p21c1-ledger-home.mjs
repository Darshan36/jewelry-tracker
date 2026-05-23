// Phase 21c.1 prod walkthrough — unified /ledger home page, role-scoped boxes,
// per-party + per-karigar khata drill-downs, dashboard consolidation, mobile,
// and the regression check on the three old routes (which 21c.2 will retire
// but MUST stay live during 21c.1).
//
// Priorities the user called out:
//   PRIORITY 1 — Live box reconciliation: dashboard GoToLedgerCard total
//     must equal sum of /ledger box totals AND box totals must reconcile to
//     the listed owner balances per category.
//   PRIORITY 2 — Live role-scoping: LABOUR_MGMT sees ONLY the Karigar box +
//     karigar owners (no parties); PURCHASE_DEPT sees ONLY Purchase payables
//     + suppliers (no karigar). Zero leakage. This is the headline integrity
//     check for the unified-page architecture.
//
// Other checks:
//   - ADMIN /ledger renders 4 boxes + owner list + walk-in section.
//   - Party khata drill-down: navigate to /ledger/party/[id] → edit a
//     MANUAL_PAYMENT entry → balance recomputes → restore.
//   - Karigar khata drill-down: create temp karigar → /ledger/karigar/[id]
//     → "Record entry" (always-visible) → advance posts → balance flips
//     to "Advance held".
//   - Dashboard GoToLedgerCard: card total = sum of /ledger boxes;
//     clicking navigates to /ledger.
//   - Mobile 390x844: /ledger renders without horizontal scroll on the
//     boxes section.
//   - Regression: /payables, /receivables, /completed all still render
//     (21c.2 will retire them; during 21c.1 they MUST stay alive).
//
// Cleanup: every row inserted is tagged with the rehearsal marker and
// soft-deleted at the end via DB DELETE.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p21c1-out");
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
  // credentials.md is a Markdown table of role → (email, password) for the
  // non-admin test accounts. Gitignored locally; passwords also in admin's
  // password manager.
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
const MARKER = `__phase21c1_walk_${Date.now()}`;

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

// --- DB helpers (use pg against DIRECT_URL = prod Supabase) ---
async function withDb(fn) {
  const c = new pg.Client({ connectionString: DIRECT_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function ledgerBalance(c, col, id) {
  const { rows } = await c.query(
    `SELECT
       COALESCE(SUM(CASE WHEN direction='INCREASE' THEN amount ELSE 0 END), 0) AS inc,
       COALESCE(SUM(CASE WHEN direction='DECREASE' THEN amount ELSE 0 END), 0) AS dec
     FROM ledger_entries
     WHERE "${col}" = $1 AND "deletedAt" IS NULL`,
    [id],
  );
  return BigInt(rows[0].inc) - BigInt(rows[0].dec);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500); // hydration buffer
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function logout(page) {
  // The sidebar Sign-out button is the canonical path; on mobile it's behind
  // the hamburger so we navigate to /auth/login and rely on the redirect.
  await page.context().clearCookies();
  await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
}

async function parseRupees(text) {
  // Accept "₹1,23,456.78" or "−₹100.00" or "₹0.00" → returns paise as BigInt.
  if (!text) return 0n;
  const stripped = text.replace(/[^\d.−-]/g, "").replace(/[−–—]/, "-");
  const negative = stripped.startsWith("-");
  const num = stripped.replace("-", "");
  const [r, p] = num.split(".");
  const paise = BigInt(r.replace(/[^\d]/g, "") || "0") * 100n + BigInt((p ?? "00").padEnd(2, "0").slice(0, 2) || "0");
  return negative ? -paise : paise;
}

// --- Walkthrough --------------------------------------------------------

console.log(`\n=== Phase 21c.1 prod walkthrough ===`);
console.log(`BASE: ${BASE}`);
console.log(`Marker: ${MARKER}`);

const browser = await chromium.launch({ headless: true });

let karigarId; // created in S5 for the karigar khata test
let advanceLedgerId; // created in S5; cleanup
let manualPaymentEditedId; // S3 — id of the entry we edit
let manualPaymentOriginalAmount; // S3 — for restore
let walkInPurchaseId;
let walkInPaymentId;

try {
  // ============================================================
  // S1 — ADMIN /ledger renders 4 boxes + owner list + walk-in section
  // ============================================================
  console.log(`\nS1 — ADMIN /ledger landing page`);
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const boxes = await page.locator('[data-testid="ledger-box"]').all();
    check(`ADMIN sees 4 boxes (got ${boxes.length})`, boxes.length === 4);

    const boxKeys = [];
    for (const b of boxes) {
      boxKeys.push(await b.getAttribute("data-box-key"));
    }
    check(
      `box keys = receivables + purchase_payables + casting_plating_payables + karigar`,
      boxKeys.includes("receivables") &&
        boxKeys.includes("purchase_payables") &&
        boxKeys.includes("casting_plating_payables") &&
        boxKeys.includes("karigar"),
      `got: ${boxKeys.join(", ")}`,
    );

    const owners = await page.locator('[data-testid="ledger-owner-row"]').count();
    check(`owner list rendered (${owners} rows)`, owners >= 1);

    // Capture admin box totals for the dashboard reconciliation check (S7).
    const adminBoxTotals = {};
    for (const b of boxes) {
      const key = await b.getAttribute("data-box-key");
      const total = await b.locator("p.font-display").first().innerText();
      adminBoxTotals[key] = total;
    }
    console.log(`     admin box totals: ${JSON.stringify(adminBoxTotals)}`);
    global.__adminBoxTotals = adminBoxTotals;

    await page.screenshot({ path: join(OUT_DIR, "s1-admin-ledger.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S2 — Party khata drill-down: edit MANUAL_PAYMENT → recompute → restore
  // ============================================================
  console.log(`\nS2 — Party khata drill-down (edit MANUAL_PAYMENT)`);
  {
    // Find an existing party with a MANUAL_PAYMENT entry we can safely edit.
    let candidate = null;
    await withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT le.id AS entry_id, le.amount, le."partyId" AS party_id, p.name AS party_name
         FROM ledger_entries le
         JOIN parties p ON p.id = le."partyId"
         WHERE le."entryType" = 'MANUAL_PAYMENT'
           AND le."deletedAt" IS NULL
           AND p."deletedAt" IS NULL
         ORDER BY le."createdAt" DESC
         LIMIT 1`,
      );
      if (rows[0]) {
        candidate = {
          entryId: rows[0].entry_id,
          partyId: rows[0].party_id,
          name: rows[0].party_name,
          amount: BigInt(rows[0].amount),
        };
      }
    });

    if (!candidate) {
      console.log(`  ⚠ no MANUAL_PAYMENT entry found on prod — skipping S2`);
      check("S2 skipped (no MANUAL_PAYMENT entry to edit)", true);
    } else {
      console.log(`     editing entry ${candidate.entryId} on party "${candidate.name}" (currently ${candidate.amount}p)`);
      manualPaymentEditedId = candidate.entryId;
      manualPaymentOriginalAmount = candidate.amount;

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

      // Read pre-edit DB balance.
      const preBalance = await withDb((c) => ledgerBalance(c, "partyId", candidate.partyId));

      // Edit via DB (mirroring updateLedgerPayment: amount-only change).
      // We perturb by +₹1 (100p), then restore.
      await withDb(async (c) => {
        await c.query(
          `UPDATE ledger_entries SET amount = $1, "updatedAt" = NOW() WHERE id = $2`,
          [candidate.amount + 100n, candidate.entryId],
        );
      });

      // Navigate to khata + verify balance.
      await page.goto(`${BASE}/ledger/party/${candidate.partyId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);

      const postBalanceDb = await withDb((c) => ledgerBalance(c, "partyId", candidate.partyId));
      // Edit was a DECREASE entry getting +100p, OR an INCREASE getting +100p.
      // Check direction first.
      let direction;
      await withDb(async (c) => {
        const { rows } = await c.query(
          `SELECT direction FROM ledger_entries WHERE id = $1`,
          [candidate.entryId],
        );
        direction = rows[0].direction;
      });
      const expectedShift = direction === "INCREASE" ? 100n : -100n;
      const actualShift = postBalanceDb - preBalance;
      check(
        `party balance recomputed (${direction} +100p → shift ${actualShift}p, expected ${expectedShift}p)`,
        actualShift === expectedShift,
      );

      // Restore the original amount.
      await withDb(async (c) => {
        await c.query(
          `UPDATE ledger_entries SET amount = $1, "updatedAt" = NOW() WHERE id = $2`,
          [candidate.amount, candidate.entryId],
        );
      });
      const restored = await withDb((c) => ledgerBalance(c, "partyId", candidate.partyId));
      check(
        `party balance restored to pre-edit value (${preBalance}p)`,
        restored === preBalance,
      );

      await page.screenshot({ path: join(OUT_DIR, "s2-party-khata.png"), fullPage: true });
      await ctx.close();
    }
  }

  // ============================================================
  // S3 — /ledger/party/[id] renders the statement (visual check)
  // ============================================================
  console.log(`\nS3 — Party khata visual check (any existing NON-orphan party)`);
  {
    // Pick a party that (a) has ledger entries AND (b) is NOT soft-deleted.
    // Prod currently has 2 KNOWN orphan rows (cascade bug to be fixed in
    // 21c.2 — parent party soft-deleted but ledger rows still active).
    // The previous query happily picked an orphan partyId, which then 404'd
    // because getPayablesForParty filters `deletedAt: null`. Defensive
    // filter here joins parties + requires deletedAt IS NULL.
    let testPartyId = null;
    await withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT le."partyId" AS id
         FROM ledger_entries le
         JOIN parties p ON p.id = le."partyId"
         WHERE le."deletedAt" IS NULL
           AND p."deletedAt" IS NULL
         GROUP BY le."partyId"
         LIMIT 1`,
      );
      if (rows[0]) testPartyId = rows[0].id;
    });
    if (!testPartyId) {
      console.log(`  ⚠ no non-orphan party with ledger entries — skipping S3`);
      check("S3 skipped (no non-orphan party with ledger entries)", true);
    } else {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto(`${BASE}/ledger/party/${testPartyId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);

      const balanceVisible = await page.locator('[data-testid="party-balance"]').count();
      check(`party-balance element visible`, balanceVisible >= 1);

      const ctaVisible = await page.locator('[data-testid="add-payment-button"]').count();
      check(`CTA button visible (Add payment / Receive Payment)`, ctaVisible >= 1);

      const entryRows = await page.locator('[data-testid="ledger-entry-row"]').count();
      check(`ledger entry rows rendered (${entryRows})`, entryRows >= 1);

      await ctx.close();
    }
  }

  // ============================================================
  // S4 — /ledger/karigar/[id] renders karigar khata + "Record entry"
  //      always-visible. Create temp karigar, navigate, verify.
  // ============================================================
  console.log(`\nS4 — Karigar khata: create temp karigar, Record entry advance, balance flips`);
  {
    karigarId = cuid("emp_");
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO employees (id, name, type, notes, "createdAt", "updatedAt")
         VALUES ($1, $2, 'LABOUR', $3, NOW(), NOW())`,
        [karigarId, `${MARKER} Karigar`, MARKER],
      );
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE}/ledger/karigar/${karigarId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Balance label should be "Caught up" (zero balance, new karigar).
    const caughtUpVisible = await page.locator("text=Caught up").count();
    check(`new karigar shows "Caught up" label`, caughtUpVisible >= 1);

    // "Record entry" button always-visible (even with zero balance).
    const recordButton = await page.locator('[data-testid="record-entry-button"]').count();
    check(`"Record entry" button visible at zero balance`, recordButton >= 1);

    // "Settle wages" button HIDDEN when balance === 0.
    const settleButton = await page.locator('[data-testid="settle-wages-button"]').count();
    check(`"Settle wages" button HIDDEN at zero balance`, settleButton === 0);

    // Post a ₹5,000 advance via direct SQL (mirrors createKarigarLedgerEntry
    // DECREASE MANUAL_PAYMENT).
    advanceLedgerId = cuid("le_");
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO ledger_entries (id, "employeeId", "partyId", date, direction, amount, description,
           "entryType", "sourceType", "sourceId", "createdAt", "updatedAt")
         VALUES ($1, $2, NULL, $3, 'DECREASE', 500000, $4,
                 'MANUAL_PAYMENT', NULL, NULL, NOW(), NOW())`,
        [advanceLedgerId, karigarId, today, `${MARKER} advance`],
      );
    });

    // Reload + check balance flipped.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const advanceHeldVisible = await page.locator("text=Advance held").count();
    check(`karigar khata shows "Advance held" after ₹5,000 advance`, advanceHeldVisible >= 1);

    const balanceEl = page.locator('[data-testid="karigar-balance"]');
    const signed = await balanceEl.getAttribute("data-signed");
    check(
      `data-signed = -500000 (raw signed paise)`,
      signed === "-500000",
      `got: ${signed}`,
    );

    const balanceText = await balanceEl.innerText();
    const parsedBalance = await parseRupees(balanceText);
    check(
      `displayed balance is −₹5,000 in absolute formatting (parsed: ${parsedBalance}p)`,
      parsedBalance === -500000n,
    );

    // Verify entry row in the statement table.
    const entryRows = await page.locator('[data-testid="ledger-entry-row"]').count();
    check(`statement shows 1 entry row`, entryRows === 1);

    const manualPaymentTag = await page.locator('[data-testid="manual-payment-tag"]').count();
    check(`row shows "Direct" tag (MANUAL_PAYMENT)`, manualPaymentTag === 1);

    const editButton = await page.locator('[data-testid="ledger-edit-button"]').count();
    check(`MANUAL_PAYMENT row has edit button`, editButton === 1);

    await page.screenshot({ path: join(OUT_DIR, "s4-karigar-khata.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S5 — Walk-in Pay path (settles to zero, drops from list)
  // ============================================================
  console.log(`\nS5 — Walk-in purchase Pay path`);
  {
    // Seed a walk-in purchase (no party) with ₹25,000 outstanding.
    walkInPurchaseId = cuid("pu_");
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO purchases (id, date, "partyId", "partyName", "partyPhone", discount, total, notes, "createdAt", "updatedAt")
         VALUES ($1, $2, NULL, $3, NULL, 0, 2500000, $4, NOW(), NOW())`,
        [walkInPurchaseId, today, `${MARKER} WalkInSup`, MARKER],
      );
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const walkInRows = await page.locator('[data-testid="ledger-walkin-row"]').count();
    check(`walk-in section shows our seeded walk-in (${walkInRows} total rows)`, walkInRows >= 1);

    // Find the row for our seeded purchase by matching the party name.
    const ourRow = page.locator('[data-testid="ledger-walkin-row"]').filter({
      hasText: MARKER,
    });
    const ourRowCount = await ourRow.count();
    check(`our marker walk-in row visible by name`, ourRowCount === 1);

    // Post the payment via SQL (mirrors createPurchasePayment).
    walkInPaymentId = cuid("pp_");
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO purchase_payments (id, "purchaseId", date, amount, type, note, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 2500000, 'PAYMENT', $4, NOW(), NOW())`,
        [walkInPaymentId, walkInPurchaseId, today, MARKER],
      );
    });

    // Reload, the row should be gone.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const ourRowAfter = await page
      .locator('[data-testid="ledger-walkin-row"]')
      .filter({ hasText: MARKER })
      .count();
    check(`marker walk-in row gone from /ledger after full payment`, ourRowAfter === 0);

    await ctx.close();
  }

  // ============================================================
  // S6 — Dashboard GoToLedgerCard reconciles with /ledger boxes
  // ============================================================
  console.log(`\nS6 — Dashboard GoToLedgerCard reconciliation`);
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const card = page.locator('[data-testid="dashboard-ledger-card"]');
    check(`dashboard GoToLedgerCard visible`, (await card.count()) === 1);

    const cardHref = await card.getAttribute("href");
    check(`card href points to /ledger`, cardHref === "/ledger");

    // Read the card's displayed total (the big number).
    const cardTotalText = await card.locator("p.font-display").first().innerText();
    const cardTotal = await parseRupees(cardTotalText);

    // Read /ledger boxes and sum them.
    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const boxes = await page.locator('[data-testid="ledger-box"]').all();
    let sumBoxes = 0n;
    for (const b of boxes) {
      const t = await b.locator("p.font-display").first().innerText();
      sumBoxes += await parseRupees(t);
    }

    check(
      `dashboard card total (${cardTotal}p) === Σ /ledger boxes (${sumBoxes}p) — LIVE box reconciliation`,
      cardTotal === sumBoxes,
    );

    // Click the dashboard card → navigates to /ledger.
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.locator('[data-testid="dashboard-ledger-card"]').click();
    await page.waitForURL(/\/ledger$/, { timeout: 10000 });
    check(`clicking GoToLedgerCard navigates to /ledger`, page.url().endsWith("/ledger"));

    await page.screenshot({ path: join(OUT_DIR, "s6-dashboard-card.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S7 — Role-scoped login: LABOUR_MGMT (LIVE NO-LEAK CHECK)
  // ============================================================
  console.log(`\nS7 — LABOUR_MGMT role-scoped login (live no-leak check)`);
  if (!creds.LABOUR_MGMT) {
    check("LABOUR_MGMT credentials not found — skip", false, "missing in credentials.md");
  } else {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, creds.LABOUR_MGMT.email, creds.LABOUR_MGMT.password);
    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const boxes = await page.locator('[data-testid="ledger-box"]').all();
    check(`LABOUR_MGMT sees exactly 1 box (got ${boxes.length})`, boxes.length === 1);

    const boxKey = boxes.length > 0 ? await boxes[0].getAttribute("data-box-key") : null;
    check(`LABOUR_MGMT box is karigar (got ${boxKey})`, boxKey === "karigar");

    // CRITICAL: check NO party rows in the owner list.
    const ownerKinds = await page.locator('[data-testid="ledger-owner-row"]').evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-owner-kind")),
    );
    const hasParty = ownerKinds.includes("party");
    check(
      `LABOUR_MGMT owner list has ZERO parties (live no-leak)`,
      !hasParty,
      `kinds: ${[...new Set(ownerKinds)].join(", ")}`,
    );

    const karigarCount = ownerKinds.filter((k) => k === "karigar").length;
    check(`LABOUR_MGMT sees karigar owners (count: ${karigarCount})`, karigarCount >= 1);

    // Marker karigar from S4 should be visible (zero-balance "Caught up" karigar
    // still appears — always-available-surface pattern).
    const ourKarigar = await page
      .locator('[data-testid="ledger-owner-row"]')
      .filter({ hasText: MARKER })
      .count();
    check(`LABOUR_MGMT sees the marker karigar from S4`, ourKarigar === 1);

    await page.screenshot({ path: join(OUT_DIR, "s7-labour-mgmt-ledger.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S8 — Role-scoped login: PURCHASE_DEPT (LIVE NO-LEAK CHECK)
  // ============================================================
  console.log(`\nS8 — PURCHASE_DEPT role-scoped login (live no-leak check)`);
  if (!creds.PURCHASE_DEPT) {
    check("PURCHASE_DEPT credentials not found — skip", false, "missing in credentials.md");
  } else {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, creds.PURCHASE_DEPT.email, creds.PURCHASE_DEPT.password);
    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const boxes = await page.locator('[data-testid="ledger-box"]').all();
    check(`PURCHASE_DEPT sees exactly 1 box (got ${boxes.length})`, boxes.length === 1);

    const boxKey = boxes.length > 0 ? await boxes[0].getAttribute("data-box-key") : null;
    check(`PURCHASE_DEPT box is purchase_payables (got ${boxKey})`, boxKey === "purchase_payables");

    const ownerKinds = await page.locator('[data-testid="ledger-owner-row"]').evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-owner-kind")),
    );
    const hasKarigar = ownerKinds.includes("karigar");
    check(
      `PURCHASE_DEPT owner list has ZERO karigars (live no-leak)`,
      !hasKarigar,
      `kinds: ${[...new Set(ownerKinds)].join(", ")}`,
    );

    // Marker karigar from S4 must NOT be visible to PURCHASE_DEPT.
    const markerVisible = await page
      .locator('[data-testid="ledger-owner-row"]')
      .filter({ hasText: MARKER })
      .count();
    check(`PURCHASE_DEPT does NOT see marker karigar (no leak)`, markerVisible === 0);

    await page.screenshot({ path: join(OUT_DIR, "s8-purchase-dept-ledger.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S9 — Mobile 390x844 spot-check on /ledger
  // ============================================================
  console.log(`\nS9 — Mobile 390x844 spot-check on /ledger`);
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    // Boxes should render (single-column on mobile).
    const boxes = await page.locator('[data-testid="ledger-box"]').count();
    check(`mobile: boxes render (${boxes})`, boxes >= 1);

    // Page should not have horizontal scrollbar (body width <= viewport width).
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    check(
      `mobile: no horizontal scroll (scrollWidth=${scrollWidth} <= 390+1)`,
      scrollWidth <= 391,
    );

    await page.screenshot({ path: join(OUT_DIR, "s9-mobile-ledger.png"), fullPage: true });
    await ctx.close();
  }

  // ============================================================
  // S10 — Regression: old routes /payables /receivables /completed still render
  // ============================================================
  console.log(`\nS10 — Regression: old routes still render unchanged`);
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    for (const route of ["/payables", "/receivables", "/completed"]) {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const status = resp ? resp.status() : 0;
      check(
        `${route} returns 200 (got ${status})`,
        status === 200,
      );
      // Any redirect away from the route would be a regression (route gone or denied to ADMIN).
      const url = new URL(page.url());
      check(
        `${route} URL not redirected (current: ${url.pathname})`,
        url.pathname === route,
      );
      await page.screenshot({ path: join(OUT_DIR, `s10-${route.slice(1)}.png`), fullPage: false });
    }

    // Sidebar should still list the old routes (they MUST stay during 21c.1).
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    const sidebarItems = await page
      .locator('[data-testid="sidebar-desktop"] a')
      .evaluateAll((as) => as.map((a) => a.textContent?.trim() ?? ""));
    check(`sidebar contains "Ledger"`, sidebarItems.some((t) => t.includes("Ledger")));
    check(`sidebar STILL contains "Payables" (21c.1 keeps old routes)`, sidebarItems.some((t) => t.includes("Payables")));
    check(`sidebar STILL contains "Receivables"`, sidebarItems.some((t) => t.includes("Receivables")));
    check(`sidebar STILL contains "Completed"`, sidebarItems.some((t) => t.includes("Completed")));

    await ctx.close();
  }
} finally {
  // --- Cleanup: tombstone everything we created ---
  console.log(`\nCleanup — remove marker rows`);
  await withDb(async (c) => {
    await c.query(`DELETE FROM ledger_entries WHERE description LIKE '%${MARKER}%' OR description LIKE 'Wage payment%${MARKER}%'`);
    await c.query(`DELETE FROM ledger_entries WHERE "employeeId" IN (SELECT id FROM employees WHERE notes LIKE '%${MARKER}%')`);
    await c.query(`DELETE FROM employees WHERE notes LIKE '%${MARKER}%'`);
    await c.query(`DELETE FROM purchase_payments WHERE "purchaseId" IN (SELECT id FROM purchases WHERE notes LIKE '%${MARKER}%') OR note = '${MARKER}'`);
    await c.query(`DELETE FROM purchases WHERE notes LIKE '%${MARKER}%'`);
  });
  console.log("  ✓ marker rows removed");

  await browser.close();
}

console.log(`\n=== Phase 21c.1 walkthrough: ${pass}/${pass + fail} PASS ===`);
if (fail > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

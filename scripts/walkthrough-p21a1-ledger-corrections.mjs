// Phase 21a.1 walkthrough — ledger entry corrections + chip removal +
// credit-balance visibility, against prod.
//
// The screenshot scenario, live:
//   S1) ADMIN login + dashboard
//   S2) Create a SALE for ₹1,000 with a new customer (auto-promotion)
//   S3) On /sales: the new party-linked sale shows NO status chip
//       (renders "on ledger" hint instead) — THE ORIGINAL COMPLAINT
//   S4) Create a SECOND, WALK-IN sale (partyId NULL). On /sales it
//       STILL shows the status chip — proves the conditional render
//       fires correctly for both paths
//   S5) /receivables/[partyId]: record a ₹10,000 OVERPAYMENT via the
//       modal → balance flips to credit −₹9,000 (DB check)
//   S6) /receivables list: the customer appears with the "Credit"
//       badge + tinted credit styling
//   S7) Per-party ledger statement: the MANUAL_PAYMENT row has Edit +
//       Delete buttons; the SALE (TRANSACTION_LINKED) row shows the
//       read-only "via source" hint
//   S8) Edit the payment ₹10,000 → ₹1,000 via the modal → balance = ₹0
//       (DB check)
//   S9) Delete the payment via the row's Delete button → balance =
//       ₹1,000 (full sale outstanding; DB check)
//  S10) Create a NEW payment ₹200 via "Receive Payment" → balance = ₹800
//       (proves create still works alongside edit; DB check)
//  S11) Cleanup: soft-delete sales + ledger entries + auto-promoted
//       party. Tombstones all rows tagged with the test marker.
//
// Marker: __phase21a1_walk_<timestamp>. Catch-block emergency cleanup
// mirrors the success-path cleanup.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p21a1-out");
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

const env = loadEnv(".env.production.local");
const ADMIN_EMAIL = env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = env.SEED_ADMIN_PASSWORD;
const DIRECT_URL = env.DIRECT_URL;
const BASE =
  process.env.WALKTHROUGH_BASE ??
  "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";

// Prod-ref guard via username (Supabase pooled URL).
const usernameMatch = DIRECT_URL.match(/postgres\.([^:]+):/);
const projectRef = usernameMatch?.[1];
if (projectRef !== "cseqdcrfnvgsalsyhjsz") {
  console.error(`ABORT — DIRECT_URL not pointing at prod (got ${projectRef}).`);
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("FAIL: missing SEED_ADMIN_EMAIL / PASSWORD");
  process.exit(1);
}

const TS = Date.now();
const MARKER = `__phase21a1_walk_${TS}`;
const PHONE_TAIL = TS.toString().slice(-7);
const TEST_PARTY_PHONE = `9${PHONE_TAIL}99`;
const TEST_PARTY_NAME = `${MARKER}_Customer`;

const results = [];
function pass(step, note) {
  results.push({ step, status: "PASS", note });
  console.log(`✓ ${step} — ${note}`);
}
function fail(step, note) {
  results.push({ step, status: "FAIL", note });
  console.log(`✗ ${step} — ${note}`);
}

const created = {
  partyLinkedSaleId: null,
  walkInSaleId: null,
  partyId: null,
};

async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function partyBalancePaise(pgClient, partyId) {
  const r = await pgClient.query(
    `SELECT COALESCE(SUM(CASE direction WHEN 'INCREASE' THEN amount ELSE -amount END), 0) AS bal
       FROM ledger_entries WHERE "partyId" = $1 AND "deletedAt" IS NULL`,
    [partyId],
  );
  return BigInt(r.rows[0].bal);
}

async function findActiveManualPaymentId(pgClient, partyId) {
  const r = await pgClient.query(
    `SELECT id FROM ledger_entries
      WHERE "partyId" = $1 AND "entryType" = 'MANUAL_PAYMENT' AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC LIMIT 1`,
    [partyId],
  );
  return r.rows[0]?.id ?? null;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  const pgClient = new pg.Client({ connectionString: DIRECT_URL });
  await pgClient.connect();

  try {
    // ─── S1) ADMIN login + dashboard ──────────────────────────────────
    await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname.startsWith("/dashboard"), {
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    await shot(page, "01-dashboard");
    const heading = (await page.textContent("h1")) || "";
    if (heading.toLowerCase().includes("dashboard"))
      pass("S1 login + dashboard", `h1="${heading.trim()}"`);
    else fail("S1 login + dashboard", `unexpected h1: ${heading}`);

    // ─── S2) Create a party-linked SALE ───────────────────────────────
    await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
    await page.fill('input[id="party-name-input"]', TEST_PARTY_NAME).catch(
      async () => {
        await page.fill('input[id$="party-name"]', TEST_PARTY_NAME);
      },
    );
    await page.fill('input[id="party-phone-input"]', TEST_PARTY_PHONE).catch(
      async () => {
        await page.fill('input[id$="party-phone"]', TEST_PARTY_PHONE);
      },
    );
    await page.fill('input[name="lineItems.0.itemDescription"]', `${MARKER}_party_item`);
    await page.fill('input[name="lineItems.0.qty"]', "1");
    await page.fill('input[name="lineItems.0.rate"]', "1000");
    await page.getByRole("button", { name: /save/i }).first().click();
    await page.waitForURL((u) => /\/sales(?:\/|$)/.test(u.pathname), {
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");

    // Locate sale + auto-promoted party.
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await pgClient.query(
        `SELECT id, "partyId", total FROM sales
           WHERE "partyName" = $1 AND "deletedAt" IS NULL
           ORDER BY "createdAt" DESC LIMIT 1`,
        [TEST_PARTY_NAME],
      );
      if (r.rows.length === 1) {
        created.partyLinkedSaleId = r.rows[0].id;
        created.partyId = r.rows[0].partyId;
        break;
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    if (created.partyLinkedSaleId && created.partyId) {
      pass(
        "S2 party-linked sale created",
        `saleId=${created.partyLinkedSaleId.slice(0, 12)}… partyId=${created.partyId.slice(0, 12)}…`,
      );
    } else {
      fail("S2 party-linked sale created", "sale or partyId not found");
    }

    // ─── S3) /sales: party-linked row hides the status chip ───────────
    await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
    await shot(page, "03-sales-list");
    const row = page
      .getByRole("row")
      .filter({ hasText: TEST_PARTY_NAME })
      .first();
    if ((await row.count()) === 0) {
      fail("S3 row visible", "row not found on /sales");
    } else {
      // The chip renders the label text "Pending" / "Partial" /
      // "Completed" / "Refund due" inside the chip span.
      const chipText = await row.getByText(/^(Pending|Partial|Completed|Refund due)$/i).count();
      const hintVisible = await row.getByTestId("ledger-tracked-hint").count();
      if (chipText === 0 && hintVisible >= 1) {
        pass(
          "S3 party-linked sale shows NO chip; 'on ledger' hint present",
          `chip=0 hint=${hintVisible}`,
        );
      } else {
        fail(
          "S3 party-linked sale chip rendering",
          `chipText=${chipText} hintVisible=${hintVisible}`,
        );
      }
    }

    // ─── S4) Create a WALK-IN sale (partyId NULL) ─────────────────────
    await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
    // Walk-in: typing only a name (no party-picker selection) and
    // skipping the phone leaves partyId NULL on save. The form requires
    // a name; we use the marker so cleanup finds it.
    const walkInName = `${MARKER}_WalkIn`;
    await page.fill('input[id="party-name-input"]', walkInName).catch(
      async () => {
        await page.fill('input[id$="party-name"]', walkInName);
      },
    );
    // Deliberately leave phone empty → auto-promotion skips (needs phone)
    await page.fill('input[name="lineItems.0.itemDescription"]', `${MARKER}_walkin_item`);
    await page.fill('input[name="lineItems.0.qty"]', "1");
    await page.fill('input[name="lineItems.0.rate"]', "500");
    await page.getByRole("button", { name: /save/i }).first().click();
    await page.waitForURL((u) => /\/sales(?:\/|$)/.test(u.pathname), {
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");

    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await pgClient.query(
        `SELECT id, "partyId" FROM sales
           WHERE "partyName" = $1 AND "deletedAt" IS NULL
           ORDER BY "createdAt" DESC LIMIT 1`,
        [walkInName],
      );
      if (r.rows.length === 1) {
        created.walkInSaleId = r.rows[0].id;
        if (r.rows[0].partyId !== null) {
          fail("S4 walk-in sale has NULL partyId", `partyId=${r.rows[0].partyId}`);
        }
        break;
      }
      await new Promise((res) => setTimeout(res, 2000));
    }

    if (created.walkInSaleId) {
      // Now look at /sales and confirm the walk-in row DOES show the chip
      await page.goto(`${BASE}/sales`, { waitUntil: "networkidle" });
      const walkInRow = page
        .getByRole("row")
        .filter({ hasText: walkInName })
        .first();
      const walkInChip = await walkInRow
        .getByText(/^(Pending|Partial|Completed|Refund due)$/i)
        .count();
      const walkInHint = await walkInRow.getByTestId("ledger-tracked-hint").count();
      if (walkInChip >= 1 && walkInHint === 0) {
        pass(
          "S4 walk-in sale STILL shows status chip",
          `chip=${walkInChip} hint=${walkInHint}`,
        );
      } else {
        fail(
          "S4 walk-in chip rendering",
          `chip=${walkInChip} hint=${walkInHint}`,
        );
      }
    } else {
      fail("S4 walk-in sale created", "walk-in sale row not found");
    }

    // ─── S5) Record ₹10,000 overpayment via PartyLedgerPaymentModal ───
    await page.goto(`${BASE}/receivables/${created.partyId}`, {
      waitUntil: "networkidle",
    });
    await page.click('[data-testid="add-payment-button"]');
    await page.waitForSelector('input[id="party-ledger-payment-amount"]', {
      timeout: 10_000,
    });
    await page.fill('input[id="party-ledger-payment-amount"]', "10000");
    await shot(page, "05-overpayment-modal");
    // direction="receivable" → button label is "Record receipt", NOT "Record payment".
    await page.getByRole("button", { name: /record receipt/i }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const balanceAfterOverpay = await partyBalancePaise(pgClient, created.partyId);
    if (balanceAfterOverpay === -900000n) {
      pass(
        "S5 overpayment creates credit −₹9,000",
        `balance=${balanceAfterOverpay}p (₹1k sale − ₹10k payment)`,
      );
    } else {
      fail(
        "S5 overpayment balance",
        `expected -900000p, got ${balanceAfterOverpay}p`,
      );
    }

    // ─── S6) /receivables shows credit-balance party with credit styling ─
    await page.goto(`${BASE}/receivables`, { waitUntil: "networkidle" });
    await shot(page, "06-receivables-credit-balance");
    const creditRow = page
      .getByRole("row")
      .filter({ hasText: TEST_PARTY_NAME })
      .first();
    const creditBadge = await creditRow.getByTestId("credit-badge").count();
    const rowText = (await creditRow.textContent()) || "";
    // Negative outstanding renders with leading "−" (U+2212) prefix.
    const hasMinus = /[−]\s*₹/.test(rowText);
    if (creditBadge >= 1 && hasMinus) {
      pass(
        "S6 credit-balance party visible with 'Credit' badge + minus prefix",
        `badge=${creditBadge} rowText="${rowText.replace(/\s+/g, " ").trim().slice(0, 100)}"`,
      );
    } else {
      fail(
        "S6 credit styling",
        `badge=${creditBadge} hasMinus=${hasMinus} rowText="${rowText.slice(0, 120)}"`,
      );
    }

    // ─── S7) Per-party ledger: edit/delete on MANUAL_PAYMENT row;
    //                          "via source" on TRANSACTION_LINKED row ─
    await page.goto(`${BASE}/receivables/${created.partyId}`, {
      waitUntil: "networkidle",
    });
    await shot(page, "07-party-ledger-actions");
    const editButtons = await page.getByTestId("ledger-edit-button").count();
    const deleteButtons = await page.getByTestId("ledger-delete-button").count();
    const readonlyHints = await page.getByTestId("ledger-readonly-hint").count();
    if (editButtons >= 1 && deleteButtons >= 1 && readonlyHints >= 1) {
      pass(
        "S7 ledger row actions: edit+delete on MANUAL_PAYMENT, 'via source' on TRANSACTION_LINKED",
        `edit=${editButtons} delete=${deleteButtons} readonly=${readonlyHints}`,
      );
    } else {
      fail(
        "S7 ledger row actions",
        `edit=${editButtons} delete=${deleteButtons} readonly=${readonlyHints}`,
      );
    }

    // ─── S8) Edit payment ₹10,000 → ₹1,000 → balance = 0 ──────────────
    await page.getByTestId("ledger-edit-button").first().click();
    await page.waitForSelector('input[id="party-ledger-payment-amount"]', {
      timeout: 10_000,
    });
    // Verify it's prefilled with 10000.00
    const prefill = await page.inputValue('input[id="party-ledger-payment-amount"]');
    const prefillNum = Number(prefill);
    if (Math.abs(prefillNum - 10000) < 0.01) {
      pass("S8a edit modal prefilled with ₹10,000", `value="${prefill}"`);
    } else {
      fail("S8a edit modal prefill", `value="${prefill}"`);
    }
    // Edit to 1000
    await page.fill('input[id="party-ledger-payment-amount"]', "1000");
    await shot(page, "08-edit-modal");
    await page.getByRole("button", { name: /save changes/i }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const balanceAfterEdit = await partyBalancePaise(pgClient, created.partyId);
    if (balanceAfterEdit === 0n) {
      pass(
        "S8b after edit ₹10,000 → ₹1,000, balance = ₹0",
        `balance=${balanceAfterEdit}p`,
      );
    } else {
      fail(
        "S8b balance after edit",
        `expected 0p, got ${balanceAfterEdit}p`,
      );
    }

    // ─── S9) Delete payment → balance = ₹1,000 ────────────────────────
    await page.goto(`${BASE}/receivables/${created.partyId}`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("ledger-delete-button").first().click();
    // The Delete? confirm button appears via the in-row inline confirm.
    await page.getByRole("button", { name: /confirm delete/i }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const balanceAfterDelete = await partyBalancePaise(pgClient, created.partyId);
    if (balanceAfterDelete === 100000n) {
      pass(
        "S9 after delete, balance = ₹1,000 (full sale outstanding)",
        `balance=${balanceAfterDelete}p`,
      );
    } else {
      fail(
        "S9 balance after delete",
        `expected 100000p, got ${balanceAfterDelete}p`,
      );
    }

    // ─── S10) Create a NEW payment ₹200 → balance = ₹800 ──────────────
    await page.goto(`${BASE}/receivables/${created.partyId}`, {
      waitUntil: "networkidle",
    });
    await page.click('[data-testid="add-payment-button"]');
    await page.waitForSelector('input[id="party-ledger-payment-amount"]', {
      timeout: 10_000,
    });
    await page.fill('input[id="party-ledger-payment-amount"]', "200");
    // direction="receivable" → "Record receipt", not "Record payment".
    await page.getByRole("button", { name: /record receipt/i }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const balanceAfterNewPayment = await partyBalancePaise(pgClient, created.partyId);
    if (balanceAfterNewPayment === 80000n) {
      pass(
        "S10 new payment ₹200 → balance = ₹800 (create alongside edit confirmed)",
        `balance=${balanceAfterNewPayment}p`,
      );
    } else {
      fail(
        "S10 balance after new payment",
        `expected 80000p, got ${balanceAfterNewPayment}p`,
      );
    }
    await shot(page, "10-after-new-payment");

    // ─── S11) Cleanup ─────────────────────────────────────────────────
    await pgClient.query("BEGIN");
    if (created.partyLinkedSaleId) {
      await pgClient.query(
        `UPDATE sales SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
        [created.partyLinkedSaleId],
      );
    }
    if (created.walkInSaleId) {
      await pgClient.query(
        `UPDATE sales SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
        [created.walkInSaleId],
      );
    }
    if (created.partyId) {
      // Tombstone all active ledger entries for this party (the
      // TRANSACTION_LINKED entry from the sale + any remaining
      // MANUAL_PAYMENT entries from S10).
      await pgClient.query(
        `UPDATE ledger_entries SET "deletedAt" = NOW(), "updatedAt" = NOW()
           WHERE "partyId" = $1 AND "deletedAt" IS NULL`,
        [created.partyId],
      );
      await pgClient.query(
        `UPDATE parties SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
        [created.partyId],
      );
    }
    await pgClient.query("COMMIT");
    pass(
      "S11 cleanup complete",
      "2 sales + ledger entries + auto-promoted party tombstoned",
    );

    await pgClient.end();
  } catch (err) {
    console.error("WALKTHROUGH ERROR:", err);
    try {
      const c = new pg.Client({ connectionString: DIRECT_URL });
      await c.connect();
      if (created.partyLinkedSaleId) {
        await c.query(
          `UPDATE sales SET "deletedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
          [created.partyLinkedSaleId],
        );
      }
      if (created.walkInSaleId) {
        await c.query(
          `UPDATE sales SET "deletedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
          [created.walkInSaleId],
        );
      }
      if (created.partyId) {
        await c.query(
          `UPDATE ledger_entries SET "deletedAt" = NOW() WHERE "partyId" = $1 AND "deletedAt" IS NULL`,
          [created.partyId],
        );
        await c.query(
          `UPDATE parties SET "deletedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
          [created.partyId],
        );
      }
      await c.end();
      console.error("emergency cleanup done");
    } catch (cleanupErr) {
      console.error("emergency cleanup failed:", cleanupErr);
    }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log("");
  console.log(`===== walkthrough-p21a1 — ${passed} PASS / ${failed} FAIL =====`);
  console.log(`marker: ${MARKER}`);
  for (const r of results)
    console.log(`  ${r.status === "PASS" ? "✓" : "✗"} ${r.step}: ${r.note}`);
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

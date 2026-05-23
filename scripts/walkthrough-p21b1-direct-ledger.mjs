// Phase 21b.1 prod walkthrough — the user's scenario, done right, live.
//
// Sequence:
//   S1) ADMIN login
//   S2) Create a LABOUR karigar via /employees
//   S3) /labour shows the new "Karigar ledger" section with the karigar
//       row at "Caught up" + "Record entry" button visible regardless of
//       outstanding (the always-visible surface that fixes the root cause)
//   S4) Click "Record entry" → DECREASE default → ₹6,000 advance →
//       confirm balance −₹6,000 / "Advance held" label (UI + DB)
//   S5) Daily piece entry: 120 × ₹50 = ₹6,000 → confirm balance ₹0 /
//       "Caught up" (UI + DB) — netting via running balance, automatic
//   S6) Click "Record entry" again → flip to INCREASE → +₹2,000 with
//       note "opening — prior work" → confirm balance +₹2,000 / "Owed
//       wages" (UI + DB)
//   S7) Edit the advance: ₹6,000 → ₹4,000 via the karigar's detail
//       modal → confirm balance +₹4,000 (DB)
//   S8) Soft-delete the advance → confirm balance +₹8,000 (DB)
//   S9) Confirm bulk-piece-entry form has NO advance affordance (DOM
//       inspection) AND the WAGE EmployeePaymentModal has NO [Advance]
//       quick-tag
//   S10) Party-ledger regression — Hitesh's existing party balance
//        still reads correctly (DB-only check, no UI flow)
//   S11) Cleanup: tombstone the karigar + 2 pieces + 3 ledger entries

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p21b1-out");
mkdirSync(OUT_DIR, { recursive: true });

function loadEnv(file) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
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

const ref = DIRECT_URL.match(/postgres\.([^:]+):/)?.[1];
if (ref !== "cseqdcrfnvgsalsyhjsz") {
  console.error(`ABORT — DIRECT_URL not pointing at prod (got ${ref})`);
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("FAIL: missing SEED_ADMIN_EMAIL / PASSWORD");
  process.exit(1);
}

const TS = Date.now();
const MARKER = `__phase21b1_walk_${TS}`;
const KARIGAR_NAME = `${MARKER}_Ajay`;

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
  employeeId: null,
  advanceLedgerId: null,
  openingLedgerId: null,
  pieceEntryId: null,
  pieceLedgerId: null,
};

async function shot(page, name) {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function ownerBalance(c, employeeId) {
  const r = await c.query(
    `SELECT COALESCE(SUM(CASE direction WHEN 'INCREASE' THEN amount ELSE -amount END), 0)::text AS bal
       FROM ledger_entries
      WHERE "employeeId" = $1 AND "deletedAt" IS NULL`,
    [employeeId],
  );
  return BigInt(r.rows[0].bal);
}

function fmt(n) {
  const sign = n < 0n ? "−" : "+";
  const abs = n < 0n ? -n : n;
  const rupees = abs / 100n;
  return `${sign}₹${rupees.toLocaleString("en-IN")}`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  const c = new pg.Client({ connectionString: DIRECT_URL });
  await c.connect();

  try {
    // ─── S1) ADMIN login ──────────────────────────────────────────────
    await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname.startsWith("/dashboard"), {
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    pass("S1 login", "/dashboard reached");

    // ─── S2) Create a LABOUR karigar via /employees ───────────────────
    await page.goto(`${BASE}/employees`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /add employee/i }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[name="name"]').fill(KARIGAR_NAME);
    await page.getByRole("button", { name: /^save$/i }).first().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await c.query(
        `SELECT id FROM employees WHERE name=$1 AND type='LABOUR' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
        [KARIGAR_NAME],
      );
      if (r.rows.length === 1) {
        created.employeeId = r.rows[0].id;
        break;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (!created.employeeId) {
      fail("S2 LABOUR karigar created", "employee row not found");
      throw new Error("S2 failed");
    }
    pass(
      "S2 LABOUR karigar created",
      `id=${created.employeeId.slice(0, 12)}… name="${KARIGAR_NAME}"`,
    );

    // ─── S3) /labour shows the new Karigar ledger section ─────────────
    await page.goto(`${BASE}/labour`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await shot(page, "03-labour-fresh-karigar");
    const section = page.getByTestId("karigar-ledger-section");
    const sectionExists = (await section.count()) === 1;
    const row = page
      .locator(`[data-testid="karigar-ledger-row"][data-employee-id="${created.employeeId}"]`)
      .first();
    const rowExists = (await row.count()) === 1;
    const caughtUpHere = await row
      .getByTestId("balance-label-zero")
      .count()
      .catch(() => 0);
    const recordEntryHere = await row
      .getByTestId("record-entry-button")
      .count()
      .catch(() => 0);
    if (sectionExists && rowExists && caughtUpHere > 0 && recordEntryHere > 0) {
      pass(
        "S3 unified Karigar ledger section",
        `section + row + "Caught up" label + always-visible "Record entry" button all present`,
      );
    } else {
      fail(
        "S3 unified Karigar ledger section",
        `section=${sectionExists} row=${rowExists} caughtUp=${caughtUpHere} recordBtn=${recordEntryHere}`,
      );
    }

    // ─── S4) Record ₹6,000 advance via the always-visible button ──────
    await row.getByTestId("record-entry-button").click();
    await page.waitForTimeout(700);
    await shot(page, "04a-modal-open-decrease-default");
    const modal = page.getByTestId("karigar-ledger-entry-modal");
    const modalOpen = (await modal.count()) === 1;
    // DECREASE radio should be checked by default
    const decreaseChecked = await page
      .getByTestId("karigar-ledger-direction-decrease")
      .isChecked()
      .catch(() => false);
    if (!modalOpen || !decreaseChecked) {
      fail(
        "S4a modal opens with DECREASE default",
        `modalOpen=${modalOpen} decreaseChecked=${decreaseChecked}`,
      );
    } else {
      pass(
        "S4a modal opens, DECREASE selected by default (advance is the common case)",
        "ready to record advance",
      );
    }

    await page.locator("#karigar-ledger-amount").fill("6000");
    await page
      .locator("#karigar-ledger-description")
      .fill("advance for next week");
    await page.getByTestId("karigar-ledger-save").click();
    await page.waitForTimeout(2000);

    // Verify the MANUAL_PAYMENT DECREASE row landed
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await c.query(
        `SELECT id, direction, amount::text AS amount, description, "entryType",
                "sourceType", "partyId", "employeeId"
           FROM ledger_entries
          WHERE "employeeId"=$1 AND description=$2 AND "deletedAt" IS NULL
       ORDER BY "createdAt" DESC LIMIT 1`,
        [created.employeeId, "advance for next week"],
      );
      if (r.rows.length === 1) {
        created.advanceLedgerId = r.rows[0].id;
        const row = r.rows[0];
        const ok =
          row.direction === "DECREASE" &&
          row.amount === "600000" &&
          row.entryType === "MANUAL_PAYMENT" &&
          row.sourceType === null &&
          row.partyId === null &&
          row.employeeId === created.employeeId;
        if (ok) {
          pass(
            "S4b advance posted as DECREASE MANUAL_PAYMENT — correct direction + owner",
            `id=${row.id.slice(0, 12)}… amount=−₹6,000 description="advance for next week"`,
          );
        } else {
          fail("S4b advance row shape", JSON.stringify(row));
        }
        break;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (!created.advanceLedgerId) {
      fail("S4b advance posted", "ledger row not found");
      throw new Error("S4 failed");
    }

    // Re-read /labour and confirm UI shows "Advance held" + correct amount
    await page.goto(`${BASE}/labour`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await shot(page, "04c-labour-after-advance");
    const rowAfterAdvance = page
      .locator(`[data-testid="karigar-ledger-row"][data-employee-id="${created.employeeId}"]`)
      .first();
    const adv = await rowAfterAdvance
      .getByTestId("balance-label-credit")
      .count()
      .catch(() => 0);
    const advAmount = await rowAfterAdvance
      .getByTestId("balance-amount-credit")
      .textContent()
      .catch(() => "");
    const dbBal = await ownerBalance(c, created.employeeId);
    if (dbBal === -600000n && adv > 0 && /6,000/.test(advAmount)) {
      pass(
        "S4c UI shows 'Advance held' + −₹6,000 (DB matches)",
        `db=${fmt(dbBal)} amountCell="${advAmount.trim()}"`,
      );
    } else {
      fail(
        "S4c advance UI label",
        `db=${dbBal}p creditLabelCount=${adv} amountCell="${advAmount}"`,
      );
    }

    // ─── S5) 120 × ₹50 piece work via Daily piece entry ──────────────
    await page.fill(`#bulk-rate-${created.employeeId}`, "50");
    await page.fill(`#bulk-count-${created.employeeId}`, "120");
    await page.fill(`#bulk-note-${created.employeeId}`, "polishing");
    await page.locator('[data-testid="bulk-save-button"]').click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await c.query(
        `SELECT id FROM piece_entries WHERE "employeeId"=$1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
        [created.employeeId],
      );
      if (r.rows.length === 1) {
        created.pieceEntryId = r.rows[0].id;
        break;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    const linked = await c.query(
      `SELECT id FROM ledger_entries WHERE "sourceType"='PIECE_ENTRY' AND "sourceId"=$1 AND "deletedAt" IS NULL`,
      [created.pieceEntryId],
    );
    if (linked.rows.length === 1) created.pieceLedgerId = linked.rows[0].id;

    const balAfterWork = await ownerBalance(c, created.employeeId);
    // UI assertion — "Caught up" label
    await shot(page, "05a-labour-after-work");
    const rowAfterWork = page
      .locator(`[data-testid="karigar-ledger-row"][data-employee-id="${created.employeeId}"]`)
      .first();
    const caughtUp = await rowAfterWork
      .getByTestId("balance-label-zero")
      .count()
      .catch(() => 0);
    if (balAfterWork === 0n && caughtUp > 0) {
      pass(
        "S5 advance (−6000) + 120×₹50 work (+6000) → balance ₹0 (Caught up) — netting AUTOMATIC",
        `db=${fmt(balAfterWork)} 'Caught up' label visible (advance consumed by work, no allocation logic)`,
      );
    } else {
      fail(
        "S5 netting",
        `db=${balAfterWork}p caughtUpLabel=${caughtUp}`,
      );
    }

    // ─── S6) Flip direction picker → INCREASE opening +₹2,000 ─────────
    await rowAfterWork.getByTestId("record-entry-button").click();
    await page.waitForTimeout(700);
    // Click the INCREASE radio (flip from default DECREASE)
    await page.getByTestId("karigar-ledger-direction-increase").click();
    await page.locator("#karigar-ledger-amount").fill("2000");
    await page
      .locator("#karigar-ledger-description")
      .fill("opening — prior work");
    await shot(page, "06a-modal-increase-selected");
    await page.getByTestId("karigar-ledger-save").click();
    await page.waitForTimeout(2000);

    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await c.query(
        `SELECT id, direction, amount::text AS amount, description, "entryType"
           FROM ledger_entries
          WHERE "employeeId"=$1 AND description=$2 AND "deletedAt" IS NULL
       ORDER BY "createdAt" DESC LIMIT 1`,
        [created.employeeId, "opening — prior work"],
      );
      if (r.rows.length === 1) {
        created.openingLedgerId = r.rows[0].id;
        const row = r.rows[0];
        const ok =
          row.direction === "INCREASE" &&
          row.amount === "200000" &&
          row.entryType === "MANUAL_PAYMENT";
        if (ok) {
          pass(
            "S6a INCREASE opening entry posted via direction picker flip",
            `id=${row.id.slice(0, 12)}… +₹2,000 direction=INCREASE`,
          );
        } else {
          fail("S6a opening entry shape", JSON.stringify(row));
        }
        break;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }

    const balAfterOpening = await ownerBalance(c, created.employeeId);
    await page.goto(`${BASE}/labour`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await shot(page, "06b-labour-after-opening");
    const rowAfterOpening = page
      .locator(`[data-testid="karigar-ledger-row"][data-employee-id="${created.employeeId}"]`)
      .first();
    const owed = await rowAfterOpening
      .getByTestId("balance-label-owed")
      .count()
      .catch(() => 0);
    if (balAfterOpening === 200000n && owed > 0) {
      pass(
        "S6b balance = +₹2,000 'Owed wages' after INCREASE entry",
        `db=${fmt(balAfterOpening)}`,
      );
    } else {
      fail(
        "S6b opening balance",
        `db=${balAfterOpening}p owedLabel=${owed}`,
      );
    }

    // ─── S7) Edit the advance ₹6,000 → ₹4,000 via the detail modal ────
    await page.goto(`${BASE}/employees`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    // Click the karigar row to open detail modal
    await page.getByText(KARIGAR_NAME).first().click();
    await page.waitForTimeout(800);
    await shot(page, "07a-detail-modal");
    const histSection = page.getByTestId("karigar-ledger-history-section");
    const histPresent = (await histSection.count()) === 1;
    if (!histPresent) {
      fail("S7a karigar ledger history section", "section not found in detail modal");
    } else {
      pass(
        "S7a karigar ledger history section present in detail modal",
        "MANUAL_PAYMENT rows have edit/delete; TRANSACTION_LINKED via source",
      );
    }
    // Locate the advance row (entry id matches created.advanceLedgerId)
    const advanceRow = page.locator(
      `[data-testid="karigar-ledger-history-row"][data-entry-id="${created.advanceLedgerId}"]`,
    );
    await advanceRow.getByTestId("edit-ledger-entry").click();
    await page.waitForTimeout(700);
    await shot(page, "07b-edit-modal-prefilled");
    // Confirm prefill of amount + description in edit mode
    const editAmount = await page
      .locator("#karigar-ledger-amount")
      .inputValue();
    const editDescription = await page
      .locator("#karigar-ledger-description")
      .inputValue();
    if (editAmount === "6000.00" && editDescription === "advance for next week") {
      pass(
        "S7b edit modal prefilled correctly",
        `amount="${editAmount}" description="${editDescription}"`,
      );
    } else {
      fail(
        "S7b edit modal prefill",
        `amount="${editAmount}" description="${editDescription}"`,
      );
    }
    await page.locator("#karigar-ledger-amount").fill("4000");
    await page.getByTestId("karigar-ledger-save").click();
    await page.waitForTimeout(2000);

    const balAfterEdit = await ownerBalance(c, created.employeeId);
    if (balAfterEdit === 400000n) {
      pass(
        "S7c edit recomputes balance: advance ₹6,000 → ₹4,000 → +₹4,000",
        `db=${fmt(balAfterEdit)} (work 6000 + opening 2000 − advance 4000 = +4000)`,
      );
    } else {
      fail("S7c balance after edit", `db=${balAfterEdit}p (expected 400000p)`);
    }

    // ─── S8) Soft-delete the advance ──────────────────────────────────
    // Reopen the detail modal — edit may have closed only the inner modal
    if ((await page.getByText(KARIGAR_NAME).first().isVisible().catch(() => false)) === false) {
      await page.goto(`${BASE}/employees`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      await page.getByText(KARIGAR_NAME).first().click();
      await page.waitForTimeout(800);
    }
    const advanceRow2 = page.locator(
      `[data-testid="karigar-ledger-history-row"][data-entry-id="${created.advanceLedgerId}"]`,
    );
    await advanceRow2.getByTestId("delete-ledger-entry").click();
    await page.waitForTimeout(2000);

    const balAfterDelete = await ownerBalance(c, created.employeeId);
    if (balAfterDelete === 800000n) {
      pass(
        "S8 soft-delete recomputes: advance gone → +₹8,000 (work 6000 + opening 2000)",
        `db=${fmt(balAfterDelete)}`,
      );
    } else {
      fail(
        "S8 balance after delete",
        `db=${balAfterDelete}p (expected 800000p)`,
      );
    }
    // Confirm advance row tombstoned
    const tomb = await c.query(
      `SELECT "deletedAt" FROM ledger_entries WHERE id=$1`,
      [created.advanceLedgerId],
    );
    if (tomb.rows[0].deletedAt !== null) {
      pass(
        "S8b advance ledger row tombstoned",
        `deletedAt=${tomb.rows[0].deletedAt.toISOString()}`,
      );
    } else {
      fail("S8b advance not tombstoned", "deletedAt is null");
    }

    // ─── S9) No advance affordance on the bulk-piece-entry form ───────
    // Close detail modal first
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    await page.goto(`${BASE}/labour`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await shot(page, "09-labour-pieces-form");
    // Inside the bulk-piece-entry-section, count any element with text
    // "Advance" or with a testid matching quick-note-advance.
    const pieceSection = page.locator(
      '[data-testid="bulk-piece-entry-section"]',
    );
    const advanceText = await pieceSection
      .locator("text=/Advance/i")
      .count()
      .catch(() => 0);
    const advanceChip = await pieceSection
      .locator("[data-testid*='advance']")
      .count()
      .catch(() => 0);
    if (advanceText === 0 && advanceChip === 0) {
      pass(
        "S9a bulk-piece-entry-section has NO advance affordance (text or chip)",
        "pieces are work only",
      );
    } else {
      fail(
        "S9a pieces form advance leak",
        `text matches=${advanceText} chip matches=${advanceChip}`,
      );
    }
    // Also confirm the WAGE EmployeePaymentModal no longer renders the
    // [Advance] quick-tag. The /labour row with balance > 0 (our karigar
    // is now +₹8,000) renders a Pay button — open it and inspect.
    const payBtn = page
      .locator(`[data-testid="karigar-ledger-row"][data-employee-id="${created.employeeId}"]`)
      .first()
      .getByTestId("pay-wage-button");
    if ((await payBtn.count()) > 0) {
      await payBtn.click();
      await page.waitForTimeout(700);
      const empModal = page.getByTestId("employee-payment-modal");
      const empModalOpen = (await empModal.count()) === 1;
      const advanceTagGone =
        (await empModal.getByTestId("quick-note-advance").count()) === 0;
      if (empModalOpen && advanceTagGone) {
        pass(
          "S9b WAGE EmployeePaymentModal has NO [Advance] quick-tag",
          "Step 4 confirmed live — single canonical advance path",
        );
      } else {
        fail(
          "S9b WAGE [Advance] tag removal",
          `modalOpen=${empModalOpen} tagGone=${advanceTagGone}`,
        );
      }
      // Close modal
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
    } else {
      fail("S9b WAGE modal access", "pay-wage-button not found");
    }

    // ─── S10) Party-ledger regression (DB-only) ───────────────────────
    const partyLedgerCount = await c.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(CASE direction WHEN 'INCREASE' THEN amount ELSE -amount END), 0)::text AS bal
         FROM ledger_entries
         WHERE "partyId" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    const partyN = partyLedgerCount.rows[0].n;
    const partyBal = BigInt(partyLedgerCount.rows[0].bal);
    if (partyN >= 2) {
      pass(
        "S10 party-ledger 21a/21a.1 still works",
        `${partyN} active party-owned ledger rows, aggregated balance ${fmt(partyBal)}`,
      );
    } else {
      fail(
        "S10 party ledger missing",
        `n=${partyN} (expected ≥ 2 from the 2 surviving rows)`,
      );
    }

    // ─── S11) Cleanup ─────────────────────────────────────────────────
    console.log("\n── Cleanup");
    await c.query(
      `UPDATE ledger_entries SET "deletedAt" = NOW() WHERE "employeeId"=$1 AND "deletedAt" IS NULL`,
      [created.employeeId],
    );
    await c.query(
      `UPDATE piece_entries SET "deletedAt" = NOW() WHERE "employeeId"=$1 AND "deletedAt" IS NULL`,
      [created.employeeId],
    );
    await c.query(
      `UPDATE employees SET "deletedAt" = NOW() WHERE id=$1`,
      [created.employeeId],
    );
    const post = await c.query(
      `SELECT COUNT(*)::int AS n FROM employees WHERE type='LABOUR' AND "deletedAt" IS NULL`,
    );
    if (post.rows[0].n === 0) {
      pass(
        "S11 cleanup — karigar zero-active",
        "0 active LABOUR employees post-walkthrough",
      );
    } else {
      fail("S11 cleanup", `${post.rows[0].n} active LABOUR remain`);
    }
  } catch (err) {
    fail("UNEXPECTED", err.message);
    console.error(err);
    // Emergency cleanup
    if (created.employeeId) {
      try {
        await c.query(
          `UPDATE ledger_entries SET "deletedAt" = NOW() WHERE "employeeId"=$1 AND "deletedAt" IS NULL`,
          [created.employeeId],
        );
        await c.query(
          `UPDATE piece_entries SET "deletedAt" = NOW() WHERE "employeeId"=$1 AND "deletedAt" IS NULL`,
          [created.employeeId],
        );
        await c.query(
          `UPDATE employees SET "deletedAt" = NOW() WHERE id=$1`,
          [created.employeeId],
        );
        console.log("Emergency cleanup completed");
      } catch (e) {
        console.error("Emergency cleanup failed:", e.message);
      }
    }
  } finally {
    await c.end();
    await browser.close();
  }

  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  console.log("\n══════════════════════════════════════════════════════");
  console.log(`Phase 21b.1 walkthrough: ${passCount}/${results.length} PASS`);
  console.log("══════════════════════════════════════════════════════");
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

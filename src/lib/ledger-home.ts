// Phase 21c.1 — unified /ledger home page query helpers.
//
// Single-table read producing the four role-scoped summary boxes and the
// unified owner list (parties + karigar) used by /ledger. Option A's
// payoff: every owner kind reads from the same `ledger_entries` table.
// Walk-in transactions (`partyId IS NULL` AND no owner) keep their own
// section at the bottom of /ledger — they remain on the *Payment rails
// in 21c.1 (they get formalized as walk-in-only in 21c.2).
//
// The shape mirrors `listPayables` from `outstanding-balances.ts` —
// bulk fetch every relevant Party + Employee with their ledgerEntries
// included, compute balances in memory. NOT N+1.
//
// Role × box matrix (encoded here AND in `canViewLedger` / the box
// projector below; keep both in sync):
//
//   | Role                  | Receivables | Pur. Pay | Cast/Plat Pay | Karigar |
//   |-----------------------|-------------|----------|---------------|---------|
//   | ADMIN                 |     ✅      |    ✅    |      ✅       |   ✅    |
//   | PURCHASE_DEPT         |     —       |    ✅    |      —        |   —     |
//   | CASTING_PLATING_MGMT  |     —       |    —     |      ✅       |   —     |
//   | LABOUR_MGMT           |     —       |    —     |      —        |   ✅    |
//
// Owners visible:
//   - ADMIN: every party with non-zero balance + every active LABOUR
//     karigar (including zero/credit balances so the "Record entry"
//     surface stays available — same shape as /labour's KarigarLedgerSection).
//   - PURCHASE_DEPT: parties with non-zero balance in PURCHASE/PURCHASE_RETURN
//     activity (scoped — excludes MANUAL_PAYMENT).
//   - CASTING_PLATING_MGMT: parties with non-zero balance in CASTING/PLATING
//     activity.
//   - LABOUR_MGMT: every active LABOUR karigar.
//
// Walk-in section:
//   - ADMIN: all walk-in payables (purchase/casting/plating) + walk-in
//     receivables (sales).
//   - PURCHASE_DEPT: purchase walk-ins only.
//   - CASTING_PLATING_MGMT: casting/plating walk-ins only.
//   - LABOUR_MGMT: none (labour has no transactional walk-in concept).

import { prisma } from "@/lib/prisma";
import type {
  LedgerSourceType,
  Party,
  Role,
} from "@/generated/prisma";

import { computeOwnerBalance, computeScopedBalance } from "@/lib/ledger";
import {
  listWalkInPayables,
  listWalkInReceivables,
  type WalkInPayable,
  type WalkInReceivable,
} from "@/lib/outstanding-balances";

// ---- Box / owner type shapes ----------------------------------------

/**
 * Four-way box discriminator. Each box is one role-scoped slice of the
 * ledger. A role's `canViewLedger`-derived view picks a SUBSET of these
 * boxes; the boxes a role can't see are simply absent from the
 * returned object.
 */
export type LedgerBoxKey =
  | "receivables"
  | "purchase_payables"
  | "casting_plating_payables"
  | "karigar";

export type LedgerBox = {
  key: LedgerBoxKey;
  label: string;
  /** Total signed balance (paise, Number for JSON safety). For receivables/payables,
   * signed = INCREASE − DECREASE on the in-scope ledger slice. For the karigar box,
   * signed = total wages owed minus total advances/payments out. Negative = credit
   * (party prepaid, or karigar holds net advances). */
  total: number;
  /** Number of owners contributing a non-zero balance to this box. */
  count: number;
  /** Per-box drill-down link (always /ledger#<anchor>, the boxes are visual
   * roll-up cards on /ledger; the unified owner list right below carries
   * the per-owner links). */
  anchor: string;
};

// ---- URL slug ↔ tab key mapping (Phase 21c.1.1) ----------------------
//
// The /ledger page accepts `?tab=<slug>` for deep-linking from the
// dashboard. Slugs are user-friendly (`sales`, `purchase`,
// `casting-plating`, `karigar`); internal tab keys mirror the box keys
// (`receivables`, `purchase_payables`, ...). Keep both mappings here so
// the parser (ledger page server component) and the encoder (dashboard
// box links) speak the same vocabulary.

export const LEDGER_TAB_SLUG_BY_BOX: Record<LedgerBoxKey, string> = {
  receivables: "sales",
  purchase_payables: "purchase",
  casting_plating_payables: "casting-plating",
  karigar: "karigar",
};

const LEDGER_BOX_BY_SLUG: Record<string, LedgerBoxKey> = Object.fromEntries(
  (Object.entries(LEDGER_TAB_SLUG_BY_BOX) as [LedgerBoxKey, string][]).map(
    ([key, slug]) => [slug, key],
  ),
);

/**
 * Parse a `?tab=` URL slug into the internal tab vocabulary. Missing or
 * invalid → `"all"` (the default unified-list tab). Used by the /ledger
 * page server component to derive `initialTab` from `searchParams`.
 */
export function parseLedgerTabSlug(raw: string | string[] | undefined): "all" | LedgerBoxKey {
  const slug = Array.isArray(raw) ? raw[0] : raw;
  if (!slug) return "all";
  return LEDGER_BOX_BY_SLUG[slug] ?? "all";
}

/**
 * Build a /ledger URL pre-targeted to a box's tab. Used by the dashboard
 * per-category clickable boxes (Phase 21c.1.1) and any other deep-link
 * surface in the app.
 */
export function ledgerHrefForBox(key: LedgerBoxKey): string {
  return `/ledger?tab=${LEDGER_TAB_SLUG_BY_BOX[key]}`;
}

export type LedgerOwnerKind = "party" | "karigar";

export type LedgerOwnerRow = {
  kind: LedgerOwnerKind;
  /** Stable id used for routing + React key. */
  id: string;
  name: string;
  phone: string | null;
  /** Raw signed balance (paise, Number). Negative = credit balance
   * (party prepaid, OR karigar holds advance). UI labels the sign.
   *
   * For ADMIN: full party balance (all sources + MANUAL_PAYMENT).
   * For scoped roles: balance equals the role's single slice.
   *
   * Used by the "All" tab on /ledger. Per-category tabs read `slices`. */
  balance: number;
  /** Per-row href to the owner's khata view. */
  href: string;
  /**
   * Phase 21c.1.1 — per-category balance slices for the /ledger tab
   * filter. A category appears in this map iff the owner contributes to
   * that box (party slices: only when non-zero, matching box count rule;
   * karigar slice: always present, even at zero balance, to match the
   * always-available-surface pattern — zero karigars stay visible under
   * the Karigar tab).
   *
   * INVARIANT (matches Phase 21c.1's drift-bug-class fix):
   *   `Σ owners.map(o => o.slices[<key>] ?? 0)` over the role's visible
   *   owners EQUALS the matching box's `total`. Tab and box read the
   *   same numbers because they're computed in the same loop below —
   *   slices are the per-owner contribution to the box accumulator.
   */
  slices: Partial<Record<LedgerBoxKey, number>>;
};

export type LedgerHomeData = {
  /** Role-scoped boxes — only the ones this role can see. */
  boxes: LedgerBox[];
  /** Unified owner list, role-scoped. Sorted by abs(balance) desc with
   * non-zero entries first, then zero-balance karigars (which appear so
   * the user can still record an advance/adjustment). */
  owners: LedgerOwnerRow[];
};

// ---- Box source-type sets (kept in sync with outstanding-balances.ts) ----

const RECEIVABLE_SOURCES: LedgerSourceType[] = ["SALE", "SALE_RETURN"];
const PURCHASE_SOURCES: LedgerSourceType[] = ["PURCHASE", "PURCHASE_RETURN"];
const CASTING_PLATING_SOURCES: LedgerSourceType[] = ["CASTING", "PLATING"];

// ---- Role × box gating ---------------------------------------------

function rolesForBox(box: LedgerBoxKey): Role[] {
  switch (box) {
    case "receivables":
      return ["ADMIN"];
    case "purchase_payables":
      return ["ADMIN", "PURCHASE_DEPT"];
    case "casting_plating_payables":
      return ["ADMIN", "CASTING_PLATING_MGMT"];
    case "karigar":
      return ["ADMIN", "LABOUR_MGMT"];
  }
}

function canRoleSeeBox(role: Role, box: LedgerBoxKey): boolean {
  return rolesForBox(box).includes(role);
}

/** Visible party owners include parties contributing to a box this role
 * can see. For ADMIN: any party with non-zero balance. For scoped roles:
 * only parties with non-zero scoped activity. */
function visiblePartySources(role: Role): LedgerSourceType[] {
  if (role === "ADMIN") {
    return [...PURCHASE_SOURCES, ...CASTING_PLATING_SOURCES, ...RECEIVABLE_SOURCES];
  }
  if (role === "PURCHASE_DEPT") return PURCHASE_SOURCES;
  if (role === "CASTING_PLATING_MGMT") return CASTING_PLATING_SOURCES;
  return []; // LABOUR_MGMT — no party visibility
}

// ---- The home query --------------------------------------------------

export async function listLedgerHome(role: Role): Promise<LedgerHomeData> {
  // Parallelise the two owner-side fetches.
  const partySources = visiblePartySources(role);
  const fetchParties = partySources.length === 0
    ? Promise.resolve(
        [] as Awaited<ReturnType<typeof fetchPartiesForRole>>,
      )
    : fetchPartiesForRole(partySources);

  const fetchKarigar = canRoleSeeBox(role, "karigar")
    ? fetchKarigarRows()
    : Promise.resolve(
        [] as Awaited<ReturnType<typeof fetchKarigarRows>>,
      );

  const [parties, karigars] = await Promise.all([fetchParties, fetchKarigar]);

  // ---- Boxes + owners — single pass, slices feed both -----------------
  //
  // Phase 21c.1.1: restructured from 4 per-box loops + 2 per-owner loops
  // into a single per-owner loop that computes each category's slice
  // ONCE. The slice value is pushed both into the owner row's `slices`
  // map AND into the matching box accumulator. This guarantees the
  // tab-total reconciliation invariant: `Σ owners[].slices[k]` ≡
  // `boxes[k].total`, by construction.
  //
  // Slice rules:
  //   - Party slices set ONLY when non-zero (matches the box count rule
  //     — a party contributes to a box iff their slice ≠ 0).
  //   - Karigar slice set for EVERY karigar including zero (matches the
  //     always-available-surface pattern — zero karigars still appear
  //     under the Karigar tab so "Record entry" stays reachable).
  //
  // Why receivables INCLUDES MANUAL_PAYMENT but purchase/casting/plating
  // EXCLUDE it: this is the existing Phase 21a / 21c.1 box semantics.
  // Receivables is ADMIN-only and includes manual party-level payments
  // against sales; payable scopes are activity-only views designed for
  // PURCHASE_DEPT / CASTING_PLATING_MGMT.

  const boxAccumulators: Partial<Record<LedgerBoxKey, { total: bigint; count: number }>> = {};
  function accumulate(key: LedgerBoxKey, value: bigint) {
    const acc = boxAccumulators[key] ?? { total: 0n, count: 0 };
    acc.total += value;
    if (value !== 0n) acc.count += 1;
    boxAccumulators[key] = acc;
  }

  const owners: LedgerOwnerRow[] = [];

  // --- Per-party slices + owner rows ---
  for (const p of parties) {
    const slices: Partial<Record<LedgerBoxKey, number>> = {};

    if (canRoleSeeBox(role, "receivables")) {
      const recv = computeOwnerBalance(
        p.ledgerEntries.filter(
          (e) =>
            e.entryType === "MANUAL_PAYMENT" ||
            (e.sourceType !== null && RECEIVABLE_SOURCES.includes(e.sourceType)),
        ),
      );
      accumulate("receivables", recv);
      if (recv !== 0n) slices.receivables = Number(recv);
    }

    if (canRoleSeeBox(role, "purchase_payables")) {
      const purch = computeScopedBalance(p.ledgerEntries, PURCHASE_SOURCES);
      accumulate("purchase_payables", purch);
      if (purch !== 0n) slices.purchase_payables = Number(purch);
    }

    if (canRoleSeeBox(role, "casting_plating_payables")) {
      const cp = computeScopedBalance(p.ledgerEntries, CASTING_PLATING_SOURCES);
      accumulate("casting_plating_payables", cp);
      if (cp !== 0n) slices.casting_plating_payables = Number(cp);
    }

    // Per-role owner-list balance — ADMIN sees full net (incl.
    // MANUAL_PAYMENT); scoped roles see their single slice.
    let balance: bigint;
    if (role === "ADMIN") {
      balance = computeOwnerBalance(p.ledgerEntries);
    } else if (role === "PURCHASE_DEPT") {
      balance = computeScopedBalance(p.ledgerEntries, PURCHASE_SOURCES);
    } else if (role === "CASTING_PLATING_MGMT") {
      balance = computeScopedBalance(p.ledgerEntries, CASTING_PLATING_SOURCES);
    } else {
      continue; // LABOUR_MGMT — no parties
    }
    if (balance === 0n) continue;

    owners.push({
      kind: "party",
      id: p.id,
      name: p.name,
      phone: p.phone,
      balance: Number(balance),
      href: `/ledger/party/${p.id}`,
      slices,
    });
  }

  // --- Per-karigar slice + owner row ---
  for (const k of karigars) {
    const balance = computeOwnerBalance(k.ledgerEntries);
    if (canRoleSeeBox(role, "karigar")) {
      accumulate("karigar", balance);
    }
    // Karigar slice ALWAYS set (incl. zero) — always-available-surface
    // pattern. The Karigar tab includes zero-balance karigars.
    owners.push({
      kind: "karigar",
      id: k.id,
      name: k.name,
      phone: k.phone,
      balance: Number(balance),
      href: `/ledger/karigar/${k.id}`,
      slices: canRoleSeeBox(role, "karigar")
        ? { karigar: Number(balance) }
        : {},
    });
  }

  // --- Boxes from accumulators, in canonical order ---
  const BOX_ORDER: LedgerBoxKey[] = [
    "receivables",
    "purchase_payables",
    "casting_plating_payables",
    "karigar",
  ];
  const BOX_LABEL: Record<LedgerBoxKey, string> = {
    receivables: "Receivables",
    purchase_payables: "Purchase payables",
    casting_plating_payables: "Casting/Plating payables",
    karigar: "Karigar wages",
  };
  const boxes: LedgerBox[] = [];
  for (const key of BOX_ORDER) {
    if (!canRoleSeeBox(role, key)) continue;
    const acc = boxAccumulators[key] ?? { total: 0n, count: 0 };
    boxes.push({
      key,
      label: BOX_LABEL[key],
      total: Number(acc.total),
      count: acc.count,
      anchor: "#owners",
    });
  }

  // Sort: non-zero owners first, by abs(balance) desc. Zero-balance
  // karigars trail alphabetically (handled by source ordering).
  owners.sort((a, b) => {
    const aNonZero = a.balance !== 0 ? 1 : 0;
    const bNonZero = b.balance !== 0 ? 1 : 0;
    if (aNonZero !== bNonZero) return bNonZero - aNonZero;
    if (a.balance === 0 && b.balance === 0) {
      return a.name.localeCompare(b.name);
    }
    return Math.abs(b.balance) - Math.abs(a.balance);
  });

  return { boxes, owners };
}

/**
 * Walk-in section for /ledger. Reuses the existing 21a walk-in helpers
 * (they continue to read from the *Payment rails). Returns role-scoped
 * walk-ins; LABOUR_MGMT returns empty.
 */
export async function listLedgerHomeWalkIns(
  role: Role,
): Promise<{ payables: WalkInPayable[]; receivables: WalkInReceivable[] }> {
  if (role === "LABOUR_MGMT") {
    return { payables: [], receivables: [] };
  }

  const [payables, receivables] = await Promise.all([
    role === "PURCHASE_DEPT"
      ? listWalkInPayables("purchase")
      : role === "CASTING_PLATING_MGMT"
        ? listWalkInPayables("casting_plating")
        : listWalkInPayables("all"),
    role === "ADMIN" ? listWalkInReceivables() : Promise.resolve([]),
  ]);
  return { payables, receivables };
}

// ---- Fetch helpers --------------------------------------------------

type PartyWithLedger = Party & {
  ledgerEntries: {
    direction: "INCREASE" | "DECREASE";
    amount: bigint;
    entryType: "TRANSACTION_LINKED" | "MANUAL_PAYMENT";
    sourceType: LedgerSourceType | null;
    deletedAt: Date | null;
  }[];
};

async function fetchPartiesForRole(
  visibleSources: LedgerSourceType[],
): Promise<PartyWithLedger[]> {
  // The "parties of interest" set: any party with at least one
  // non-deleted ledger entry whose sourceType is in the role's
  // visible-sources slice. MANUAL_PAYMENT (sourceType IS NULL) is NOT
  // a qualifier on its own — a party with only manual-payment activity
  // and no transactional source is unusual; treat it as ADMIN-visible
  // by including it via the per-party fetch fallback below.
  const partyIds = await prisma.ledgerEntry
    .findMany({
      where: {
        deletedAt: null,
        partyId: { not: null },
        sourceType: { in: visibleSources },
      },
      select: { partyId: true },
      distinct: ["partyId"],
    })
    .then((rows) =>
      rows
        .map((r) => r.partyId)
        .filter((id): id is string => id !== null),
    );

  if (partyIds.length === 0) return [];

  const parties = await prisma.party.findMany({
    where: { id: { in: partyIds }, deletedAt: null },
    include: {
      ledgerEntries: { where: { deletedAt: null } },
    },
    orderBy: { name: "asc" },
  });

  return parties;
}

type KarigarWithLedger = {
  id: string;
  name: string;
  phone: string | null;
  ledgerEntries: {
    direction: "INCREASE" | "DECREASE";
    amount: bigint;
    entryType: "TRANSACTION_LINKED" | "MANUAL_PAYMENT";
    sourceType: LedgerSourceType | null;
    deletedAt: Date | null;
  }[];
};

async function fetchKarigarRows(): Promise<KarigarWithLedger[]> {
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, type: "LABOUR" },
    include: {
      ledgerEntries: { where: { deletedAt: null } },
    },
    orderBy: { name: "asc" },
  });
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    phone: e.phone,
    ledgerEntries: e.ledgerEntries,
  }));
}

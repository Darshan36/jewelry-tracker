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

export type LedgerOwnerKind = "party" | "karigar";

export type LedgerOwnerRow = {
  kind: LedgerOwnerKind;
  /** Stable id used for routing + React key. */
  id: string;
  name: string;
  phone: string | null;
  /** Raw signed balance (paise, Number). Negative = credit balance
   * (party prepaid, OR karigar holds advance). UI labels the sign. */
  balance: number;
  /** Per-row href to the owner's khata view. */
  href: string;
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

  // ---- Boxes ----
  const boxes: LedgerBox[] = [];

  if (canRoleSeeBox(role, "receivables")) {
    let total = 0n;
    let count = 0;
    for (const p of parties) {
      // Receivables balance — sale + sale_return activity + MANUAL_PAYMENT
      // entries (ADMIN-only context).
      const balance = computeOwnerBalance(
        p.ledgerEntries.filter(
          (e) =>
            e.entryType === "MANUAL_PAYMENT" ||
            (e.sourceType !== null && RECEIVABLE_SOURCES.includes(e.sourceType)),
        ),
      );
      if (balance !== 0n) {
        total += balance;
        count += 1;
      }
    }
    boxes.push({
      key: "receivables",
      label: "Receivables",
      total: Number(total),
      count,
      anchor: "#owners",
    });
  }

  if (canRoleSeeBox(role, "purchase_payables")) {
    let total = 0n;
    let count = 0;
    for (const p of parties) {
      // Scoped (activity only) — exclude MANUAL_PAYMENT to mirror
      // listPayables('purchase') semantics for scoped roles.
      const balance = computeScopedBalance(p.ledgerEntries, PURCHASE_SOURCES);
      if (balance !== 0n) {
        total += balance;
        count += 1;
      }
    }
    boxes.push({
      key: "purchase_payables",
      label: "Purchase payables",
      total: Number(total),
      count,
      anchor: "#owners",
    });
  }

  if (canRoleSeeBox(role, "casting_plating_payables")) {
    let total = 0n;
    let count = 0;
    for (const p of parties) {
      const balance = computeScopedBalance(
        p.ledgerEntries,
        CASTING_PLATING_SOURCES,
      );
      if (balance !== 0n) {
        total += balance;
        count += 1;
      }
    }
    boxes.push({
      key: "casting_plating_payables",
      label: "Casting/Plating payables",
      total: Number(total),
      count,
      anchor: "#owners",
    });
  }

  if (canRoleSeeBox(role, "karigar")) {
    let total = 0n;
    let count = 0;
    for (const k of karigars) {
      const balance = computeOwnerBalance(k.ledgerEntries);
      if (balance !== 0n) {
        total += balance;
        count += 1;
      }
    }
    boxes.push({
      key: "karigar",
      label: "Karigar wages",
      total: Number(total),
      count,
      anchor: "#owners",
    });
  }

  // ---- Owners (parties + karigar, role-scoped) ----
  const owners: LedgerOwnerRow[] = [];

  for (const p of parties) {
    // Per-role balance projection — ADMIN sees full signed balance
    // (includes MANUAL_PAYMENT). Scoped roles see activity-only on their
    // slice (matches the box semantics so list ↔ box totals reconcile).
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
    });
  }

  for (const k of karigars) {
    const balance = computeOwnerBalance(k.ledgerEntries);
    // Include EVERY active LABOUR karigar (even zero balance) so the
    // "Record entry" affordance on their khata page is reachable from
    // the home page without scrolling /labour. Same shape as the 21b.1
    // KarigarLedgerSection on /labour ("always-available surface").
    owners.push({
      kind: "karigar",
      id: k.id,
      name: k.name,
      phone: k.phone,
      balance: Number(balance),
      href: `/ledger/karigar/${k.id}`,
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

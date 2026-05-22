// Outstanding balance + party-rollup helpers.
//
// Phase 21a — REWRITTEN to read from the LedgerEntry table for
// party-linked balances. Bill-wise `*Payment` rows are no longer
// consulted for party balances (they remain alive only for walk-in
// transactions; see listWalkInPayables / listWalkInReceivables at the
// bottom of this file, unchanged from Phase 17b).
//
// Scope-vs-ADMIN model (locked at Phase 21a checkpoint 0 point 3a):
//   - ADMIN scope ('all'): party balance = Σ(INCREASE) − Σ(DECREASE)
//     across ALL non-deleted entries (every sourceType + MANUAL_PAYMENT).
//     Raw signed, NO clamp — negative = party credit balance.
//   - PURCHASE_DEPT scope ('purchase'): "outstanding by activity" —
//     SUM filtered to sourceType IN ('PURCHASE', 'PURCHASE_RETURN').
//     Excludes MANUAL_PAYMENT (which has sourceType IS NULL).
//   - CASTING_PLATING_MGMT scope ('casting_plating'): filtered to
//     sourceType IN ('CASTING', 'PLATING'). Excludes MANUAL_PAYMENT.
//   - Receivables: ADMIN-only; same as ADMIN payables but filtered to
//     sourceType IN ('SALE', 'SALE_RETURN') + MANUAL_PAYMENT.
//
// `computeOutstanding` (the bill-wise pure helper) is RETAINED for
// walk-in transactions only — those rows still aggregate per-bill via
// their *Payment + *Return children.

import { prisma } from "@/lib/prisma";
import type {
  LedgerSourceType,
  Party,
  PaymentType,
} from "@/generated/prisma";

import { computePartyBalance, computeScopedBalance } from "@/lib/ledger";

// --- Walk-in per-transaction outstanding (unchanged from Phase 17b) ---

type PaymentLike = {
  amount: bigint;
  type: PaymentType;
  deletedAt: Date | null;
};

type ReturnLike = {
  refundAmount: bigint;
  deletedAt: Date | null;
};

/**
 * Per-transaction outstanding for WALK-IN rows only. Party-linked
 * transactions no longer have per-bill outstanding under Phase 21a;
 * their math lives entirely on the LedgerEntry table.
 *
 * Clamped non-negative — walk-ins keep the legacy clamp behaviour
 * because their UI presents the value as "Outstanding ₹X" with no
 * credit-balance semantics. (Party rollups, in contrast, expose
 * negative balances as credit.)
 */
export function computeOutstanding(input: {
  total: bigint;
  payments: PaymentLike[];
  returns?: ReturnLike[];
}): bigint {
  const netPaid = input.payments
    .filter((p) => p.deletedAt === null)
    .reduce(
      (sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount),
      0n,
    );
  const returnTotal = (input.returns ?? [])
    .filter((r) => r.deletedAt === null)
    .reduce((sum, r) => sum + r.refundAmount, 0n);
  const remaining = input.total - returnTotal - netPaid;
  return remaining > 0n ? remaining : 0n;
}

// --- Types -----------------------------------------------------------

export type PayableScope = "purchase" | "casting_plating" | "all";

/**
 * Payables-side source types per scope. ADMIN ('all') sees every
 * payables source — PURCHASE / PURCHASE_RETURN / CASTING / PLATING —
 * but NOT SALE / SALE_RETURN (those are receivables). MANUAL_PAYMENT
 * has sourceType IS NULL and is included in the ADMIN balance calc
 * via `computePartyBalance` (which sees everything); scoped roles
 * intentionally exclude MANUAL_PAYMENT (see computeScopedBalance).
 */
const PAYABLE_SCOPE_SOURCES: Record<PayableScope, LedgerSourceType[]> = {
  purchase: ["PURCHASE", "PURCHASE_RETURN"],
  casting_plating: ["CASTING", "PLATING"],
  all: ["PURCHASE", "PURCHASE_RETURN", "CASTING", "PLATING"],
};

const RECEIVABLE_SOURCES: LedgerSourceType[] = ["SALE", "SALE_RETURN"];

export type PartyPayableRollup = {
  party: Party;
  /**
   * Outstanding (paise as Number for JSON safety). Raw signed; negative
   * means the party has credit balance. UI must label sign.
   *
   * For ADMIN scope ('all'): full party balance including MANUAL_PAYMENT.
   * For scoped roles: activity-slice balance (matching `<source>Outstanding`
   * fields summed below) — excludes MANUAL_PAYMENT.
   */
  totalOutstanding: number;
  /**
   * Per-source activity-slice subtotals. Each is the raw signed sum of
   * TRANSACTION_LINKED entries for the matching sourceType — never
   * includes MANUAL_PAYMENT. Used by the ADMIN dashboard for the
   * per-source cards (Purchase / Casting / Plating Payables).
   */
  purchaseOutstanding: number;
  castingOutstanding: number;
  platingOutstanding: number;
  /**
   * True when the scoped view's `totalOutstanding` is the activity-
   * only number (excludes MANUAL_PAYMENT) AND the party has at least
   * one MANUAL_PAYMENT entry on file. UI shows the footnote
   * "Showing purchase activity only. Payments to this party are
   * tracked on the full account." (or casting/plating variant) when
   * this is true. ADMIN scope always sets this to false (admin sees
   * true net).
   */
  showScopeFootnote: boolean;
};

export type PartyReceivableRollup = {
  party: Party;
  totalOutstanding: number;
};

// Walk-in row shapes — unchanged from Phase 17b. Walk-in transactions
// (partyId IS NULL) stay on the bill-wise *Payment rails in 21a.
export type WalkInPayable = {
  kind: "PURCHASE" | "CASTING" | "PLATING";
  id: string;
  partyName: string;
  partyPhone: string | null;
  date: Date;
  total: number;
  paidAmount: number;
  outstanding: number;
  hasAttachment: boolean;
};

export type WalkInReceivable = {
  kind: "SALE";
  id: string;
  partyName: string;
  partyPhone: string | null;
  date: Date;
  total: number;
  paidAmount: number;
  outstanding: number;
  hasAttachment: boolean;
};

// --- Party rollup aggregators (ledger-driven) ------------------------

/**
 * Whether a party has at least one MANUAL_PAYMENT entry. Used to drive
 * the scope-footnote flag for multi-role parties under scoped views.
 * Pure function over already-loaded entries.
 */
function hasManualPayment(
  entries: { entryType: "TRANSACTION_LINKED" | "MANUAL_PAYMENT"; deletedAt: Date | null }[],
): boolean {
  return entries.some(
    (e) => e.entryType === "MANUAL_PAYMENT" && e.deletedAt === null,
  );
}

export async function listPayables(
  scope: PayableScope,
): Promise<PartyPayableRollup[]> {
  // Bulk-fetch every Party that has any non-deleted ledger entry whose
  // sourceType matches the scope (or any MANUAL_PAYMENT for ADMIN scope).
  // We compute outstanding per-party in memory after fetching.
  const allowedSources = PAYABLE_SCOPE_SOURCES[scope];

  // The "parties of interest" set: any party with at least one
  // non-deleted TRANSACTION_LINKED INCREASE entry from a payables-side
  // source in scope. Returns/MANUAL_PAYMENT don't qualify a party for
  // payables on their own — there has to be a purchase/casting/plating
  // INCREASE somewhere.
  const incomingSources = allowedSources.filter(
    (s) => !s.endsWith("_RETURN"),
  );
  // Phase 21b — partyId is now nullable on LedgerEntry (karigar entries
  // set employeeId instead). Filter the nulls so the downstream `id: {
  // in: partyIds }` query receives only valid party ids.
  const partyIds = await prisma.ledgerEntry
    .findMany({
      where: {
        deletedAt: null,
        direction: "INCREASE",
        sourceType: { in: incomingSources },
        partyId: { not: null },
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
  });

  const rollups: PartyPayableRollup[] = [];
  for (const party of parties) {
    const entries = party.ledgerEntries;

    let balance: bigint;
    let showFootnote = false;

    if (scope === "all") {
      // ADMIN — true net balance, includes MANUAL_PAYMENT.
      balance = computePartyBalance(entries);
    } else {
      // Scoped role — "outstanding by activity".
      balance = computeScopedBalance(entries, allowedSources);
      showFootnote = hasManualPayment(entries);
    }

    // Per-source activity-slice subtotals — always computed, regardless
    // of scope, so the ADMIN dashboard has them ready. These are
    // activity-only (TRANSACTION_LINKED slice per source); they sum to
    // less than `totalOutstanding` when ADMIN-scope MANUAL_PAYMENT
    // entries exist.
    const purchaseOut = computeScopedBalance(entries, [
      "PURCHASE",
      "PURCHASE_RETURN",
    ]);
    const castingOut = computeScopedBalance(entries, ["CASTING"]);
    const platingOut = computeScopedBalance(entries, ["PLATING"]);

    // Don't show parties whose balance has settled (== 0). Negative
    // (credit) balances ARE shown so admins can see who has prepaid
    // money sitting against no transaction. Scoped views may show
    // a positive activity balance even if the true net is zero —
    // that's the documented asymmetry.
    if (balance === 0n) continue;

    rollups.push({
      party: stripPartyRelations(party),
      totalOutstanding: Number(balance),
      purchaseOutstanding: Number(purchaseOut),
      castingOutstanding: Number(castingOut),
      platingOutstanding: Number(platingOut),
      showScopeFootnote: showFootnote,
    });
  }

  // Sort by absolute outstanding desc — biggest unsettled balances
  // first, regardless of sign.
  rollups.sort((a, b) => Math.abs(b.totalOutstanding) - Math.abs(a.totalOutstanding));
  return rollups;
}

export async function listReceivables(): Promise<PartyReceivableRollup[]> {
  // Receivables = parties with INCREASE entries from SALE source.
  // Phase 21b: filter null partyId (karigar entries).
  const partyIds = await prisma.ledgerEntry
    .findMany({
      where: {
        deletedAt: null,
        direction: "INCREASE",
        sourceType: { in: ["SALE"] },
        partyId: { not: null },
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
  });

  const rollups: PartyReceivableRollup[] = [];
  for (const party of parties) {
    // Receivables is ADMIN-only — true net balance using only the
    // receivables-side sources + MANUAL_PAYMENT. We compute via the
    // scoped helper (since the receivables side is sales + sale-returns
    // only) plus the MANUAL_PAYMENT impact: a customer who paid against
    // their sales has a DECREASE MANUAL_PAYMENT that reduces what they
    // owe. Practical implementation: total receivables balance =
    // SUM(SALE INCREASE) − SUM(SALE_RETURN DECREASE) − SUM(MANUAL_PAYMENT
    // DECREASE) (the latter applied if the party is a customer, since
    // a customer's manual payment IS receivables reconciliation).
    //
    // Multi-role caveat: a party that is both customer AND supplier
    // with MANUAL_PAYMENT entries will see their full party balance —
    // an admin reconciling receivables knows to take the party-level
    // perspective. The ADMIN-only access matrix and small workshop
    // scale mean this works in practice without scope-tagging on
    // MANUAL_PAYMENT.
    const balance = computePartyBalance(
      party.ledgerEntries.filter(
        (e) =>
          e.entryType === "MANUAL_PAYMENT" ||
          (e.sourceType !== null && RECEIVABLE_SOURCES.includes(e.sourceType)),
      ),
    );
    if (balance === 0n) continue;
    rollups.push({
      party: stripPartyRelations(party),
      totalOutstanding: Number(balance),
    });
  }

  rollups.sort((a, b) => Math.abs(b.totalOutstanding) - Math.abs(a.totalOutstanding));
  return rollups;
}

// --- Per-party detail (ledger statement source data) -----------------

/**
 * Detailed per-party payables — used by /payables/[partyId].
 *
 * Returns the Party, the total outstanding (signed), the scope footnote
 * flag, and the chronological ledger entries with running balance. The
 * page renders the statement via the LedgerEntry rows directly — no
 * per-transaction outstanding breakdown since payments aren't allocated
 * to specific bills anymore.
 */
export async function getPayablesForParty(
  partyId: string,
  scope: PayableScope,
): Promise<{
  party: Party;
  totalOutstanding: number;
  showScopeFootnote: boolean;
  entries: PartyLedgerEntryForClient[];
} | null> {
  const party = await prisma.party.findUnique({
    where: { id: partyId, deletedAt: null },
    include: {
      ledgerEntries: {
        where: { deletedAt: null },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!party) return null;

  const allowedSources = PAYABLE_SCOPE_SOURCES[scope];

  let balance: bigint;
  let entriesForClient: PartyLedgerEntryForClient[];
  let showFootnote = false;

  if (scope === "all") {
    balance = computePartyBalance(party.ledgerEntries);
    entriesForClient = projectAllEntries(party.ledgerEntries);
  } else {
    balance = computeScopedBalance(party.ledgerEntries, allowedSources);
    showFootnote = hasManualPayment(party.ledgerEntries);
    // Scoped views: include only the entries that contribute to the
    // scoped balance — i.e., TRANSACTION_LINKED rows whose sourceType
    // is in scope. MANUAL_PAYMENT entries are NOT shown to scoped
    // roles (they reconcile against the full account and aren't part
    // of the activity view).
    entriesForClient = projectAllEntries(
      party.ledgerEntries.filter(
        (e) => e.sourceType !== null && allowedSources.includes(e.sourceType),
      ),
    );
  }

  return {
    party: stripPartyRelations(party),
    totalOutstanding: Number(balance),
    showScopeFootnote: showFootnote,
    entries: entriesForClient,
  };
}

export async function getReceivablesForParty(partyId: string): Promise<{
  party: Party;
  totalOutstanding: number;
  entries: PartyLedgerEntryForClient[];
} | null> {
  const party = await prisma.party.findUnique({
    where: { id: partyId, deletedAt: null },
    include: {
      ledgerEntries: {
        where: { deletedAt: null },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!party) return null;

  // ADMIN-only — true net using receivables-side TRANSACTION_LINKED
  // entries + MANUAL_PAYMENT. See listReceivables for the multi-role
  // caveat.
  const relevant = party.ledgerEntries.filter(
    (e) =>
      e.entryType === "MANUAL_PAYMENT" ||
      (e.sourceType !== null && RECEIVABLE_SOURCES.includes(e.sourceType)),
  );
  const balance = computePartyBalance(relevant);

  return {
    party: stripPartyRelations(party),
    totalOutstanding: Number(balance),
    entries: projectAllEntries(relevant),
  };
}

// --- Client-shape projection (chronological + running balance) -------

export type PartyLedgerEntryForClient = {
  id: string;
  date: Date;
  direction: "INCREASE" | "DECREASE";
  amount: number;
  description: string | null;
  entryType: "TRANSACTION_LINKED" | "MANUAL_PAYMENT";
  sourceType: LedgerSourceType | null;
  sourceId: string | null;
  /** Running balance after this entry, raw signed (paise). */
  runningBalance: number;
};

function projectAllEntries(
  entries: {
    id: string;
    date: Date;
    direction: "INCREASE" | "DECREASE";
    amount: bigint;
    description: string | null;
    entryType: "TRANSACTION_LINKED" | "MANUAL_PAYMENT";
    sourceType: LedgerSourceType | null;
    sourceId: string | null;
    deletedAt: Date | null;
  }[],
): PartyLedgerEntryForClient[] {
  // Entries should arrive already filtered to deletedAt === null and
  // sorted chronologically; both invariants are caller-side.
  let running = 0n;
  const out: PartyLedgerEntryForClient[] = [];
  for (const e of entries) {
    if (e.direction === "INCREASE") running += e.amount;
    else running -= e.amount;
    out.push({
      id: e.id,
      date: e.date,
      direction: e.direction,
      amount: Number(e.amount),
      description: e.description,
      entryType: e.entryType,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      runningBalance: Number(running),
    });
  }
  return out;
}

// --- Helpers ---------------------------------------------------------

function stripPartyRelations<T extends Party>(party: T): Party {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ...partyOnly } = party;
  return partyOnly as Party;
}

// --- Walk-in aggregators (unchanged from Phase 17b) ------------------
//
// Walk-in transactions (partyId IS NULL) stay on the bill-wise rails
// in 21a. The functions below mirror their Phase 17b shape exactly —
// they read from the *Payment + *Return child tables, not the ledger.

function netPaid(payments: PaymentLike[]): bigint {
  return payments
    .filter((p) => p.deletedAt === null)
    .reduce(
      (sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount),
      0n,
    );
}

function returnTotalOf(returns: ReturnLike[]): bigint {
  return returns
    .filter((r) => r.deletedAt === null)
    .reduce((sum, r) => sum + r.refundAmount, 0n);
}

export async function listWalkInPayables(
  scope: PayableScope,
): Promise<WalkInPayable[]> {
  const includePurchase = scope === "purchase" || scope === "all";
  const includeCasting = scope === "casting_plating" || scope === "all";
  const includePlating = scope === "casting_plating" || scope === "all";

  const [purchases, castingEntries, platingEntries] = await Promise.all([
    includePurchase
      ? prisma.purchase.findMany({
          where: { deletedAt: null, partyId: null },
          include: {
            payments: { where: { deletedAt: null } },
            returns: { where: { deletedAt: null } },
          },
          orderBy: { date: "desc" },
        })
      : Promise.resolve([]),
    includeCasting
      ? prisma.castingEntry.findMany({
          where: { deletedAt: null, partyId: null },
          include: {
            payments: { where: { deletedAt: null } },
            attachment: true,
          },
          orderBy: { date: "desc" },
        })
      : Promise.resolve([]),
    includePlating
      ? prisma.platingEntry.findMany({
          where: { deletedAt: null, partyId: null },
          include: {
            payments: { where: { deletedAt: null } },
            attachment: true,
          },
          orderBy: { date: "desc" },
        })
      : Promise.resolve([]),
  ]);

  let purchaseAttachmentSet = new Set<string>();
  if (purchases.length > 0) {
    const attachments = await prisma.attachment.findMany({
      where: {
        attachedToType: "PURCHASE",
        attachedToId: { in: purchases.map((p) => p.id) },
        status: "READY",
        deletedAt: null,
      },
      select: { attachedToId: true },
    });
    purchaseAttachmentSet = new Set(
      attachments
        .map((a) => a.attachedToId)
        .filter((id): id is string => id !== null),
    );
  }

  const rows: WalkInPayable[] = [];

  for (const p of purchases) {
    const outstanding = computeOutstanding({
      total: p.total,
      payments: p.payments,
      returns: p.returns,
    });
    if (outstanding <= 0n) continue;
    rows.push({
      kind: "PURCHASE",
      id: p.id,
      partyName: p.partyName,
      partyPhone: p.partyPhone ?? null,
      date: p.date,
      total: Number(p.total - returnTotalOf(p.returns)),
      paidAmount: Number(netPaid(p.payments)),
      outstanding: Number(outstanding),
      hasAttachment: purchaseAttachmentSet.has(p.id),
    });
  }

  for (const e of castingEntries) {
    const outstanding = computeOutstanding({
      total: e.total,
      payments: e.payments,
    });
    if (outstanding <= 0n) continue;
    rows.push({
      kind: "CASTING",
      id: e.id,
      partyName: e.partyName,
      partyPhone: e.partyPhone ?? null,
      date: e.date,
      total: Number(e.total),
      paidAmount: Number(netPaid(e.payments)),
      outstanding: Number(outstanding),
      hasAttachment: e.attachment !== null && e.attachment.status === "READY",
    });
  }

  for (const e of platingEntries) {
    const outstanding = computeOutstanding({
      total: e.total,
      payments: e.payments,
    });
    if (outstanding <= 0n) continue;
    rows.push({
      kind: "PLATING",
      id: e.id,
      partyName: e.partyName,
      partyPhone: e.partyPhone ?? null,
      date: e.date,
      total: Number(e.total),
      paidAmount: Number(netPaid(e.payments)),
      outstanding: Number(outstanding),
      hasAttachment: e.attachment !== null && e.attachment.status === "READY",
    });
  }

  rows.sort((a, b) => b.outstanding - a.outstanding);
  return rows;
}

export async function listWalkInReceivables(): Promise<WalkInReceivable[]> {
  const sales = await prisma.sale.findMany({
    where: { deletedAt: null, partyId: null },
    include: {
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
    },
    orderBy: { date: "desc" },
  });

  let saleAttachmentSet = new Set<string>();
  if (sales.length > 0) {
    const attachments = await prisma.attachment.findMany({
      where: {
        attachedToType: "SALE",
        attachedToId: { in: sales.map((s) => s.id) },
        status: "READY",
        deletedAt: null,
      },
      select: { attachedToId: true },
    });
    saleAttachmentSet = new Set(
      attachments
        .map((a) => a.attachedToId)
        .filter((id): id is string => id !== null),
    );
  }

  const rows: WalkInReceivable[] = [];
  for (const s of sales) {
    const outstanding = computeOutstanding({
      total: s.total,
      payments: s.payments,
      returns: s.returns,
    });
    if (outstanding <= 0n) continue;
    rows.push({
      kind: "SALE",
      id: s.id,
      partyName: s.partyName,
      partyPhone: s.partyPhone ?? null,
      date: s.date,
      total: Number(s.total - returnTotalOf(s.returns)),
      paidAmount: Number(netPaid(s.payments)),
      outstanding: Number(outstanding),
      hasAttachment: saleAttachmentSet.has(s.id),
    });
  }

  rows.sort((a, b) => b.outstanding - a.outstanding);
  return rows;
}

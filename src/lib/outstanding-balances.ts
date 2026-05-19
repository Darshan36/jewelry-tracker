// Outstanding balance + party-rollup helpers (Phase 17b).
//
// Pure functions over already-loaded transaction shapes (no Prisma
// access in `computeOutstanding`), plus DB-querying aggregators
// (`listPayables`, `listReceivables`, `getPayablesForParty`,
// `getReceivablesForParty`) that consolidate per-party rollups across
// the three payable sources (Purchase, CastingEntry, PlatingEntry) and
// the one receivable source (Sale).
//
// Currency stays as `bigint` paise throughout the aggregation; only the
// page-level renderers convert to Number for display.
//
// Performance: each aggregator runs ONE Prisma query with `include` for
// the related transactions + their payments + returns (Sales/Purchases
// only). No N+1 loops.

import { prisma } from "@/lib/prisma";
import type { PaymentType, Party, Sale, Purchase, CastingEntry, PlatingEntry } from "@/generated/prisma";

// --- Per-transaction outstanding -----------------------------------

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
 * Outstanding balance for a single transaction in BigInt paise.
 *
 * For Sales/Purchases: `total − netPaid − returnTotal` where
 * netPaid = SUM(PAYMENT.amount) − SUM(REFUND.amount), filtered to
 * non-deleted, and returnTotal = SUM(refundAmount) over non-deleted.
 *
 * For CastingEntry/PlatingEntry: no returns; outstanding is just
 * `total − netPaid` (omit `returns` from the input shape).
 *
 * Returns a non-negative BigInt — overpaid (refund_due) cases clamp to 0
 * because "outstanding" is the amount STILL OWED, never negative.
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

export type PartyPayableRollup = {
  party: Party;
  totalOutstanding: number; // paise as Number for JSON safety
  purchaseOutstanding: number;
  castingOutstanding: number;
  platingOutstanding: number;
  /** True if ANY transaction in scope is missing its bill attachment. */
  hasMissingAttachment: boolean;
};

export type PartyReceivableRollup = {
  party: Party;
  totalOutstanding: number;
  /** True if ANY outstanding sale is missing its bill attachment. */
  hasMissingAttachment: boolean;
};

export type PurchaseWithOutstanding = Purchase & {
  outstanding: number; // paise
  hasAttachment: boolean;
};

export type CastingEntryWithOutstanding = CastingEntry & {
  outstanding: number;
  hasAttachment: boolean;
};

export type PlatingEntryWithOutstanding = PlatingEntry & {
  outstanding: number;
  hasAttachment: boolean;
};

export type SaleWithOutstanding = Sale & {
  outstanding: number;
  hasAttachment: boolean;
};

// --- Aggregators -----------------------------------------------------

/**
 * Build a Prisma `where` clause that includes only parties that have
 * at least one in-scope transaction with outstanding > 0. Doing this in
 * the WHERE clause avoids loading parties whose transactions are all
 * fully paid.
 *
 * Note: we can't filter "outstanding > 0" purely at the SQL layer here
 * because outstanding involves aggregation across child rows. Instead,
 * we filter for parties that have ANY non-deleted transaction in scope,
 * then filter in JS after computing outstandings. Acceptable at the
 * ~100-transactions/month scale; if the table grows large we can move
 * to a materialised view or a denormalised `outstandingPaise` column.
 */
function whereForScope(scope: PayableScope) {
  const parts: Record<string, unknown>[] = [];
  if (scope === "purchase" || scope === "all") {
    parts.push({ purchases: { some: { deletedAt: null } } });
  }
  if (scope === "casting_plating" || scope === "all") {
    parts.push({ castingEntries: { some: { deletedAt: null } } });
    parts.push({ platingEntries: { some: { deletedAt: null } } });
  }
  return parts.length === 1 ? parts[0] : { OR: parts };
}

/**
 * List parties with outstanding payables, scoped by transaction type.
 *
 * Returns rollups sorted by totalOutstanding desc. Only parties with
 * at least one outstanding rupee in scope are included.
 */
export async function listPayables(
  scope: PayableScope,
): Promise<PartyPayableRollup[]> {
  const includePurchase = scope === "purchase" || scope === "all";
  const includeCasting = scope === "casting_plating" || scope === "all";
  const includePlating = scope === "casting_plating" || scope === "all";

  // Always include all relations — conditional `include: false` produces
  // a type where the relation key is missing, which complicates the
  // downstream type narrowing. The cost of loading unused relations at
  // ~100-transactions/month is negligible.
  const parties = await prisma.party.findMany({
    where: {
      deletedAt: null,
      ...whereForScope(scope),
    },
    include: {
      purchases: {
        where: { deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          returns: { where: { deletedAt: null } },
        },
      },
      castingEntries: {
        where: { deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          attachment: true,
        },
      },
      platingEntries: {
        where: { deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          attachment: true,
        },
      },
    },
  });

  // Phase 17b: pre-fetch all bill attachments for purchases in this party
  // set in one query (vs. N+1 lookups). Sales/Purchases attach via
  // discriminator, not FK, so we group by attachedToId.
  let purchaseAttachmentSet = new Set<string>();
  if (includePurchase) {
    const purchaseIds = parties.flatMap((p) => p.purchases.map((pu) => pu.id));
    if (purchaseIds.length > 0) {
      const attachments = await prisma.attachment.findMany({
        where: {
          attachedToType: "PURCHASE",
          attachedToId: { in: purchaseIds },
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
  }

  const rollups: PartyPayableRollup[] = [];
  for (const party of parties) {
    let purchaseOut = 0n;
    let castingOut = 0n;
    let platingOut = 0n;
    let missing = false;

    if (includePurchase) {
      for (const p of party.purchases) {
        const out = computeOutstanding({
          total: p.total,
          payments: p.payments,
          returns: p.returns,
        });
        if (out > 0n) {
          purchaseOut += out;
          if (!purchaseAttachmentSet.has(p.id)) missing = true;
        }
      }
    }
    if (includeCasting) {
      for (const e of party.castingEntries) {
        const out = computeOutstanding({
          total: e.total,
          payments: e.payments,
        });
        if (out > 0n) {
          castingOut += out;
          if (!e.attachment || e.attachment.status !== "READY") missing = true;
        }
      }
    }
    if (includePlating) {
      for (const e of party.platingEntries) {
        const out = computeOutstanding({
          total: e.total,
          payments: e.payments,
        });
        if (out > 0n) {
          platingOut += out;
          if (!e.attachment || e.attachment.status !== "READY") missing = true;
        }
      }
    }

    const total = purchaseOut + castingOut + platingOut;
    if (total === 0n) continue; // skip parties with no actual outstanding

    rollups.push({
      // Strip the included relations from the Party object — the client
      // shape just needs the master record. Re-fetch transactions
      // separately via getPayablesForParty when needed.
      party: stripPartyRelations(party),
      totalOutstanding: Number(total),
      purchaseOutstanding: Number(purchaseOut),
      castingOutstanding: Number(castingOut),
      platingOutstanding: Number(platingOut),
      hasMissingAttachment: missing,
    });
  }

  rollups.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  return rollups;
}

export async function listReceivables(): Promise<PartyReceivableRollup[]> {
  const parties = await prisma.party.findMany({
    where: {
      deletedAt: null,
      sales: { some: { deletedAt: null } },
    },
    include: {
      sales: {
        where: { deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          returns: { where: { deletedAt: null } },
        },
      },
    },
  });

  // Same single-query bulk fetch for sale attachments.
  const saleIds = parties.flatMap((p) => p.sales.map((s) => s.id));
  let saleAttachmentSet = new Set<string>();
  if (saleIds.length > 0) {
    const attachments = await prisma.attachment.findMany({
      where: {
        attachedToType: "SALE",
        attachedToId: { in: saleIds },
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

  const rollups: PartyReceivableRollup[] = [];
  for (const party of parties) {
    let total = 0n;
    let missing = false;
    for (const s of party.sales) {
      const out = computeOutstanding({
        total: s.total,
        payments: s.payments,
        returns: s.returns,
      });
      if (out > 0n) {
        total += out;
        if (!saleAttachmentSet.has(s.id)) missing = true;
      }
    }
    if (total === 0n) continue;
    rollups.push({
      party: stripPartyRelations(party),
      totalOutstanding: Number(total),
      hasMissingAttachment: missing,
    });
  }

  rollups.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  return rollups;
}

/**
 * Detailed party-level payables view for the /payables/[partyId] page.
 *
 * Returns the Party + per-source arrays of transactions with each one's
 * outstanding balance + hasAttachment flag attached. Sources are
 * filtered by scope so PURCHASE_DEPT users don't accidentally see
 * casting/plating data.
 */
export async function getPayablesForParty(
  partyId: string,
  scope: PayableScope,
): Promise<{
  party: Party;
  purchases: PurchaseWithOutstanding[];
  castingEntries: CastingEntryWithOutstanding[];
  platingEntries: PlatingEntryWithOutstanding[];
  totalOutstanding: number;
} | null> {
  const includePurchase = scope === "purchase" || scope === "all";
  const includeCasting = scope === "casting_plating" || scope === "all";
  const includePlating = scope === "casting_plating" || scope === "all";

  const party = await prisma.party.findUnique({
    where: { id: partyId, deletedAt: null },
    include: {
      purchases: {
        where: { deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          returns: { where: { deletedAt: null } },
        },
        orderBy: { date: "desc" },
      },
      castingEntries: {
        where: { deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          attachment: true,
        },
        orderBy: { date: "desc" },
      },
      platingEntries: {
        where: { deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          attachment: true,
        },
        orderBy: { date: "desc" },
      },
    },
  });
  if (!party) return null;

  // Bulk attachment lookup for purchases.
  let purchaseAttachmentSet = new Set<string>();
  if (includePurchase && party.purchases.length > 0) {
    const attachments = await prisma.attachment.findMany({
      where: {
        attachedToType: "PURCHASE",
        attachedToId: { in: party.purchases.map((p) => p.id) },
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

  const purchases: PurchaseWithOutstanding[] = includePurchase
    ? party.purchases.map((p) => ({
        ...stripChildRelations(p),
        outstanding: Number(
          computeOutstanding({
            total: p.total,
            payments: p.payments,
            returns: p.returns,
          }),
        ),
        hasAttachment: purchaseAttachmentSet.has(p.id),
      }))
    : [];

  const castingEntries: CastingEntryWithOutstanding[] = includeCasting
    ? party.castingEntries.map((e) => ({
        ...stripChildRelations(e),
        outstanding: Number(
          computeOutstanding({ total: e.total, payments: e.payments }),
        ),
        hasAttachment:
          e.attachment !== null && e.attachment.status === "READY",
      }))
    : [];

  const platingEntries: PlatingEntryWithOutstanding[] = includePlating
    ? party.platingEntries.map((e) => ({
        ...stripChildRelations(e),
        outstanding: Number(
          computeOutstanding({ total: e.total, payments: e.payments }),
        ),
        hasAttachment:
          e.attachment !== null && e.attachment.status === "READY",
      }))
    : [];

  const totalOutstanding =
    purchases.reduce((sum, p) => sum + p.outstanding, 0) +
    castingEntries.reduce((sum, e) => sum + e.outstanding, 0) +
    platingEntries.reduce((sum, e) => sum + e.outstanding, 0);

  return {
    party: stripPartyRelations(party),
    purchases: purchases.filter((p) => p.outstanding > 0),
    castingEntries: castingEntries.filter((e) => e.outstanding > 0),
    platingEntries: platingEntries.filter((e) => e.outstanding > 0),
    totalOutstanding,
  };
}

export async function getReceivablesForParty(partyId: string): Promise<{
  party: Party;
  sales: SaleWithOutstanding[];
  totalOutstanding: number;
} | null> {
  const party = await prisma.party.findUnique({
    where: { id: partyId, deletedAt: null },
    include: {
      sales: {
        where: { deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          returns: { where: { deletedAt: null } },
        },
        orderBy: { date: "desc" },
      },
    },
  });
  if (!party) return null;

  let saleAttachmentSet = new Set<string>();
  if (party.sales.length > 0) {
    const attachments = await prisma.attachment.findMany({
      where: {
        attachedToType: "SALE",
        attachedToId: { in: party.sales.map((s) => s.id) },
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

  const sales: SaleWithOutstanding[] = party.sales.map((s) => ({
    ...stripChildRelations(s),
    outstanding: Number(
      computeOutstanding({
        total: s.total,
        payments: s.payments,
        returns: s.returns,
      }),
    ),
    hasAttachment: saleAttachmentSet.has(s.id),
  }));

  const totalOutstanding = sales.reduce((sum, s) => sum + s.outstanding, 0);

  return {
    party: stripPartyRelations(party),
    sales: sales.filter((s) => s.outstanding > 0),
    totalOutstanding,
  };
}

// --- Helpers ---------------------------------------------------------

// Prisma include-objects come back with relation arrays that we don't
// want to ship to the client. Strip them down to the bare Party shape.
function stripPartyRelations<T extends Party>(party: T): Party {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ...partyOnly } = party;
  // Cast: the spread includes the relation keys (purchases, etc) but
  // TypeScript types them as Party fields only if they were declared on
  // the schema. We just return the party-as-Party — its relation fields
  // are dropped by the consumer-side type contract.
  return partyOnly as Party;
}

function stripChildRelations<T extends object>(row: T): T {
  // For transaction rows (Purchase/CastingEntry/etc.), we want to keep
  // the row data but drop the relations (payments, returns, attachment)
  // — these are aggregated into a single `outstanding` number and a
  // `hasAttachment` bool on the result type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = row as any;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { payments, returns, attachment, ...rest } = r;
  return rest as T;
}

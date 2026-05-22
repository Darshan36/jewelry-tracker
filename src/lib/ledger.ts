// Phase 21a — party-ledger (khata) helpers.
//
// The ledger is the single source of truth for party-linked transaction
// balances. Bill-wise `*Payment` rows still exist for walk-in
// transactions (partyId IS NULL); they are dropped in 21c.
//
// What this module contains:
//   - describeTransactionLedgerEntry — auto-derived description string
//     used on every TRANSACTION_LINKED entry.
//   - writeTransactionLedgerEntry — called inside createX / createReturn
//     server-action transactions to insert the linked ledger row.
//   - updateTransactionLedgerEntry — handles the FOUR party-change
//     transitions inside updateX (walk-in→party, party→same, party→
//     other-party, party→walk-in). Never mutates partyId on an
//     existing row — clean audit via soft-delete-and-recreate.
//   - softDeleteTransactionLedgerEntry — called inside softDeleteX to
//     soft-delete the linked entry atomically with the parent.
//   - writeReturnLedgerEntry / softDeleteReturnLedgerEntry — the
//     return-row equivalents (always DECREASE).
//   - computePartyBalance — pure aggregation, RAW SIGNED, no clamp.
//     Negative result means the party has credit balance.
//   - listPartyLedger — chronological entries + running balance for
//     the /payables/[partyId] and /receivables/[partyId] statement view.
//
// CRITICAL: every mutation helper takes a Prisma.TransactionClient (`tx`)
// so the ledger write joins the parent's prisma.$transaction envelope.
// Atomicity is the whole point — a parent mutation that succeeds while
// its ledger write fails would desync the party balance.

import { prisma } from "@/lib/prisma";
import type { LedgerSourceType, Prisma } from "@/generated/prisma";

// ---- Description builders --------------------------------------------

/**
 * Auto-derived description for a TRANSACTION_LINKED entry on the PARTY
 * side (Sale / Purchase / Casting / Plating + returns). Karigar-side
 * entries (PIECE_ENTRY, WAGE_PAYMENT) have richer descriptions built by
 * `describePieceEntry` / `describeWagePayment` — those carry
 * count/rate/note details that wouldn't fit the "N items" template.
 *
 * The description is shown in the party-ledger statement view. The
 * sourceType + sourceId discriminator on the row is the authoritative
 * link; this string is purely for human readability.
 */
export function describeTransactionLedgerEntry(input: {
  sourceType: LedgerSourceType;
  lineItemCount: number;
}): string {
  const word =
    input.lineItemCount === 1 ? "item" : "items";
  switch (input.sourceType) {
    case "SALE":
      return `Sale - ${input.lineItemCount} ${word}`;
    case "PURCHASE":
      return `Purchase - ${input.lineItemCount} ${word}`;
    case "CASTING":
      return `Casting - ${input.lineItemCount} ${word}`;
    case "PLATING":
      return `Plating - ${input.lineItemCount} ${word}`;
    case "SALE_RETURN":
      return "Sale return";
    case "PURCHASE_RETURN":
      return "Purchase return";
    case "PIECE_ENTRY":
      // Defensive fallback — call sites should use describePieceEntry,
      // which carries the count/rate/note context this generic helper
      // doesn't see. Returning a marker rather than throwing keeps the
      // ledger row creatable even if a future code path misroutes here.
      return "Piece work";
    case "WAGE_PAYMENT":
      // Same defensive fallback — call sites use describeWagePayment.
      return "Wage payment";
  }
}

/**
 * Format a paise integer as a rupee string for embedding in a
 * description. Uses Indian comma grouping (lakh / crore). Drops the
 * decimal when the amount is a whole rupee, so "₹15" reads cleaner
 * than "₹15.00" in `"50 pcs @ ₹15/pc"`. Used only by the description
 * builders; storage and display elsewhere still go through
 * `formatCurrency`.
 */
function formatRateForDescription(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const remainder = abs % 100n;
  const grouped = new Intl.NumberFormat("en-IN").format(Number(rupees));
  const minus = negative ? "−" : "";
  if (remainder === 0n) return `${minus}₹${grouped}`;
  const paiseStr = remainder.toString().padStart(2, "0");
  return `${minus}₹${grouped}.${paiseStr}`;
}

/**
 * Karigar piece-entry description. The 21c per-karigar view will render
 * these directly — the product owner wants to SEE what the work was,
 * not just a number.
 *
 * Examples:
 *   - "50 pcs @ ₹15/pc — polishing"  (with Phase 18.1 note)
 *   - "20 pcs @ ₹40/pc"              (no note)
 *   - "1 pc @ ₹2,500/pc — setting"   (singular)
 *
 * Singular/plural is "pc" vs "pcs". The line total is intentionally NOT
 * embedded — the amount column on the ledger view already shows it.
 */
export function describePieceEntry(input: {
  count: number;
  ratePerPiece: bigint;
  note?: string | null;
}): string {
  const unit = input.count === 1 ? "pc" : "pcs";
  const rate = formatRateForDescription(input.ratePerPiece);
  const base = `${input.count} ${unit} @ ${rate}/pc`;
  const note = input.note?.trim();
  return note ? `${base} — ${note}` : base;
}

/**
 * Karigar wage-payment description. Advances are wage payments with a
 * descriptive note — there's no separate "advance" entry type; the
 * data model treats both as DECREASE entries against the employee's
 * ledger balance. Surface the note when present; otherwise just
 * "Wage payment".
 *
 * Examples:
 *   - "Wage payment — advance for next week"
 *   - "Wage payment — weekly settlement"
 *   - "Wage payment"
 */
export function describeWagePayment(input: {
  note?: string | null;
}): string {
  const note = input.note?.trim();
  return note ? `Wage payment — ${note}` : "Wage payment";
}

// ---- TRANSACTION_LINKED writes (parent create path) ------------------

type TransactionLedgerInput = {
  partyId: string;
  date: Date;
  sourceType: LedgerSourceType;
  sourceId: string;
  amount: bigint;
  lineItemCount: number;
  userId: string | null;
};

/**
 * Insert the linked TRANSACTION_LINKED INCREASE entry for a party-
 * attached parent transaction (Sale / Purchase / CastingEntry /
 * PlatingEntry). No-op when `partyId === null` (walk-in path).
 *
 * MUST be called inside the parent's prisma.$transaction so a thrown
 * write rolls the parent back.
 */
export async function writeTransactionLedgerEntry(
  tx: Prisma.TransactionClient,
  input: TransactionLedgerInput,
): Promise<void> {
  await tx.ledgerEntry.create({
    data: {
      partyId: input.partyId,
      date: input.date,
      direction: "INCREASE",
      amount: input.amount,
      description: describeTransactionLedgerEntry({
        sourceType: input.sourceType,
        lineItemCount: input.lineItemCount,
      }),
      entryType: "TRANSACTION_LINKED",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdById: input.userId,
      updatedById: input.userId,
    },
  });
}

// ---- TRANSACTION_LINKED updates (parent update path) -----------------

type UpdateTransactionLedgerInput = {
  sourceType: LedgerSourceType;
  sourceId: string;
  oldPartyId: string | null;
  newPartyId: string | null;
  newDate: Date;
  newAmount: bigint;
  newLineItemCount: number;
  userId: string | null;
};

/**
 * Handles the four party-change transitions on parent update:
 *   1. walk-in → party (oldPartyId === null, newPartyId !== null):
 *      Migrate the active *Payment rows for this transaction into
 *      MANUAL_PAYMENT LedgerEntries on the new party, soft-delete those
 *      *Payment rows, then create the TRANSACTION_LINKED INCREASE entry.
 *   2. party → same-party (oldPartyId === newPartyId): in-place update
 *      of the existing TRANSACTION_LINKED entry's amount / date /
 *      description. partyId is NOT mutated.
 *   3. party → other-party (oldPartyId !== newPartyId, both non-null):
 *      soft-delete the existing entry on the old party, create a new
 *      entry on the new party. Pre-existing MANUAL_PAYMENT entries on
 *      the old party stay (admin reconciles credit/debit manually if
 *      that ever surfaces — rare at workshop scale).
 *   4. party → walk-in (oldPartyId !== null, newPartyId === null):
 *      soft-delete the existing entry on the old party. Future payments
 *      land on the *Payment rails. Pre-existing MANUAL_PAYMENT entries
 *      stay on the old party.
 */
export async function updateTransactionLedgerEntry(
  tx: Prisma.TransactionClient,
  input: UpdateTransactionLedgerInput,
): Promise<void> {
  const oldParty = input.oldPartyId;
  const newParty = input.newPartyId;

  // Case 1 — walk-in → party
  if (oldParty === null && newParty !== null) {
    await migrateWalkInPaymentsToLedger(tx, {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      newPartyId: newParty,
      userId: input.userId,
    });
    await writeTransactionLedgerEntry(tx, {
      partyId: newParty,
      date: input.newDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      amount: input.newAmount,
      lineItemCount: input.newLineItemCount,
      userId: input.userId,
    });
    return;
  }

  // Case 4 — party → walk-in
  if (oldParty !== null && newParty === null) {
    await softDeleteTransactionLedgerEntry(tx, {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      userId: input.userId,
    });
    return;
  }

  // Case 2 — party → same-party (in-place update)
  if (oldParty !== null && newParty !== null && oldParty === newParty) {
    const existing = await findActiveLedgerEntry(tx, input.sourceType, input.sourceId);
    if (existing) {
      await tx.ledgerEntry.update({
        where: { id: existing.id },
        data: {
          date: input.newDate,
          amount: input.newAmount,
          description: describeTransactionLedgerEntry({
            sourceType: input.sourceType,
            lineItemCount: input.newLineItemCount,
          }),
          updatedById: input.userId,
        },
      });
    } else {
      // Defensive: should always exist for a party-linked parent, but
      // backfill if not (e.g., row created before migration).
      await writeTransactionLedgerEntry(tx, {
        partyId: newParty,
        date: input.newDate,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        amount: input.newAmount,
        lineItemCount: input.newLineItemCount,
        userId: input.userId,
      });
    }
    return;
  }

  // Case 3 — party → other-party (soft-delete old, create new)
  if (oldParty !== null && newParty !== null && oldParty !== newParty) {
    await softDeleteTransactionLedgerEntry(tx, {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      userId: input.userId,
    });
    await writeTransactionLedgerEntry(tx, {
      partyId: newParty,
      date: input.newDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      amount: input.newAmount,
      lineItemCount: input.newLineItemCount,
      userId: input.userId,
    });
    return;
  }

  // Else: walk-in → walk-in. No ledger row to touch on either side.
  // Future walk-in payments stay on *Payment rails.
}

// ---- TRANSACTION_LINKED soft-delete (parent soft-delete path) --------

type SoftDeleteLedgerInput = {
  sourceType: LedgerSourceType;
  sourceId: string;
  userId: string | null;
};

/**
 * Soft-delete the linked TRANSACTION_LINKED entry for a parent that's
 * being soft-deleted. No-op if no active entry exists (walk-in path or
 * a parent that was never party-linked).
 */
export async function softDeleteTransactionLedgerEntry(
  tx: Prisma.TransactionClient,
  input: SoftDeleteLedgerInput,
): Promise<void> {
  await tx.ledgerEntry.updateMany({
    where: {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      deletedAt: null,
    },
    data: {
      deletedAt: new Date(),
      deletedById: input.userId,
    },
  });
}

// ---- Karigar (Employee-owned) ledger writes — Phase 21b -------------
//
// PIECE_ENTRY → INCREASE on the karigar's ledger ("shop owes karigar").
// WAGE_PAYMENT → DECREASE ("shop paid karigar"). Advances are wage
// payments with a descriptive note — the data model treats them as
// regular DECREASE entries; a credit balance (negative) means the
// karigar holds an advance against future work.
//
// Both helpers MUST be called inside the parent labour action's
// `prisma.$transaction` so a thrown ledger write rolls the parent
// (PieceEntry / EmployeePayment) back atomically. Soft-deletes reuse
// the owner-agnostic `softDeleteTransactionLedgerEntry` from above.

type PieceEntryLedgerInput = {
  employeeId: string;
  date: Date;
  sourceId: string;        // piece_entries.id
  count: number;
  ratePerPiece: bigint;
  totalAmount: bigint;     // = count × ratePerPiece (caller computes)
  note: string | null;
  userId: string | null;
};

export async function writePieceEntryLedger(
  tx: Prisma.TransactionClient,
  input: PieceEntryLedgerInput,
): Promise<void> {
  await tx.ledgerEntry.create({
    data: {
      employeeId: input.employeeId,
      partyId: null,
      date: input.date,
      direction: "INCREASE",
      amount: input.totalAmount,
      description: describePieceEntry({
        count: input.count,
        ratePerPiece: input.ratePerPiece,
        note: input.note,
      }),
      entryType: "TRANSACTION_LINKED",
      sourceType: "PIECE_ENTRY",
      sourceId: input.sourceId,
      createdById: input.userId,
      updatedById: input.userId,
    },
  });
}

type WagePaymentLedgerInput = {
  employeeId: string;
  date: Date;
  sourceId: string;        // employee_payments.id
  amount: bigint;
  note: string | null;
  userId: string | null;
};

export async function writeWagePaymentLedger(
  tx: Prisma.TransactionClient,
  input: WagePaymentLedgerInput,
): Promise<void> {
  await tx.ledgerEntry.create({
    data: {
      employeeId: input.employeeId,
      partyId: null,
      date: input.date,
      direction: "DECREASE",
      amount: input.amount,
      description: describeWagePayment({ note: input.note }),
      entryType: "TRANSACTION_LINKED",
      sourceType: "WAGE_PAYMENT",
      sourceId: input.sourceId,
      createdById: input.userId,
      updatedById: input.userId,
    },
  });
}

// ---- Return-row ledger helpers ---------------------------------------

type ReturnLedgerInput = {
  partyId: string;
  date: Date;
  sourceType: "SALE_RETURN" | "PURCHASE_RETURN";
  sourceId: string;
  amount: bigint;
  userId: string | null;
};

/**
 * Insert the DECREASE entry for a SaleReturn / PurchaseReturn against a
 * party-linked parent. The return row's `id` is the sourceId (separate
 * from the parent transaction's id, so the partial-unique-on-active
 * index allows both the original INCREASE and the return DECREASE to
 * coexist).
 */
export async function writeReturnLedgerEntry(
  tx: Prisma.TransactionClient,
  input: ReturnLedgerInput,
): Promise<void> {
  await tx.ledgerEntry.create({
    data: {
      partyId: input.partyId,
      date: input.date,
      direction: "DECREASE",
      amount: input.amount,
      description: describeTransactionLedgerEntry({
        sourceType: input.sourceType,
        lineItemCount: 0,
      }),
      entryType: "TRANSACTION_LINKED",
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdById: input.userId,
      updatedById: input.userId,
    },
  });
}

export async function softDeleteReturnLedgerEntry(
  tx: Prisma.TransactionClient,
  input: SoftDeleteLedgerInput,
): Promise<void> {
  // Same shape as the transaction soft-delete; the sourceType is the
  // return enum value passed by the caller. Keeping a separate
  // function name makes the call site grep-friendly.
  await softDeleteTransactionLedgerEntry(tx, input);
}

// ---- Internal helpers -------------------------------------------------

async function findActiveLedgerEntry(
  tx: Prisma.TransactionClient,
  sourceType: LedgerSourceType,
  sourceId: string,
): Promise<{ id: string } | null> {
  return tx.ledgerEntry.findFirst({
    where: { sourceType, sourceId, deletedAt: null },
    select: { id: true },
  });
}

/**
 * Walk-in → party transition support: migrate the active *Payment
 * rows for this transaction into MANUAL_PAYMENT LedgerEntries on the
 * new party, then soft-delete the *Payment rows. The resulting
 * MANUAL_PAYMENT direction follows the same rules as the initial
 * backfill (PAYMENT → DECREASE for all entity kinds; REFUND →
 * INCREASE).
 *
 * Why migrate: otherwise the transaction's prior payment history
 * becomes invisible to the new party-ledger view, leaving a "ghost"
 * payment recorded against a now-party-linked transaction that
 * listWalkInPayables no longer surfaces.
 */
async function migrateWalkInPaymentsToLedger(
  tx: Prisma.TransactionClient,
  input: {
    sourceType: LedgerSourceType;
    sourceId: string;
    newPartyId: string;
    userId: string | null;
  },
): Promise<void> {
  const { sourceType, sourceId, newPartyId, userId } = input;

  if (sourceType === "SALE") {
    const payments = await tx.salePayment.findMany({
      where: { saleId: sourceId, deletedAt: null },
    });
    for (const p of payments) {
      await tx.ledgerEntry.create({
        data: {
          partyId: newPartyId,
          date: p.date,
          direction: p.type === "PAYMENT" ? "DECREASE" : "INCREASE",
          amount: p.amount,
          description: p.note ?? `Migrated from walk-in ${p.type.toLowerCase()}`,
          entryType: "MANUAL_PAYMENT",
          sourceType: null,
          sourceId: null,
          createdById: userId,
          updatedById: userId,
        },
      });
    }
    if (payments.length > 0) {
      await tx.salePayment.updateMany({
        where: { saleId: sourceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    return;
  }

  if (sourceType === "PURCHASE") {
    const payments = await tx.purchasePayment.findMany({
      where: { purchaseId: sourceId, deletedAt: null },
    });
    for (const p of payments) {
      await tx.ledgerEntry.create({
        data: {
          partyId: newPartyId,
          date: p.date,
          direction: p.type === "PAYMENT" ? "DECREASE" : "INCREASE",
          amount: p.amount,
          description: p.note ?? `Migrated from walk-in ${p.type.toLowerCase()}`,
          entryType: "MANUAL_PAYMENT",
          sourceType: null,
          sourceId: null,
          createdById: userId,
          updatedById: userId,
        },
      });
    }
    if (payments.length > 0) {
      await tx.purchasePayment.updateMany({
        where: { purchaseId: sourceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    return;
  }

  if (sourceType === "CASTING") {
    const payments = await tx.castingPayment.findMany({
      where: { castingEntryId: sourceId, deletedAt: null },
    });
    for (const p of payments) {
      await tx.ledgerEntry.create({
        data: {
          partyId: newPartyId,
          date: p.date,
          direction: p.type === "PAYMENT" ? "DECREASE" : "INCREASE",
          amount: p.amount,
          description: p.note ?? `Migrated from walk-in ${p.type.toLowerCase()}`,
          entryType: "MANUAL_PAYMENT",
          sourceType: null,
          sourceId: null,
          createdById: userId,
          updatedById: userId,
        },
      });
    }
    if (payments.length > 0) {
      await tx.castingPayment.updateMany({
        where: { castingEntryId: sourceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    return;
  }

  if (sourceType === "PLATING") {
    const payments = await tx.platingPayment.findMany({
      where: { platingEntryId: sourceId, deletedAt: null },
    });
    for (const p of payments) {
      await tx.ledgerEntry.create({
        data: {
          partyId: newPartyId,
          date: p.date,
          direction: p.type === "PAYMENT" ? "DECREASE" : "INCREASE",
          amount: p.amount,
          description: p.note ?? `Migrated from walk-in ${p.type.toLowerCase()}`,
          entryType: "MANUAL_PAYMENT",
          sourceType: null,
          sourceId: null,
          createdById: userId,
          updatedById: userId,
        },
      });
    }
    if (payments.length > 0) {
      await tx.platingPayment.updateMany({
        where: { platingEntryId: sourceId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    return;
  }

  // SALE_RETURN / PURCHASE_RETURN never enter this path — they're
  // child rows, not parent transactions, and don't go through
  // updateTransactionLedgerEntry. Defensive no-op.
}

// ---- Balance computation (raw signed, NO CLAMP) ----------------------

type LedgerEntryLike = {
  direction: "INCREASE" | "DECREASE";
  amount: bigint;
  deletedAt: Date | null;
};

/**
 * RAW SIGNED owner balance: Σ(INCREASE) − Σ(DECREASE) across
 * non-deleted entries. NEVER clamped — negative results represent
 * credit balances. The UI must label negative balances as "credit"
 * rather than displaying a minus-prefixed outstanding amount.
 *
 * Owner-agnostic: works for Party-owned entries (Phase 21a) and
 * Employee-owned entries (Phase 21b — karigar). The math is identical
 * because the LedgerEntry shape already separated direction from
 * owner.
 *
 * Phase 21b: renamed from `computePartyBalance`. The old name is
 * preserved as a `@deprecated` alias for one phase; drop the alias in
 * 21c when all call sites have moved.
 */
export function computeOwnerBalance(entries: LedgerEntryLike[]): bigint {
  let total = 0n;
  for (const e of entries) {
    if (e.deletedAt !== null) continue;
    if (e.direction === "INCREASE") total += e.amount;
    else total -= e.amount;
  }
  return total;
}

/**
 * @deprecated Use `computeOwnerBalance` instead — owner-agnostic name.
 * Kept for one phase (drop in 21c) so existing party-side call sites
 * don't break during the rename.
 */
export const computePartyBalance = computeOwnerBalance;

/**
 * Scoped-balance computation — for /payables role-scoped views.
 *
 * Filters to entries whose sourceType matches the role's scope, EXCLUDING
 * MANUAL_PAYMENT (which has sourceType IS NULL and reconciles against
 * the full party balance, not per-activity).
 *
 * ADMIN view should use `computePartyBalance` (all entries, all sources)
 * — true net balance including MANUAL_PAYMENT.
 *
 * Scoped roles (PURCHASE_DEPT, CASTING_PLATING_MGMT) use this to see
 * "outstanding by activity" — what their workflow generated, untouched
 * by ADMIN's reconciliation payments. Multi-role parties (rare at
 * workshop scale) show the asymmetry with a footnote in the UI.
 */
type ScopedLedgerEntryLike = LedgerEntryLike & {
  sourceType: LedgerSourceType | null;
};

export function computeScopedBalance(
  entries: ScopedLedgerEntryLike[],
  allowedSourceTypes: LedgerSourceType[],
): bigint {
  let total = 0n;
  for (const e of entries) {
    if (e.deletedAt !== null) continue;
    if (e.sourceType === null) continue; // exclude MANUAL_PAYMENT
    if (!allowedSourceTypes.includes(e.sourceType)) continue;
    if (e.direction === "INCREASE") total += e.amount;
    else total -= e.amount;
  }
  return total;
}

// ---- Read-side helpers (party-statement view) ------------------------

export type LedgerEntryForClient = {
  id: string;
  date: Date;
  direction: "INCREASE" | "DECREASE";
  amount: number; // paise as Number for JSON safety
  description: string | null;
  entryType: "TRANSACTION_LINKED" | "MANUAL_PAYMENT";
  sourceType: LedgerSourceType | null;
  sourceId: string | null;
  /** Running balance after this entry, raw signed (paise). */
  runningBalance: number;
};

/**
 * Chronological ledger entries for one party with running balance
 * precomputed. Used by /payables/[partyId] and /receivables/[partyId]
 * statement views.
 *
 * Returns RAW SIGNED running balance — negative = credit. The view
 * must label sign appropriately per role direction.
 */
export async function listPartyLedger(
  partyId: string,
): Promise<LedgerEntryForClient[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { partyId, deletedAt: null },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  let running = 0n;
  const out: LedgerEntryForClient[] = [];
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

/**
 * Phase 21b — chronological ledger entries for one karigar (Employee)
 * with running balance precomputed. Peer to `listPartyLedger`.
 *
 * Note: 21b ships no dedicated per-karigar view (that's 21c). This
 * helper exists because `labour-balances.ts` needs to fetch karigar
 * entries to drive the outstanding-wages number on /labour, and the
 * 21c view will consume it as-is.
 */
export async function listEmployeeLedger(
  employeeId: string,
): Promise<LedgerEntryForClient[]> {
  const entries = await prisma.ledgerEntry.findMany({
    where: { employeeId, deletedAt: null },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  let running = 0n;
  const out: LedgerEntryForClient[] = [];
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

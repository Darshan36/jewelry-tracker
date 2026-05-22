// Phase 21b — owner discriminator helpers for the LedgerEntry table.
//
// A LedgerEntry's owner is either a Party (party-linked transactions —
// Phase 21a) OR an Employee (karigar / labour entries — Phase 21b).
// The DB CHECK constraint `ledger_entries_owner_exactly_one` enforces
// "exactly one is non-null"; this module is the application-layer
// counterpart that surfaces the violation cleanly BEFORE Prisma fires
// the constraint error.
//
// Mirrors the assertPartyHasRole pattern from party-roles.ts: a tiny
// defense-in-depth assert called by every action that writes a
// LedgerEntry, plus a typed `LedgerOwner` discriminated union that the
// ledger.ts helpers branch on.

export type LedgerOwner =
  | { kind: "PARTY"; partyId: string }
  | { kind: "EMPLOYEE"; employeeId: string };

export type LedgerOwnerSlice = {
  partyId: string | null | undefined;
  employeeId: string | null | undefined;
};

/**
 * True iff exactly one of (partyId, employeeId) is a non-empty string.
 * `null`, `undefined`, and empty string all count as "not set".
 */
export function hasExactlyOneOwner(slice: LedgerOwnerSlice): boolean {
  const hasParty = typeof slice.partyId === "string" && slice.partyId.length > 0;
  const hasEmployee =
    typeof slice.employeeId === "string" && slice.employeeId.length > 0;
  return hasParty !== hasEmployee; // XOR
}

/**
 * Action-layer guard. Throws a clear Error BEFORE the DB CHECK fires —
 * Prisma's constraint-violation error is opaque ("violates check
 * constraint"); this surfaces the actual condition so the caller can log
 * a useful message.
 */
export function assertOwnerExactlyOne(slice: LedgerOwnerSlice): void {
  if (hasExactlyOneOwner(slice)) return;
  const hasParty = typeof slice.partyId === "string" && slice.partyId.length > 0;
  const hasEmployee =
    typeof slice.employeeId === "string" && slice.employeeId.length > 0;
  if (!hasParty && !hasEmployee) {
    throw new Error(
      "LedgerEntry owner missing: exactly one of partyId or employeeId must be set.",
    );
  }
  throw new Error(
    "LedgerEntry owner ambiguous: partyId AND employeeId are both set; exactly one must be set.",
  );
}

/**
 * Resolve a `LedgerOwner` discriminated union from a slice that has at
 * most one owner set. Throws via `assertOwnerExactlyOne` if neither or
 * both are set.
 */
export function resolveLedgerOwner(slice: LedgerOwnerSlice): LedgerOwner {
  assertOwnerExactlyOne(slice);
  if (typeof slice.partyId === "string" && slice.partyId.length > 0) {
    return { kind: "PARTY", partyId: slice.partyId };
  }
  // assertOwnerExactlyOne guarantees employeeId is set here.
  return { kind: "EMPLOYEE", employeeId: slice.employeeId as string };
}

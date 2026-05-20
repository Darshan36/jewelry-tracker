// Party role-flag helpers — Phase 17a defense-in-depth.
//
// Every Party row must have at least one role flag set (`isCustomer`,
// `isSupplier`, `isCastingVendor`, `isPlatingVendor`). The role flags
// determine which UI surfaces show the party — a roleless party would be
// invisible to /customers, /suppliers, AND /vendors, defeating the unified
// model's whole point.
//
// The form-context-sets-flag invariant (each transactional form sets the
// role flag implicitly based on its URL) keeps the UI path safe. This
// helper is the second-layer guard at the action boundary: every
// `prisma.party.create` should be preceded by `assertPartyHasRole(data)`
// so a future refactor that drops the hardcoded flag fails loudly instead
// of producing a silently-broken Party row.

export const PARTY_ROLE_FLAGS = [
  "isCustomer",
  "isSupplier",
  "isCastingVendor",
  "isPlatingVendor",
] as const;

export type PartyRoleFlag = (typeof PARTY_ROLE_FLAGS)[number];

export type PartyRoleSlice = Partial<Record<PartyRoleFlag, boolean | null>>;

export function hasAnyPartyRole(data: PartyRoleSlice): boolean {
  return PARTY_ROLE_FLAGS.some((k) => data[k] === true);
}

export function assertPartyHasRole(data: PartyRoleSlice): void {
  if (!hasAnyPartyRole(data)) {
    throw new Error(
      "Party must have at least one role flag set (isCustomer / isSupplier / isCastingVendor / isPlatingVendor).",
    );
  }
}

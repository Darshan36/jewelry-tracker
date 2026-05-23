// Centralised revalidation set per transaction kind.
//
// Each transactional mutation (create/update/soft-delete on the entry
// itself OR its payment/return children) touches multiple page caches:
//   - the entity's own list page (/sales, /purchases, /casting, /plating)
//   - /ledger (the unified party + karigar home page since 21c.1)
//   - /dashboard (per-role; the per-category ledger boxes since 21c.1.1
//     read from the same listLedgerHome source, and dashboard tx-count /
//     monthly-aggregate cards reflect entry counts)
//
// Phase 21c.2: /completed, /payables, /receivables routes REMOVED;
// their content lives on /ledger + dashboard category boxes. The
// revalidatePath lines for those routes are gone — revalidating a
// deleted route is harmless but pointless.
//
// Before this helper existed, action files only called
// `revalidatePath("/<entity>")`. Adding a casting entry left the
// dashboard's "Casting Payables" card stale; same shape for sales /
// purchases / plating. See the polish bug-fix where the user reported
// "adding entries in casting does not reflect on the dashboard".
//
// The helper takes nothing — every call site is unconditional. The
// per-party-side revalidation (`/customers`, `/suppliers`, `/vendors`)
// remains inline in each action because it's conditional on
// `partyCreatedOrUpdated`.

import { revalidatePath } from "next/cache";

export function revalidateSaleViews() {
  revalidatePath("/sales");
  revalidatePath("/ledger");
  revalidatePath("/dashboard");
}

export function revalidatePurchaseViews() {
  revalidatePath("/purchases");
  revalidatePath("/ledger");
  revalidatePath("/dashboard");
}

export function revalidateCastingViews() {
  revalidatePath("/casting");
  revalidatePath("/ledger");
  revalidatePath("/dashboard");
}

export function revalidatePlatingViews() {
  revalidatePath("/plating");
  revalidatePath("/ledger");
  revalidatePath("/dashboard");
}

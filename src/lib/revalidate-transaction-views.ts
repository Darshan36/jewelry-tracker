// Centralised revalidation set per transaction kind.
//
// Each transactional mutation (create/update/soft-delete on the entry
// itself OR its payment/return children) touches multiple page caches:
//   - the entity's own list page (/sales, /purchases, /casting, /plating)
//   - the payables (purchase/casting/plating) or receivables (sales)
//     party rollup, whose live numbers come from these same rows
//   - /completed, the ADMIN-only settled-history view, which filters by
//     derived status (computed from payments + returns)
//   - /dashboard, whose per-source payables/receivables cards and
//     monthly aggregates are computed from these rows
//
// Before this helper landed, action files only called
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
  revalidatePath("/receivables");
  revalidatePath("/completed");
  revalidatePath("/dashboard");
}

export function revalidatePurchaseViews() {
  revalidatePath("/purchases");
  revalidatePath("/payables");
  revalidatePath("/completed");
  revalidatePath("/dashboard");
}

export function revalidateCastingViews() {
  revalidatePath("/casting");
  revalidatePath("/payables");
  revalidatePath("/completed");
  revalidatePath("/dashboard");
}

export function revalidatePlatingViews() {
  revalidatePath("/plating");
  revalidatePath("/payables");
  revalidatePath("/completed");
  revalidatePath("/dashboard");
}

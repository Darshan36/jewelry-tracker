// Role-access matrix for Payables/Receivables (Phase 17b).
//
// Pure functions — no DB, no auth. Server components call these after
// reading the session role; the page-level guard then redirects on
// false. See proxy.ts for the URL-level enforcement (defense-in-depth
// alongside this UI-layer check).

import type { Role } from "@/generated/prisma";

import type { PayableScope } from "./outstanding-balances";

/**
 * Whether a role can view payables of a given scope.
 *
 * Scope mapping:
 *   - `purchase` → only Purchases-source payables.
 *   - `casting_plating` → CastingEntry + PlatingEntry payables.
 *   - `all` → both above combined.
 *
 * Matrix:
 *   - ADMIN: any scope.
 *   - PURCHASE_DEPT: `purchase` only (not `casting_plating`, not `all`).
 *   - CASTING_PLATING_MGMT: `casting_plating` only.
 *   - LABOUR_MGMT: none.
 *
 * Note `all` is the ADMIN-only superset; non-ADMIN roles must request
 * their specific scope. Use `effectivePayableScope(role)` to derive the
 * scope a role should default to when opening /payables.
 */
export function canViewPayables(role: Role, scope: PayableScope): boolean {
  if (role === "ADMIN") return true;
  if (role === "PURCHASE_DEPT") return scope === "purchase";
  if (role === "CASTING_PLATING_MGMT") return scope === "casting_plating";
  return false; // LABOUR_MGMT and any unknown roles
}

/**
 * The default scope a role should use when opening the /payables page.
 * Returns `null` if the role has no access at all (LABOUR_MGMT).
 */
export function effectivePayableScope(role: Role): PayableScope | null {
  if (role === "ADMIN") return "all";
  if (role === "PURCHASE_DEPT") return "purchase";
  if (role === "CASTING_PLATING_MGMT") return "casting_plating";
  return null;
}

/**
 * Whether a role can view the /receivables page.
 *
 * Only ADMIN. Receivables (= outstanding sales) is a customer-facing
 * book; other roles don't have a business need for it under the current
 * organisation shape. Revisit if a sales-facing role is added later.
 */
export function canViewReceivables(role: Role): boolean {
  return role === "ADMIN";
}

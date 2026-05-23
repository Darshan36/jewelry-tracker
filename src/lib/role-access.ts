// Role-access matrix.
//
// Pure functions — no DB, no auth. Server components call these after
// reading the session role; the page-level guard then redirects on
// false. See proxy.ts for the URL-level enforcement (defense-in-depth
// alongside this UI-layer check).
//
// Phase 21c.2: canViewPayables / canViewReceivables / canViewCompleted
// / effectivePayableScope were REMOVED with the routes they gated.
// /payables, /receivables, /completed all consolidated into /ledger
// (21c.1) + dashboard category boxes (21c.1.1); see canViewLedger
// below for the unified-page gate.

import type { Role } from "@/generated/prisma";

// Phase 18 — Labour management gates.
//
// `canViewLabour` controls visibility (sidebar item, dashboard cards,
// /labour route) and `canManageLabour` controls mutation actions
// (createBulkPieceEntries, createEmployeePayment, etc). For now both
// resolve to the same matrix — ADMIN + LABOUR_MGMT — but the two
// helpers are separate so a future read-only role can flip just the
// view bit without inheriting mutation access.

/**
 * Whether a role can view the /labour page and its dashboard
 * companion cards.
 */
export function canViewLabour(role: Role): boolean {
  return role === "ADMIN" || role === "LABOUR_MGMT";
}

/**
 * Whether a role can mutate labour data (piece entries, payments).
 * Mirrors the server-action requireRole list.
 */
export function canManageLabour(role: Role): boolean {
  return role === "ADMIN" || role === "LABOUR_MGMT";
}

// Phase 19 + 21c.2: canViewCompleted REMOVED (route retired in 21c.2).

/** Whether a role can view the /reports page (Phase 15 placeholder). */
export function canViewReports(role: Role): boolean {
  return role === "ADMIN";
}

// Phase 21c.1 — Unified ledger home.
//
// `/ledger` is visible to every authenticated role — each role sees a
// role-scoped subset of the four summary boxes (receivables, purchase
// payables, casting/plating payables, karigar wages) and the unified
// owner list filtered to the owners they can act on. The box / owner
// gating itself lives in `src/lib/ledger-home.ts` (`canRoleSeeBox`,
// `visiblePartySources`); this helper is the URL-level gate equivalent
// of the others above.
//
// Why "every role" instead of role-specific gating: every role has at
// least one box that's relevant to them (LABOUR_MGMT sees the karigar
// slice, scoped roles see their payables, ADMIN sees all four). Hiding
// the route per-role would mean adding a sidebar-visibility branch for
// no benefit — the page already empty-states cleanly when a role's
// scope contains no rows.

/** Whether a role can view the /ledger page (every role can). */
export function canViewLedger(role: Role): boolean {
  return (
    role === "ADMIN" ||
    role === "PURCHASE_DEPT" ||
    role === "CASTING_PLATING_MGMT" ||
    role === "LABOUR_MGMT"
  );
}

// Phase 16 — User management UI.
//
// `/users` is ADMIN-only — only admins can list, create, edit, reset
// passwords for, or deactivate other users. The page server-component
// uses this for the redirect; the proxy gates the URL; every server
// action calls `requireRole(['ADMIN'])`. Three-layer defense matches
// the /completed and /receivables pattern.

/** Whether a role can manage users (list, create, edit, deactivate). */
export function canManageUsers(role: Role): boolean {
  return role === "ADMIN";
}

// Phase 20 — Shop settings.
//
// `/settings` is ADMIN-only — admins configure the bill header
// content (shop name, phone, address, footer). Same three-layer
// pattern. The print bill route `/sales/[id]/bill` inherits the
// existing `/sales` ADMIN gate via the proxy's prefix match; no
// new role helper needed for it.

/** Whether a role can manage shop settings (bill header config). */
export function canManageSettings(role: Role): boolean {
  return role === "ADMIN";
}

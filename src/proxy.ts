import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import type { Role } from "@/generated/prisma";

// Per-route role gates. Defense-in-depth alongside server-action requireRole().
// Key: the leading path segment under /app (without trailing slash).
// Value: the roles that are allowed in.
//
// Routes not listed default to "any authenticated user OK" — see proxy logic.
// /dashboard is intentionally open to every role (it renders role-specific
// content on the inside).
const ROUTE_ROLES: Record<string, Role[]> = {
  "/sales": ["ADMIN"],
  "/customers": ["ADMIN"],
  "/purchases": ["ADMIN", "PURCHASE_DEPT"],
  "/suppliers": ["ADMIN", "PURCHASE_DEPT"],
  "/employees": ["ADMIN", "LABOUR_MGMT"],
  "/labour": ["ADMIN", "LABOUR_MGMT"],
  "/casting": ["ADMIN", "CASTING_PLATING_MGMT"],
  "/plating": ["ADMIN", "CASTING_PLATING_MGMT"],
  "/vendors": ["ADMIN", "CASTING_PLATING_MGMT"],
  // Phase 17b: Payables visible to ADMIN, PURCHASE_DEPT, CASTING_PLATING_MGMT
  // (each role's page server-component re-filters by effective scope —
  // PURCHASE_DEPT can't see casting payables and vice versa even at this
  // route level). LABOUR_MGMT has no payables to view.
  "/payables": ["ADMIN", "PURCHASE_DEPT", "CASTING_PLATING_MGMT"],
  // Receivables is ADMIN-only — customer-facing book.
  "/receivables": ["ADMIN"],
  // Phase 19: Completed (aggregated cross-entity history) is ADMIN-only.
  // /reports is preemptively gated for Phase 15 (still a sidebar placeholder).
  "/completed": ["ADMIN"],
  "/reports": ["ADMIN"],
  // Phase 16: User management UI — ADMIN-only.
  "/users": ["ADMIN"],
  // Phase 20: Shop settings (bill header config) — ADMIN-only.
  // The print bill route `/sales/[id]/bill` is covered by the
  // existing `/sales` gate above; no separate entry needed.
  "/settings": ["ADMIN"],
  "/admin": ["ADMIN"],
  "/dashboard": ["ADMIN", "PURCHASE_DEPT", "LABOUR_MGMT", "CASTING_PLATING_MGMT"],
};

function findRouteRoles(path: string): Role[] | null {
  for (const prefix of Object.keys(ROUTE_ROLES)) {
    if (path === prefix || path.startsWith(prefix + "/")) {
      return ROUTE_ROLES[prefix];
    }
  }
  return null;
}

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;

  if (path === "/") {
    return NextResponse.redirect(
      new URL(isLoggedIn ? "/dashboard" : "/auth/login", req.nextUrl),
    );
  }

  const isAuthRoute = path.startsWith("/auth");
  const isApiAuthRoute = path.startsWith("/api/auth");
  const isPublicAsset =
    path.startsWith("/_next") || path.startsWith("/favicon");

  if (isApiAuthRoute || isPublicAsset) return;

  if (isAuthRoute) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
    return;
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/auth/login", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated: enforce per-route role gate.
  const allowedRoles = findRouteRoles(path);
  if (allowedRoles !== null) {
    const userRole = req.auth?.user?.role;
    if (!userRole || !allowedRoles.includes(userRole)) {
      // Unauthorized for this route — send them to their landing page.
      // /dashboard is in ROUTE_ROLES with all four roles, so the next
      // request will pass the check and render role-appropriate content.
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

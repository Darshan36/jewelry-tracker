import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;

  // Root: redirect cleanly to dashboard or login (no landing page).
  if (path === "/") {
    return NextResponse.redirect(
      new URL(isLoggedIn ? "/dashboard" : "/auth/login", req.nextUrl),
    );
  }

  const isAuthRoute = path.startsWith("/auth");
  const isApiAuthRoute = path.startsWith("/api/auth");
  const isDebugRoute = path.startsWith("/api/debug-env"); // TEMP: remove after diag
  const isPublicAsset =
    path.startsWith("/_next") || path.startsWith("/favicon");

  if (isApiAuthRoute || isDebugRoute || isPublicAsset) return;

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
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

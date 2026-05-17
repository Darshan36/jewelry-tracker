import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { Sidebar } from "./sidebar";

// Server-side auth check — defense in depth against any proxy bypass.
// The proxy already redirects unauthenticated requests away from /(app)
// routes, but this guarantees session.user is non-null inside the group.
//
// Phase 11: layout structure differs by viewport.
//   - Desktop: <Sidebar> (aside) + <main> side-by-side, full-height flex
//   - Mobile: <Sidebar> renders a fixed header bar (hamburger + title +
//     role chip) and a Sheet drawer; <main> fills the screen below the
//     header with `pt-14` to clear the fixed header.

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  return (
    <div className="md:flex md:h-screen">
      <Sidebar user={session.user} />
      <main className="flex-1 overflow-auto bg-surface pt-14 md:pt-0 min-h-screen md:min-h-0">
        {children}
      </main>
    </div>
  );
}

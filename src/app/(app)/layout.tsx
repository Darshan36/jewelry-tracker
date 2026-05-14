import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { Sidebar } from "./sidebar";

// Server-side auth check — defense in depth against any proxy bypass.
// The proxy already redirects unauthenticated requests away from /(app)
// routes, but this guarantees session.user is non-null inside the group.

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  return (
    <div className="flex h-screen">
      <Sidebar user={session.user} />
      <main className="flex-1 overflow-auto bg-surface">{children}</main>
    </div>
  );
}

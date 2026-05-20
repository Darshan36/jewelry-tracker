// Phase 16 — /users page.
//
// ADMIN-only management surface for the User model. Three-layer
// defense (proxy ROUTE_ROLES, this server-component redirect,
// every server action's requireRole) prevents any non-admin
// from reading or mutating users.

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canManageUsers } from "@/lib/role-access";

import { listUsers } from "./actions";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  // Page-component redirect (defense in depth — proxy already gates
  // /users → ADMIN, but a misrouted server-component import would
  // bypass the proxy. Re-check here.)
  if (!canManageUsers(session.user.role)) {
    redirect("/dashboard");
  }

  const users = await listUsers();

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Users
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Sign-in accounts and access roles
        </p>
      </header>

      <UsersTable users={users} currentUserId={session.user.id} />
    </div>
  );
}

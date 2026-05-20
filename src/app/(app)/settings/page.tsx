// Phase 20 — /settings page.
//
// ADMIN-only config surface for the shop header (shopName, phone,
// address, footer) that appears on the print bill. Three-layer
// access: proxy `ROUTE_ROLES["/settings"] = ["ADMIN"]` + this page
// server-component redirect + `upsertShopSettings` action gate.

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canManageSettings } from "@/lib/role-access";

import { getShopSettings } from "./actions";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  if (!canManageSettings(session.user.role)) {
    redirect("/dashboard");
  }

  const settings = await getShopSettings();

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Shop settings
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Header content for printable bills
        </p>
      </header>

      <SettingsForm initialSettings={settings} />
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Building2,
  CheckCircle2,
  Factory,
  FileText,
  Flame,
  HardHat,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import type { Role } from "@/generated/prisma";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  allowedRoles: Role[];
};

const ALL_ROLES: Role[] = [
  "ADMIN",
  "PURCHASE_DEPT",
  "LABOUR_MGMT",
  "CASTING_PLATING_MGMT",
];

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true, allowedRoles: ALL_ROLES },
  { href: "/sales", label: "Sales", icon: TrendingUp, enabled: true, allowedRoles: ["ADMIN"] },
  { href: "/customers", label: "Customers", icon: Users, enabled: true, allowedRoles: ["ADMIN"] },
  { href: "/purchases", label: "Purchases", icon: TrendingDown, enabled: true, allowedRoles: ["ADMIN", "PURCHASE_DEPT"] },
  { href: "/suppliers", label: "Suppliers", icon: Building2, enabled: true, allowedRoles: ["ADMIN", "PURCHASE_DEPT"] },
  { href: "/employees", label: "Employees", icon: UserCog, enabled: true, allowedRoles: ["ADMIN", "LABOUR_MGMT"] },
  { href: "/labour", label: "Payroll", icon: HardHat, enabled: true, allowedRoles: ["ADMIN", "LABOUR_MGMT"] },
  { href: "/casting", label: "Casting", icon: Flame, enabled: true, allowedRoles: ["ADMIN", "CASTING_PLATING_MGMT"] },
  { href: "/plating", label: "Plating", icon: Sparkles, enabled: true, allowedRoles: ["ADMIN", "CASTING_PLATING_MGMT"] },
  { href: "/vendors", label: "Vendors", icon: Factory, enabled: true, allowedRoles: ["ADMIN", "CASTING_PLATING_MGMT"] },
  { href: "/payables", label: "Payables", icon: ArrowUpFromLine, enabled: true, allowedRoles: ["ADMIN", "PURCHASE_DEPT", "CASTING_PLATING_MGMT"] },
  { href: "/receivables", label: "Receivables", icon: ArrowDownToLine, enabled: true, allowedRoles: ["ADMIN"] },
  { href: "/completed", label: "Completed", icon: CheckCircle2, enabled: false, allowedRoles: ["ADMIN"] },
  { href: "/reports", label: "Reports", icon: BarChart3, enabled: false, allowedRoles: ["ADMIN"] },
  { href: "/users", label: "Users", icon: ShieldCheck, enabled: false, allowedRoles: ["ADMIN"] },
  { href: "/admin/bills-test", label: "Bills Test", icon: FileText, enabled: true, allowedRoles: ["ADMIN"] },
  { href: "/settings", label: "Settings", icon: Settings, enabled: false, allowedRoles: ["ADMIN"] },
];

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  PURCHASE_DEPT: "Purchases",
  LABOUR_MGMT: "Labour",
  CASTING_PLATING_MGMT: "Casting/Plating",
};

const ROLE_DOT: Record<Role, string> = {
  ADMIN: "bg-primary",
  PURCHASE_DEPT: "bg-secondary-container",
  LABOUR_MGMT: "bg-tertiary",
  CASTING_PLATING_MGMT: "bg-secondary",
};

type Props = {
  user: { id: string; email: string; name: string; role: Role };
};

// Phase 11: dual-render. Desktop always-visible aside; mobile hamburger
// trigger + Sheet drawer. Tap nav item on mobile closes the drawer.
export function Sidebar({ user }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visible = NAV_ITEMS.filter((i) => i.allowedRoles.includes(user.role));

  const navInner = (
    <SidebarInner
      user={user}
      pathname={pathname}
      visible={visible}
      onItemClick={() => setMobileOpen(false)}
    />
  );

  return (
    <>
      {/* Desktop sidebar — always visible at md and above */}
      <aside
        data-testid="sidebar-desktop"
        className="hidden md:flex w-60 shrink-0 flex-col bg-surface-container-low border-r border-outline-variant"
      >
        {navInner}
      </aside>

      {/* Mobile header bar — hamburger + wordmark + role chip */}
      <div
        data-testid="sidebar-mobile-header"
        className="md:hidden fixed top-0 inset-x-0 z-30 h-14 flex items-center justify-between gap-2 px-3 bg-surface-container-low border-b border-outline-variant"
      >
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
          className="inline-flex items-center justify-center h-11 w-11 text-on-surface hover:bg-surface-container transition-colors"
        >
          <Menu className="size-5" />
        </button>
        <h2 className="flex-1 text-base font-semibold tracking-tight text-on-surface truncate">
          Shree Creation
        </h2>
        <RoleChip role={user.role} />
      </div>

      {/* Mobile drawer — Sheet on left, slides in on hamburger tap */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          data-testid="sidebar-mobile-drawer"
          side="left"
          className="bg-surface-container-low p-0 flex flex-col"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {navInner}
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarInner({
  user,
  pathname,
  visible,
  onItemClick,
}: {
  user: Props["user"];
  pathname: string;
  visible: NavItem[];
  onItemClick: () => void;
}) {
  return (
    <>
      {/* Wordmark */}
      <div className="p-6 border-b border-outline-variant">
        <h2 className="text-lg font-semibold tracking-tight text-on-surface">
          Shree Creation
        </h2>
        <p className="mt-1 text-on-surface-variant text-xs uppercase tracking-wider">
          Jewelry Mfg
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {visible.map((item) => (
            <li key={item.href}>
              <NavRow
                item={item}
                active={isActive(pathname, item.href)}
                onClick={onItemClick}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* User panel */}
      <div className="border-t border-outline-variant p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="flex-1 min-w-0 text-sm font-medium truncate text-on-surface">
            {user.name}
          </p>
          <RoleChip role={user.role} />
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/auth/login" })}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
        >
          <LogOut className="size-4" />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function NavRow({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;

  if (!item.enabled) {
    return (
      <div
        aria-disabled="true"
        className="flex items-center gap-3 px-3 py-2 border-l-2 border-transparent text-sm text-on-surface opacity-50 cursor-not-allowed"
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1">{item.label}</span>
        <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">
          Soon
        </span>
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={[
        "flex items-center gap-3 px-3 py-2 border-l-2 text-sm text-on-surface transition-colors",
        active
          ? "bg-surface-container-high border-primary"
          : "border-transparent hover:bg-surface-container",
      ].join(" ")}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

function RoleChip({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider bg-surface-container border border-outline-variant text-on-surface-variant whitespace-nowrap">
      <span className={`size-1.5 rounded-full ${ROLE_DOT[role]}`} aria-hidden />
      {ROLE_LABEL[role]}
    </span>
  );
}

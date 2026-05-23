import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/lib/auth";
import { canViewLedger } from "@/lib/role-access";
import { getPayablesForParty } from "@/lib/outstanding-balances";
import type { PayableScope } from "@/lib/outstanding-balances";

import { PartyLedgerDetail } from "./party-ledger-detail";

// Phase 21c.1 — Per-party khata view inside /ledger.
//
// Reuses `getPayablesForParty` (which already produces the exact shape
// the unified detail component needs: party + totalOutstanding signed +
// entries with running balance + showScopeFootnote). The function
// supports `scope: 'all' | 'purchase' | 'casting_plating'` — for ADMIN
// we always use 'all' (full ledger), for scoped roles their natural
// scope. For LABOUR_MGMT we redirect — they have no party visibility
// in the ledger.
//
// `direction` is a UI-only hint: it controls the modal CTA label
// ("Add payment" vs "Receive Payment") to match the workshop user's
// mental model. The underlying ledger write is direction-agnostic.

type Props = {
  params: Promise<{ partyId: string }>;
};

function scopeFor(role: "ADMIN" | "PURCHASE_DEPT" | "CASTING_PLATING_MGMT"): PayableScope {
  if (role === "ADMIN") return "all";
  if (role === "PURCHASE_DEPT") return "purchase";
  return "casting_plating";
}

export default async function PartyLedgerPage({ params }: Props) {
  const { partyId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const role = session.user.role;
  if (!canViewLedger(role)) redirect("/dashboard");
  if (role === "LABOUR_MGMT") redirect("/ledger");

  const scope = scopeFor(role);
  const detail = await getPayablesForParty(partyId, scope);
  if (!detail) notFound();

  // Infer modal CTA label from party role flags:
  //   - isCustomer + no supplier/vendor flags → receivable (Receive Payment)
  //   - otherwise → payable (Add payment, the conservative default for
  //     dual-role parties)
  // Scoped roles always operate in payable mode regardless of party
  // flags (they only see payable-side activity in their scope).
  const isCustomerOnly =
    detail.party.isCustomer &&
    !detail.party.isSupplier &&
    !detail.party.isCastingVendor &&
    !detail.party.isPlatingVendor;
  const direction: "payable" | "receivable" =
    role === "ADMIN" && isCustomerOnly ? "receivable" : "payable";

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <Link
          href="/ledger"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to ledger
        </Link>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          {detail.party.name}
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {detail.party.phone ?? "No phone"}
        </p>
      </header>

      <PartyLedgerDetail
        party={detail.party}
        totalOutstanding={detail.totalOutstanding}
        showScopeFootnote={detail.showScopeFootnote}
        entries={detail.entries}
        scope={scope}
        direction={direction}
      />
    </div>
  );
}

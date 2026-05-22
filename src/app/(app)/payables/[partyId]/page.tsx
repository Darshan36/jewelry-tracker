import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/lib/auth";
import {
  canViewPayables,
  effectivePayableScope,
} from "@/lib/role-access";
import { getPayablesForParty } from "@/lib/outstanding-balances";

import { PartyPayablesDetail } from "./party-payables-detail";

type Props = {
  params: Promise<{ partyId: string }>;
};

export default async function PartyPayablesPage({ params }: Props) {
  const { partyId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const scope = effectivePayableScope(session.user.role);
  if (scope === null || !canViewPayables(session.user.role, scope)) {
    redirect("/dashboard");
  }

  const detail = await getPayablesForParty(partyId, scope);
  if (!detail) notFound();

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <Link
          href="/payables"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to payables
        </Link>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          {detail.party.name}
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {detail.party.phone ?? "No phone"}
        </p>
      </header>

      <PartyPayablesDetail
        party={detail.party}
        totalOutstanding={detail.totalOutstanding}
        showScopeFootnote={detail.showScopeFootnote}
        entries={detail.entries}
        scope={scope}
      />
    </div>
  );
}

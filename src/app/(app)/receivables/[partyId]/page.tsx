import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/lib/auth";
import { canViewReceivables } from "@/lib/role-access";
import { getReceivablesForParty } from "@/lib/outstanding-balances";

import { PartyReceivablesDetail } from "./party-receivables-detail";

type Props = {
  params: Promise<{ partyId: string }>;
};

export default async function PartyReceivablesPage({ params }: Props) {
  const { partyId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  if (!canViewReceivables(session.user.role)) redirect("/dashboard");

  const detail = await getReceivablesForParty(partyId);
  if (!detail) notFound();

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <Link
          href="/receivables"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to receivables
        </Link>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          {detail.party.name}
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {detail.party.phone ?? "No phone"}
        </p>
      </header>

      <PartyReceivablesDetail
        party={detail.party}
        sales={detail.sales}
        totalOutstanding={detail.totalOutstanding}
      />
    </div>
  );
}

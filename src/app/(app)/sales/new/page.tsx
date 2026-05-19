import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/prisma";

import { SaleForm } from "../sale-form";

export default async function NewSalePage() {
  const parties = await prisma.party.findMany({
    where: { isCustomer: true, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true },
  });

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <Link
          href="/sales"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to sales
        </Link>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">New sale</h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Record a new sale transaction
        </p>
      </header>

      <SaleForm mode="create" parties={parties} />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/prisma";

import { SaleForm } from "../../sale-form";
import { serializeSale } from "../../sale-helpers";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditSalePage({ params }: Props) {
  const { id } = await params;

  const [saleRow, parties] = await Promise.all([
    prisma.sale.findUnique({
      where: { id, deletedAt: null },
      include: {
        lineItems: { orderBy: { createdAt: "asc" } },
        payments: true,
        returns: true,
      },
    }),
    prisma.party.findMany({
      where: { isCustomer: true, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
  ]);

  if (!saleRow) notFound();
  const sale = serializeSale(saleRow);

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
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Edit sale
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {sale.partyName} · ₹
          {(sale.total / 100).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      </header>

      <SaleForm mode="edit" sale={sale} parties={parties} />
    </div>
  );
}

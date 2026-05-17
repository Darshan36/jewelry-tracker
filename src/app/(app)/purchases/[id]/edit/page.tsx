import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/prisma";

import { PurchaseForm } from "../../purchase-form";
import { serializePurchase } from "../../purchase-helpers";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditPurchasePage({ params }: Props) {
  const { id } = await params;

  const [purchaseRow, suppliers] = await Promise.all([
    prisma.purchase.findUnique({
      where: { id, deletedAt: null },
      include: {
        lineItems: { orderBy: { createdAt: "asc" } },
        payments: true,
        returns: true,
      },
    }),
    prisma.supplier.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
  ]);

  if (!purchaseRow) notFound();
  const purchase = serializePurchase(purchaseRow);

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <Link
          href="/purchases"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to purchases
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Edit purchase
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {purchase.partyName} · ₹
          {(purchase.total / 100).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      </header>

      <PurchaseForm mode="edit" purchase={purchase} suppliers={suppliers} />
    </div>
  );
}

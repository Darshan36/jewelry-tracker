import { prisma } from "@/lib/prisma";

import { PurchasesTable } from "./purchases-table";
import {
  serializePurchase,
  type PurchaseForClient,
} from "./purchase-helpers";

export default async function PurchasesPage() {
  const [purchaseRows, supplierRows] = await Promise.all([
    prisma.purchase.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      // Include non-deleted payments AND returns so serializePurchase can
      // compute net paidAmount (PAYMENT minus REFUND) + returnTotal, and
      // derive the live status (pending / partial / completed / refund_due)
      // at the page-render boundary.
      include: {
        payments: { where: { deletedAt: null } },
        returns: { where: { deletedAt: null } },
        lineItems: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.supplier.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
  ]);

  const purchases: PurchaseForClient[] = purchaseRows.map(serializePurchase);

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Purchases</h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Supplier transactions and outstanding payables
        </p>
      </header>

      <PurchasesTable purchases={purchases} suppliers={supplierRows} />
    </div>
  );
}

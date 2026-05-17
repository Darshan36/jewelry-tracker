import { prisma } from "@/lib/prisma";

import { PurchasesTable } from "./purchases-table";
import {
  serializePurchase,
  type PurchaseForClient,
} from "./purchase-helpers";

export default async function PurchasesPage() {
  const purchaseRows = await prisma.purchase.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  });

  const purchases: PurchaseForClient[] = purchaseRows.map(serializePurchase);

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Purchases</h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Supplier transactions and outstanding payables
        </p>
      </header>

      <PurchasesTable purchases={purchases} />
    </div>
  );
}

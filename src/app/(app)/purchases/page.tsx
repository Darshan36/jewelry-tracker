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

  // Phase 12a — photo counts. Bill rows aren't a relation off Purchase
  // (no FK; just the discriminator pair), so we count in a single
  // groupBy query and merge by id. Single extra round-trip regardless
  // of page size.
  const photoIds = purchaseRows.map((p) => p.id);
  const photoCountRows =
    photoIds.length > 0
      ? await prisma.bill.groupBy({
          by: ["attachedToId"],
          where: {
            attachedToType: "PURCHASE_PHOTO",
            attachedToId: { in: photoIds },
            deletedAt: null,
            status: "READY",
          },
          _count: { _all: true },
        })
      : [];
  const photoCountById = new Map<string, number>();
  for (const row of photoCountRows) {
    if (row.attachedToId) {
      photoCountById.set(row.attachedToId, row._count._all);
    }
  }

  const purchases: PurchaseForClient[] = purchaseRows.map((p) =>
    serializePurchase(p, { photoCount: photoCountById.get(p.id) ?? 0 }),
  );

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Purchases
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Supplier transactions and outstanding payables
        </p>
      </header>

      <PurchasesTable purchases={purchases} />
    </div>
  );
}

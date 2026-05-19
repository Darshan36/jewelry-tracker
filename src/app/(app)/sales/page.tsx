import { prisma } from "@/lib/prisma";

import { SalesTable } from "./sales-table";
import { serializeSale, type SaleForClient } from "./sale-helpers";

export default async function SalesPage() {
  const saleRows = await prisma.sale.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  });

  // Phase 12c — photo counts. Attachment rows aren't a relation off Sale
  // (no FK; just the discriminator pair), so we count in a single groupBy
  // query and merge by id. Single extra round-trip regardless of page size.
  const photoIds = saleRows.map((s) => s.id);
  const photoCountRows =
    photoIds.length > 0
      ? await prisma.attachment.groupBy({
          by: ["attachedToId"],
          where: {
            attachedToType: "SALE_PHOTO",
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

  const sales: SaleForClient[] = saleRows.map((s) =>
    serializeSale(s, { photoCount: photoCountById.get(s.id) ?? 0 }),
  );

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Sales
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Customer transactions and outstanding balances
        </p>
      </header>

      <SalesTable sales={sales} />
    </div>
  );
}

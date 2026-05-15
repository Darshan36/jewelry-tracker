import { prisma } from "@/lib/prisma";

import { SalesTable } from "./sales-table";
import { serializeSale, type SaleForClient } from "./sale-helpers";

export default async function SalesPage() {
  const [saleRows, customerRows] = await Promise.all([
    prisma.sale.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      // Include non-deleted payments AND returns so serializeSale can
      // compute net paidAmount (PAYMENT minus REFUND) + returnTotal, and
      // derive the live status (pending / partial / completed / refund_due)
      // at the page-render boundary.
      include: {
        payments: { where: { deletedAt: null } },
        returns: { where: { deletedAt: null } },
        lineItems: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
  ]);

  const sales: SaleForClient[] = saleRows.map(serializeSale);

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Sales</h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Customer transactions and outstanding balances
        </p>
      </header>

      <SalesTable sales={sales} customers={customerRows} />
    </div>
  );
}

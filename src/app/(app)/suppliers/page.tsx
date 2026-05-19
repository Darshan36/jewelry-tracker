import { prisma } from "@/lib/prisma";

import { SuppliersTable } from "./suppliers-table";

export default async function SuppliersPage() {
  const suppliers = await prisma.party.findMany({
    where: { isSupplier: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Suppliers
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Vendors and material sources
        </p>
      </header>

      <SuppliersTable parties={suppliers} />
    </div>
  );
}

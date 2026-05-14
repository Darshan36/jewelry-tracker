import { prisma } from "@/lib/prisma";

import { SuppliersTable } from "./suppliers-table";

export default async function SuppliersPage() {
  const suppliers = await prisma.supplier.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Suppliers</h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Vendors and material sources
        </p>
      </header>

      <SuppliersTable suppliers={suppliers} />
    </div>
  );
}

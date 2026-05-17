import { prisma } from "@/lib/prisma";

import { PlatingTable } from "./plating-table";
import { serializePlatingEntry } from "./plating-helpers";

export default async function PlatingPage() {
  const [entries, vendors] = await Promise.all([
    prisma.platingEntry.findMany({
      where: { deletedAt: null },
      orderBy: { date: "desc" },
      include: {
        lineItems: { orderBy: { createdAt: "asc" } },
        payments: true,
        vendor: true,
        bill: true,
      },
    }),
    prisma.castingPlatingVendor.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
  ]);

  const serialized = entries.map(serializePlatingEntry);

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Plating</h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Outsourced plating jobs (weight × rate)
        </p>
      </header>

      <PlatingTable entries={serialized} vendors={vendors} />
    </div>
  );
}

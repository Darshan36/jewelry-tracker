import { prisma } from "@/lib/prisma";

import { CastingTable } from "./casting-table";
import { serializeCastingEntry } from "./casting-helpers";

export default async function CastingPage() {
  const entries = await prisma.castingEntry.findMany({
    where: { deletedAt: null },
    orderBy: { date: "desc" },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
      payments: true,
      vendor: true,
      bill: true,
    },
  });

  const serialized = entries.map(serializeCastingEntry);

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">Casting</h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Outsourced casting jobs (weight × rate)
        </p>
      </header>

      <CastingTable entries={serialized} />
    </div>
  );
}

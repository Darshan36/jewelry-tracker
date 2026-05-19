import { prisma } from "@/lib/prisma";

import { PlatingTable } from "./plating-table";
import { serializePlatingEntry } from "./plating-helpers";

export default async function PlatingPage() {
  const entries = await prisma.platingEntry.findMany({
    where: { deletedAt: null },
    orderBy: { date: "desc" },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
      payments: true,
      vendor: true,
      attachment: true,
    },
  });

  const serialized = entries.map(serializePlatingEntry);

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Plating
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Outsourced plating jobs (weight × rate)
        </p>
      </header>

      <PlatingTable entries={serialized} />
    </div>
  );
}

import { prisma } from "@/lib/prisma";

import { VendorsTable, type VendorForClient } from "./vendors-table";

// Vendors list. Phase 17a: queries the unified Party table filtered to
// rows with either isCastingVendor or isPlatingVendor set. Each row
// carries the casting + plating entry counts and the total amount
// currently owed to that vendor across both entity kinds.

export default async function VendorsPage() {
  const vendors = await prisma.party.findMany({
    where: {
      OR: [{ isCastingVendor: true }, { isPlatingVendor: true }],
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    include: {
      castingEntries: {
        where: { deletedAt: null },
        include: { payments: { where: { deletedAt: null } } },
      },
      platingEntries: {
        where: { deletedAt: null },
        include: { payments: { where: { deletedAt: null } } },
      },
    },
  });

  const serialized: VendorForClient[] = vendors.map((v) => {
    let owed = 0n;
    let castingCount = 0;
    let platingCount = 0;

    for (const e of v.castingEntries) {
      castingCount += 1;
      const netPaid = e.payments.reduce(
        (sum: bigint, p) =>
          p.type === "PAYMENT" ? sum + p.amount : sum - p.amount,
        0n,
      );
      const remaining = e.total - netPaid;
      if (remaining > 0n) owed += remaining;
    }
    for (const e of v.platingEntries) {
      platingCount += 1;
      const netPaid = e.payments.reduce(
        (sum: bigint, p) =>
          p.type === "PAYMENT" ? sum + p.amount : sum - p.amount,
        0n,
      );
      const remaining = e.total - netPaid;
      if (remaining > 0n) owed += remaining;
    }

    return {
      id: v.id,
      name: v.name,
      phone: v.phone,
      address: v.address,
      notes: v.notes,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      deletedAt: v.deletedAt,
      castingCount,
      platingCount,
      owedPaise: Number(owed),
      isCustomer: v.isCustomer,
      isSupplier: v.isSupplier,
      isCastingVendor: v.isCastingVendor,
      isPlatingVendor: v.isPlatingVendor,
    };
  });

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Vendors
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Casting and plating service providers
        </p>
      </header>

      <VendorsTable parties={serialized} />
    </div>
  );
}

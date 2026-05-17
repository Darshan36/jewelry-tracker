import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/prisma";

import { PlatingForm } from "../plating-form";

export default async function NewPlatingEntryPage() {
  const vendors = await prisma.castingPlatingVendor.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true },
  });

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <Link
          href="/plating"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to plating
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          New plating entry
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Record a new outsourced plating job
        </p>
      </header>

      <PlatingForm mode="create" vendors={vendors} />
    </div>
  );
}

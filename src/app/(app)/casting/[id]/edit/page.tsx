import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/prisma";

import { CastingForm } from "../../casting-form";
import { serializeCastingEntry } from "../../casting-helpers";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditCastingEntryPage({ params }: Props) {
  const { id } = await params;

  const [entryRow, vendors] = await Promise.all([
    prisma.castingEntry.findUnique({
      where: { id, deletedAt: null },
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

  if (!entryRow) notFound();
  const entry = serializeCastingEntry(entryRow);

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <Link
          href="/casting"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to casting
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Edit casting entry
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {entry.partyName} · ₹
          {(entry.total / 100).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      </header>

      <CastingForm mode="edit" entry={entry} vendors={vendors} />
    </div>
  );
}

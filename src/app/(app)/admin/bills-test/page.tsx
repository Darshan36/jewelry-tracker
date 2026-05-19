import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { BillsTestClient } from "./bills-test-client";

// Phase 8 admin-only sandbox. Verifies the R2 upload flow end-to-end
// without touching any production-relevant entity. Once Phase 3.4 retrofit
// lands (real attached bills on Sales / Purchases / payments), this page
// stays as a diagnostic surface.

export default async function BillsTestPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const bills = await prisma.attachment.findMany({
    where: { deletedAt: null },
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });

  const serialised = bills.map((b) => ({
    id: b.id,
    originalFilename: b.originalFilename,
    mimeType: b.mimeType,
    sizeBytes: b.sizeBytes,
    status: b.status,
    uploadedAt: b.uploadedAt.toISOString(),
  }));

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Bills Test
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Admin · R2 upload sandbox
        </p>
      </header>

      <BillsTestClient bills={serialised} />
    </div>
  );
}

"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import { employeeInputSchema, type EmployeeInput } from "./schema";
import { serializeEmployee } from "./types";

// Schema validates rupees as number; this helper handles the rupees → BigInt
// paise conversion at the Prisma boundary. Keeping it action-local avoids
// the wire-format issue that would arise if the schema's output were BigInt
// (client would send BigInt, server's re-parse would reject it).
function toPrismaData<T extends { monthlySalary: number | null }>(parsed: T) {
  const { monthlySalary, ...rest } = parsed;
  return {
    ...rest,
    monthlySalary:
      monthlySalary === null ? null : BigInt(Math.round(monthlySalary * 100)),
  };
}

export async function createEmployee(input: EmployeeInput) {
  await requireRole(["ADMIN", "LABOUR_MGMT"]);

  const parsed = employeeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const created = await prisma.employee.create({
    data: toPrismaData(parsed.data),
  });
  revalidatePath("/employees");
  return { ok: true as const, employee: serializeEmployee(created) };
}

export async function updateEmployee(id: string, input: EmployeeInput) {
  await requireRole(["ADMIN", "LABOUR_MGMT"]);

  const parsed = employeeInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const updated = await prisma.employee.update({
    where: { id, deletedAt: null },
    data: toPrismaData(parsed.data),
  });
  revalidatePath("/employees");
  return { ok: true as const, employee: serializeEmployee(updated) };
}

export async function softDeleteEmployee(id: string) {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  // Phase 21c.2 cascade fix: soft-deleting an employee must also soft-
  // delete their active ledger_entries (PIECE_ENTRY / WAGE_PAYMENT
  // TRANSACTION_LINKED rows + MANUAL_PAYMENT karigar entries). Without
  // this, ledger rows would remain ACTIVE while their owner employee
  // is soft-deleted — silently corrupting the karigar box total
  // (the row's amount would still sum into balances even though the
  // employee shouldn't be visible).
  //
  // Mirrors the Phase 21a softDeleteSale cascade shape (commit 2bcf16e)
  // applied to LedgerEntry instead of *Payment/*Return.
  await prisma.$transaction(async (tx) => {
    const deletedAt = new Date();
    await tx.employee.update({
      where: { id, deletedAt: null },
      data: { deletedAt },
    });
    await tx.ledgerEntry.updateMany({
      where: { employeeId: id, deletedAt: null },
      data: { deletedAt, deletedById: session.user.id },
    });
  });
  revalidatePath("/employees");
  revalidatePath("/labour");
  revalidatePath("/ledger");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

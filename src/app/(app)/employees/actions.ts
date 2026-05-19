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
function toPrismaData<
  T extends { monthlySalary: number | null; ratePerPiece: number | null },
>(parsed: T) {
  const { monthlySalary, ratePerPiece, ...rest } = parsed;
  return {
    ...rest,
    monthlySalary:
      monthlySalary === null ? null : BigInt(Math.round(monthlySalary * 100)),
    ratePerPiece:
      ratePerPiece === null ? null : BigInt(Math.round(ratePerPiece * 100)),
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
  await requireRole(["ADMIN", "LABOUR_MGMT"]);

  await prisma.employee.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/employees");
  return { ok: true as const };
}

"use server";

// Phase 21b.1 — direct karigar ledger entry actions.
//
// Mirrors `parties/ledger-actions.ts` (Phase 21a / 21a.1) for the
// employee owner. Solves the bug where users recorded advances as fake
// piece entries (wrong direction + nonsensical semantics) because there
// was no direct path to post a cash event to a karigar's ledger.
//
// Three actions:
//   - createKarigarLedgerEntry — posts a MANUAL_PAYMENT entry owned by
//     the employee. Direction is user-picked (DECREASE for advance /
//     payment, INCREASE for opening-balance / adjustment).
//   - updateKarigarLedgerEntry — edit amount / date / direction /
//     description in place. Rejects TRANSACTION_LINKED entries (those
//     are corrected via their source PieceEntry / EmployeePayment).
//   - softDeleteKarigarLedgerEntry — soft-delete a MANUAL_PAYMENT
//     entry. Same TRANSACTION_LINKED rejection.
//
// Role gating: same as the rest of /labour — ADMIN + LABOUR_MGMT.
// Atomicity: single-row writes, but still wrapped in
// `prisma.$transaction` for consistency with the wider ledger-write
// surface (and to make future extension safe).

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import {
  createKarigarLedgerEntrySchema,
  updateKarigarLedgerEntrySchema,
  type CreateKarigarLedgerEntryInput,
  type UpdateKarigarLedgerEntryInput,
} from "./karigar-ledger-schema";

export type KarigarLedgerActionResult =
  | { ok: true; entryId: string }
  | {
      ok: false;
      errors: {
        employeeId?: string[];
        amount?: string[];
        date?: string[];
        direction?: string[];
        description?: string[];
        id?: string[];
        message?: string;
      };
    };

function rupeesToPaise(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

function revalidateKarigarLedger() {
  revalidatePath("/labour");
  revalidatePath("/employees");
  revalidatePath("/dashboard");
}

export async function createKarigarLedgerEntry(
  input: CreateKarigarLedgerEntryInput,
): Promise<KarigarLedgerActionResult> {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  const parsed = createKarigarLedgerEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Verify the karigar exists, is LABOUR, and is not deleted. FIXED
  // employees stay on the SALARY rail (Phase 21b scope discipline) — a
  // direct ledger entry against a FIXED employee would split their
  // payment data across two rails and break the monthly-reminder model.
  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId, deletedAt: null },
    select: { id: true, type: true },
  });
  if (!employee) {
    return { ok: false, errors: { employeeId: ["Employee not found"] } };
  }
  if (employee.type !== "LABOUR") {
    return {
      ok: false,
      errors: {
        employeeId: [
          "Direct ledger entries are only valid for LABOUR (karigar) employees",
        ],
      },
    };
  }

  const amountPaise = rupeesToPaise(data.amount);

  const created = await prisma.$transaction(async (tx) => {
    return tx.ledgerEntry.create({
      data: {
        employeeId: employee.id,
        partyId: null,
        date: data.date,
        direction: data.direction,
        amount: amountPaise,
        description: data.description,
        entryType: "MANUAL_PAYMENT",
        sourceType: null,
        sourceId: null,
        createdById: session.user.id,
        updatedById: session.user.id,
      },
    });
  });

  revalidateKarigarLedger();
  return { ok: true, entryId: created.id };
}

export async function updateKarigarLedgerEntry(
  input: UpdateKarigarLedgerEntryInput,
): Promise<KarigarLedgerActionResult> {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  const parsed = updateKarigarLedgerEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const entry = await prisma.ledgerEntry.findUnique({
    where: { id: data.id, deletedAt: null },
    select: { id: true, entryType: true, employeeId: true },
  });
  if (!entry) {
    return { ok: false, errors: { message: "Ledger entry not found" } };
  }
  if (entry.entryType !== "MANUAL_PAYMENT") {
    return {
      ok: false,
      errors: {
        message:
          "Cannot edit a TRANSACTION_LINKED entry directly. Edit the source piece entry or wage payment instead.",
      },
    };
  }
  if (!entry.employeeId) {
    return {
      ok: false,
      errors: {
        message:
          "This ledger entry is not karigar-owned. Use the party ledger action instead.",
      },
    };
  }

  const amountPaise = rupeesToPaise(data.amount);

  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.update({
      where: { id: entry.id },
      data: {
        date: data.date,
        direction: data.direction,
        amount: amountPaise,
        description: data.description,
        updatedById: session.user.id,
      },
    });
  });

  revalidateKarigarLedger();
  return { ok: true, entryId: entry.id };
}

export async function softDeleteKarigarLedgerEntry(
  id: string,
): Promise<KarigarLedgerActionResult> {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  const entry = await prisma.ledgerEntry.findUnique({
    where: { id, deletedAt: null },
    select: { id: true, entryType: true, employeeId: true },
  });
  if (!entry) {
    return { ok: false, errors: { message: "Ledger entry not found" } };
  }
  if (entry.entryType !== "MANUAL_PAYMENT") {
    return {
      ok: false,
      errors: {
        message:
          "Cannot soft-delete a TRANSACTION_LINKED entry directly. Delete the source piece entry or wage payment instead.",
      },
    };
  }
  if (!entry.employeeId) {
    return {
      ok: false,
      errors: {
        message:
          "This ledger entry is not karigar-owned. Use the party ledger action instead.",
      },
    };
  }

  await prisma.ledgerEntry.update({
    where: { id: entry.id },
    data: {
      deletedAt: new Date(),
      deletedById: session.user.id,
    },
  });

  revalidateKarigarLedger();
  return { ok: true, entryId: entry.id };
}

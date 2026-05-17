// Role-based access control for Bill rows.
//
// Bills inherit their access rule from the parent entity they're attached
// to (the `attachedToType` discriminator). ADMIN sees every bill regardless
// of attachment; the non-admin roles see only the bill kinds tied to their
// domain.
//
// Phase 8 ships infrastructure; the only path that exercises this helper
// is the admin-only /admin/bills-test page. Once Phase 3.4 retrofit lands
// (bills on Sales / Purchases / payments) and Phase 6 wires casting/plating
// receipts, this matrix is what every viewer / downloader / deleter will
// consult — same answer regardless of whether the bill is loaded for the
// list view or for a `<img src=...>` GET-presign.
//
// Server only (imports prisma + r2). Do not import from 'use client'.

import type { Bill, Role } from "@/generated/prisma";

import { prisma } from "@/lib/prisma";
import { generatePresignedGetUrl } from "@/lib/r2";
import {
  ATTACHED_TO_TYPES,
  type AttachedToType,
} from "@/app/(app)/bills/schema";

// Per-attachment-type role rule. Standalone bills (`attachedToType: null`)
// are admin-only since they have no parent to inherit from — the admin
// test page is the only path that creates these today.
const ROLE_MATRIX: Record<AttachedToType, Role[]> = {
  SALE: ["ADMIN"],
  PURCHASE: ["ADMIN", "PURCHASE_DEPT"],
  PURCHASE_PAYMENT: ["ADMIN", "PURCHASE_DEPT"],
  CASTING_ENTRY: ["ADMIN", "CASTING_PLATING_MGMT"],
  PLATING_ENTRY: ["ADMIN", "CASTING_PLATING_MGMT"],
};

function isAttachedToType(value: string | null): value is AttachedToType {
  return value !== null && (ATTACHED_TO_TYPES as readonly string[]).includes(value);
}

/**
 * Returns true iff the role is allowed to view / mutate the given bill.
 *
 * Rules:
 *   - ADMIN always passes.
 *   - Bills with `attachedToType = null` are admin-only.
 *   - Bills with a known `attachedToType` consult the role matrix above.
 *   - Bills with an unrecognised `attachedToType` fail closed (admin-only).
 */
export function canAccessBill(
  role: Role,
  bill: Pick<Bill, "attachedToType">,
): boolean {
  if (role === "ADMIN") return true;
  if (bill.attachedToType === null) return false;
  if (!isAttachedToType(bill.attachedToType)) return false;
  return ROLE_MATRIX[bill.attachedToType].includes(role);
}

/**
 * Returns a 1-hour presigned GET URL for inline viewing, or `null` if the
 * caller's role can't see the bill, the bill doesn't exist, the bill is
 * soft-deleted, or the bill isn't in READY status (PENDING/FAILED bills
 * have no usable R2 object).
 */
export async function getViewableBillUrl(
  billId: string,
  role: Role,
): Promise<string | null> {
  const bill = await prisma.bill.findUnique({ where: { id: billId } });
  if (!bill) return null;
  if (bill.deletedAt !== null) return null;
  if (bill.status !== "READY") return null;
  if (!canAccessBill(role, bill)) return null;

  return generatePresignedGetUrl(bill.r2Key);
}

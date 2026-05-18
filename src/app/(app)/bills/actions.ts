"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireSession, requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import {
  deleteObject,
  generatePresignedPutUrl,
  headObject,
} from "@/lib/r2";
import { canAccessBill, getViewableBillUrl } from "@/lib/bill-access";
import type { Role } from "@/generated/prisma";

import {
  confirmUploadInputSchema,
  type ConfirmUploadInput,
  MAX_FILE_SIZE_BYTES,
  prepareUploadInputSchema,
  type PrepareUploadInput,
  softDeleteBillInputSchema,
  type SoftDeleteBillInput,
  type AttachedToType,
} from "./schema";

// Per-attachment-type role rule for MUTATION (who can attach a bill to
// what). Mirrors the read matrix in `bill-access.ts` but lives here to
// keep the action's first await self-contained — a reader scanning the
// action sees the role gate without crossing files.
//
// Standalone bills (attachedToType = null) are ADMIN-only because the
// only path that creates them is the /admin/bills-test page.
const WRITE_MATRIX: Record<AttachedToType, Role[]> = {
  SALE: ["ADMIN"],
  PURCHASE: ["ADMIN", "PURCHASE_DEPT"],
  PURCHASE_PAYMENT: ["ADMIN", "PURCHASE_DEPT"],
  CASTING_ENTRY: ["ADMIN", "CASTING_PLATING_MGMT"],
  PLATING_ENTRY: ["ADMIN", "CASTING_PLATING_MGMT"],
  PURCHASE_PHOTO: ["ADMIN", "PURCHASE_DEPT"],
};

function rolesForAttachedTo(t: AttachedToType | null | undefined): Role[] {
  if (t === null || t === undefined) return ["ADMIN"];
  return WRITE_MATRIX[t];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// R2 key format: bills/YYYY/MM/<uuid>-<sanitized-filename-prefix>.
// The UUID is independent of the Bill row's PK so we don't need a
// pre-insert id allocation step; the @@unique on r2Key is the database
// safety net against collision. The filename prefix is purely cosmetic
// — lets a human glancing at the R2 dashboard recognise what's inside.
function buildR2Key(sanitizedFilename: string, now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = pad2(now.getUTCMonth() + 1);
  const prefix = sanitizedFilename.slice(0, 60);
  return `bills/${yyyy}/${mm}/${randomUUID()}-${prefix}`;
}

export async function prepareUpload(input: PrepareUploadInput) {
  const parsed = prepareUploadInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  // Role gate based on what the bill will be attached to. Done AFTER schema
  // parse so `attachedToType` is already in the typed enum (or null).
  const session = await requireRole(rolesForAttachedTo(parsed.data.attachedToType));

  const now = new Date();
  const r2Key = buildR2Key(parsed.data.originalFilename, now);

  const bill = await prisma.bill.create({
    data: {
      r2Key,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      originalFilename: parsed.data.originalFilename,
      uploadedById: session.user.id,
      attachedToType: parsed.data.attachedToType ?? null,
      attachedToId: parsed.data.attachedToId ?? null,
      status: "PENDING",
    },
  });

  const presignedUrl = await generatePresignedPutUrl(
    r2Key,
    parsed.data.mimeType,
    parsed.data.sizeBytes,
  );

  return {
    ok: true as const,
    billId: bill.id,
    presignedUrl,
  };
}

export async function confirmUpload(input: ConfirmUploadInput) {
  const parsed = confirmUploadInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const bill = await prisma.bill.findUnique({ where: { id: parsed.data.billId } });
  if (!bill) {
    return { ok: false as const, errors: { billId: ["Bill not found"] } };
  }

  // Role gate — same matrix as prepareUpload (you can only confirm a bill
  // you'd be allowed to attach).
  await requireRole(rolesForAttachedTo(bill.attachedToType as AttachedToType | null));

  if (bill.status !== "PENDING") {
    return {
      ok: false as const,
      errors: { billId: [`Bill is already ${bill.status.toLowerCase()}`] },
    };
  }

  // Verify the R2 object matches what was registered. A mismatch (wrong
  // mime, oversized, missing) marks the row FAILED and removes the R2
  // object so the bucket doesn't accumulate junk.
  const head = await headObject(bill.r2Key);

  const mimeMatches = head !== null && head.contentType === bill.mimeType;
  const sizeOk =
    head !== null &&
    head.contentLength === bill.sizeBytes &&
    head.contentLength <= MAX_FILE_SIZE_BYTES;

  if (!head || !mimeMatches || !sizeOk) {
    // Try to clean up R2 (best effort — failure here is logged, not fatal,
    // because the DB tombstone is what matters for status). Orphan cleanup
    // job is deferred — see KNOWN_GAPS.
    try {
      if (head !== null) await deleteObject(bill.r2Key);
    } catch (err) {
      console.error("[confirmUpload] R2 cleanup failed for failed bill", bill.id, err);
    }
    await prisma.bill.update({
      where: { id: bill.id },
      data: { status: "FAILED" },
    });
    revalidatePath("/admin/bills-test");
    return {
      ok: false as const,
      errors: { billId: ["Upload verification failed"] },
    };
  }

  const updated = await prisma.bill.update({
    where: { id: bill.id },
    data: { status: "READY", confirmedAt: new Date() },
  });
  revalidatePath("/admin/bills-test");
  return { ok: true as const, bill: updated };
}

export async function softDeleteBill(input: SoftDeleteBillInput) {
  const parsed = softDeleteBillInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const bill = await prisma.bill.findUnique({ where: { id: parsed.data.billId } });
  if (!bill) {
    return { ok: false as const, errors: { billId: ["Bill not found"] } };
  }
  if (bill.deletedAt !== null) {
    return { ok: false as const, errors: { billId: ["Bill already deleted"] } };
  }

  const session = await requireRole(rolesForAttachedTo(bill.attachedToType as AttachedToType | null));
  // Defense in depth: also check the read-side matrix via canAccessBill,
  // matching the rule used by the viewer. Role write matrix == read matrix
  // by construction; this guards against drift.
  if (!canAccessBill(session.user.role, bill)) {
    throw new Error("Forbidden");
  }

  // Delete R2 first, DB second. If R2 fails we still tombstone in DB so
  // the row disappears from list views — the orphan cleanup job (deferred)
  // will reconcile later. The reverse order would risk a tombstoned row
  // still pointing at a live R2 object that an external token holder could
  // still GET via a previously-issued presigned URL until expiry.
  try {
    await deleteObject(bill.r2Key);
  } catch (err) {
    console.error("[softDeleteBill] R2 delete failed; continuing with DB tombstone", bill.id, err);
  }

  await prisma.bill.update({
    where: { id: bill.id },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/admin/bills-test");
  return { ok: true as const };
}

// Returns a short-lived presigned GET URL for inline viewing, or null if
// the caller can't see the bill. Calls into the read-side helper so the
// matrix is enforced consistently.
export async function getBillViewUrl(billId: string) {
  const session = await requireSession();
  const url = await getViewableBillUrl(billId, session.user.role);
  if (!url) return { ok: false as const, error: "Not available" };
  return { ok: true as const, url };
}

// Fetch the bill currently attached to an entity via the
// (attachedToType, attachedToId) discriminator. Used by Sales / Purchases
// rows that don't carry a `billId` FK on the entity (Casting / Plating
// can use either this OR the FK on the entry row — both work). Returns
// null if no bill is attached or if the caller can't access it.
export async function getBillForEntity(
  attachedToType: AttachedToType,
  attachedToId: string,
) {
  const session = await requireSession();

  // Find the most recent READY bill for this discriminator pair.
  // Bills are 1:1 in practice (the upload flow soft-deletes the prior
  // bill before attaching a new one); the orderBy is a defensive tie-
  // breaker.
  const bill = await prisma.bill.findFirst({
    where: {
      attachedToType,
      attachedToId,
      status: "READY",
      deletedAt: null,
    },
    orderBy: { uploadedAt: "desc" },
  });

  if (!bill) return { ok: true as const, bill: null };
  if (!canAccessBill(session.user.role, bill)) {
    return { ok: true as const, bill: null };
  }

  return {
    ok: true as const,
    bill: {
      id: bill.id,
      originalFilename: bill.originalFilename,
      mimeType: bill.mimeType,
      sizeBytes: bill.sizeBytes,
    },
  };
}

// Phase 12a — multi-photo variant of getBillForEntity. Returns every
// READY photo attached to the entity, oldest first. Same role gate as
// the single-bill lookup. Empty array (not an error) when there are no
// photos.
export type PhotoForClient = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
};

export async function getPhotosForEntity(
  attachedToType: AttachedToType,
  attachedToId: string,
): Promise<
  | { ok: true; photos: PhotoForClient[] }
  | { ok: false; error: string }
> {
  const session = await requireSession();

  const rows = await prisma.bill.findMany({
    where: {
      attachedToType,
      attachedToId,
      status: "READY",
      deletedAt: null,
    },
    orderBy: { uploadedAt: "asc" },
  });

  // Filter via the read-side matrix — if the caller can't access any one
  // photo (which shouldn't happen since they all share the same
  // attachedToType, but defense in depth), drop it from the list rather
  // than erroring out.
  const visible = rows.filter((r) => canAccessBill(session.user.role, r));

  return {
    ok: true,
    photos: visible.map((r) => ({
      id: r.id,
      originalFilename: r.originalFilename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      uploadedAt: r.uploadedAt,
    })),
  };
}

-- Rename Bill → Attachment for semantic clarity.
-- The table now stores both invoice bills (SALE/PURCHASE/CASTING_ENTRY/
-- PLATING_ENTRY/PURCHASE_PAYMENT discriminators) AND visual photos
-- (PURCHASE_PHOTO discriminator). The original name "Bill" became
-- misleading when Phase 12a added photo support.
--
-- Rename scope:
--   - Table:  bills           → attachments
--   - Enum:   BillStatus      → AttachmentStatus
--   - Cols:   casting_entries.billId / plating_entries.billId
--             → attachmentId
--   - Indexes + constraints follow the Prisma naming convention so
--     future `prisma migrate dev` diffs stay clean.
--
-- User-facing UI keeps "bill" terminology — workshop staff call them
-- bills. The rename only affects the internal data layer.
--
-- Production rows: zero rows in bills, casting_entries, plating_entries
-- at the time of this migration (polish-session soft-delete cleanup
-- swept everything). Migration is purely structural.

-- 1. Rename the enum
ALTER TYPE "BillStatus" RENAME TO "AttachmentStatus";

-- 2. Rename the table (Postgres keeps existing constraint/index names
-- attached to the table but doesn't auto-rename the textual names)
ALTER TABLE "bills" RENAME TO "attachments";

-- 3. Rename the table's indexes + constraints to follow the new name
ALTER INDEX "bills_pkey" RENAME TO "attachments_pkey";
ALTER INDEX "bills_r2Key_key" RENAME TO "attachments_r2Key_key";
ALTER INDEX "bills_uploadedById_idx" RENAME TO "attachments_uploadedById_idx";
ALTER INDEX "bills_attachedToType_attachedToId_idx" RENAME TO "attachments_attachedToType_attachedToId_idx";
ALTER INDEX "bills_deletedAt_idx" RENAME TO "attachments_deletedAt_idx";
ALTER INDEX "bills_status_idx" RENAME TO "attachments_status_idx";
ALTER TABLE "attachments" RENAME CONSTRAINT "bills_uploadedById_fkey" TO "attachments_uploadedById_fkey";

-- 4. Rename the FK column on casting_entries
ALTER TABLE "casting_entries" RENAME COLUMN "billId" TO "attachmentId";
ALTER INDEX "casting_entries_billId_key" RENAME TO "casting_entries_attachmentId_key";
ALTER TABLE "casting_entries" RENAME CONSTRAINT "casting_entries_billId_fkey" TO "casting_entries_attachmentId_fkey";

-- 5. Rename the FK column on plating_entries
ALTER TABLE "plating_entries" RENAME COLUMN "billId" TO "attachmentId";
ALTER INDEX "plating_entries_billId_key" RENAME TO "plating_entries_attachmentId_key";
ALTER TABLE "plating_entries" RENAME CONSTRAINT "plating_entries_billId_fkey" TO "plating_entries_attachmentId_fkey";

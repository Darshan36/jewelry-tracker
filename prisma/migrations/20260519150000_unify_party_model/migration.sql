-- Phase 17a — unify Customer + Supplier + CastingPlatingVendor into Party model
-- with role flags. See KNOWN_GAPS.md and CLAUDE.md §4 for the decision lineage.
--
-- Strategy:
--   1. Create parties table + indexes + FKs.
--   2. Migrate customers → parties (isCustomer = true), deduping by phone.
--   3. Migrate suppliers → parties (isSupplier = true), handling phone collisions.
--   4. Migrate casting_plating_vendors → parties (BOTH isCastingVendor AND
--      isPlatingVendor = true), handling phone collisions.
--   5. Add partyId column to transaction tables (sales, purchases,
--      casting_entries, plating_entries); populate from old FK columns
--      via phone join (resolves deduped party rows).
--   6. Drop old FK columns + indexes + tables.
--
-- Phone-collision rules:
--   - phone IS NOT NULL: rows sharing a phone collapse into a single Party.
--     The most recently updated source row wins the canonical Party id.
--   - phone IS NULL: each source row creates its own Party row (no dedup).
--
-- Production is at day-0 baseline (0 active business rows). Data-movement
-- statements run against 0 rows; the migration is syntactically a no-op
-- on prod. Dev has minimal test data and migrates cleanly.

-- 1. Create parties table.
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isCustomer" BOOLEAN NOT NULL DEFAULT false,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "isCastingVendor" BOOLEAN NOT NULL DEFAULT false,
    "isPlatingVendor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,
    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "parties_phone_key" ON "parties"("phone");
CREATE INDEX "parties_phone_idx" ON "parties"("phone");
CREATE INDEX "parties_name_idx" ON "parties"("name");
CREATE INDEX "parties_isCustomer_deletedAt_idx" ON "parties"("isCustomer", "deletedAt");
CREATE INDEX "parties_isSupplier_deletedAt_idx" ON "parties"("isSupplier", "deletedAt");
CREATE INDEX "parties_isCastingVendor_deletedAt_idx" ON "parties"("isCastingVendor", "deletedAt");
CREATE INDEX "parties_isPlatingVendor_deletedAt_idx" ON "parties"("isPlatingVendor", "deletedAt");

ALTER TABLE "parties" ADD CONSTRAINT "parties_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "parties" ADD CONSTRAINT "parties_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "parties" ADD CONSTRAINT "parties_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2a. Migrate customers (non-null phone — dedup by phone, most recent wins).
INSERT INTO "parties" (id, name, phone, email, address, notes, "isCustomer", "createdAt", "updatedAt", "deletedAt")
SELECT DISTINCT ON (phone)
    id, name, phone, email, address, notes, true, "createdAt", "updatedAt", "deletedAt"
FROM "customers"
WHERE phone IS NOT NULL
ORDER BY phone, "updatedAt" DESC;

-- 2b. Migrate customers (null phone — no dedup, each row becomes its own Party).
INSERT INTO "parties" (id, name, phone, email, address, notes, "isCustomer", "createdAt", "updatedAt", "deletedAt")
SELECT id, name, NULL, email, address, notes, true, "createdAt", "updatedAt", "deletedAt"
FROM "customers"
WHERE phone IS NULL;

-- 3a. Migrate suppliers with phone where no party exists at that phone.
INSERT INTO "parties" (id, name, phone, email, address, notes, "isSupplier", "createdAt", "updatedAt", "deletedAt")
SELECT DISTINCT ON (s.phone)
    s.id, s.name, s.phone, s.email, s.address, s.notes, true, s."createdAt", s."updatedAt", s."deletedAt"
FROM "suppliers" s
WHERE s.phone IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "parties" p WHERE p.phone = s.phone)
ORDER BY s.phone, s."updatedAt" DESC;

-- 3b. For suppliers whose phone already maps to a Party (was a customer first),
--     flip the isSupplier flag on that Party. COALESCE retains the canonical
--     name/email/etc from the prior insert. If multiple suppliers share a phone,
--     DISTINCT ON in the inner subquery picks the most recent for any merged
--     metadata.
UPDATE "parties" p
SET "isSupplier" = true,
    name    = COALESCE(p.name, sub.name),
    email   = COALESCE(p.email, sub.email),
    address = COALESCE(p.address, sub.address),
    notes   = COALESCE(p.notes, sub.notes),
    "updatedAt" = GREATEST(p."updatedAt", sub."updatedAt")
FROM (
    SELECT DISTINCT ON (phone) id, name, phone, email, address, notes, "createdAt", "updatedAt"
    FROM "suppliers"
    WHERE phone IS NOT NULL
    ORDER BY phone, "updatedAt" DESC
) sub
WHERE p.phone = sub.phone;

-- 3c. Migrate suppliers with null phone — each becomes a new Party row.
INSERT INTO "parties" (id, name, phone, email, address, notes, "isSupplier", "createdAt", "updatedAt", "deletedAt")
SELECT id, name, NULL, email, address, notes, true, "createdAt", "updatedAt", "deletedAt"
FROM "suppliers"
WHERE phone IS NULL;

-- 4a. Migrate casting_plating_vendors (non-null phone, no existing Party at that phone)
--     with BOTH isCastingVendor AND isPlatingVendor flags set (the old single
--     model didn't distinguish — see CLAUDE.md §4).
INSERT INTO "parties" (id, name, phone, email, address, notes, "isCastingVendor", "isPlatingVendor", "createdAt", "updatedAt", "deletedAt")
SELECT DISTINCT ON (v.phone)
    v.id, v.name, v.phone, NULL, v.address, v.notes, true, true, v."createdAt", v."updatedAt", v."deletedAt"
FROM "casting_plating_vendors" v
WHERE v.phone IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "parties" p WHERE p.phone = v.phone)
ORDER BY v.phone, v."updatedAt" DESC;

-- 4b. For vendors whose phone already maps to a Party, flip both flags.
UPDATE "parties" p
SET "isCastingVendor" = true,
    "isPlatingVendor" = true,
    name    = COALESCE(p.name, sub.name),
    address = COALESCE(p.address, sub.address),
    notes   = COALESCE(p.notes, sub.notes),
    "updatedAt" = GREATEST(p."updatedAt", sub."updatedAt")
FROM (
    SELECT DISTINCT ON (phone) id, name, phone, address, notes, "createdAt", "updatedAt"
    FROM "casting_plating_vendors"
    WHERE phone IS NOT NULL
    ORDER BY phone, "updatedAt" DESC
) sub
WHERE p.phone = sub.phone;

-- 4c. Migrate vendors with null phone — each becomes a new Party row.
INSERT INTO "parties" (id, name, phone, email, address, notes, "isCastingVendor", "isPlatingVendor", "createdAt", "updatedAt", "deletedAt")
SELECT id, name, NULL, NULL, address, notes, true, true, "createdAt", "updatedAt", "deletedAt"
FROM "casting_plating_vendors"
WHERE phone IS NULL;

-- 5. Add partyId column to transaction tables (nullable to preserve walk-in semantics).
ALTER TABLE "sales" ADD COLUMN "partyId" TEXT;
ALTER TABLE "purchases" ADD COLUMN "partyId" TEXT;
ALTER TABLE "casting_entries" ADD COLUMN "partyId" TEXT;
ALTER TABLE "plating_entries" ADD COLUMN "partyId" TEXT;

-- 5a. Populate sales.partyId from old customerId via phone-join (resolves
--     deduped non-canonical rows to their canonical Party).
UPDATE "sales" s
SET "partyId" = p.id
FROM "customers" c
INNER JOIN "parties" p
    ON (c.phone IS NOT NULL AND p.phone = c.phone)
    OR (c.phone IS NULL AND p.id = c.id)
WHERE s."customerId" = c.id;

-- 5b. Populate purchases.partyId.
UPDATE "purchases" pu
SET "partyId" = p.id
FROM "suppliers" su
INNER JOIN "parties" p
    ON (su.phone IS NOT NULL AND p.phone = su.phone)
    OR (su.phone IS NULL AND p.id = su.id)
WHERE pu."supplierId" = su.id;

-- 5c. Populate casting_entries.partyId.
UPDATE "casting_entries" ce
SET "partyId" = p.id
FROM "casting_plating_vendors" v
INNER JOIN "parties" p
    ON (v.phone IS NOT NULL AND p.phone = v.phone)
    OR (v.phone IS NULL AND p.id = v.id)
WHERE ce."vendorId" = v.id;

-- 5d. Populate plating_entries.partyId.
UPDATE "plating_entries" pe
SET "partyId" = p.id
FROM "casting_plating_vendors" v
INNER JOIN "parties" p
    ON (v.phone IS NOT NULL AND p.phone = v.phone)
    OR (v.phone IS NULL AND p.id = v.id)
WHERE pe."vendorId" = v.id;

-- 6. Drop old FK constraints + indexes + columns from transaction tables.
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_customerId_fkey";
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_supplierId_fkey";
ALTER TABLE "casting_entries" DROP CONSTRAINT IF EXISTS "casting_entries_vendorId_fkey";
ALTER TABLE "plating_entries" DROP CONSTRAINT IF EXISTS "plating_entries_vendorId_fkey";

DROP INDEX IF EXISTS "sales_customerId_idx";
DROP INDEX IF EXISTS "purchases_supplierId_idx";
DROP INDEX IF EXISTS "casting_entries_vendorId_idx";
DROP INDEX IF EXISTS "plating_entries_vendorId_idx";

ALTER TABLE "sales" DROP COLUMN "customerId";
ALTER TABLE "purchases" DROP COLUMN "supplierId";
ALTER TABLE "casting_entries" DROP COLUMN "vendorId";
ALTER TABLE "plating_entries" DROP COLUMN "vendorId";

-- 7. Add new partyId FKs + indexes.
ALTER TABLE "sales" ADD CONSTRAINT "sales_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "casting_entries" ADD CONSTRAINT "casting_entries_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "plating_entries" ADD CONSTRAINT "plating_entries_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "sales_partyId_idx" ON "sales"("partyId");
CREATE INDEX "purchases_partyId_idx" ON "purchases"("partyId");
CREATE INDEX "casting_entries_partyId_idx" ON "casting_entries"("partyId");
CREATE INDEX "plating_entries_partyId_idx" ON "plating_entries"("partyId");

-- 8. Drop old master-data tables.
DROP TABLE "customers";
DROP TABLE "suppliers";
DROP TABLE "casting_plating_vendors";

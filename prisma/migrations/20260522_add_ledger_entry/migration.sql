-- Phase 21a — Pure party ledger (khata).
--
-- Replaces the bill-wise *Payment model for party-linked transactions.
-- Each transaction whose parent has partyId NOT NULL gets a
-- TRANSACTION_LINKED INCREASE entry (DECREASE for SALE_RETURN /
-- PURCHASE_RETURN). Manual payments are MANUAL_PAYMENT DECREASE
-- entries with no sourceType.
--
-- Walk-in transactions (partyId IS NULL) keep using *Payment rails
-- through 21a — those tables are dropped in 21c.
--
-- Outstanding balance is raw signed Σ(INCREASE) − Σ(DECREASE), never
-- clamped to non-negative — negative = party has credit balance.
--
-- This migration is ADDITIVE-ONLY: no existing tables modified, no
-- existing columns dropped. Data backfill happens in a separate
-- one-shot script after this migration is applied.

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('TRANSACTION_LINKED', 'MANUAL_PAYMENT');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('SALE', 'PURCHASE', 'CASTING', 'PLATING', 'SALE_RETURN', 'PURCHASE_RETURN');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "description" TEXT,
    "entryType" "LedgerEntryType" NOT NULL,
    "sourceType" "LedgerSourceType",
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (regular non-unique indexes for query planning)
CREATE INDEX "ledger_entries_partyId_date_idx" ON "ledger_entries"("partyId", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_partyId_deletedAt_idx" ON "ledger_entries"("partyId", "deletedAt");

-- CreateIndex
CREATE INDEX "ledger_entries_sourceType_sourceId_idx" ON "ledger_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ledger_entries_entryType_idx" ON "ledger_entries"("entryType");

-- CreateIndex
CREATE INDEX "ledger_entries_deletedAt_idx" ON "ledger_entries"("deletedAt");

-- CreateIndex — partial unique index on (sourceType, sourceId) WHERE
-- deletedAt IS NULL. Enforces the "one active TRANSACTION_LINKED entry
-- per (sourceType, sourceId)" invariant while still allowing the
-- soft-delete-and-recreate pattern that party-change transitions use
-- (see ledger.ts updateTransactionLedgerEntry → party→other-party).
-- Prisma's @@unique is absolute (no WHERE clause) — it would reject
-- the re-create insert because the soft-deleted row still occupies
-- (sourceType, sourceId). The partial-unique-on-active-rows is the
-- canonical Postgres pattern for soft-delete + unique cohabitation.
CREATE UNIQUE INDEX "ledger_entries_source_unique_active_idx"
    ON "ledger_entries"("sourceType", "sourceId")
    WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 21b — extend LedgerEntry so karigar (Employee) balances live in
-- the same table as Party balances. Owner discriminator is "which FK is
-- set": exactly one of (partyId, employeeId) is non-null, enforced by a
-- DB CHECK constraint + an action-layer assertOwnerExactlyOne.
--
-- Purely additive: nullable partyId (was NOT NULL — all existing rows
-- already have partyId set), new nullable employeeId column with FK,
-- CHECK constraint, two new indexes, and two new LedgerSourceType enum
-- values for PIECE_ENTRY (INCREASE) and WAGE_PAYMENT (DECREASE).
--
-- Zero data migration — prod was confirmed zero-active for karigar
-- piece_entries / wage payments before this migration ran (Phase 21b
-- Checkpoint 0 prod-diagnose; failed-workaround rows soft-deleted by
-- the owner on 2026-05-23). New piece entries auto-post going forward.

-- Drop NOT NULL on the existing partyId so karigar entries can leave it
-- null while keeping it set on every pre-21b row.
ALTER TABLE "ledger_entries"
  ALTER COLUMN "partyId" DROP NOT NULL;

-- New nullable employeeId column + FK + indexes.
ALTER TABLE "ledger_entries"
  ADD COLUMN "employeeId" TEXT;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ledger_entries_employeeId_date_idx"
  ON "ledger_entries"("employeeId", "date");

CREATE INDEX "ledger_entries_employeeId_deletedAt_idx"
  ON "ledger_entries"("employeeId", "deletedAt");

-- Exactly one of (partyId, employeeId) must be non-null. The cast to int
-- gives us the count of non-null owners as an integer; we then assert ==
-- 1. Postgres evaluates this on every INSERT / UPDATE.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_owner_exactly_one"
  CHECK (
    (CASE WHEN "partyId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "employeeId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- Extend the LedgerSourceType enum with the two karigar-side values.
-- These are TRANSACTION_LINKED entries: piece work emits INCREASE, wage
-- payment (including advances) emits DECREASE. Phase 18.1's per-entry
-- note carries onto the linked ledger description via describePieceEntry.
ALTER TYPE "LedgerSourceType" ADD VALUE 'PIECE_ENTRY';
ALTER TYPE "LedgerSourceType" ADD VALUE 'WAGE_PAYMENT';

-- Phase 18.1 — piece rate is dynamic (entered per piece-entry), not a
-- fixed worker attribute. Drops Employee.ratePerPiece. Production is
-- at day-0 baseline for labour data; no rows lost.

ALTER TABLE "employees" DROP COLUMN "ratePerPiece";

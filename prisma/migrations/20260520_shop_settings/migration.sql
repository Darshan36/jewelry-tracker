-- Phase 20 — print-friendly sales bill + shop settings.
--
-- Single-row config table for the bill header content (shop name,
-- phone, address, footer). One-row semantics enforced at the
-- application layer (settings actions upsert via findFirst), not by
-- a DB constraint — Postgres CHECK constraints can't enforce
-- "exactly one row" across the table, and a unique constant column
-- (e.g., `singleton: 'shop' @unique`) would clutter the schema. The
-- application-layer enforcement matches the read pattern (always
-- `findFirst`, never `findUnique`).

CREATE TABLE "shop_settings" (
  "id"          TEXT PRIMARY KEY,
  "shopName"    TEXT NOT NULL,
  "phone"       TEXT,
  "address"     TEXT,
  "footer"      TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "shop_settings_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

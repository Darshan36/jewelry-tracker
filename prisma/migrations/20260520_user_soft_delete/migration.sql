-- Phase 16 — User management UI.
--
-- Add deletedAt for soft-delete (= deactivation). Matches the app-wide
-- soft-delete convention used by every other entity. Existing rows
-- default to NULL (active). Auth.js authorize() will reject users with
-- deletedAt IS NOT NULL even on a correct password match.

ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);

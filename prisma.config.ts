// Prisma 7 config — env loaded from .env.local (our canonical env file).
// In Prisma 7, the datasource URL is declared here, NOT in schema.prisma.
// We use DIRECT_URL (session pooler, port 5432) for all CLI operations
// (migrations, db push, studio) because the transaction pooler (DATABASE_URL)
// strips prepared-statement support that migrations need.
//
// Runtime queries via PrismaClient use DATABASE_URL (with ?pgbouncer=true)
// through a database adapter — see src/lib/prisma.ts.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"],
  },
});

// Prisma client singleton.
//
// Connects via @prisma/adapter-pg using DATABASE_URL (transaction pooler,
// port 6543, with ?pgbouncer=true&connection_limit=1 — see KNOWN_GAPS.md).
// CLI/migrations use DIRECT_URL via prisma.config.ts; this file is for
// runtime queries only.
//
// SERVER ONLY. Do not import from 'use client' components — Prisma's
// runtime pulls in node:process/path/url and will break in a browser bundle.

import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({ connectionString });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

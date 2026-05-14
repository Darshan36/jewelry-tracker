// Prisma client singleton.
//
// Connects via @prisma/adapter-pg using DATABASE_URL (transaction pooler,
// port 6543, with ?pgbouncer=true&connection_limit=1 — see KNOWN_GAPS.md).
// CLI/migrations use DIRECT_URL via prisma.config.ts; this file is for
// runtime queries only.
//
// SERVER ONLY. Do not import from 'use client' components — Prisma's
// runtime pulls in node:process/path/url and will break in a browser bundle.
//
// Construction is lazy (via Proxy): DATABASE_URL is read on first use, not
// at module load. Next.js build-time page-data collection imports route
// modules to extract metadata; if construction were eager, a missing env
// at collection time would crash the build even when the env is present
// for actual request handling.

import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  globalForPrisma.prisma = createPrisma();
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrisma(), prop, receiver);
  },
});

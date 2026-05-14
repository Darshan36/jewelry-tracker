// Seed script — creates the first ADMIN user. Idempotent (upsert).
//
// Runs via `npx prisma db seed` (Prisma CLI wires this through the
// `prisma.seed` block in package.json → `tsx prisma/seed.ts`).
// Can also be run directly: `npx tsx prisma/seed.ts`.
//
// Connects through DIRECT_URL (session pooler, port 5432) — seed is a
// one-shot operation and doesn't benefit from the transaction pooler.
//
// SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env.local.
// Password must be at least 12 characters.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DIRECT_URL (or DATABASE_URL) must be set in .env.local");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Admin";

  if (!email || !password) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env.local",
    );
  }

  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {}, // don't overwrite an existing admin's password/name
    create: {
      email,
      passwordHash,
      name,
      role: "ADMIN",
    },
  });

  // Redact the email local-part in console output; show only the domain.
  const redactedEmail = user.email.replace(/^[^@]+/, "<redacted>");
  console.log(`✓ Admin ready: ${redactedEmail} (id: ${user.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

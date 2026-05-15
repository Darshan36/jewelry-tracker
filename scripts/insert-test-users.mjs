// Loads scripts/.test-user-insert.sql against production via DIRECT_URL.
// Run inside a subshell that sources .env.production.local:
//
//   ( set -a; source .env.production.local; set +a; node scripts/insert-test-users.mjs )

import { readFile } from "node:fs/promises";
import { Client } from "pg";

const sql = await readFile("scripts/.test-user-insert.sql", "utf8");

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL is not set. Did you source .env.production.local?");
  process.exit(1);
}

const c = new Client({ connectionString: process.env.DIRECT_URL });

try {
  await c.connect();
  await c.query(sql);
  const result = await c.query(
    `SELECT email, role::text AS role FROM users WHERE email LIKE 'test-%@shreecreation.test' ORDER BY role`,
  );
  console.log("Inserted test users (emails redacted):");
  for (const row of result.rows) {
    const masked = "test-<role>@<domain>";
    console.log(`  ${masked.padEnd(28)} ${row.role}`);
  }
  await c.end();
} catch (e) {
  console.error("Insert failed:", e.message);
  process.exit(1);
}

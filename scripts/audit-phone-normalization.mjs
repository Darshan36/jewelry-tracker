// One-off Phase 6 audit — count rows whose stored phone has non-digit
// characters that the new normalization would strip. Read-only. Run against
// production via: ( set -a; source .env.production.local; set +a; node
// scripts/audit-phone-normalization.mjs )

import { Client } from "pg";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL not set. Source .env.production.local first.");
  process.exit(1);
}

const c = new Client({ connectionString: process.env.DIRECT_URL });
await c.connect();

const queries = [
  {
    label: "customers with non-digit chars in phone",
    sql: `SELECT count(*)::int AS n FROM customers WHERE phone IS NOT NULL AND phone ~ '[^0-9]'`,
  },
  {
    label: "customers total (non-deleted)",
    sql: `SELECT count(*)::int AS n FROM customers WHERE "deletedAt" IS NULL`,
  },
  {
    label: "suppliers with non-digit chars in phone",
    sql: `SELECT count(*)::int AS n FROM suppliers WHERE phone IS NOT NULL AND phone ~ '[^0-9]'`,
  },
  {
    label: "suppliers total (non-deleted)",
    sql: `SELECT count(*)::int AS n FROM suppliers WHERE "deletedAt" IS NULL`,
  },
  {
    label: "sales with non-digit chars in partyPhone",
    sql: `SELECT count(*)::int AS n FROM sales WHERE "partyPhone" IS NOT NULL AND "partyPhone" ~ '[^0-9]'`,
  },
  {
    label: "sales with non-null partyPhone (non-deleted)",
    sql: `SELECT count(*)::int AS n FROM sales WHERE "partyPhone" IS NOT NULL AND "deletedAt" IS NULL`,
  },
  {
    label: "purchases with non-digit chars in partyPhone",
    sql: `SELECT count(*)::int AS n FROM purchases WHERE "partyPhone" IS NOT NULL AND "partyPhone" ~ '[^0-9]'`,
  },
  {
    label: "purchases with non-null partyPhone (non-deleted)",
    sql: `SELECT count(*)::int AS n FROM purchases WHERE "partyPhone" IS NOT NULL AND "deletedAt" IS NULL`,
  },
];

for (const q of queries) {
  const r = await c.query(q.sql);
  console.log(`  ${q.label.padEnd(50)} ${r.rows[0].n}`);
}

await c.end();

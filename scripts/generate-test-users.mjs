// Build the three Phase-5 test users with random passwords, hash with bcrypt,
// and write the raw credentials + an SQL INSERT block. Run once; the output
// is consumed manually:
//   - credentials.md (project root, gitignored) holds the raw passwords for
//     the walkthrough.
//   - /tmp/test-user-insert.sql holds the parameterised SQL the loader uses
//     to insert into production.
//
// Stdout summary is intentionally redacted — passwords appear only in the
// generated files.

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";

const COST = 12;

const ROLES = [
  { email: "test-purchase@shreecreation.test", name: "Test Purchase Dept", role: "PURCHASE_DEPT" },
  { email: "test-labour@shreecreation.test", name: "Test Labour Mgmt", role: "LABOUR_MGMT" },
  { email: "test-casting@shreecreation.test", name: "Test Casting Plating", role: "CASTING_PLATING_MGMT" },
];

// Strong, URL-safe-ish: 16 base64 chars stripped of padding.
function generatePassword() {
  return randomBytes(12).toString("base64").replace(/[+/=]/g, "").slice(0, 16);
}

const users = [];
for (const r of ROLES) {
  const password = generatePassword();
  const hash = await bcrypt.hash(password, COST);
  users.push({ ...r, password, hash });
}

// credentials.md (gitignored) — raw passwords for the walkthrough.
const credentialsMd = [
  "# Phase 5 RBAC — Test User Credentials",
  "",
  "**DO NOT COMMIT.** This file is in `.gitignore`. Delete it (or move it to",
  "a password manager) after the Phase 5 walkthrough is complete.",
  "",
  "These accounts were created on **production** for the Phase 5 role walkthrough.",
  "Each can sign in at the production app URL.",
  "",
  "| Role | Email | Password |",
  "|---|---|---|",
  ...users.map((u) => `| ${u.role} | \`${u.email}\` | \`${u.password}\` |`),
  "",
  "## Cleanup",
  "",
  "After the walkthrough, either keep these for ongoing role testing or delete",
  "via production DB:",
  "",
  "```sql",
  "DELETE FROM users WHERE email IN (",
  users.map((u) => `  '${u.email}'`).join(",\n"),
  ");",
  "```",
  "",
].join("\n");

await writeFile("credentials.md", credentialsMd, "utf8");

// SQL insert file — consumed by the loader script; not committed.
const sqlInsert = [
  "-- Phase 5 RBAC — insert three test users.",
  "-- Idempotent: drops the rows first in case of re-runs.",
  "DELETE FROM users WHERE email IN (" + users.map((u) => `'${u.email}'`).join(", ") + ");",
  "INSERT INTO users (id, email, \"passwordHash\", name, role, \"createdAt\", \"updatedAt\") VALUES",
  users
    .map(
      (u) =>
        `  (gen_random_uuid()::text, '${u.email}', '${u.hash}', '${u.name.replace(/'/g, "''")}', '${u.role}', NOW(), NOW())`,
    )
    .join(",\n") + ";",
].join("\n");

await writeFile("scripts/.test-user-insert.sql", sqlInsert, "utf8");

console.log("Generated 3 test users.");
console.log("  credentials.md written (gitignored)");
console.log("  scripts/.test-user-insert.sql written (gitignored)");
for (const u of users) {
  console.log(`  ${u.role.padEnd(22)} ${u.email}`);
}

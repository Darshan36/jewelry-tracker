// Phase 21.fix prod walkthrough — stale-JWT security fix.
//
// Heightened-discipline: auth touches every request. Sequence:
//
//   S0 — ADMIN-NOT-LOCKED-OUT (sanity, already proven before this
//        script runs; re-asserted here as a regression check).
//   S1 — Legitimate ACTIVE test user (baseline): login → /dashboard.
//   S2 — DEMOTE live: DB role change → next request loses access,
//        no re-login.
//   S3 — PROMOTE live: DB role change → next request gains access,
//        no re-login (the friendly direction).
//   S4 — DEACTIVATE live: DB deletedAt set → next request kicked
//        to /auth/login (cookie killed by Auth.js when jwtCallback
//        returns null). THE headline case against PROD — framework
//        behavior re-confirmed in prod env.
//   S5a — Fresh login while deactivated: rejected (Phase 16 guard).
//   S5b — Reactivated → fresh login works.
//   S6 — Transient DB error fail-safe against prod Supabase: monkey-
//        patch findUnique to throw, call jwtCallback, prove token
//        preserved.
//   S7 — Regression: ADMIN sees 21c.1.1 surfaces unchanged
//        (dashboard category boxes + /ledger tabs).
//
// Cleanup: marker test user deleted from prod.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p21fix-out");
mkdirSync(OUT_DIR, { recursive: true });

function loadEnv(file) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const env = loadEnv(".env.production.local");
const ADMIN_EMAIL = env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = env.SEED_ADMIN_PASSWORD;
const PROD_DIRECT_URL = env.DIRECT_URL;
const BASE = process.env.WALKTHROUGH_BASE ?? "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";
const MARKER = `__phase21fix_walk_${Date.now()}`;
const TEST_EMAIL = `${MARKER}@shreecreation.test`;
const TEST_PASSWORD = "P21fixWalkPW_2026!";

const PROD_PROJECT_REF = "cseqdcrfnvgsalsyhjsz";
if (!PROD_DIRECT_URL.includes(PROD_PROJECT_REF)) {
  throw new Error(`Refusing to run prod walkthrough against non-prod DB: ${new URL(PROD_DIRECT_URL).host}`);
}

let pass = 0;
let fail = 0;
const failures = [];
function check(label, cond, info = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}${info ? "  — " + info : ""}`);
    fail++;
    failures.push(label + (info ? " — " + info : ""));
  }
}

function cuid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function withDb(fn) {
  const c = new pg.Client({ connectionString: PROD_DIRECT_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function login(browser, email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 20000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await page.close();
  return ctx;
}

async function probeRoute(ctx, pathname) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}${pathname}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const finalPath = new URL(page.url()).pathname;
  await page.close();
  return { finalPath, ok: finalPath === pathname };
}

console.log(`\n=== Phase 21.fix prod walkthrough ===`);
console.log(`BASE: ${BASE}`);
console.log(`Marker: ${MARKER}`);
console.log(`Test user: ${TEST_EMAIL}`);

// SEED test user in PROD
let testUserId;
console.log(`\nSEED — create test ADMIN user in PROD`);
{
  testUserId = cuid("user_");
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO users (id, email, "passwordHash", name, role, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'ADMIN', NOW(), NOW())`,
      [testUserId, TEST_EMAIL, hash, `${MARKER} TestUser`],
    );
  });
  console.log(`  test user seeded: id=${testUserId}`);
}

const browser = await chromium.launch({ headless: true });

try {
  // ============================================================
  // S0 — Re-assert ADMIN access (regression check)
  // ============================================================
  console.log(`\nS0 — Admin-still-OK regression check`);
  {
    const ctx = await login(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    const dash = await probeRoute(ctx, "/dashboard");
    const users = await probeRoute(ctx, "/users");
    check(`ADMIN reaches /dashboard`, dash.ok, `final=${dash.finalPath}`);
    check(`ADMIN reaches /users`, users.ok, `final=${users.finalPath}`);
    await ctx.close();
  }

  // ============================================================
  // S1 — Legitimate active test user (baseline)
  // ============================================================
  console.log(`\nS1 — Legitimate active test user (baseline)`);
  let userCtx = await login(browser, TEST_EMAIL, TEST_PASSWORD);
  {
    const dash = await probeRoute(userCtx, "/dashboard");
    const users = await probeRoute(userCtx, "/users");
    const sales = await probeRoute(userCtx, "/sales");
    check(`active ADMIN test user reaches /dashboard`, dash.ok, `final=${dash.finalPath}`);
    check(`active ADMIN test user reaches /users`, users.ok, `final=${users.finalPath}`);
    check(`active ADMIN test user reaches /sales`, sales.ok, `final=${sales.finalPath}`);
  }

  // ============================================================
  // S2 — DEMOTE live (ADMIN → PURCHASE_DEPT) — no re-login
  // ============================================================
  console.log(`\nS2 — DEMOTE live: ADMIN → PURCHASE_DEPT`);
  {
    await withDb(async (c) => {
      await c.query(
        `UPDATE users SET role = 'PURCHASE_DEPT', "updatedAt" = NOW() WHERE id = $1`,
        [testUserId],
      );
    });
    console.log(`  [DB] role updated → PURCHASE_DEPT in prod`);
    const users = await probeRoute(userCtx, "/users");
    check(
      `demoted user REDIRECTED AWAY from /users (no re-login)`,
      !users.ok && users.finalPath !== "/users",
      `final=${users.finalPath}`,
    );
    const purchases = await probeRoute(userCtx, "/purchases");
    check(
      `demoted user CAN reach /purchases (new role's page)`,
      purchases.ok,
      `final=${purchases.finalPath}`,
    );
  }

  // ============================================================
  // S3 — PROMOTE live (PURCHASE_DEPT → ADMIN) — no re-login
  // ============================================================
  console.log(`\nS3 — PROMOTE live: PURCHASE_DEPT → ADMIN`);
  {
    await withDb(async (c) => {
      await c.query(
        `UPDATE users SET role = 'ADMIN', "updatedAt" = NOW() WHERE id = $1`,
        [testUserId],
      );
    });
    console.log(`  [DB] role updated → ADMIN in prod`);
    const users = await probeRoute(userCtx, "/users");
    check(
      `promoted user REGAINS access to /users (no re-login)`,
      users.ok,
      `final=${users.finalPath}`,
    );
  }

  // ============================================================
  // S4 — DEACTIVATE live → COOKIE KILLED (against PROD)
  // ============================================================
  console.log(`\nS4 — DEACTIVATE live: cookie killed by Auth.js (PROD)`);
  {
    await withDb(async (c) => {
      await c.query(
        `UPDATE users SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
        [testUserId],
      );
    });
    console.log(`  [DB] deletedAt set in prod`);
    const users = await probeRoute(userCtx, "/users");
    check(
      `deactivated user redirected to /auth/login (Auth.js invalidated cookie via jwtCallback null)`,
      users.finalPath === "/auth/login",
      `final=${users.finalPath}`,
    );
    const dash = await probeRoute(userCtx, "/dashboard");
    check(
      `even /dashboard (any-role) redirects to /auth/login`,
      dash.finalPath === "/auth/login",
      `final=${dash.finalPath}`,
    );
    await userCtx.close();
  }

  // ============================================================
  // S5a — Fresh login while deactivated rejected
  // ============================================================
  console.log(`\nS5a — Fresh login while deactivated rejected`);
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    await page.locator('input[type="email"]').first().fill(TEST_EMAIL);
    await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
    const url = new URL(page.url()).pathname;
    check(
      `deactivated user CANNOT fresh-login (stays on /auth/login)`,
      url === "/auth/login",
      `final=${url}`,
    );
    await ctx.close();
  }

  // ============================================================
  // S5b — Reactivate + fresh login works
  // ============================================================
  console.log(`\nS5b — Reactivate + fresh login works`);
  {
    await withDb(async (c) => {
      await c.query(
        `UPDATE users SET "deletedAt" = NULL, "updatedAt" = NOW() WHERE id = $1`,
        [testUserId],
      );
    });
    console.log(`  [DB] deletedAt cleared in prod`);
    const ctx = await login(browser, TEST_EMAIL, TEST_PASSWORD);
    const users = await probeRoute(ctx, "/users");
    check(
      `reactivated user fresh-login + reaches /users`,
      users.ok,
      `final=${users.finalPath}`,
    );
    await ctx.close();
  }

  // ============================================================
  // S6 — Transient DB error fail-safe against PROD Supabase
  // ============================================================
  console.log(`\nS6 — Transient DB error fail-safe (against prod Supabase prisma)`);
  {
    // Load .env.production.local into process.env so the lazy prisma
    // proxy reads the prod connection string.
    for (const [k, v] of Object.entries(env)) {
      if (!process.env[k]) process.env[k] = v;
    }
    const { jwtCallback } = await import("../src/lib/auth-callbacks.ts");
    const { prisma } = await import("../src/lib/prisma.ts");

    const original = prisma.user.findUnique.bind(prisma.user);
    prisma.user.findUnique = async () => {
      throw new Error("Simulated prod DB blip — connection terminated");
    };

    const preset = {
      id: testUserId,
      role: "ADMIN",
      iat: 1234567,
      custom: "preserve-me",
    };
    const result = await jwtCallback({ token: { ...preset } });

    prisma.user.findUnique = original;

    check(`jwtCallback returned non-null on prod DB throw (fail-safe)`, result !== null);
    if (result !== null) {
      check(`token.id preserved`, result.id === preset.id);
      check(`token.role preserved`, result.role === preset.role);
      check(`token.iat preserved`, result.iat === preset.iat);
      check(`custom field preserved`, result.custom === preset.custom);
    }

    // Sanity: prisma restored, real read works against prod.
    const sanity = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { id: true, deletedAt: true },
    });
    check(`prisma restored cleanly post-monkey-patch (prod sanity)`, sanity?.id === testUserId);
  }

  // ============================================================
  // S7 — Regression: 21c.1.1 surfaces unchanged
  // ============================================================
  console.log(`\nS7 — Regression on 21c.1.1 surfaces (dashboard boxes + /ledger tabs)`);
  {
    const ctx = await login(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const dashBoxes = await page.locator('[data-testid="dashboard-ledger-box"]').count();
    check(`dashboard still shows 4 individual ledger boxes`, dashBoxes === 4, `got ${dashBoxes}`);

    await page.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const tabs = await page.locator('[data-testid="ledger-tab"]').count();
    check(`/ledger still shows 5 category tabs`, tabs === 5, `got ${tabs}`);

    const ledgerBoxes = await page.locator('[data-testid="ledger-box"]').count();
    check(`/ledger still shows 4 summary boxes`, ledgerBoxes === 4, `got ${ledgerBoxes}`);

    await page.close();
    await ctx.close();
  }
} finally {
  // ============================================================
  // CLEANUP
  // ============================================================
  console.log(`\nCleanup — remove marker test user`);
  try {
    await withDb(async (c) => {
      await c.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    });
    console.log(`  ✓ marker test user deleted from prod`);
  } catch (e) {
    console.error(`  ✗ cleanup failed:`, e);
  }
  await browser.close();
}

console.log(`\n=== Phase 21.fix walkthrough: ${pass}/${pass + fail} PASS ===`);
if (fail > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

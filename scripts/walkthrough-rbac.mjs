// Phase 5 RBAC walkthrough — Playwright-driven, production-only.
//
// For each of the four roles, log in, check sidebar contents, then probe
// every protected route and verify allow/redirect behaviour. Output is a
// table of PASS/FAIL for the 21-point matrix from the Phase 5 plan.
//
// Credentials:
//   - ADMIN  ← .env.production.local (SEED_ADMIN_EMAIL/PASSWORD)
//   - rest   ← credentials.md at project root (gitignored)
//
// Stdout never leaks raw passwords. Each session is a fresh browser
// context so cookies between roles do not interfere.

import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-rbac-out");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";

// ---------- env loaders ----------

function loadEnvFile(file) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function loadCredentialsMd() {
  // credentials.md is a Markdown table — parse the rows that look like:
  //   | ROLE | `email` | `password` |
  const txt = readFileSync(join(REPO_ROOT, "credentials.md"), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([A-Z_]+)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
    if (m) out[m[1]] = { email: m[2], password: m[3] };
  }
  return out;
}

const prodEnv = loadEnvFile(".env.production.local");
const testCreds = loadCredentialsMd();

const USERS = [
  {
    role: "ADMIN",
    email: prodEnv.SEED_ADMIN_EMAIL,
    password: prodEnv.SEED_ADMIN_PASSWORD,
    expectedSidebar: [
      "Dashboard",
      "Sales",
      "Purchases",
      "Casting", // Soon
      "Plating", // Soon
      "Completed", // Soon
      "Customers",
      "Suppliers",
      "Employees",
      "Reports", // Soon
      "Users", // Soon
      "Settings", // Soon
    ],
    routes: {
      "/dashboard": "allow",
      "/sales": "allow",
      "/customers": "allow",
      "/purchases": "allow",
      "/suppliers": "allow",
      "/employees": "allow",
      // /casting and /plating: proxy allows admin through; page doesn't exist
      // yet → 404. Out of scope for the redirect check (verified separately).
    },
  },
  {
    role: "PURCHASE_DEPT",
    email: testCreds.PURCHASE_DEPT?.email,
    password: testCreds.PURCHASE_DEPT?.password,
    expectedSidebar: ["Dashboard", "Purchases", "Suppliers"],
    routes: {
      "/dashboard": "allow",
      "/sales": "redirect",
      "/customers": "redirect",
      "/purchases": "allow",
      "/suppliers": "allow",
      "/employees": "redirect",
      "/casting": "redirect",
      "/plating": "redirect",
    },
  },
  {
    role: "LABOUR_MGMT",
    email: testCreds.LABOUR_MGMT?.email,
    password: testCreds.LABOUR_MGMT?.password,
    expectedSidebar: ["Dashboard", "Employees"],
    routes: {
      "/dashboard": "allow",
      "/sales": "redirect",
      "/customers": "redirect",
      "/purchases": "redirect",
      "/suppliers": "redirect",
      "/employees": "allow",
      "/casting": "redirect",
      "/plating": "redirect",
    },
  },
  {
    role: "CASTING_PLATING_MGMT",
    email: testCreds.CASTING_PLATING_MGMT?.email,
    password: testCreds.CASTING_PLATING_MGMT?.password,
    // Casting + Plating are "Soon" items with CASTING_PLATING_MGMT in their
    // allowedRoles → they appear in the sidebar (disabled) so the user can
    // see what's coming. Matches the original sidebar-pattern for Soon items.
    expectedSidebar: ["Dashboard", "Casting", "Plating"],
    routes: {
      "/dashboard": "allow",
      "/sales": "redirect",
      "/customers": "redirect",
      "/purchases": "redirect",
      "/suppliers": "redirect",
      "/employees": "redirect",
      // /casting and /plating: proxy allows through; no page → 404.
    },
  },
];

// ---------- walkthrough ----------

const results = [];

async function login(page, email, password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/auth/login"), {
      timeout: 30_000,
    }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  return new URL(page.url()).pathname;
}

async function readSidebar(page) {
  // Read all nav items from the sidebar's <aside>; pick up both <Link> rows
  // (enabled) and the disabled <div role="aria-disabled"> rows for "Soon" items.
  const labels = await page.$$eval("aside nav li", (lis) =>
    lis.map((li) => {
      const spans = li.querySelectorAll("span");
      // The first <span> after the icon is the label; the last span (if
      // present and reading "Soon") indicates disabled status.
      const texts = Array.from(spans).map((s) => s.textContent?.trim() ?? "");
      return texts.find((t) => t && t.toLowerCase() !== "soon") ?? "";
    }),
  );
  return labels.filter(Boolean);
}

async function probeRoute(page, path) {
  // After goto with `waitUntil: 'domcontentloaded'` the final URL reflects
  // any proxy redirect. We classify:
  //   - "allow": final pathname starts with the requested path
  //   - "redirect": final pathname is /dashboard (and we asked for something else)
  //   - "404": no <aside> rendered AND status was 404
  //   - "other": anything else, recorded for inspection
  const resp = await page.goto(`${BASE}${path}`, {
    waitUntil: "domcontentloaded",
  });
  const status = resp ? resp.status() : 0;
  const final = new URL(page.url()).pathname;
  if (final === path || final.startsWith(path + "/")) return { kind: "allow", status, final };
  if (final === "/dashboard") return { kind: "redirect", status, final };
  if (status === 404) return { kind: "404", status, final };
  return { kind: "other", status, final };
}

async function logout(page) {
  // Sign out via the sidebar button if present; otherwise just clear cookies.
  try {
    const btn = page.getByRole("button", { name: /sign out/i });
    if (await btn.count()) {
      await btn.first().click();
      await page.waitForURL(/\/auth\/login/, { timeout: 15_000 });
      return;
    }
  } catch {
    // ignore
  }
}

async function runRole(browser, user, index) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const roleResults = { role: user.role, checks: [] };

  console.log(`\n========== ${user.role} ==========`);
  if (!user.email || !user.password) {
    console.log("  FAIL: missing credentials");
    roleResults.checks.push({ name: "credentials", status: "FAIL", info: "missing email/password" });
    results.push(roleResults);
    await ctx.close();
    return;
  }

  try {
    const landed = await login(page, user.email, user.password);
    const loginOk = landed === "/dashboard";
    console.log(`  login + landed: ${landed} ${loginOk ? "PASS" : "FAIL"}`);
    roleResults.checks.push({
      name: "login → /dashboard",
      status: loginOk ? "PASS" : "FAIL",
      info: landed,
    });

    await page.screenshot({
      path: join(OUT_DIR, `${String(index).padStart(2, "0")}-${user.role}-dashboard.png`),
      fullPage: false,
    });

    // Sidebar contents.
    const sidebar = await readSidebar(page);
    const expected = user.expectedSidebar;
    const missing = expected.filter((l) => !sidebar.includes(l));
    const extra = sidebar.filter((l) => !expected.includes(l));
    const sidebarOk = missing.length === 0 && extra.length === 0;
    console.log(`  sidebar:`, sidebar.join(", "));
    if (missing.length) console.log(`    missing:`, missing.join(", "));
    if (extra.length) console.log(`    extra:`, extra.join(", "));
    roleResults.checks.push({
      name: "sidebar matches",
      status: sidebarOk ? "PASS" : "FAIL",
      info: sidebar.join(", ") + (missing.length || extra.length ? ` | missing=[${missing.join(",")}] extra=[${extra.join(",")}]` : ""),
    });

    // Route probes.
    for (const [path, expectedKind] of Object.entries(user.routes)) {
      const r = await probeRoute(page, path);
      const ok = r.kind === expectedKind;
      console.log(`  ${path.padEnd(14)} → ${r.kind.padEnd(8)} (status ${r.status}, final ${r.final}) ${ok ? "PASS" : "FAIL"}`);
      roleResults.checks.push({
        name: `${path} → ${expectedKind}`,
        status: ok ? "PASS" : "FAIL",
        info: `kind=${r.kind} status=${r.status} final=${r.final}`,
      });
    }

    await logout(page);
  } catch (err) {
    console.log(`  walkthrough error: ${err.message}`);
    roleResults.checks.push({
      name: "exception",
      status: "FAIL",
      info: err.message,
    });
  } finally {
    await ctx.close();
  }

  results.push(roleResults);
}

const browser = await chromium.launch({ headless: true });

try {
  for (let i = 0; i < USERS.length; i++) {
    await runRole(browser, USERS[i], i);
  }
} finally {
  await browser.close();
}

// ---------- summary ----------

console.log("\n\n========== SUMMARY ==========");
let totalPass = 0;
let totalFail = 0;
for (const r of results) {
  const pass = r.checks.filter((c) => c.status === "PASS").length;
  const fail = r.checks.filter((c) => c.status === "FAIL").length;
  totalPass += pass;
  totalFail += fail;
  console.log(`  ${r.role.padEnd(22)} ${pass} pass / ${fail} fail`);
  for (const c of r.checks.filter((c) => c.status === "FAIL")) {
    console.log(`    FAIL: ${c.name} — ${c.info}`);
  }
}
console.log(`\nTotal: ${totalPass} pass / ${totalFail} fail`);
process.exit(totalFail === 0 ? 0 : 1);

// Phase 8 bills walkthrough — Playwright-driven, production-only.
//
// Covers walkthrough steps 4, 5, 6, 7, 8, 9, 10 (step 2 ≈ 5 was already
// done manually by the product owner; step 3 is implicit in 5).
//
// Credentials:
//   - ADMIN  ← .env.production.local (SEED_ADMIN_EMAIL/PASSWORD)
//   - PURCHASE_DEPT ← credentials.md (gitignored)
//
// Fixtures written into ./walkthrough-p8-out/.
// Stdout never logs raw passwords.

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(__dirname, "walkthrough-p8-out");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = "https://jewlerytracker-darshan-somaiyas-projects.vercel.app";

// ---------- env / cred loaders ----------
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
const ADMIN = { email: prodEnv.SEED_ADMIN_EMAIL, password: prodEnv.SEED_ADMIN_PASSWORD };
const PURCH = testCreds.PURCHASE_DEPT;

// ---------- fixtures ----------
// Minimal valid 1x1 PNG (~70 bytes; image/png-detectable by extension)
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0xb7, 0x49, 0x4f, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

// Minimal valid PDF (~250 bytes)
const PDF_BYTES = Buffer.from(
  "%PDF-1.0\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/Resources<<>>/MediaBox[0 0 612 792]>>endobj\n" +
    "xref\n" +
    "0 4\n" +
    "0000000000 65535 f\n" +
    "0000000009 00000 n\n" +
    "0000000052 00000 n\n" +
    "0000000101 00000 n\n" +
    "trailer<</Size 4/Root 1 0 R>>\n" +
    "startxref\n" +
    "156\n" +
    "%%EOF\n",
  "utf8",
);

const TXT_BYTES = Buffer.from("hello world\n", "utf8");
const BIG_BYTES = Buffer.alloc(11 * 1024 * 1024, 0); // 11 MB > 10 MB cap

const FILES = {
  png: join(OUT_DIR, "fixture.png"),
  pdf: join(OUT_DIR, "fixture.pdf"),
  txt: join(OUT_DIR, "fixture.txt"),
  big: join(OUT_DIR, "fixture-big.png"), // .png so browser picks image/png; size triggers rejection
};
writeFileSync(FILES.png, PNG_BYTES);
writeFileSync(FILES.pdf, PDF_BYTES);
writeFileSync(FILES.txt, TXT_BYTES);
writeFileSync(FILES.big, BIG_BYTES);

// ---------- runner state ----------
const results = [];
function check(label, pass, detail = "") {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function login(page, email, password) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"], input[type="email"]').first().fill(email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.toString().includes("/auth/login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
}

async function tbodyRowCount(page) {
  return await page.locator("table tbody tr").count();
}

async function dismissErrorBanner(page) {
  // The banner shows inline; clearing the file input and picking a new file
  // resets state via onPickFile setting state to {kind:'idle'} only on a
  // successful pick. Force a reset by directly clearing the input.
  await page.evaluate(() => {
    const inp = document.querySelector('input[type="file"]');
    if (inp) {
      inp.value = "";
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  // Allow React to re-render.
  await page.waitForTimeout(150);
}

// ---------- main ----------
const browser = await chromium.launch({ headless: true });
try {
  // ============ ADMIN session ============
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  admin.on("dialog", (d) => d.accept());

  await login(admin, ADMIN.email, ADMIN.password);
  await admin.goto(`${BASE}/admin/bills-test`);
  await admin.waitForLoadState("networkidle");

  // ============ Step 5: upload PNG → new ready row ============
  const beforePng = await tbodyRowCount(admin);
  await admin.setInputFiles('input[type="file"]', FILES.png);
  await admin.waitForTimeout(200);
  await admin.locator('button:has-text("Upload")').click();
  try {
    await admin.waitForFunction(
      (n) => document.querySelectorAll("table tbody tr").length > n,
      beforePng,
      { timeout: 60_000 },
    );
    check("Step 5 — PNG upload creates new row", true, `${beforePng} → ${await tbodyRowCount(admin)}`);
  } catch (err) {
    check("Step 5 — PNG upload creates new row", false, err.message);
  }

  // ============ Step 4: View on top ready row ============
  try {
    // The newly uploaded PNG row should be at top with View enabled.
    const [viewPage] = await Promise.all([
      adminCtx.waitForEvent("page", { timeout: 10_000 }),
      admin.locator('button[aria-label^="View"]:not([disabled])').first().click(),
    ]);
    const viewUrl = viewPage.url();
    const resp = await fetch(viewUrl);
    const ct = resp.headers.get("content-type") || "";
    check(
      "Step 4 — View URL returns 200 image/*",
      resp.status === 200 && ct.startsWith("image/"),
      `status=${resp.status} content-type=${ct}`,
    );
    await viewPage.close();
  } catch (err) {
    check("Step 4 — View URL returns 200 image/*", false, err.message);
  }

  // ============ Step 6: .txt rejected client-side ============
  await dismissErrorBanner(admin);
  await admin.setInputFiles('input[type="file"]', FILES.txt);
  await admin.waitForTimeout(400);
  const banner6 = await admin
    .locator("text=Unsupported file type")
    .first()
    .isVisible()
    .catch(() => false);
  check("Step 6 — .txt rejected client-side", banner6);

  // ============ Step 7: >10MB rejected client-side ============
  await dismissErrorBanner(admin);
  await admin.setInputFiles('input[type="file"]', FILES.big);
  await admin.waitForTimeout(400);
  const banner7 = await admin
    .locator("text=File too large")
    .first()
    .isVisible()
    .catch(() => false);
  check("Step 7 — >10MB rejected client-side", banner7);

  // ============ Step 8: Delete a row ============
  await dismissErrorBanner(admin);
  const beforeDelete = await tbodyRowCount(admin);
  try {
    await admin.locator('button[aria-label^="Delete"]').first().click();
    await admin.waitForFunction(
      (n) => document.querySelectorAll("table tbody tr").length < n,
      beforeDelete,
      { timeout: 15_000 },
    );
    const afterDelete = await tbodyRowCount(admin);
    check("Step 8 — Delete removes a row", afterDelete < beforeDelete, `${beforeDelete} → ${afterDelete}`);
  } catch (err) {
    check("Step 8 — Delete removes a row", false, err.message);
  }

  // ============ Step 10: upload final PDF as bait for tests phase ============
  const beforePdf = await tbodyRowCount(admin);
  await admin.setInputFiles('input[type="file"]', FILES.pdf);
  await admin.waitForTimeout(200);
  await admin.locator('button:has-text("Upload")').click();
  try {
    await admin.waitForFunction(
      (n) => document.querySelectorAll("table tbody tr").length > n,
      beforePdf,
      { timeout: 60_000 },
    );
    check("Step 10 — Final PDF upload creates new row", true, `${beforePdf} → ${await tbodyRowCount(admin)}`);
  } catch (err) {
    check("Step 10 — Final PDF upload creates new row", false, err.message);
  }

  await adminCtx.close();

  // ============ Step 9: PURCHASE_DEPT → /admin redirect ============
  if (PURCH?.email && PURCH?.password) {
    const purchCtx = await browser.newContext();
    const purch = await purchCtx.newPage();
    await login(purch, PURCH.email, PURCH.password);
    await purch.goto(`${BASE}/admin/bills-test`);
    await purch.waitForLoadState("networkidle");
    const finalPath = new URL(purch.url()).pathname;
    check(
      "Step 9 — PURCHASE_DEPT redirected from /admin/bills-test to /dashboard",
      finalPath === "/dashboard",
      `final=${finalPath}`,
    );
    await purchCtx.close();
  } else {
    check("Step 9 — PURCHASE_DEPT redirected", false, "PURCHASE_DEPT row missing from credentials.md");
  }
} finally {
  await browser.close();
}

const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass).length;
console.log(`\n${pass}/${results.length} PASS  ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

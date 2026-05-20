# Shree Creation — Production Handoff

Phase 4.5 handed the app from development to production. This doc is the operational reference: where things live, how to deploy, what to rotate, how to recover.

## 1. Production URLs

| Surface | URL |
|---|---|
| App | `https://jewlerytracker-darshan-somaiyas-projects.vercel.app` |
| Vercel project dashboard | `https://vercel.com/darshan-somaiyas-projects/jewlerytracker` |
| Supabase project dashboard | `https://supabase.com/dashboard/project/cseqdcrfnvgsalsyhjsz` |
| GitHub repo | `https://github.com/Darshan36/jewelry-tracker` |

Note: the Vercel project name is `jewlerytracker` (missing the "e" — the pre-existing project name is preserved). The app's display name remains "Shree Creation."

## 2. Production architecture

```
GitHub: Darshan36/jewelry-tracker (main branch)
        │
        │ push to main → webhook
        ▼
Vercel project: prj_G044SI4W3lUfumtIGuAvzYDOhABA
        │ Framework: Next.js 16 (auto-detected)
        │ Node: 24.x
        │ Build: npm install → postinstall (prisma generate) → next build
        │ Output: Fluid Compute (Node.js serverless functions, iad1)
        │
        ├─► /api/auth/*           (Auth.js v5 credential routes)
        ├─► /api/*                (Server Actions transport)
        ├─► proxy.ts middleware   (Auth gate on every non-public route)
        └─► /* App Router pages   (server-rendered on demand)
        │
        │ runtime queries via @prisma/adapter-pg
        ▼
Supabase Postgres: cseqdcrfnvgsalsyhjsz (ap-south-1, Mumbai)
        │ Transaction pooler  port 6543  (DATABASE_URL, runtime)
        │ Session pooler      port 5432  (DIRECT_URL, migrations + CLI)
        │ 10 entity tables, all initially empty
        │ 1 user row: c.darshan.somaiya369@gmail.com (ADMIN)
        │ Public-schema grants REVOKED from anon/authenticated
```

## 3. Local dev vs production — what differs

| Concern | Local dev | Production |
|---|---|---|
| URL | `http://localhost:3000` (or 3001) | the .vercel.app URL above |
| DB | a separate Supabase project (`rylgkzatxebvmemwspyb`) | `cseqdcrfnvgsalsyhjsz` |
| Env file | `.env.local` (gitignored) | Vercel Project Settings → Environment Variables (target: production) |
| Auth secret | local-only value | distinct value; rotating prod does NOT affect dev |
| Seeded admin | `kirtithakkar@shreecreation.com` | `c.darshan.somaiya369@gmail.com` |

The two databases are independent. Migrations applied locally must be deployed to prod via `npx prisma migrate deploy` against `DIRECT_URL` from `.env.production.local`.

## 4. Deploying a change

Routine workflow:

```bash
# 1. Make your change locally, run tests
npm run test:run

# 2. Commit + push to main
git add ...
git commit -m "..."
git push origin main
```

The GitHub-Vercel integration auto-triggers a production deploy on every push to `main`. No PR review gate exists yet (single-developer mode). To monitor:

```bash
# Open the deployment list in browser
gh repo view --web Darshan36/jewelry-tracker
# Or watch via the Vercel CLI (if installed)
vercel logs --follow
```

Build time is ~60s cold, ~30s with cache.

### If a build needs a schema change

```bash
# 1. Edit prisma/schema.prisma
# 2. Locally:
npx prisma migrate dev --name <description>
npm run prisma:generate

# 3. Apply to PROD before deploying the code that uses it:
DATABASE_URL=<from .env.production.local> \
DIRECT_URL=<from .env.production.local> \
  npx prisma migrate deploy

# 4. Then commit + push the schema + code together.
```

The order matters: deploying code that queries a new column before the migration runs against prod will produce runtime errors on the first request that hits that code path.

## 5. Environment variables

Production env vars are managed via the Vercel dashboard or REST API. Full list (target = `production`):

| Key | Notes |
|---|---|
| `DATABASE_URL` | Transaction pooler URL, port 6543, with `?pgbouncer=true&connection_limit=1`. URL-encode any reserved characters in the password. |
| `DIRECT_URL` | Session pooler, port 5432. Used for migrations and Prisma CLI; not for runtime queries. |
| `AUTH_SECRET` | 32-byte base64 random. Rotating invalidates every active session globally. |
| `AUTH_TRUST_HOST` | Constant `true` — Auth.js trusts the X-Forwarded-Host header from Vercel. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://cseqdcrfnvgsalsyhjsz.supabase.co`. Inlined into the client bundle at build time. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_…` format. Inlined at build time. |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` format. Server-only. |
| `SEED_ADMIN_EMAIL` / `_PASSWORD` / `_NAME` | Consumed by `prisma/seed.ts` for first-run admin creation. Safe to keep after seeding for idempotency. |

**Watch for URL-truncation when scripting env-var writes.** When importing env values into a shell pipeline, anything containing `&` will be parsed as a background operator if the value isn't quoted. During Phase 4.5 setup this corrupted the initial `DATABASE_URL` upload (it stored as an empty string after the `&`, surfaced as a `Configuration` error on login attempts). Always read values directly from the file via Node, not via `source`/`set -a`.

A change to env vars does NOT automatically redeploy. After editing, trigger a redeploy from the dashboard or push a no-op commit.

## 6. Rotating secrets

| Secret | Rotate when | How |
|---|---|---|
| Vercel personal access token (`vcp_…`) | Used in a shared transcript or expired | Account → Tokens → revoke, generate new. |
| Supabase Management token (`sbp_…`) | Used in a shared transcript or expired | Supabase Dashboard → Account → Access Tokens. |
| Supabase DB password | Suspected leak; quarterly | Supabase Dashboard → Project Settings → Database → Reset DB password → update `DATABASE_URL` + `DIRECT_URL` in Vercel → redeploy. |
| `AUTH_SECRET` | Suspected session-cookie compromise; every 6–12 months as hygiene | Run `openssl rand -base64 32` → paste into Vercel env → redeploy. All existing sessions are invalidated; users log in again. |
| `SEED_ADMIN_PASSWORD` (and the corresponding `users.passwordHash`) | Suspected compromise; once a password-change UI exists | Until then, requires direct DB update (see KNOWN_GAPS). |

## 7. First-time login

The seeded admin account is:

- **Email:** `c.darshan.somaiya369@gmail.com`
- **Password:** stored in `.env.production.local` as `SEED_ADMIN_PASSWORD` (gitignored)
- **Role:** `ADMIN`

After first login, change the password via direct DB update (no UI for self-service yet — see KNOWN_GAPS).

Additional users can be created by:

1. Direct insert against the prod DB via raw SQL with an explicit role from `ADMIN | PURCHASE_DEPT | LABOUR_MGMT | CASTING_PLATING_MGMT`. `role` is required (no default since Phase 5). Example:
   ```sql
   INSERT INTO users (id, email, "passwordHash", role, name, "createdAt", "updatedAt")
   VALUES ('cuid()', 'newuser@example.com', '<bcrypt-cost-12-hash>', 'PURCHASE_DEPT', 'New User', NOW(), NOW());
   ```
2. Or by setting different `SEED_ADMIN_*` env vars locally and re-running `npx prisma db seed` against `DIRECT_URL` (idempotent — won't duplicate if email matches; the seed creates an `ADMIN`).

## 8. Test accounts (production)

Three non-admin test users exist on production for RBAC verification:

- `test-purchase@shreecreation.test` — `PURCHASE_DEPT` role
- `test-labour@shreecreation.test` — `LABOUR_MGMT` role
- `test-casting@shreecreation.test` — `CASTING_PLATING_MGMT` role

**Passwords are in admin's password manager.** They are NOT stored on disk anywhere in the repo or the local working tree — the original generation file (`credentials.md`) was gitignored and is intended to be deleted after the passwords land in the password manager.

**Purpose:** verify role-gated access after any RBAC-related schema or guard changes. Sign in as each role, confirm sidebar contents and route allow/redirect behaviour against the access matrix in CLAUDE.md §2. The automated walkthrough script `scripts/walkthrough-rbac.mjs` exercises all four roles in ~30 seconds and produces a 36-point PASS/FAIL report against production.

**Do not delete.** Recreating them requires direct DB inserts (no user-management UI yet — see KNOWN_GAPS); keeping them avoids a regeneration step every time we touch role logic. Cost is three extra rows on a table with a handful of entries.

## 9. Backups

Supabase Free tier provides daily automated backups for 7 days, retrievable from Project Settings → Database → Backups. No app-side backup automation has been added.

For the workshop-scale workload (~100 transactions/month), a periodic manual `pg_dump` against `DIRECT_URL` is a reasonable insurance policy:

```bash
pg_dump "$DIRECT_URL" --no-owner --no-privileges > backup-$(date +%Y-%m-%d).sql
```

Run from a machine that already has the URL in env. Store the dump somewhere off the host.

## 10. Common operational tasks

**View runtime logs** — Vercel dashboard → Deployments → pick a deployment → Functions tab. Or via API:

```bash
# Requires the Vercel CLI:
vercel logs https://jewlerytracker-darshan-somaiyas-projects.vercel.app --follow
```

**Roll back a deploy** — Vercel dashboard → Deployments → find the last good one → ⋯ menu → Promote to Production. Or via the Rolling Releases feature for canary control.

**Disable a user** — direct SQL: `UPDATE users SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE email = '…'`. There is no UI for this; sessions will continue working until the JWT expires (30 days) unless `AUTH_SECRET` is also rotated.

**Restore a soft-deleted row** — direct SQL: `UPDATE <table> SET "deletedAt" = NULL, "updatedAt" = NOW() WHERE id = '…'`. There is no UI; see KNOWN_GAPS for the `Settings → Deleted records` page deferred item.

## 11. Cleanup after Phase 4.5

The walkthrough script `scripts/walkthrough-prod.mjs` is committed for re-runs against future deploys. It creates a customer + sale + payment + return, asserts the full lifecycle including the `refund_due` chip, then cleans up. Each invocation uses a unique `__walkthrough_<timestamp>` marker so concurrent runs don't collide.

If a future run fails partway and leaves orphan rows, clean up with:

```sql
DELETE FROM sale_payments WHERE "saleId" IN (SELECT id FROM sales WHERE "itemDescription" LIKE '%__walkthrough_%');
DELETE FROM sale_returns  WHERE "saleId" IN (SELECT id FROM sales WHERE "itemDescription" LIKE '%__walkthrough_%');
DELETE FROM sales         WHERE "itemDescription" LIKE '%__walkthrough_%';
DELETE FROM customers     WHERE name LIKE '%__walkthrough_%';
```

## 12. What's still deferred

See [`KNOWN_GAPS.md`](../KNOWN_GAPS.md) § Deferred items for the running list (lean working doc). Older / historical items live in [`KNOWN_GAPS_ARCHIVE.md`](./KNOWN_GAPS_ARCHIVE.md) — reference-only. Items added in Phase 4.5 specifically:

- No user-management UI (create staff, change password, forgot password). Direct DB ops only.
- No app-side backup automation (Supabase backups exist on the free tier; pull periodically).
- No observability beyond Vercel's built-in logs (no Sentry/Datadog/Logtail; the authorize callback's `console.error` is the only custom logging).
- No staging environment. Prod is fed directly from `main`.
- No custom domain. Custom domains bypass Vercel's SSO protection by default; the project-level SSO is currently disabled.
- The Vercel CLI is not installed locally — relevant if you want to run `vercel logs --follow` or `vercel env pull`.

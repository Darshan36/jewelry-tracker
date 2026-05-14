# Known Gaps and Deferred Items

Living document of decisions deferred, caveats accepted, and items to revisit. Audited every 3–4 phases.

## How to use this file

- Items added when a phase intentionally defers work
- Each item has a clear revisit trigger (next phase / next major bump / when condition X happens)
- When an item is resolved, mark it `[resolved on YYYY-MM-DD]` and leave it in place for one audit cycle, then remove

## Decision lineage

Decisions where we deviated from an original spec or assumption, kept for institutional memory.

- **shadcn preset is `radix-nova`, not "default + slate".** The setup spec specified shadcn's classic "Default style + Slate base color." The shadcn CLI (≥4.x) replaced `--style` and `--base-color` with a preset list (Nova / Vega / Maia / Lyra / Mira / Luma / Sera / Custom); none are named "slate." We ran `shadcn init -b radix --css-variables -y` and got the `radix-nova` preset. The visual tokens it shipped are fully overridden in `src/app/globals.css`, so the preset choice is cosmetic-only — but any future `npx shadcn add <component>` will pull components written for the radix-nova variant.

- **Tailwind v4 with CSS-based `@theme`, not `tailwind.config.ts`.** The setup spec said "update `tailwind.config.ts`," but `create-next-app` now scaffolds Tailwind v4, which puts theme tokens in `globals.css` via the `@theme` directive. No `tailwind.config.ts` file exists. End result is the same — design tokens compile to Tailwind utilities and CSS variables.

- **Prisma 7 architecture: schema has no datasource URLs; connection split between `prisma.config.ts` (CLI/migrations) and an adapter on `PrismaClient` (runtime).** The Phase 1.5 spec assumed Prisma 6's pattern of `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")` inside `schema.prisma`. Prisma 7 (installed v7.8.0) rejects both fields in the schema (error P1012). The new architecture: (a) `prisma.config.ts` declares `datasource.url = process.env.DIRECT_URL` for the CLI / migrations / studio (session pooler, port 5432, supports prepared statements); (b) `src/lib/prisma.ts` constructs a `@prisma/adapter-pg` adapter with `process.env.DATABASE_URL` (transaction pooler, port 6543 + `?pgbouncer=true&connection_limit=1`) and passes it to `new PrismaClient({ adapter })` for runtime queries. The two-URL pattern is preserved — just plumbed through two different files instead of one schema block. Adapter dependencies added: `@prisma/adapter-pg`, `pg`, `@types/pg`.

- **Prisma 7 client barrel.** Prisma 7's `prisma-client` generator emits the client into `src/generated/prisma/` as separate files (`client.ts`, `models.ts`, `enums.ts`, etc.) with no `index.ts`. To make `import { PrismaClient } from '@/generated/prisma'` resolve canonically (the idiom that tutorials and AI assistants assume), `scripts/post-prisma-generate.mjs` writes a barrel that re-exports from `./client`. The `prisma:generate` npm script chains generation + barrel; `postinstall` delegates to it so fresh clones always have a working barrel.

- **Tailwind v4 spacing namespace collision — named `--spacing-*` tokens NOT exposed via `@theme`.** DESIGN.md defines spacing as `xs/sm/md/lg/xl = 4/8/16/24/40px`, but Tailwind v4's size-keyword utilities (`max-w-md`, `max-w-lg`, `max-h-xl`, `min-w-sm`, etc.) read from the same `--spacing-*` CSS variable namespace. Defining `--spacing-md: 16px` in `@theme` would shadow Tailwind's default size-keyword resolution and make `max-w-md` = 16px instead of 28rem. Discovered during Phase 1.6 Task 5 when the login card rendered ~200px wide instead of ~450px. Resolution: we use Tailwind's **numeric** spacing utilities exclusively (`p-1` = 4px, `p-2` = 8px, `p-4` = 16px, `p-6` = 24px, `p-10` = 40px) — these derive from the singular `--spacing` base unit (`0.25rem`) and don't collide. Equivalents table is documented in `src/app/globals.css`.

- **Auth.js v5 module augmentation requires `@auth/core/*` paths, not just `next-auth/*`.** Auth.js v5's docs show augmenting `next-auth` and `next-auth/jwt` to add custom fields (e.g. `Session.user.role`, `JWT.role`). In beta.31 reality, the `next-auth/jwt.d.ts` file is `export * from "@auth/core/jwt"` — TypeScript interface merging doesn't propagate through the `export *` re-export. Augmentation must target both the wrapper paths (`next-auth`, `next-auth/jwt`) AND the originals (`@auth/core/types`, `@auth/core/jwt`). See `src/types/next-auth.d.ts` for the four-module declaration. Discovered Phase 1.6 Task 3 — initial spec-shaped augmentation produced TS2322 errors (`token.id` typed as `unknown`).

- **Next.js 16 middleware → proxy rename.** The original Phase 1.6 spec called for `src/middleware.ts`; Next.js 16 deprecated that convention in favor of `src/proxy.ts`. File contents are unchanged (the `auth((req) => …)` wrapper from Auth.js works identically). Critically, **`proxy.ts` defaults to the Node.js runtime** per the official docs, which solves the Auth.js + Prisma edge-bundling problem (the proxy import chain pulls in `@prisma/adapter-pg` → `pg` → `node:net` etc.) without needing to split auth config into `auth.config.ts` + `auth.ts`. Future contributors looking at Auth.js v5 docs will see the split-config pattern; **ignore it** — our stack doesn't need it. Discovered Phase 1.6 Task 4 when the dev server failed to compile middleware.ts under Edge Runtime.

- **Public schema grants revoked from `anon` and `authenticated` roles.** Supabase's default setup grants table-level privileges on `public` to the `anon` (browser-exposed via `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and `authenticated` roles. We don't use Supabase's REST/PostgREST endpoint at all — Prisma talks directly to Postgres through the pooler with the `postgres` role. So those grants were pure attack surface with zero benefit. Phase 1.5 ran:
  ```sql
  REVOKE ALL ON SCHEMA public FROM anon, authenticated;
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES   FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  ```
  Verified via `has_table_privilege('anon', …, 'SELECT' | 'INSERT')` returning `false` for every check. **If we later want to use Supabase REST for any reason** (Supabase Auth client-side, Realtime, Storage public buckets, etc.), grants need to be re-applied per-table with appropriate RLS policies. Don't blindly `GRANT ALL`.

## Resolved (one audit cycle)

Items completed but kept here for one audit cycle for traceability, then pruned.

- **Prisma + Supabase PgBouncer compatibility flag** — *[resolved on 2026-05-14]*. Applied `?pgbouncer=true&connection_limit=1` to `DATABASE_URL` only (via Phase 1.5 Task 1); `DIRECT_URL` kept clean for migrations (it goes through the session pooler which natively supports prepared statements). Plumbed through Prisma 7's adapter pattern: `DATABASE_URL` → `PrismaPg` adapter → `PrismaClient` runtime; `DIRECT_URL` → `prisma.config.ts` → Prisma CLI. Verified via throwaway `_connectivity_check` table + `/api/health` smoke test (both removed in Task 6 cleanup). No prepared-statement errors observed across migration apply, drop, and 2× runtime queries.

## Deferred items

Work intentionally not done, with revisit triggers.

- **`@hono/node-server <1.19.13` middleware bypass via repeated slashes** *(moderate, GHSA-92pp-h63x-v22m)*. Pulled transitively by `@prisma/dev → prisma`. `npm audit fix --force` would downgrade Prisma to 6.19.3 (breaking). Dev-time-only attack surface. **Revisit on next Prisma major bump** (post-7.x) — should drop automatically.

- **`postcss <8.5.10` XSS in CSS stringify** *(moderate, GHSA-qx2v-qp2m-jg93)*. Pulled transitively by `next`. Fix would downgrade `next` to 9.3.3 (massive breaking change). Build-time-only attack surface for our internal app. **Revisit on next Next.js major bump** (post-16.x) — should drop automatically.

- **Supabase Agent Skills package (`supabase/agent-skills`) not installed.** Deferred to avoid pulling Claude Code toward Supabase-native patterns (Edge Functions, RLS-first design, Supabase CLI migrations) when we've committed to Prisma + Postgres patterns instead. The Supabase MCP server alone provides enough context for read/write operations. **Revisit if MCP-only context proves insufficient** during database phases (Phase 2+).

- **Credential rotation deferred.** The Supabase `sb_secret_…` (service role), `sb_publishable_…` (anon), and DB master password were exposed in a logged chat transcript during Phase 1 setup. The legacy JWT keys for the same project are also valid until the JWT secret is rotated. **The first admin password (`SEED_ADMIN_PASSWORD`) is also in the transcript** from Phase 1.6 Task 2 — same leak surface. No production data exists yet, so the overall leak risk is low. **Revisit before Phase 2 (master data)** when real customer/transaction data begins landing in the database. Rotation steps: Supabase dashboard → Settings → Database → Reset password (regenerates pooler URLs); → Settings → API → Rotate JWT secret (invalidates exposed JWTs and `sb_*` keys); rotate the admin password by updating the `users` row directly (or via a future Settings UI); rotate `AUTH_SECRET` to invalidate any existing JWT sessions; update `.env.local` with new values; restart dev server / redeploy.

- **Invite user flow not built.** Currently only the seeded admin exists. The product expects admins to create additional staff accounts (and other admins) from inside the app via an authenticated "Invite User" flow, but Phase 1.6 only seeds the single primary admin. Two more admins (Sachin and Kunj Thakkar — credentials discarded from working memory) wait for this flow. **Revisit in Phase 2 alongside master data, or later if the company doesn't need additional users yet.** Until then, ad-hoc admin creation requires running the seed script with different env vars or inserting `users` rows directly.

- **No password reset flow.** A user who forgets their password has no self-service recovery path. Admin must update the DB row (`UPDATE users SET "passwordHash" = …`) directly, or via a future Settings UI. Acceptable for an internal app with 1–3 known users on the same network. **Revisit when the user count grows or someone forgets their password in practice.**

- **No account lockout / rate limiting on login.** Failed login attempts have no throttling — an attacker who knows the email could brute-force the password endlessly. Acceptable trade-off for an internal app behind a single login wall with a known small admin set. **Revisit if user count grows materially, if the app is ever exposed beyond the office network, or if we add public-facing surfaces.** Implementation options when needed: edge-rate-limiting via Vercel firewall, in-app cooldown table tracked in Postgres, or a `failedAttempts` + `lockedUntil` columns on `User`.

## Onboarding notes for future contributors

Things that aren't gaps but trip up new sessions.

- **MCP authentication is per-developer.** `.mcp.json` at project root declares the Supabase MCP server, but OAuth tokens are stored in each developer's local Claude Code state — not in the repo. A new session in this folder must run `claude /mcp` in a regular terminal (outside the IDE), select `supabase`, and complete OAuth before MCP tools work. The `.mcp.json` file itself is committed; tokens are not.

- **Dev server default port may be 3001, not 3000.** If another long-running node process holds port 3000, `next dev` falls back to 3001 with a `⚠ Port 3000 is in use` warning. Check the dev.log / terminal output for the actual port before opening the browser. To free port 3000: `Get-Process node` (Windows) or `lsof -i :3000` (mac/linux) → identify the holder → kill it if it's a stale dev server.

- **Tailwind v4 — theme tokens live in `src/app/globals.css`, NOT in a JS config file.** Don't go looking for `tailwind.config.ts` — it doesn't exist. All color/font/radius tokens are defined in the `@theme { … }` block inside `globals.css`. If you need to add a new color or change a token, edit `globals.css`. The `@theme` directive auto-generates Tailwind utility classes (`bg-surface-container`, `text-on-primary`, etc.) and CSS custom properties (`var(--color-surface)`) from the declarations.

- **Supabase keys use the new `sb_publishable_…` / `sb_secret_…` format**, not legacy JWTs. The env var names in `.env.local` retain the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` convention from the original spec, but the values are new-format. `@supabase/supabase-js@2.105+` accepts both formats. Don't be surprised that the values don't look like JWTs.

- **DB password contains URL sub-delim characters** (`,` and `*`). It's URL-encoded as `%2C` and `%2A` inside both `DATABASE_URL` and `DIRECT_URL` so Prisma's URL parser doesn't choke. If you regenerate the password and it contains other reserved characters (`+`, `&`, `?`, `#`, `/`, `@`, `:`, space), URL-encode them too. The raw password roundtrips correctly server-side.

- **Currency is stored as integer paise**, not rupees-with-decimals. `₹1,234.56` ↔ `123456` paise. Display formatters convert at the UI layer only. Never store, sum, or arithmetic-on currency as a float anywhere.

- **Status is derived, not stored.** Don't add a `status` column to `Sale` or `Purchase`. See `CLAUDE.md` §5 for the full rationale and the TypeScript string-literal union pattern.

- **`prisma generate` does NOT run automatically after `migrate dev` in Prisma 7.** The Prisma 6 behavior of chaining generation onto migration was dropped. Run `npm run prisma:generate` after any schema change — this also writes the barrel `src/generated/prisma/index.ts` that makes `@/generated/prisma` resolve. Fresh clones get this automatically via the `postinstall` hook in `package.json`.

- **Postgres `anon` and `authenticated` roles have no privileges on the `public` schema.** New tables don't need RLS policies for security (the only roles that can access them are `postgres` / `service_role`, both of which `BYPASSRLS`). Adding RLS as defense-in-depth is fine. If you see "RLS disabled" advisories from Supabase, **the threat is mitigated by the grant revocation** — see decision lineage. Schema-level USAGE remains for the two roles (inherited from the `PUBLIC` role) but is harmless without table grants.

- **Prisma client output lives at `src/generated/prisma/` (gitignored).** The directory is regenerated by `npm run prisma:generate`. Never edit files inside it directly. Importing pattern: `import { prisma } from '@/lib/prisma'` for the singleton; `import { PrismaClient, Prisma, $Enums } from '@/generated/prisma'` for type imports.

- **First-time setup after `git clone`.** Required steps before the dev server is useful: (1) `npm install` (runs `postinstall` → `prisma generate` → barrel write automatically); (2) populate `.env.local` from `.env.example` — values come from Supabase dashboard + a fresh `openssl rand -base64 32` for `AUTH_SECRET` + a chosen `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (12+ chars); (3) `npx prisma migrate deploy` to apply existing migrations to your DB; (4) `npx prisma db seed` to create the admin user; (5) `npm run dev` to start the server; (6) sign in at `/auth/login` with the seeded credentials. Skipping step 4 means there's no user to log in as.

- **JWT sessions — no DB session table.** Auth.js is configured with `session: { strategy: 'jwt', maxAge: 30 days }`. Sessions are stateless JWE cookies signed/encrypted with `AUTH_SECRET`. There is no `sessions` table in the DB and no `@auth/prisma-adapter` involvement (despite the package being installed — it's available for a future switch but not wired up). To invalidate all sessions globally (e.g. after a security incident), **rotate `AUTH_SECRET` in `.env.local`**. Every existing cookie becomes undecryptable; everyone is forced to re-authenticate.

- **Heading fonts cascade from `@layer base`, not from per-element classes.** All `h1`–`h6` elements automatically use Geist via `html, body { font-family: var(--font-sans); }` + `h1, h2, h3, h4, h5, h6 { font-family: var(--font-display); }` in `src/app/globals.css`. **Don't add `font-display` to heading elements** — it's redundant and creates inconsistent patterns across pages. Only use `font-display` on **non-heading** elements that should look like headings (e.g. the dashboard card's stat number uses `font-display text-2xl font-semibold` on a `<p>` because `<p>` defaults to Inter).

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

- **Master data parties (Customers / Suppliers) are for regulars only — walk-in / one-time parties NOT represented in master tables.** Forcing every sale/purchase party through a master record creates friction that doesn't match jewelry-workshop reality. The dual-path party model lands in Phase 3 (Sales) and Phase 4 (Purchases): each Sale/Purchase row gets either `customerId` (FK to a known regular) OR a free-text `partyName` + `partyPhone` pair (one-time / walk-in). The Customers page therefore intentionally has no Excel-bulk-import yet; regulars are entered manually as they emerge. Discovered Phase 2.1 planning. Cross-references: Phase 3 / Phase 4 implement the autocomplete + free-text fallback.

- **Schema extraction pattern for forms with Server Actions.** Zod schemas cannot be exported from files carrying the `'use server'` directive — Next.js compiles non-function exports into client-reference stubs, replacing the actual schema with a serialized handle. When the client form modal imports the "schema," it receives a stub that fails the `zodResolver`'s `isZod4Schema` check (`'_zod' in schema`) at module load with **"Invalid input: not a Zod schema."** Convention going forward: each entity gets a `schema.ts` (no directive — pure validation), `actions.ts` (`'use server'`, imports schema), and form modal (`'use client'`, imports schema). Pattern committed for Customer in Phase 2.1; Suppliers (Phase 2.2) and Employees (Phase 2.3) follow the same layout. Cross-reference Sales (Phase 3) and Purchases (Phase 4) when those land. Discovered Phase 2.1 Task 7.

- **RHF triple-generic pattern for transform-emitting schemas.** When a zod schema uses `.transform(...)` (as ours does to coerce `""` → `null` on optional fields), the input and output types differ — `phone: string | null | undefined` going in, `phone: string | null` coming out. RHF v7's `useForm<TFieldValues>` defaults `TTransformedValues = TFieldValues`, which mismatches the resolver's actual return shape. The fix is the **explicit triple generic**: `useForm<FormInput, unknown, FormOutput>` where `FormInput = z.input<typeof schema>` (form's pre-transform value type, allows `defaultValues: { phone: '' }`) and `FormOutput = z.output<typeof schema>` (post-transform shape passed to `onSubmit`). Without it, TypeScript rejects both `defaultValues` and `handleSubmit`. Committed for the Customer form modal in Phase 2.1 Task 4; same pattern for every form modal going forward.

- **Optional-field edit semantics — empty form field means NULL, not "preserve old value."** Customer/Supplier/Employee input schemas use a `.nullish().transform((v) => (v === undefined || v === null || v === "" ? null : v))` pattern (with `.pipe(z.union([z.null(), z.string().email(...)]))` for email so format validation runs after the empty-string normalization). This emits `null` for cleared inputs. Prisma's `update.data` treats `undefined` as "skip this field" but `null` as "set column to NULL" — so emitting `null` makes clearing-via-edit-form actually clear the DB column, not silently retain the stale value. The previous `.transform(() => undefined)` pattern from the Phase 2.1 spec example had this bug. Output type for each optional field is `string | null`, never `string | undefined`. Discovered Phase 2.1 Task 3.

## Resolved (one audit cycle)

Items completed but kept here for one audit cycle for traceability, then pruned.

- **Prisma + Supabase PgBouncer compatibility flag** — *[resolved on 2026-05-14]*. Applied `?pgbouncer=true&connection_limit=1` to `DATABASE_URL` only (via Phase 1.5 Task 1); `DIRECT_URL` kept clean for migrations (it goes through the session pooler which natively supports prepared statements). Plumbed through Prisma 7's adapter pattern: `DATABASE_URL` → `PrismaPg` adapter → `PrismaClient` runtime; `DIRECT_URL` → `prisma.config.ts` → Prisma CLI. Verified via throwaway `_connectivity_check` table + `/api/health` smoke test (both removed in Task 6 cleanup). No prepared-statement errors observed across migration apply, drop, and 2× runtime queries.

- **Credential rotation (Supabase + Auth.js secrets)** — *[resolved on 2026-05-14]*. Rotated: Supabase DB master password, Supabase JWT signing secret, `sb_publishable_…` (anon) key, `sb_secret_…` (service role) key, and `AUTH_SECRET`. **Admin password (`users.passwordHash`) NOT rotated** — deferred to dedicated `Settings → Change Password` UI in a later phase; direct-SQL `UPDATE users SET "passwordHash" = …` was judged higher risk than the narrower remaining exposure surface (admin-password attack also requires email + access to the running app + login flow). New credentials live only in `.env.local`. Old credentials in the chat transcript are now invalidated. All previously-issued session cookies are also invalidated by the `AUTH_SECRET` rotation; only fresh logins succeed. Resolution required a full `.next/` cache nuke between attempts — see the new "Build-cache cousins" onboarding note.

## Deferred items

Work intentionally not done, with revisit triggers.

- **`@hono/node-server <1.19.13` middleware bypass via repeated slashes** *(moderate, GHSA-92pp-h63x-v22m)*. Pulled transitively by `@prisma/dev → prisma`. `npm audit fix --force` would downgrade Prisma to 6.19.3 (breaking). Dev-time-only attack surface. **Revisit on next Prisma major bump** (post-7.x) — should drop automatically.

- **`postcss <8.5.10` XSS in CSS stringify** *(moderate, GHSA-qx2v-qp2m-jg93)*. Pulled transitively by `next`. Fix would downgrade `next` to 9.3.3 (massive breaking change). Build-time-only attack surface for our internal app. **Revisit on next Next.js major bump** (post-16.x) — should drop automatically.

- **Supabase Agent Skills package (`supabase/agent-skills`) not installed.** Deferred to avoid pulling Claude Code toward Supabase-native patterns (Edge Functions, RLS-first design, Supabase CLI migrations) when we've committed to Prisma + Postgres patterns instead. The Supabase MCP server alone provides enough context for read/write operations. **Revisit if MCP-only context proves insufficient** during database phases (Phase 2+).

- **Admin password rotation deferred.** Supabase keys + DB password + `AUTH_SECRET` were rotated end of Phase 2.1 (see Resolved section above), but `users.passwordHash` for the seeded admin still corresponds to the original password that appeared in the chat transcript during Phase 1.6 Task 2. Exposure surface is narrower than the Supabase keys — an attack also requires the admin email + access to the running app + going through the login flow (no direct DB read possible from the transcript-leaked value). But the leak is still real. **Revisit when `Settings → Change Password` UI is built** (Phase 6 or later), or sooner if there's external reason to believe the password has spread beyond the transcript. Direct-SQL `UPDATE users SET "passwordHash" = …` was considered for the rotation pass but rejected — the bcrypt-hash dance + direct DB UPDATE was judged higher risk than the remaining surface. `SEED_ADMIN_PASSWORD` in `.env.local` also still has the original value (kept in sync with the DB record so `npx prisma db seed` remains idempotent).

- **Invite user flow not built.** Currently only the seeded admin exists. The product expects admins to create additional staff accounts (and other admins) from inside the app via an authenticated "Invite User" flow, but Phase 1.6 only seeds the single primary admin. Two more admins (Sachin and Kunj Thakkar — credentials discarded from working memory) wait for this flow. **Revisit in Phase 2 alongside master data, or later if the company doesn't need additional users yet.** Until then, ad-hoc admin creation requires running the seed script with different env vars or inserting `users` rows directly.

- **No password reset flow.** A user who forgets their password has no self-service recovery path. Admin must update the DB row (`UPDATE users SET "passwordHash" = …`) directly, or via a future Settings UI. Acceptable for an internal app with 1–3 known users on the same network. **Revisit when the user count grows or someone forgets their password in practice.**

- **No account lockout / rate limiting on login.** Failed login attempts have no throttling — an attacker who knows the email could brute-force the password endlessly. Acceptable trade-off for an internal app behind a single login wall with a known small admin set. **Revisit if user count grows materially, if the app is ever exposed beyond the office network, or if we add public-facing surfaces.** Implementation options when needed: edge-rate-limiting via Vercel firewall, in-app cooldown table tracked in Postgres, or a `failedAttempts` + `lockedUntil` columns on `User`.

- **Customer Excel import not built.** Manual entry only in Phase 2.1; no bulk-load mechanism. **Revisit as a Phase 2.x polish** if onboarding a long list of regulars (e.g., migrating from a paper ledger) becomes needed. Implementation when needed: ExcelJS-based reader on a `/customers/import` route, with a preview-and-confirm step + dedup detection (see below).

- **Customer dedup detection not built.** No warning if a user creates two records with similar names (`"Rajeshbhai"` vs `"Rajesh Bhai"`, or with/without a trailing whitespace). Manual data-entry will produce dupes over time. **Revisit in Phase 3** when the Sale party-autocomplete makes the duplication user-visible (typing "Raj" surfaces both records and the user notices). Implementation when needed: levenshtein / unicode-NFKD-normalized name match + phone-prefix match, surfaced as "Did you mean…?" suggestions on the Add modal.

- **No UI to restore soft-deleted customers.** `softDeleteCustomer` sets `deletedAt`; the page query filters `deletedAt: null`; deleted rows preserve history but are invisible from the app. To restore manually: `UPDATE customers SET "deletedAt" = NULL WHERE id = '…'` via Supabase MCP. **Build a `Settings → Deleted records` page if this becomes painful** — likely after Phase 6 when other entities have the same soft-delete pattern and consolidating into one admin view is worthwhile.

## Onboarding notes for future contributors

Things that aren't gaps but trip up new sessions.

- **MCP authentication is per-developer.** `.mcp.json` at project root declares the Supabase MCP server, but OAuth tokens are stored in each developer's local Claude Code state — not in the repo. A new session in this folder must run `claude /mcp` in a regular terminal (outside the IDE), select `supabase`, and complete OAuth before MCP tools work. The `.mcp.json` file itself is committed; tokens are not.

- **Dev server default port may be 3001, not 3000.** If another long-running node process holds port 3000, `next dev` falls back to 3001 with a `⚠ Port 3000 is in use` warning. Check the dev.log / terminal output for the actual port before opening the browser. To free port 3000: `Get-Process node` (Windows) or `lsof -i :3000` (mac/linux) → identify the holder → kill it if it's a stale dev server.

- **Tailwind v4 — theme tokens live in `src/app/globals.css`, NOT in a JS config file.** Don't go looking for `tailwind.config.ts` — it doesn't exist. All color/font/radius tokens are defined in the `@theme { … }` block inside `globals.css`. If you need to add a new color or change a token, edit `globals.css`. The `@theme` directive auto-generates Tailwind utility classes (`bg-surface-container`, `text-on-primary`, etc.) and CSS custom properties (`var(--color-surface)`) from the declarations.

- **Supabase keys use the new `sb_publishable_…` / `sb_secret_…` format**, not legacy JWTs. The env var names in `.env.local` retain the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` convention from the original spec, but the values are new-format. `@supabase/supabase-js@2.105+` accepts both formats. Don't be surprised that the values don't look like JWTs.

- **DB password contains URL sub-delim characters** (`,` and `*`). It's URL-encoded as `%2C` and `%2A` inside both `DATABASE_URL` and `DIRECT_URL` so Prisma's URL parser doesn't choke. If you regenerate the password and it contains other reserved characters (`+`, `&`, `?`, `#`, `/`, `@`, `:`, space), URL-encode them too. The raw password roundtrips correctly server-side.

- **Currency is stored as integer paise**, not rupees-with-decimals. `₹1,234.56` ↔ `123456` paise. Display formatters convert at the UI layer only. Never store, sum, or arithmetic-on currency as a float anywhere.

- **Status is derived, not stored.** Don't add a `status` column to `Sale` or `Purchase`. See `CLAUDE.md` §5 for the full rationale and the TypeScript string-literal union pattern.

- **Schema change workflow.** When adding or modifying a Prisma model:
  1. Edit `prisma/schema.prisma`
  2. `npx prisma migrate dev --name <description>` — applies the migration to the DB via `DIRECT_URL`
  3. `npm run prisma:generate` — Prisma 7 doesn't auto-regenerate after `migrate dev`; this also writes the `src/generated/prisma/index.ts` barrel
  4. **Restart the dev server** — `src/lib/prisma.ts` caches the `PrismaClient` instance in `globalThis.prisma` to prevent connection exhaustion under HMR. New models will be `undefined` on the running singleton until the process restarts (`prisma.customer` would throw `Cannot read properties of undefined (reading 'findMany')`). Discovered Phase 2.1 Task 7.

  Fresh clones get steps 3 + 1-via-`migrate deploy` from the `postinstall` hook in `package.json` — but during active development, all four steps are manual.

- **Build-cache cousins — `rm -rf .next/` is the universal first-aid kit when "I changed something and the dev server is still serving stale behavior."** Turbopack's compiled chunks under `.next/` can pin to a build's view of env-dependent module evaluation, CSS token resolution, or generated-client shape. Symptoms seen across phases:
  - **Phase 1.6 Task 5:** Tailwind CSS chunk served stale `--spacing-md` mapping after `globals.css` edits; HMR didn't pick up the change. Fix: `.next/` nuke + cold restart.
  - **Phase 2.1 Task 7:** Prisma client singleton (`globalForPrisma.prisma`) was instantiated before a new model was added; even after dev-server restart, the new model was `undefined`. Fix: `.next/` nuke + cold restart.
  - **Phase 2.1 credential rotation Task B:** Prisma reported `Authentication failed against the database server` after a verified-correct DB password change. Direct `pg` driver test with the same `DATABASE_URL` succeeded; only the dev server's Prisma adapter failed. Fix: `.next/` nuke + cold restart.

  **First diagnostic step** when a change to env vars, `globals.css`, `schema.prisma`, or any generated code doesn't take effect after a normal dev-server restart: stop the dev process, `rm -rf .next/`, restart. Saves hours over speculative debugging. The cost is a one-time recompile (~5 sec).

- **Postgres `anon` and `authenticated` roles have no privileges on the `public` schema.** New tables don't need RLS policies for security (the only roles that can access them are `postgres` / `service_role`, both of which `BYPASSRLS`). Adding RLS as defense-in-depth is fine. If you see "RLS disabled" advisories from Supabase, **the threat is mitigated by the grant revocation** — see decision lineage. Schema-level USAGE remains for the two roles (inherited from the `PUBLIC` role) but is harmless without table grants.

- **Prisma client output lives at `src/generated/prisma/` (gitignored).** The directory is regenerated by `npm run prisma:generate`. Never edit files inside it directly. Importing pattern: `import { prisma } from '@/lib/prisma'` for the singleton; `import { PrismaClient, Prisma, $Enums } from '@/generated/prisma'` for type imports.

- **First-time setup after `git clone`.** Required steps before the dev server is useful: (1) `npm install` (runs `postinstall` → `prisma generate` → barrel write automatically); (2) populate `.env.local` from `.env.example` — values come from Supabase dashboard + a fresh `openssl rand -base64 32` for `AUTH_SECRET` + a chosen `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (12+ chars); (3) `npx prisma migrate deploy` to apply existing migrations to your DB; (4) `npx prisma db seed` to create the admin user; (5) `npm run dev` to start the server; (6) sign in at `/auth/login` with the seeded credentials. Skipping step 4 means there's no user to log in as.

- **JWT sessions — no DB session table.** Auth.js is configured with `session: { strategy: 'jwt', maxAge: 30 days }`. Sessions are stateless JWE cookies signed/encrypted with `AUTH_SECRET`. There is no `sessions` table in the DB and no `@auth/prisma-adapter` involvement (despite the package being installed — it's available for a future switch but not wired up). To invalidate all sessions globally (e.g. after a security incident), **rotate `AUTH_SECRET` in `.env.local`**. Every existing cookie becomes undecryptable; everyone is forced to re-authenticate.

- **Heading fonts cascade from `@layer base`, not from per-element classes.** All `h1`–`h6` elements automatically use Geist via `html, body { font-family: var(--font-sans); }` + `h1, h2, h3, h4, h5, h6 { font-family: var(--font-display); }` in `src/app/globals.css`. **Don't add `font-display` to heading elements** — it's redundant and creates inconsistent patterns across pages. Only use `font-display` on **non-heading** elements that should look like headings (e.g. the dashboard card's stat number uses `font-display text-2xl font-semibold` on a `<p>` because `<p>` defaults to Inter).

- **Tables with Prisma `@updatedAt` — direct-SQL `UPDATE`s via Supabase MCP must set `"updatedAt" = NOW()` explicitly.** Prisma's `@updatedAt` is application-managed (the Prisma client sets the column on every update call), NOT a DB trigger. All app code goes through Prisma and inherits this automatically — but ad-hoc `UPDATE` statements run through the Supabase MCP `execute_sql` tool (for debugging, manual restores, role flips, etc.) won't touch `updatedAt` unless you include it: `UPDATE users SET role = 'STAFF', "updatedAt" = NOW() WHERE id = '…'`. The column has a NOT NULL constraint, so omitting it on an `UPDATE` will be silent unless you've cleared it, in which case the statement fails.

- **Per-entity folder convention.** Each CRUD entity (Customers built in Phase 2.1; Suppliers, Employees, Sales, Purchases follow) lives under `src/app/(app)/<entity>/` with this fixed layout:
  - `page.tsx` — server component, queries the entity list, embeds the client table
  - `schema.ts` — zod validation, **plain TS, no `'use server'` directive** (see decision lineage for why)
  - `actions.ts` — `'use server'`, imports the schema, exports `create<Entity>` / `update<Entity>` / `softDelete<Entity>`
  - `<entity>-table.tsx` — client component, TanStack Table v8, search + sort + zebra striping + Edit/Delete row actions
  - `<entity>-form-modal.tsx` — client component, RHF + zodResolver with the triple-generic pattern; one component serves both add and edit (mode toggled by `customer` prop)
  - `<entity>-detail-modal.tsx` — client component, read-only view with Edit/Delete footer (Delete shows inline confirmation, no second-modal layer)

  Soft delete is mandatory: every entity that touches business data gets a nullable `deletedAt` column + an index on it. List queries filter `where: { deletedAt: null }`. Restore is via direct DB UPDATE (see deferred items).

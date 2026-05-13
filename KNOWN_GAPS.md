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

## Deferred items

Work intentionally not done, with revisit triggers.

- **`@hono/node-server <1.19.13` middleware bypass via repeated slashes** *(moderate, GHSA-92pp-h63x-v22m)*. Pulled transitively by `@prisma/dev → prisma`. `npm audit fix --force` would downgrade Prisma to 6.19.3 (breaking). Dev-time-only attack surface. **Revisit on next Prisma major bump** (post-7.x) — should drop automatically.

- **`postcss <8.5.10` XSS in CSS stringify** *(moderate, GHSA-qx2v-qp2m-jg93)*. Pulled transitively by `next`. Fix would downgrade `next` to 9.3.3 (massive breaking change). Build-time-only attack surface for our internal app. **Revisit on next Next.js major bump** (post-16.x) — should drop automatically.

- **Prisma + Supabase PgBouncer compatibility flag not yet applied.** Supabase's transaction pooler (port 6543) uses PgBouncer in transaction mode, which doesn't support prepared statements. Prisma needs `?pgbouncer=true&connection_limit=1` appended to **`DATABASE_URL` only** — NOT `DIRECT_URL` (which uses the session pooler on port 5432 and supports prepared statements natively). **Apply when Prisma is wired up** (Phase 1 wrap-up or Phase 2). Without this, Prisma queries will intermittently fail with prepared-statement errors against the pooler.

- **Supabase Agent Skills package (`supabase/agent-skills`) not installed.** Deferred to avoid pulling Claude Code toward Supabase-native patterns (Edge Functions, RLS-first design, Supabase CLI migrations) when we've committed to Prisma + Postgres patterns instead. The Supabase MCP server alone provides enough context for read/write operations. **Revisit if MCP-only context proves insufficient** during database phases (Phase 2+).

- **Credential rotation deferred.** The Supabase `sb_secret_…` (service role), `sb_publishable_…` (anon), and DB master password were exposed in a logged chat transcript during Phase 1 setup. The legacy JWT keys for the same project are also valid until the JWT secret is rotated. No production data exists yet, so the leak surface is low. **Revisit before Phase 2 (master data)** when real customer/transaction data begins landing in the database. Rotation steps: Supabase dashboard → Settings → Database → Reset password (regenerates pooler URLs); → Settings → API → Rotate JWT secret (invalidates exposed JWTs and `sb_*` keys); update `.env.local` with new values; restart dev server / redeploy.

## Onboarding notes for future contributors

Things that aren't gaps but trip up new sessions.

- **MCP authentication is per-developer.** `.mcp.json` at project root declares the Supabase MCP server, but OAuth tokens are stored in each developer's local Claude Code state — not in the repo. A new session in this folder must run `claude /mcp` in a regular terminal (outside the IDE), select `supabase`, and complete OAuth before MCP tools work. The `.mcp.json` file itself is committed; tokens are not.

- **Dev server default port may be 3001, not 3000.** If another long-running node process holds port 3000, `next dev` falls back to 3001 with a `⚠ Port 3000 is in use` warning. Check the dev.log / terminal output for the actual port before opening the browser. To free port 3000: `Get-Process node` (Windows) or `lsof -i :3000` (mac/linux) → identify the holder → kill it if it's a stale dev server.

- **Tailwind v4 — theme tokens live in `src/app/globals.css`, NOT in a JS config file.** Don't go looking for `tailwind.config.ts` — it doesn't exist. All color/font/radius tokens are defined in the `@theme { … }` block inside `globals.css`. If you need to add a new color or change a token, edit `globals.css`. The `@theme` directive auto-generates Tailwind utility classes (`bg-surface-container`, `text-on-primary`, etc.) and CSS custom properties (`var(--color-surface)`) from the declarations.

- **Supabase keys use the new `sb_publishable_…` / `sb_secret_…` format**, not legacy JWTs. The env var names in `.env.local` retain the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` convention from the original spec, but the values are new-format. `@supabase/supabase-js@2.105+` accepts both formats. Don't be surprised that the values don't look like JWTs.

- **DB password contains URL sub-delim characters** (`,` and `*`). It's URL-encoded as `%2C` and `%2A` inside both `DATABASE_URL` and `DIRECT_URL` so Prisma's URL parser doesn't choke. If you regenerate the password and it contains other reserved characters (`+`, `&`, `?`, `#`, `/`, `@`, `:`, space), URL-encode them too. The raw password roundtrips correctly server-side.

- **Currency is stored as integer paise**, not rupees-with-decimals. `₹1,234.56` ↔ `123456` paise. Display formatters convert at the UI layer only. Never store, sum, or arithmetic-on currency as a float anywhere.

- **Status is derived, not stored.** Don't add a `status` column to `Sale` or `Purchase`. See `CLAUDE.md` §5 for the full rationale and the TypeScript string-literal union pattern.

@AGENTS.md

# Shree Creation — Project Context

## 1. Project Overview

Internal web app for **Shree Creation**, a small imitation-jewelry manufacturing company in Mumbai. The app tracks the full transaction lifecycle: sales, purchases, returns, payments, fixed-salary employees, per-piece karigar (artisan) ledger, and receipt scans.

- **Scale:** ~100 transactions/month, 1–3 concurrent users (owner + accountant).
- **Tenancy:** single-org, single-tenant. Internal use only — no public-facing pages.
- **Package slug:** `shree-creation` (in `package.json`).
- **UI display name:** **"Shree Creation"** — use this for page titles, navigation, login screens, emails.

## 2. Tech Stack

- **Framework:** Next.js 16 with App Router, TypeScript (strict mode)
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix-based, preset `radix-nova` — visual tokens fully overridden in `globals.css`)
- **Database:** Supabase Postgres (Mumbai, `ap-south-1`)
- **ORM:** Prisma 7 — singleton at `src/lib/prisma.ts` (`import { prisma } from '@/lib/prisma'`). Connects via `@prisma/adapter-pg` using `DATABASE_URL` (transaction pooler + `?pgbouncer=true&connection_limit=1`). Migrations / CLI use `DIRECT_URL` via `prisma.config.ts` (NOT `schema.prisma` — Prisma 7 moved connection URLs out of the schema). Client is generated into `src/generated/prisma/` (gitignored); regenerate with `npm run prisma:generate` after schema changes.
- **Auth:** Auth.js v5 beta with Credentials provider, **JWT strategy** (no session table — sessions are stateless JWE cookies, 30-day expiry), **bcrypt** password hashing (cost 12), `Role` enum (`ADMIN | STAFF`) in Prisma schema. Auth.js entry point: `src/lib/auth.ts` exporting `{ auth, handlers, signIn, signOut }`. Route protection lives in `src/proxy.ts` (Next.js 16 — see KNOWN_GAPS.md, was previously called `middleware.ts`).
- **Tables/grids:** TanStack Table v8
- **Charts:** Recharts
- **Excel:** ExcelJS for both export and import
- **File storage:** Supabase Storage (receipt uploads — Phase 3+)
- **Hosting:** Vercel
- **Package manager:** npm

> ⚠ This version of Next.js has breaking changes from older releases. Read `node_modules/next/dist/docs/` before writing routing or data-fetching code. Heed deprecation notices. (Reinforced by `@AGENTS.md` above.)

## 3. Design System

**"Techno-artisanal"** — high-end jewelry meets industrial precision. **Dark mode only** (no light theme).

### Color tokens (defined in `src/app/globals.css` via Tailwind v4 `@theme`)

| Purpose | Token (Tailwind class) | Hex |
|---|---|---|
| Background / surface | `bg-surface` | `#0b1326` (deep navy) |
| Surface containers | `bg-surface-container-low` / `bg-surface-container` / `…-high` / `…-highest` | `#131b2e` / `#171f33` / `#222a3d` / `#2d3449` |
| Primary (gold) | `bg-primary`, `text-on-primary` | `#f2ca50` / `#3c2f00` |
| Secondary (electric blue) | `bg-secondary` / `bg-secondary-container` | `#adc6ff` / `#0566d9` |
| Text primary | `text-on-surface` | `#dae2fd` |
| Text muted | `text-on-surface-variant` | `#d0c5af` |
| Border / outline | `border-outline-variant` | `#4d4635` (warm dark tan) |
| Status error | `bg-error`, `text-on-error` | `#ffb4ab` / `#690005` |

Full palette in `globals.css` includes Surfaces (10), Text (5), Borders (2), Primary (5), Secondary (4), Tertiary (4), Status (4), Fixed variants (12).

### Typography

- **Headings:** Geist (`font-display`), weights 400/500/600 — loaded via `next/font/google`
- **Body:** Inter (`font-sans`), weights 400/500 — default on `<body>`
- **Tabular / numeric data:** Geist (`font-mono`) — kept consistent with headings, sharp and geometric

### Rules (apply everywhere)

- **Sharp 0px corners** on every primary container, button, input, card. All `--radius-*` tokens are `0px`. Do NOT round corners — this is core to the aesthetic. Exception: `rounded-full` (9999px) is preserved for status-chip dots only.
- **1px borders for depth**, not drop shadows. Use `border border-outline-variant`.
- **No drop shadows.** Tonal layering (`bg-surface-container-low` ↔ `bg-surface-container-high`) replaces shadow for elevation.
- **Zebra-stripe data tables** by default — alternate row backgrounds with `bg-surface-container-low` and `bg-surface-container`.
- **Status chips** = small uppercase label with a leading colored dot. Sharp corners on the chip; the dot uses `rounded-full`. Color the dot per status (gold/electric-blue/error etc.) — text stays `text-on-surface`.

### Component conventions

- shadcn components inherit the palette via compat aliases in `globals.css` (`--color-foreground`, `--color-card`, `--color-primary-foreground`, `--color-muted`, etc.). Don't pass color classes to shadcn primitives — let them resolve through tokens.
- For one-off colors, use Tailwind utilities (`bg-primary`, `text-on-surface-variant`, `border-outline-variant`) — never inline hex codes in components.

## 4. Data Model

All currency is stored as integer **paise** (1 ₹ = 100 paise). Display formatters render with Indian comma grouping (`₹1,23,456.00`). Dates are `timestamptz` in UTC; display converts to `Asia/Kolkata`.

### Customer (built Phase 2.1) / Supplier (built Phase 2.2)
`id, name, phone, email, address, notes, createdAt, updatedAt, deletedAt`

- **Soft delete via `deletedAt`** (nullable). List queries filter `where: { deletedAt: null }`. Deleted rows preserve history; restoring is via direct DB UPDATE (no UI yet — see KNOWN_GAPS).
- **No uniqueness on `email` or `phone`.** Real entry produces dupes (typos, alternate spellings); we surface them via party-autocomplete in Phase 3, not by hard-rejecting them at insert.
- **Indexes:** `@@index([deletedAt])` for fast list filtering, `@@index([name])` for search.
- **"Regulars only."** Master tables hold customers/suppliers you transact with repeatedly. Walk-in / one-time parties are handled directly on Sale and Purchase rows via the dual-path party model (existing customer FK OR free-text `partyName` + `partyPhone`). See KNOWN_GAPS.md decision lineage.

### Employee
`id, name, phone, type (FIXED | LABOUR), monthly_salary (nullable), notes, created_at`

- `FIXED` — monthly-salary employees (accountant, helper)
- `LABOUR` — per-piece karigars (artisans paid by piece)

### Sale
`id, date, customer_id, item_description, qty, rate, discount, total, receipt_url, created_at`

Derived (computed at query time, **not stored**):
- `effective_total = total − sum(SaleReturn.total)`
- `paid_amount = sum(SalePayment.amount where type=PAYMENT) − sum(where type=REFUND)`
- `balance = effective_total − paid_amount`
- `status` (computed): `pending` | `partial` | `completed` | `refund_due`

### SalePayment
`id, sale_id, date, amount, type (PAYMENT | REFUND), note, created_at`

### SaleReturn
`id, sale_id, date, item_description, qty_returned, rate, discount, total, reason, receipt_url, created_at`

### Purchase / PurchasePayment / PurchaseReturn
Mirror Sale exactly — same fields, same derived columns, same status logic. Joined to `Supplier` instead of `Customer`.

### WorkEntry  (debit on karigar's balance)
`id, employee_id, date, description, pieces, rate_per_piece, total, created_at`

### WorkPayment  (credit on karigar's balance — NOT tied to a specific WorkEntry)
`id, employee_id, date, amount, note, created_at`

### WorkReversal  (credit — defective work charged back)
`id, work_entry_id, date, pieces_reversed, total, reason, created_at`

Karigar balance (computed): `sum(WorkEntry.total) − sum(WorkPayment.amount) − sum(WorkReversal.total)`

### FixedSalary
`id, employee_id, month (YYYY-MM), attendance_days, salary, advances, deductions, net_payable, paid (boolean), paid_date, created_at`

## 5. Status Logic

**Statuses are derived, never stored.** Computed at query time from the payment / return children.

For a Sale or Purchase:
1. Sum `*Payment.amount` where `type=PAYMENT`, subtract `type=REFUND` → `paid_amount`
2. Sum `*Return.total` → returns subtract from `effective_total`
3. Compute `balance = effective_total − paid_amount`
4. Map to label:
   - `pending` — no payments yet, `balance = effective_total`
   - `partial` — `paid_amount > 0` and `balance > 0`
   - `completed` — `balance = 0`
   - `refund_due` — `balance < 0` (overpaid or refund pending after returns)

The **"Completed transactions"** view (Phase 5) is just a filter where `balance = 0` across Sales and Purchases.

Karigar balance follows the same pattern — derived from `WorkEntry` (debits), `WorkPayment` (credits), `WorkReversal` (credits for defective work).

**Why derived:** lets returns and refunds amend history without manual status syncing. Source of truth is the payment children.

> **Type-level note for Phase 2 codegen.** The four computed states (`pending` | `partial` | `completed` | `refund_due`) are **TypeScript string-literal union types** computed at the API / UI layer — they are NOT Prisma database enums. The database stores only the underlying numeric fields (`Sale.total`, `SalePayment.amount`, `SaleReturn.total`, etc.); the status label is derived on read by the layer that returns rows to the client. Do not create a Prisma `enum Status { … }` or a `status` column on `Sale`/`Purchase`. Define the union as `type SaleStatus = 'pending' | 'partial' | 'completed' | 'refund_due'` in a shared `types.ts` and compute it in the query / serializer.

## 6. Conventions

- **TypeScript strict mode.** No `any`. Use `unknown` for genuinely unknown shapes and narrow with zod.
- **Server components by default.** Add `'use client'` only when a component needs interactivity, hooks, or browser APIs.
- **All forms = react-hook-form + zod.** Define the schema in a `schema.ts` next to the route; bind with `zodResolver(schema)`.
- **Per-entity scaffolding (Customers / Suppliers / Employees / Sales / Purchases):** use the folder structure documented in `KNOWN_GAPS.md` onboarding notes. Schemas live in `schema.ts` separate from `'use server'` files (Next.js compiles non-function exports from server-action files into client-reference stubs, which breaks Zod). Forms use the RHF triple-generic pattern `useForm<FormInput, unknown, FormOutput>` when the schema has transforms.
- **Currency = paise (integer) at every layer below the UI.** Display formatters live in `src/lib/format.ts`. Never multiply/divide currency in components — call `formatCurrency(paise)` for display.
- **Dates: store UTC, display `Asia/Kolkata`.** Format helpers in the same `src/lib/format.ts`: `formatDate(value)` for date-only display, `formatDateTime(value)` for date+time.
- **File naming:** kebab-case for files, PascalCase for component exports. Schema files: `schema.ts`. Action files: `actions.ts`. Page: `page.tsx`. Layout: `layout.tsx`.
- **API surface:** prefer **Server Actions** for mutations. Use route handlers (`/api/…`) only for webhooks, file downloads (Excel exports), and Auth.js callbacks.
- **Session access:** server components fetch the session via `await auth()` imported from `@/lib/auth`. Client components use `useSession()` from `next-auth/react` **only when reactivity is needed** (e.g. UI that updates as the session changes); prefer passing user data down as props from server components.
- **Path alias:** `@/*` → `src/*`. No relative `../../` imports across feature boundaries.

## 7. Phase Plan

1. **Foundation** — Next.js + Tailwind + Prisma + Auth + base shell  *(current phase)*
2. **Master data** — Customers, Suppliers, Employees CRUD
3. **Purchases** — entry, listing, payments, returns
4. **Sales** — entry, listing, payments, returns
5. **Completed transactions** — unified view of `balance = 0` records across sales + purchases
6. **Employees** — fixed-salary monthly tracking + karigar ledger (per-piece)
7. **Dashboard** — summary cards + monthly line graphs

## 8. Out of Scope (do not build)

- GST / tax calculation logic
- Multi-tenant / multi-org support
- Mobile app (responsive web is enough for now)
- Email notifications (transactional or marketing)
- Public-facing pages (landing, marketing, blog)
- Accounting integrations (Tally, Zoho Books)
- Inventory tracking (separate concern, deferred)

---

## Known gaps and deferred decisions

See [`KNOWN_GAPS.md`](./KNOWN_GAPS.md) at project root for the running list of deferred items, security debt, and decision lineage. Read it before starting a new phase — it flags items that need attention at known milestones (e.g. credential rotation before Phase 2, Prisma+PgBouncer compatibility flag when wiring Prisma).

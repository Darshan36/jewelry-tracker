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
- **Testing:** Vitest + `@testing-library/react` + `vitest-mock-extended`, `jsdom` environment, mocked Prisma. No e2e tests yet (Playwright deferred to Phase 8). Test conventions in `docs/TESTING.md`.

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

- **Two separate DB tables (`customers`, `suppliers`) sharing the same schema.** Kept apart so Sales (Phase 3) can FK to `Customer` and Purchases (Phase 4) can FK to `Supplier` without cross-pollution. The Prisma models, zod schemas, server actions, table component, and modals are near-identical clones — Phase 2.2.5 will extract the genuinely-shared bits (`requireSession()`, the `<Field>` label-value component, form-input class constants) without forcing a generic "master-data entity" abstraction.
- **Soft delete via `deletedAt`** (nullable). List queries filter `where: { deletedAt: null }`. Deleted rows preserve history; restoring is via direct DB UPDATE (no UI yet — see KNOWN_GAPS).
- **No uniqueness on `email` or `phone`.** Real entry produces dupes (typos, alternate spellings); we surface them via party-autocomplete in Phase 3, not by hard-rejecting them at insert.
- **Indexes:** `@@index([deletedAt])` for fast list filtering, `@@index([name])` for search.
- **"Regulars only."** Master tables hold customers/suppliers you transact with repeatedly. Walk-in / one-time parties are handled directly on Sale and Purchase rows via the dual-path party model (existing customer FK OR free-text `partyName` + `partyPhone`). See KNOWN_GAPS.md decision lineage.

### Employee (built Phase 2.3)
`id, name, phone, type (FIXED | LABOUR), monthlySalary (BigInt paise, nullable), address, notes, createdAt, updatedAt, deletedAt`

- `FIXED` — monthly-salary employees (accountant, helper). `monthlySalary` may be set (paise).
- `LABOUR` — per-piece karigars (artisans paid by piece). `monthlySalary` must be `null` (enforced by zod `.superRefine` — see `src/app/(app)/employees/schema.ts`).
- **Conditional schema:** if `type = LABOUR` and `monthlySalary !== null`, validation fails with "Monthly salary applies only to fixed-salary employees." Switching `FIXED → LABOUR` on the edit form clears the salary field (a `useEffect` on the watched type).
- **Currency pipeline:** stored as `BigInt?` in Prisma for paise-precision integer math; serialized to `Number` at the action's return because JSON cannot encode BigInt; displayed via `formatCurrency(paise)` from `src/lib/format.ts`. Form inputs accept rupees as `number`; conversion to BigInt paise happens in the action's `toPrismaData()` helper at the Prisma boundary (NOT in the zod schema — see KNOWN_GAPS decision lineage for the wire-format reason).
- Soft delete via `deletedAt` (matches Customer / Supplier convention).
- **Indexes:** `@@index([deletedAt])`, `@@index([name])`, `@@index([type])` (the third supports the FIXED / LABOUR / ALL filter pills on the list page).

### Sale (built Phase 3.1)
`id, date, customerId (FK → Customer, nullable, onDelete: SetNull), partyName, partyPhone, itemDescription, qty, rate (BigInt paise), discount (BigInt paise, @default(0)), total (BigInt paise, stored), notes, createdAt, updatedAt, deletedAt`

- **Dual-path party model.** Each sale either links to a `Customer` (FK `customerId` set; `partyName`/`partyPhone` are server-side snapshots of `Customer.name`/`Customer.phone` at sale time) OR is a walk-in (`customerId` null; the two strings are the only identity). Snapshot pattern preserves historical sale display correctness regardless of later customer rename or soft-delete. `onDelete: SetNull` is defensive — if a customer is ever hard-deleted, sales lose only the link, not their party data. See KNOWN_GAPS.md decision lineage.
- **Date is date-only.** Stored as DateTime in Prisma (midnight UTC by convention); rendered via `formatDate` (not `formatDateTime`). Form input is `<input type="date">` emitting "YYYY-MM-DD"; the schema's `z.coerce.date()` accepts both that string and Date instances (symmetric wire format).
- **`total` is stored, not derived.** Computed at write time in the action's `buildSaleData()` helper as `BigInt(qty) × ratePaise − discountPaise` and persisted on the row. Trade-off vs. computing on read: enables straightforward `SUM(total)` aggregates AND preserves audit history (if discount logic ever changes, historical totals don't shift). Must be recomputed on every `updateSale`. See KNOWN_GAPS.md decision lineage.
- **`status` is derived on read.** Computed by `computeSaleStatus(sale)` in `src/lib/sale-status.ts` and attached by `serializeSale()` before the row reaches the client. Phase 3.1 always returns `'pending'` (no payments/returns yet); Phase 3.2/3.3 plug into the same function's forward-compatible signature. See §5.
- **Currency pipeline** identical to Employee — schema validates rupees as `z.number().nonnegative()`, action's `buildSaleData()` converts to BigInt paise at the Prisma boundary, `serializeSale()` converts back to Number at the action return for JSON safety. Three BigInt columns per sale (`rate`, `discount`, `total`).
- Soft delete via `deletedAt`; list queries filter `where: { deletedAt: null }`.
- **Indexes:** `@@index([deletedAt])`, `@@index([date])` (for chronological queries), `@@index([customerId])` (for per-customer history).

### SalePayment (built Phase 3.2)
`id, saleId (FK → Sale, onDelete: Cascade), date, amount (BigInt paise), note, createdAt, updatedAt, deletedAt`

- **Per-payment audit trail.** Child table — one row per payment event. `paidAmount` is derived live via `SUM(amount) WHERE deletedAt IS NULL` aggregated per sale. No cached column on `Sale` (rejected to avoid drift risk; the aggregation is cheap at ~100 sales/month with single-digit payments each).
- **Payments are immutable.** No `updateSalePayment` action exists — wrong payment is corrected by soft-deleting the bad entry and creating a new correct one. Both events stay in the history list; the soft-deleted one is filtered out of the aggregation. Preserves audit trail at the cost of slightly more UI work for corrections.
- **Currency pipeline** identical to Sale/Employee — `amount` is `BigInt` paise in Prisma, `serializeSalePayment()` converts to `Number` at the action return for client JSON safety.
- **`onDelete: Cascade`** on the Sale FK is defensive — if a sale is ever hard-deleted (currently soft-only), its payment children go too. Soft-delete of a sale doesn't trigger cascade (`deletedAt` filter in queries, not actual delete).
- **Overpayment blocked at action layer.** `createSalePayment` rejects if `amount > total − sum(active payments)` with `errors.amount = ["Exceeds remaining balance. Outstanding: ₹X"]` — formatted outstanding helps the user identify intent (data error vs. customer-overpaid-and-refund-owed, the latter being a Phase 3.3 return-driven concern).
- **Indexes:** `@@index([saleId])` for aggregation queries, `@@index([deletedAt])` for soft-delete filtering.

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

**Forward-compatible helper signature.** `computeSaleStatus(sale)` lives at `src/lib/sale-status.ts` and accepts `{ total: bigint, paidAmount?: bigint, returnTotal?: bigint }`. **Phase 3.2 active:** payment-aware computation now plugs `paidAmount` in via `serializeSale()` — `SUM(SalePayment.amount WHERE deletedAt IS NULL)` per sale, fetched in `page.tsx` via `include: { payments: { where: { deletedAt: null } } }`. Status thresholds active: `paidAmount === 0n → pending`, `0n < paidAmount < total → partial`, `paidAmount >= total → completed` (the action layer blocks overpayment so `> total` only happens transiently via payment soft-deletes). **Phase 3.3 pending:** will populate `returnTotal` from `SUM(SaleReturn.total)` to activate the `refund_due` branch (fires when `(total − returnTotal) − paidAmount < 0` — return-driven only, never payment-driven, since overpayment is action-blocked). The signature is the forward-compatibility contract — phase additions populate more arguments without breaking the API. `serializeSale()` is the single place that calls `computeSaleStatus`, so when the aggregates land they're computed once per row and attached to the client-facing `SaleForClient` shape.

> **Type-level note for Phase 2 codegen.** The four computed states (`pending` | `partial` | `completed` | `refund_due`) are **TypeScript string-literal union types** computed at the API / UI layer — they are NOT Prisma database enums. The database stores only the underlying numeric fields (`Sale.total`, `SalePayment.amount`, `SaleReturn.total`, etc.); the status label is derived on read by the layer that returns rows to the client. Do not create a Prisma `enum Status { … }` or a `status` column on `Sale`/`Purchase`. Define the union as `type SaleStatus = 'pending' | 'partial' | 'completed' | 'refund_due'` in a shared `types.ts` and compute it in the query / serializer.

## 6. Conventions

- **TypeScript strict mode.** No `any`. Use `unknown` for genuinely unknown shapes and narrow with zod.
- **Server components by default.** Add `'use client'` only when a component needs interactivity, hooks, or browser APIs.
- **All forms = react-hook-form + zod.** Define the schema in a `schema.ts` next to the route; bind with `zodResolver(schema)`.
- **Per-entity scaffolding (Customers / Suppliers / Employees / Sales / Purchases):** use the folder structure documented in `KNOWN_GAPS.md` onboarding notes. Schemas live in `schema.ts` separate from `'use server'` files (Next.js compiles non-function exports from server-action files into client-reference stubs, which breaks Zod). Forms use the RHF triple-generic pattern `useForm<FormInput, unknown, FormOutput>` when the schema has transforms.
- **Every new feature ships with tests.** Schemas → schema tests covering validation + transforms. Server actions → action tests with mocked Prisma + `auth-guards` + `next/cache`. Interactive components → component tests with RTL + mocked navigation + mocked actions. Don't test third-party library internals or pure styling. See `docs/TESTING.md` for the canonical patterns. Per-entity test scaffolding (one `schema.test.ts`, one `actions.test.ts`, one table component test) is mandatory from Phase 2.3 onward.
- **Currency = paise (integer) at every layer below the UI.** Stored as `BigInt?` in Prisma (paise-precision integer math, safe even for large amounts); serialized to `Number` at the server-action boundary because JSON cannot encode BigInt; displayed via `formatCurrency(paise)` from `src/lib/format.ts`. Form inputs accept rupees as `number`; the zod schema keeps that shape, and the action's `toPrismaData()` helper converts rupees → BigInt paise at the Prisma boundary (NOT in the schema's `.transform()` — that would mismatch the client-send / server-re-parse wire format). Never multiply/divide currency as float in components. Pattern established in Phase 2.3 (`Employee.monthlySalary`); reused for every monetary field in Phase 3+.
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

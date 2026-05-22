@AGENTS.md

# Shree Creation — Project Context

Lean working doc. For phase-by-phase milestone history, superseded designs, and detailed decision lineage, see [`docs/CLAUDE_ARCHIVE.md`](./docs/CLAUDE_ARCHIVE.md) (reference-only, not auto-loaded at phase start).

## 1. Project Overview

Internal web app for **Shree Creation**, a small imitation-jewelry manufacturing company in Mumbai. The app tracks the full transaction lifecycle: sales, purchases, returns, payments, fixed-salary employees, per-piece karigar (artisan) ledger, and receipt scans.

- **Scale:** ~100 transactions/month, 1–3 concurrent users (owner + accountant).
- **Tenancy:** single-org, single-tenant. Internal use only — no public-facing pages.
- **Package slug:** `shree-creation` (in `package.json`).
- **UI display name:** **"Shree Creation"** — use this for page titles, navigation, login screens, emails.

## 2. Tech Stack

- **Framework:** Next.js 16 with App Router, TypeScript (strict mode). Route protection in `src/proxy.ts` (Next.js 16 — was `middleware.ts`).
- **Styling:** Tailwind CSS v4 + shadcn/ui (preset `radix-nova` — visual tokens overridden in `globals.css`). Visual language is **"techno-artisanal LIGHT"**: see §3.
- **Database:** Supabase Postgres (Mumbai, `ap-south-1`).
- **ORM:** Prisma 7 — singleton at `src/lib/prisma.ts` (`import { prisma } from '@/lib/prisma'`). Connects via `@prisma/adapter-pg` using `DATABASE_URL` (transaction pooler + `?pgbouncer=true&connection_limit=1`). Migrations / CLI use `DIRECT_URL` via `prisma.config.ts` (NOT `schema.prisma` — Prisma 7 moved connection URLs out of the schema). Client generated into `src/generated/prisma/` (gitignored); regenerate with `npm run prisma:generate` after schema changes.
- **Auth:** Auth.js v5 beta with Credentials provider, **JWT strategy** (stateless JWE cookies, 30-day expiry), **bcryptjs** cost 12, `Role` enum (`ADMIN | PURCHASE_DEPT | LABOUR_MGMT | CASTING_PLATING_MGMT`) in Prisma schema. Entry point: `src/lib/auth.ts` exporting `{ auth, handlers, signIn, signOut }`. The Credentials provider's `authorize` callback delegates to `src/lib/authorize-credentials.ts` so unit tests can pin deactivation/bcrypt/null branches. **Active-status gate**: `authorize` rejects users whose `deletedAt IS NOT NULL` BEFORE bcrypt — a deactivated user with the correct password fails.
- **RBAC:** Three-layer access on every gated route — (1) `src/proxy.ts` URL-prefix `ROUTE_ROLES`; (2) page server-component redirect via `canX(role)` helpers in `src/lib/role-access.ts`; (3) every server action calls `await requireRole([...allowedRoles])` as its first await. Per-role sidebar filtering in `src/app/(app)/sidebar.tsx`. `requireRole` throws `Unauthorized` (no session) or `Forbidden` (wrong role); both halt before any DB work.
- **Tables/grids:** TanStack Table v8.
- **Charts:** Recharts.
- **Excel:** ExcelJS for both export and import.
- **File storage:** Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Lazy-init wrapper at `src/lib/r2.ts` (Proxy pattern; env read on first call, not at module load). Browser uploads directly to R2 via 10-min presigned PUT URLs (two-step prepare/confirm flow — see §6); server-side downloads issue 1-hr presigned GET URLs.
- **Hosting:** Vercel; production fed from `main` (Fluid Compute, region `iad1`, Node 24).
- **Package manager:** npm.
- **Testing:** Vitest + `@testing-library/react` + `vitest-mock-extended`, `jsdom`, mocked Prisma. No e2e tests. Test conventions in `docs/TESTING.md`.

> ⚠ This version of Next.js has breaking changes from older releases. Read `node_modules/next/dist/docs/` before writing routing or data-fetching code. Heed deprecation notices. (Reinforced by `@AGENTS.md`.)

## 3. Design System

**Techno-artisanal LIGHT** — high-end jewelry meets industrial precision, rendered in cream/slate/gold. **Light theme only**; no theme switcher. Future dark mode would refactor token VALUES (not names) in `globals.css` since every consumer is token-aware.

### Color tokens (defined in `src/app/globals.css` via Tailwind v4 `@theme`)

| Purpose | Token (Tailwind class) | Hex |
|---|---|---|
| Background / surface | `bg-surface` | `#f5f0e6` (cream/parchment) |
| Surface containers | `bg-surface-container-low` / `bg-surface-container` / `…-high` / `…-highest` | `#f5f0e6` / `#ffffff` / `#faf7ef` / `#f0e9d4` |
| Primary (gold) | `bg-primary`, `text-on-primary` | `#c9a14a` / `#ffffff` |
| Secondary (slate-blue) | `bg-secondary` / `bg-secondary-container` | `#5a7ba6` / `#3a5a85` |
| Tertiary (neutral slate) | `bg-tertiary` | `#8a8e9a` |
| Text primary | `text-on-surface` | `#1a1f2e` (slate-900) |
| Text muted | `text-on-surface-variant` | `#525868` (slate-600) |
| Border / outline | `border-outline-variant` | `#e8e0cd` (soft cream-tan) |
| Status error | `bg-error`, `text-on-error` | `#a04848` / `#ffffff` |

Full palette in `globals.css` includes Surfaces (10), Text (5), Borders (2), Primary (5), Secondary (4), Tertiary (4), Status (4), Fixed variants (12).

### Status chip palette (pinned hexes in `transaction-status-chip.tsx`)

The four transaction-status chips are the only place in the codebase that uses **direct `bg-[#...]` literal hex values** rather than semantic tokens. Each chip uses a tinted background (`bg-[X]/10`) + matching dot (`bg-[X]`) + matching text (`text-[X]`) + tinted border (`border-[X]/30`). Hex values pinned at the chip layer so the tinted-pill semantics stay legible regardless of future surface remaps.

| Status | Hex | Meaning |
|---|---|---|
| `pending` | `#8a8e9a` / `#525868` text | neutral slate — waiting |
| `partial` | `#c9844a` | muted amber — warning, in progress |
| `completed` | `#5e8c4f` | muted green — positive, done |
| `refund_due` | `#5a7ba6` | slate-blue — info, money still in motion |

### Typography

- **Headings:** Geist (`font-display`), weights 400/500/600 — loaded via `next/font/google`.
- **Body:** Inter (`font-sans`), weights 400/500 — default on `<body>`.
- **Tabular / numeric data:** Geist (`font-mono`).

### Rules (apply everywhere)

- **Sharp 0px corners** on every primary container, button, input, card. All `--radius-*` tokens are `0px`. Do NOT round corners — core to the aesthetic. Exception: `rounded-full` (9999px) is preserved for status-chip dots only.
- **1px borders for depth**, not drop shadows. Use `border border-outline-variant`.
- **No drop shadows.** Tonal layering (`bg-surface-container-low` ↔ `bg-surface-container-high`) replaces shadow for elevation.
- **Zebra-stripe data tables** by default — alternate row backgrounds with `bg-surface-container-low` and `bg-surface-container`.
- **Status chips** = small uppercase label with a leading colored dot. Sharp corners on the chip; the dot uses `rounded-full`.
- **Components consume semantic tokens only** (`bg-surface`, `text-on-surface`, `border-outline-variant`, etc.). Never inline hex values in components. The status-chip exception above is the only place that pins hexes.
- shadcn components inherit the palette via compat aliases in `globals.css` (`--color-foreground`, `--color-card`, `--color-primary-foreground`, `--color-muted`, etc.). Don't pass color classes to shadcn primitives — let them resolve through tokens.

## 4. Data Model

All currency is stored as integer **paise** (1 ₹ = 100 paise). Display formatters render with Indian comma grouping (`₹1,23,456.00`). Dates are `timestamptz` in UTC; display converts to `Asia/Kolkata`.

### User
`id, email (unique), passwordHash, name, role (Role enum), deletedAt, createdAt, updatedAt`

- `role` required on insert (no default). Direct DB inserts must specify `role`.
- Soft delete via `deletedAt`. Deactivation = `deletedAt IS NOT NULL`. Reactivation clears it. Preserves audit-trail FK references on Party / PieceEntry / EmployeePayment / Attachment. Auth rejects deactivated users at `authorizeCredentials` BEFORE bcrypt.
- `passwordHash` is bcryptjs cost 12, generated via `src/lib/password.ts#hashPassword`. Verifier is `src/lib/authorize-credentials.ts`. Cost-12 PHC strings (`$2a$12$…` / `$2b$12$…`) are the only valid format.
- Email uniqueness across active AND deactivated users (Prisma `@unique`). To reuse the email of a former user, reactivate them OR hard-delete the row (safe only when no audit FKs reference them).
- Auth layer lowercases via `z.string().email().toLowerCase().trim()` (zod `.email()` runs BEFORE `.trim()`; surrounding whitespace rejected). The case-sensitive DB UNIQUE is effectively case-insensitive in practice.
- `UserForClient` (in `src/app/(app)/users/types.ts`) explicitly strips `passwordHash` via property-by-property destructure (not `...rest`) in `serializeUser` so future User-shape additions can't leak the hash through React Flight chunks or test snapshots.

### ShopSettings
`id, shopName, phone, address, footer, updatedAt, updatedById`

- Single-row config table for the print-bill header. Conceptually a singleton; enforced at the application layer via `findFirst` + create-or-update inside `upsertShopSettings`, NOT by a DB constraint. Reads also use `findFirst`.
- `shopName` required; `phone` / `address` / `footer` optional. Empty-string inputs normalize to `null` in the zod schema.
- `updatedById` set on every write; nullable FK to `User` (`ON DELETE SET NULL`).
- No soft delete; no audit trail beyond `updatedById` + `updatedAt`.
- `getShopSettings` is gate-free at the action layer (all callers are server-side ADMIN-gated surfaces).

### Party (replaces Customer / Supplier / CastingPlatingVendor)
`id, name, phone (unique, nullable), email, address, notes, isCustomer, isSupplier, isCastingVendor, isPlatingVendor, createdAt, updatedAt, deletedAt, createdById, updatedById, deletedById`

- Single table replaces three legacy ones. Boolean role flags — a single party can hold multiple roles; phone collision adds the flag to the existing Party rather than duplicating.
- **Phone globally unique** across the table (`@unique`). Normalized on save via `src/lib/phone.ts#normalizePhone` (idempotent).
- Walk-in auto-promotion is role-context-aware: `/sales/new` → `isCustomer`, `/purchases/new` → `isSupplier`, `/casting/new` → `isCastingVendor`, `/plating/new` → `isPlatingVendor`. Phone-lookup-or-create + sale-create + line-item-create runs inside `prisma.$transaction`.
- **Route names preserved**: `/customers`, `/suppliers`, `/vendors` each query Party filtered by the matching role flag; UI labels ("Customer", "Supplier", "Vendor") preserved.
- Soft delete via `deletedAt`. Role flags stay set on a soft-deleted party. List queries filter `where: { is<Role>: true, deletedAt: null }`. Restoring is direct DB UPDATE (no UI).
- No uniqueness on `email`.
- Audit columns (`createdById` / `updatedById` / `deletedById`) are nullable FKs to `User`.
- "Regulars only" — walk-in / one-time parties go on the transactional row's `partyName` + `partyPhone` snapshot, not as a Party row.
- Indexes: `@@unique([phone])`, `@@index([phone])`, `@@index([name])`, plus four role-aware indexes `@@index([is<Role>, deletedAt])`.

### Employee
`id, name, phone, type (FIXED | LABOUR), monthlySalary (BigInt paise, nullable), address, notes, createdAt, updatedAt, deletedAt`

- `FIXED` — monthly-salary employees (accountant, helper). `monthlySalary` may be set (paise).
- `LABOUR` — per-piece karigars. `monthlySalary` must be `null`. **No default piece-rate on the worker** — rate is entered per piece-entry because rates vary by job.
- Conditional schema: if `type = LABOUR` and `monthlySalary !== null`, validation fails. Switching `FIXED → LABOUR` on the edit form clears `monthlySalary` (a `useEffect` on the watched type).
- Currency pipeline: BigInt paise in Prisma → Number at action return → `formatCurrency(paise)` for display. Form accepts rupees; conversion to paise happens in the action's `toPrismaData()` at the Prisma boundary (NOT in the zod schema — see §6 wire-format reasoning).
- Soft delete via `deletedAt`.
- Reverse relations: `pieceEntries: PieceEntry[]`, `payments: EmployeePayment[]` (Prisma-only — FK on child side).
- Indexes: `@@index([deletedAt])`, `@@index([name])`, `@@index([type])`.

### PieceEntry
`id, employeeId (FK → Employee, RESTRICT), date, count (Int, positive), ratePerPiece (BigInt paise), totalAmount (BigInt paise, stored = count × ratePerPiece), note, createdAt, updatedAt, deletedAt, createdById/updatedById/deletedById (FKs → User, SET NULL)`

- One row = one LABOUR employee × one day × one piece count. Bulk-entry is the dominant write path.
- `date` stored as midnight-UTC representing the IST calendar day. Same UTC half-open range queries work for monthly aggregates.
- `ratePerPiece` entered per-entry (no per-worker default). Historical entries preserve their original rate.
- `totalAmount` stored, not derived (matches Sale/Purchase stored-total convention).
- Immutable corrections via soft-delete + recreate — no `updatePieceEntry`.
- `onDelete: RESTRICT` on the Employee FK prevents employee hard-delete while piece history exists.
- Indexes: `@@index([employeeId, date, deletedAt])`, `@@index([date, deletedAt])`.

### EmployeePayment
`id, employeeId (FK → Employee, RESTRICT), type (EmployeePaymentType: SALARY | WAGE), paidAt, amount (BigInt paise), periodStart, periodEnd, note, createdAt, updatedAt, deletedAt, createdById/updatedById/deletedById (FKs → User, SET NULL)`

- Unified ledger: `type=SALARY` for FIXED employees (monthly), `type=WAGE` for LABOUR (per-period, covers a range of PieceEntries).
- Type-vs-employee-type guard at the action layer — `createEmployeePayment` rejects `SALARY` for LABOUR and `WAGE` for FIXED.
- **Wage coverage via period overlap, NOT per-entry paid flag**: a PieceEntry dated X is "covered" iff at least one non-deleted WAGE EmployeePayment has `periodStart ≤ X ≤ periodEnd`. The `isPieceEntryCovered` helper in `labour-balances.ts` is the single source of truth. Decouples production tracking from payment tracking; soft-deleting a payment unpays all entries in that window without per-row updates.
- For SALARY payments, `periodStart` doubles as the month identifier — `isMonthSalaryPaid(payments, monthStart, monthEnd)` checks `periodStart >= monthStart AND periodStart < monthEnd`.
- Immutable corrections via soft-delete + recreate — no `updateEmployeePayment`.
- Schema-level cross-field validation: `periodEnd >= periodStart` via `superRefine` (single-day pay period allowed).
- No overpayment check at the action layer (advances/corrections + WAGE rounding are acceptable at workshop scale).
- Indexes: `@@index([employeeId, periodStart, periodEnd, deletedAt])`, `@@index([type, periodStart, deletedAt])`, `@@index([deletedAt])`.

### Sale
`id, date, partyId (FK → Party, nullable, onDelete: SetNull), partyName, partyPhone, discount (BigInt paise, @default(0)), total (BigInt paise, stored), notes, createdAt, updatedAt, deletedAt`

- Line items in `SaleLineItem` child table. Sale row carries per-transaction metadata only.
- **Sale-level discount only** (`Sale.discount` applies to whole-sale subtotal; no per-line discount).
- **`total` is stored, not derived**: computed as `SUM(lineItems.qty × lineItems.rate) − Sale.discount` at write time and persisted. Recomputed on every `updateSale`.
- **Dual-path party model**: Sale either links to a Party (FK set; `partyName`/`partyPhone` are server-side snapshots of `Party.name`/`Party.phone` at sale time) OR is a walk-in (`partyId` null; the two strings are the only identity). Snapshot pattern preserves historical sale display correctness regardless of later Party rename or soft-delete. `onDelete: SetNull` is defensive.
- `partyPhone` normalized on storage. Phone is the identity anchor for walk-in auto-promotion (see Party).
- Date is date-only — DateTime in Prisma (midnight UTC); rendered via `formatDate`. Form `<input type="date">` emits "YYYY-MM-DD"; schema's `z.coerce.date()` accepts both that and Date.
- `status` is **derived on read** via `computeTransactionStatus`. See §5.
- Currency pipeline: BigInt paise in Prisma → Number at action return. `buildSaleData()` converts rupees → paise at the Prisma boundary; `serializeSale()` converts back at action return. Two BigInt columns on Sale (`discount`, `total`) + one BigInt column per line item (`rate`).
- Soft delete via `deletedAt`; line items hidden via parent's filter.
- Indexes: `@@index([deletedAt])`, `@@index([date])`, `@@index([partyId])`.

### SaleLineItem
`id, saleId (FK → Sale, onDelete: Cascade), itemDescription, qty (Int, positive), rate (BigInt paise, non-negative), createdAt`

- Minimum 1 per Sale (schema-enforced `.min(1)`).
- **Replace-all on edit** (see §6): `tx.saleLineItem.deleteMany` + `tx.sale.update({ lineItems: { create: [...] } })` inside `prisma.$transaction`.
- Immutable after creation (no `updatedAt`); subordinate to parent (no `deletedAt`).
- Cascade only fires on actual DELETE. Soft-deleting a Sale leaves line items in place, filtered out via parent's `deletedAt IS NULL`.
- Indexes: `@@index([saleId])`.

### SalePayment
`id, saleId (FK → Sale, onDelete: Cascade), date, amount (BigInt paise), type (PaymentType: PAYMENT | REFUND, default PAYMENT), note, createdAt, updatedAt, deletedAt`

- Net `paidAmount = SUM(amount WHERE type=PAYMENT, deletedAt:null) − SUM(amount WHERE type=REFUND, deletedAt:null)` per sale. No cached column on `Sale`.
- `PaymentType` enum: `PAYMENT` = money in; `REFUND` = money out (back to customer). Same table, same form, opposite sign in aggregation. Refunds are recorded as `type=REFUND`, not a separate `SaleRefund` table.
- **Payments are immutable** — no `updateSalePayment`. Wrong payment → soft-delete + create new. Both events stay in history list; soft-deleted one filtered out of aggregation.
- Overpayment blocked at action layer. `createSalePayment` rejects PAYMENT entries where `amount > effectiveTotal − netPaid` with `errors.amount = ["Exceeds remaining balance. Outstanding: ₹X"]`. Rejects REFUND entries where `amount > netPaid` with `errors.amount = ["Refund exceeds amount paid. Maximum: ₹X"]`.
- `onDelete: Cascade` on the Sale FK is defensive.
- Indexes: `@@index([saleId])`, `@@index([saleId, type])`, `@@index([deletedAt])`.

### SaleReturn
`id, saleId (FK → Sale, onDelete: Cascade), date, qtyReturned (Int, positive), refundAmount (BigInt paise, non-negative), note, createdAt, updatedAt, deletedAt`

- `returnTotal = SUM(refundAmount) WHERE deletedAt IS NULL` per sale. Reduces sale's `effectiveTotal = total − returnTotal` in status computation. No cached column on `Sale`.
- Returns are immutable — same soft-delete-and-recreate pattern as payments.
- Cumulative validation at action layer: cannot return more items than were sold or refund more total than was originally invoiced.
- Separate from `SalePayment` by design — returns are "product back," payments are "money flow."
- Indexes: `@@index([saleId])`, `@@index([deletedAt])`.

### Purchase
`id, date, partyId (FK → Party, nullable, onDelete: SetNull), partyName, partyPhone, discount (BigInt paise, @default(0)), total (BigInt paise, stored), notes, createdAt, updatedAt, deletedAt`

- Structural mirror of `Sale`: line items in `PurchaseLineItem`, same dual-path party model, same currency pipeline, same stored-total convention, same walk-in auto-promotion (sets `isSupplier` instead of `isCustomer`), same replace-all line-item edit pattern.
- **Status meaning is semantically inverted** vs. Sales — derived from the same `computeTransactionStatus` but interpreted from the shop's perspective on the OPPOSITE side:
  - `pending` = shop owes supplier money.
  - `partial` = partial payment made to supplier.
  - `completed` = shop fully paid the supplier.
  - `refund_due` = supplier owes the shop money back.
- **UI label inversions**: "Outstanding" → "Owed to supplier"; "Refund owed" → "Refund expected"; "+ Issue refund" → "+ Record refund received"; REFUND-row styling flips from red `text-error` + `−` prefix (Sales: money OUT) to blue `text-secondary` + `+` prefix (Purchases: money IN). **Mental model: red = money out of shop, blue = money in to shop**, regardless of which entity owns the row.
- Indexes: `@@index([deletedAt])`, `@@index([date])`, `@@index([partyId])`.

### PurchaseLineItem
Mirror of `SaleLineItem`. Same min-1, same hard-delete-on-edit, same immutable-after-creation, same Cascade-only-on-actual-delete, same no-per-line-discount. Indexes: `@@index([purchaseId])`.

### PurchasePayment
Mirror of `SalePayment` with `purchaseId` FK. Reuses the same `PaymentType` enum. REFUND-type means supplier credited money back to the shop (money IN). Same action-layer validation messages (substituting "Owed to supplier" for "Outstanding" in the PAYMENT overflow error). Indexes: `@@index([purchaseId])`, `@@index([purchaseId, type])`, `@@index([deletedAt])`.

### PurchaseReturn
Mirror of `SaleReturn` with `purchaseId` FK. Semantically: the shop returning items to the supplier; `refundAmount` = what supplier is expected to credit back. Same immutability + cumulative-validation as `SaleReturn`. Indexes: `@@index([purchaseId])`, `@@index([deletedAt])`.

### Attachment
`id, r2Key (unique), mimeType, sizeBytes, originalFilename, uploadedById (FK → User), attachedToType, attachedToId, status (AttachmentStatus: PENDING | READY | FAILED), uploadedAt, confirmedAt, deletedAt`

- **Multi-purpose table** (single table for invoices AND photos). The `Attachment` row is the DB-side metadata; the actual file lives at `r2Key` inside the R2 bucket.
- **Discriminator pattern — no FK on `attachedToId`.** `attachedToType` is a string-typed enum validated against the `ATTACHED_TO_TYPES` allowlist (`SALE | PURCHASE | PURCHASE_PAYMENT | CASTING_ENTRY | PLATING_ENTRY | PURCHASE_PHOTO | SALE_PHOTO`); `attachedToId` is unconstrained `String?` carrying the parent's cuid. Postgres has no native polymorphic FK; the discriminator is the conventional workaround. Extending to a new attached-to kind = extend `ATTACHED_TO_TYPES` + add a row to `src/lib/attachment-access.ts` `ROLE_MATRIX`. Schema never changes.
- **Cardinality enforced at application layer**, not schema: invoices are 1:1 per parent (replace soft-deletes the prior); photos are many-to-1 per parent. **MIME allowlist differs**: `PHOTO_MIME_TYPES` excludes PDF.
- **Two attachment patterns** (see §6 conventions):
  - **Discriminator-only** (Sales / Purchases / payments / photos): lookup via `getAttachmentForEntity(attachedToType, attachedToId)`.
  - **FK + discriminator** (Casting / Plating): parent row carries `attachmentId @unique` FK; lookup via `prisma.castingEntry.findUnique({ include: { attachment: true } })`. The `attachedToType` + `attachedToId` discriminator columns remain authoritative for access control.
- `status` stored (not derived). PENDING from `prepareUpload`; READY after `confirmUpload` verifies the R2 object matches registered mime + size; FAILED if mismatch.
- **User-facing UI continues to use "bill" / "Add bill" / "View bill"** for invoice attachments — workshop users think of those as bills regardless of internal name.
- Soft delete via `deletedAt`. `softDeleteAttachment` deletes the R2 object FIRST then sets `deletedAt`; if R2 delete fails, the DB tombstone still applies and the R2 orphan is left for deferred cleanup (see KNOWN_GAPS).
- `uploadedById` is set from session at `prepareUpload` time. FK has no cascade.
- R2 key format: `bills/YYYY/MM/<uuid>-<sanitized-filename-prefix>`. `bills/` prefix retained for historical continuity. `@@unique` on `r2Key` is the DB safety net against UUID collision.
- Reverse Prisma relations: `castingEntry: CastingEntry?`, `platingEntry: PlatingEntry?` (Prisma-only inverse — FK is on the entry side).
- Indexes: `@@index([uploadedById])`, `@@index([attachedToType, attachedToId])`, `@@index([deletedAt])`, `@@index([status])`.

### CastingEntry / PlatingEntry
`id, date, partyId (FK → Party, nullable, onDelete: SetNull), partyName, partyPhone, discount (BigInt paise, @default(0)), total (BigInt paise, stored), notes, attachmentId (FK → Attachment, unique, nullable, onDelete: SetNull), createdAt, updatedAt, deletedAt`

- Two separate entity types (not unified with a type discriminator) — separate sidebar items match separate workflow concepts. Structural mirror via `scripts/_mirror-casting-to-plating.mjs` (gitignored).
- Dual-path party model identical to Sale / Purchase. Walk-in auto-promotion sets `isCastingVendor` or `isPlatingVendor` based on form context.
- `total` stored, not derived (computed as `SUM(lineItems.lineTotal) − discount`).
- Sale-level discount only (no per-line discount).
- `attachmentId @unique` FK to `Attachment` — at most one attachment per entry. Edit-replace detaches the old `attachmentId` first to avoid tripping the unique constraint.
- **No returns workflow.** Outsourced services have no returnable-goods analogue. Vendor rework is handled by no transaction change (free rework) or a `REFUND`-type payment row.
- Status derived via `computeTransactionStatus` (no `returnTotal` arg). Interpretation mirrors Purchases (shop owes vendor money).
- Indexes: `@@index([partyId])`, `@@index([date])`, `@@index([deletedAt])`, unique on `attachmentId`.

### CastingLineItem / PlatingLineItem
`id, <entry>Id (FK → parent, onDelete: Cascade), materialDescription, weightKg (Decimal(10, 3)), ratePerKg (BigInt paise/kg), lineTotal (BigInt paise, stored), createdAt`

- `weightKg` is `Decimal(10, 3)` — kg with 3-decimal-place gram precision. **Stored as kg, not grams**, for readability.
- `ratePerKg` is BigInt paise per kg. A ₹400/kg rate stores as `40000n`.
- `lineTotal` is BigInt paise, stored. Computed via `computeLineTotal(weightKg, ratePerKg)` in `src/lib/weight-helpers.ts` — Decimal.js `mul()` + `toDecimalPlaces(0, ROUND_HALF_EVEN)` (banker's rounding). **Never inline `weightKg.mul(...)` outside this helper.**
- Same Cascade-only-on-actual-delete behaviour as Sale / Purchase line items.
- **Replace-all on edit** — `tx.castingLineItem.deleteMany` then `tx.castingEntry.update({ lineItems: { create: [...] } })` inside `prisma.$transaction`.
- No per-line discount.
- Indexes: `@@index([<entry>Id])`.

### CastingPayment / PlatingPayment
Mirror of `PurchasePayment` with `<entry>Id` FK. Reuses the `PaymentType` enum. REFUND = vendor refunded money back to the shop (money IN, same direction as Purchases). Same immutability + action-layer validation (substituting "Owed to vendor"). Indexes: `@@index([<entry>Id])`, `@@index([<entry>Id, type])`, `@@index([deletedAt])`.

## 5. Status Logic

**Statuses are derived, never stored.** Computed at query time from payment + return children. The four computed states (`pending` | `partial` | `completed` | `refund_due`) are **TypeScript string-literal union types** — they are NOT Prisma database enums. Do not create a Prisma `enum Status` or a `status` column on `Sale` / `Purchase`. Define the union as `type SaleStatus = 'pending' | 'partial' | 'completed' | 'refund_due'` and compute in the query/serializer.

Unified helper `computeTransactionStatus({ total, paidAmount?, returnTotal? })` in `src/lib/transaction-status.ts` serves Sales, Purchases, Casting, Plating — same math, same four branches:

```
effectiveTotal = total − returnTotal
- paidAmount === 0n AND returnTotal === 0n  → pending
- paidAmount === 0n AND returnTotal > 0n
    AND effectiveTotal <= 0n                → completed  (edge: full return,
                                              nothing was ever owed back)
- paidAmount > effectiveTotal               → refund_due (overpaid relative to
                                              reduced effective total)
- paidAmount === effectiveTotal AND
    effectiveTotal > 0n                     → completed
- 0n < paidAmount < effectiveTotal          → partial
```

`paidAmount` here is the **net** of `SUM(*Payment.amount WHERE type=PAYMENT, deletedAt:null) − SUM(... WHERE type=REFUND, deletedAt:null)`. `returnTotal` is `SUM(*Return.refundAmount WHERE deletedAt:null)` for Sales / Purchases; Casting / Plating have no returns.

`serialize<Entity>()` is the single call site that computes both aggregates and invokes the helper. The page-level query fetches the children that feed it (`include: { payments: { where: { deletedAt: null } }, returns: { where: { deletedAt: null } } }`).

The unified `<TransactionStatusChip>` in `src/components/` is shared across all four entity folders.

**Why derived**: returns and refunds amend history without manual status syncing. Source of truth is the payment + return children.

**Type aliases** `SaleStatus` (in `sales/sale-helpers.ts`) and `PurchaseStatus` (in `purchases/purchase-helpers.ts`) preserve readability at the call site without duplicating logic. If business rules ever diverge between Sales and Purchases, `transaction-status.ts` is the natural extension point.

**Chip rendering is walk-in-only (Phase 21a.1)**. Status is still computed for every row (the serializer always invokes `computeTransactionStatus`), but the chip is **rendered only when `partyId IS NULL`** in the entity tables and detail modals across Sales / Purchases / Casting / Plating. Party-linked rows render a small `data-testid="ledger-tracked-hint"` ("on ledger") instead. **Why**: Phase 21a moved payment from per-bill `*Payment` rows to a party-level `LedgerEntry` for party-linked transactions; the serializer now passes `paidAmount=0n` for those rows so status always derives to `pending`. Rendering a stale "Pending" chip while the party-ledger pointer in the same row said the payment was tracked elsewhere was contradictory misinformation. The chip remains meaningful for walk-ins because walk-ins still aggregate on `*Payment` children.

## 6. Conventions

- **TypeScript strict mode.** No `any`. Use `unknown` for genuinely unknown shapes and narrow with zod.
- **Server components by default.** Add `'use client'` only when a component needs interactivity, hooks, or browser APIs.
- **All forms = react-hook-form + zod.** Define the schema in `schema.ts` next to the route; bind with `zodResolver(schema)`. Schemas live in `schema.ts` **separate** from `'use server'` files (Next.js compiles non-function exports from server-action files into client-reference stubs, which breaks Zod). Forms use the RHF triple-generic pattern `useForm<FormInput, unknown, FormOutput>` when the schema has transforms.
- **Every new feature ships with tests.** Schemas → schema tests covering validation + transforms. Server actions → action tests with mocked Prisma + `auth-guards` + `next/cache`. Interactive components → component tests with RTL + mocked navigation + mocked actions. Don't test third-party library internals or pure styling. See `docs/TESTING.md` for canonical patterns. Per-entity test scaffolding (one `schema.test.ts`, one `actions.test.ts`, one table component test) is mandatory.
- **Currency = paise (integer) at every layer below the UI.** Stored as `BigInt?` in Prisma; serialized to `Number` at the server-action boundary (JSON cannot encode BigInt); displayed via `formatCurrency(paise)` from `src/lib/format.ts`. Form inputs accept rupees as `number`; the zod schema keeps that shape; the action's `toPrismaData()` helper converts rupees → BigInt paise at the Prisma boundary — **NOT in the schema's `.transform()`**, which would mismatch the client-send / server-re-parse wire format. Never multiply/divide currency as float in components.
- **Dates: store UTC, display `Asia/Kolkata`.** Format helpers in `src/lib/format.ts`: `formatDate(value)` for date-only display, `formatDateTime(value)` for date+time. **IST-aware month helpers**: `startOfMonthIST(y, m)`, `endOfMonthIST(y, m)`, `startOfCurrentMonthIST()`, `endOfCurrentMonthIST()`, `formatMonthIST(date)`, `monthIsoIST(date)`, `currentIstYearMonth()`. All "this month" / period calculations use these — never browser local time.
- **File naming:** kebab-case for files, PascalCase for component exports. Schema files: `schema.ts`. Action files: `actions.ts`. Page: `page.tsx`. Layout: `layout.tsx`.
- **API surface:** prefer **Server Actions** for mutations. Use route handlers (`/api/…`) only for webhooks, file downloads (Excel exports), and Auth.js callbacks.
- **Session access:** server components fetch the session via `await auth()` from `@/lib/auth`. Client components use `useSession()` from `next-auth/react` only when reactivity is needed; prefer passing user data down as props from server components.
- **Role gates on every server action.** Every server action calls `await requireRole([...allowedRoles])` as its first await. The list is per-action and declares which roles can invoke it — reading the action's first line tells you the access matrix at a glance.
- **Phone identity for parties.** Normalize via `src/lib/phone.ts#normalizePhone` (idempotent). Apply at every **storage** boundary (Party.phone, Sale.partyPhone, Purchase.partyPhone, CastingEntry.partyPhone, PlatingEntry.partyPhone) AND every **lookup** boundary (`findFirst` in auto-promotion, party-picker phone-prefix match). Asymmetric normalization → lookup misses already-stored records.
- **Multi-item line items use replace-all on edit.** `tx.<child>LineItem.deleteMany({ where: { <parent>Id } })` then `tx.<parent>.update({ data: { ..., lineItems: { create: [...] } } })` inside `prisma.$transaction`. Atomicity guarantees either all line items replace cleanly or none do. Line items are subordinate to parent; the audit-relevant unit is the parent.
- **Ledger MANUAL_PAYMENT entries are editable + soft-deletable in place; TRANSACTION_LINKED entries are corrected via their source transaction (Phase 21a.1).** `updateLedgerPayment(id, { amount, date, description })` and `softDeleteLedgerEntry(id)` in `src/app/(app)/parties/ledger-actions.ts` operate only when `entryType === 'MANUAL_PAYMENT'`. Both reject `TRANSACTION_LINKED` rows at the action layer; the per-party ledger UI renders a small `data-testid="ledger-readonly-hint"` ("via source") on those rows instead of edit/delete buttons. **Why**: a TRANSACTION_LINKED entry mirrors a Sale / Purchase / Casting / Plating / Return row — editing the ledger entry directly would desync it from its source. Fix the parent transaction; the existing `updateX` / `softDeleteX` flow cascades to the linked entry via `updateTransactionLedgerEntry` / `softDeleteTransactionLedgerEntry`. Role gates for edit/delete use the same `rolesAllowedForParty` intersection as `createLedgerPayment`.
- **Credit balances surface in payables / receivables list rollups (Phase 21a.1).** `listPayables` and `listReceivables` filter only `balance === 0n` rows — parties with negative balance (DECREASE > INCREASE, i.e. "we owe them back" / "they prepaid") stay in the result set. List tables render `data-testid="credit-badge"` ("Credit") plus a leading `−` prefix and the secondary tint on the outstanding amount. The per-party ledger statement view (`/payables/[partyId]`, `/receivables/[partyId]`) labels the header "Credit balance" instead of "Outstanding" when the signed balance is negative. **Don't clamp signed balances to ≥0** in any party-rollup code path; the negative state is a legal balance representable on the ledger.
- **Browser → R2 file uploads use a two-step prepare/confirm flow.** `prepareUpload` (server action) validates schema → creates PENDING Attachment row → returns 10-min presigned PUT URL. Browser PUTs bytes directly to R2 (no Vercel transit, no body-size limit at the function layer). `confirmUpload` (server action) re-fetches the row → `headObject` against R2 → verifies actual mime + size match registered → flips row to READY (or FAILED + R2 cleanup on mismatch). Both actions revalidate the relevant page.
- **AttachmentActionModal prop contract.** `onAttach` and `onDetach` props are optional. Absent → discriminator-only flow (Sales / Purchases): the modal short-circuits both calls. Present → FK + discriminator flow (Casting / Plating): `onDetach` runs FIRST in the replace path (clears the FK so the soft-delete can fire without tripping `@unique`), and `onAttach` runs LAST after `confirmUpload`. Same component handles both attachment patterns cleanly. Internal chain: `getAttachmentForEntity → [onDetach] → softDelete → prepareUpload → R2 PUT → confirmUpload → [onAttach]`.
- **Photos vs bills share `Attachment` table; discriminator-only dispatch.** Bills (invoices/receipts) and photos (visual record on Purchase/Sale) both live in one table — differ only by `attachedToType` and client-side MIME allowlist. **Cardinality enforced at application layer**, not schema. **Adding photo support to a new entity**: extend `ATTACHED_TO_TYPES`, add `ROLE_MATRIX` entry, extend `PhotoGallery`'s `entityType` prop union, mount `<PhotoGallery>` on parent's form/detail surfaces, add `Photos (optional)` section to entity form (create-mode `pendingPhotos: File[]` batched after entity create; edit-mode live `<PhotoGallery mode="edit">`), add `<PhotoCountBadge>` to the table, extend `serializeEntity` with `options.photoCount`, and add a `prisma.attachment.groupBy` aggregate to the page query. `<PhotoGallery>` and `<PhotoLightbox>` are entityType-parameterized and reused as-is.
- **Lazy-init Proxy wrappers for SDK clients** (Prisma, R2). Any module that constructs an SDK client from env vars must wrap construction in a `globalThis`-cached `Proxy` so the env read defers until first property access. Next.js 16's build-time page-data collection imports route modules; eager construction crashes the build when env-resolution timing differs from runtime. See `src/lib/prisma.ts` and `src/lib/r2.ts`.
- **Weight pipeline.** Weight `Decimal(10, 3)` kg. Rate `BigInt` paise per kg. Line total via `computeLineTotal(weightKg, ratePerKg)` from `src/lib/weight-helpers.ts` (Decimal.js `mul()` + `toDecimalPlaces(0, ROUND_HALF_EVEN)`, returns BigInt paise). **Never inline `weightKg.mul(...)` outside this helper.** Banker's rounding avoids systematic bias across many transactions.
- **Decimal serialisation at the action boundary.** Decimal columns serialise as **strings** (e.g., `weightKg: "2.500"`), not JS numbers. JS Number cannot safely round-trip 3-decimal-place values (`2.500 → 2.5` collapses trailing zeros and loses the gram-precision contract). Use `formatKg(s: string)` for display. Never `Number(decimalField)` before display arithmetic. Symmetric pattern with BigInt → Number paise at the action boundary.
- **Forms as pages, read-only detail modals, inline action buttons.** All four transactional entities (Sales, Purchases, Casting, Plating) use dedicated `/<entity>/new` and `/<entity>/[id]/edit` routes with standalone form components. Detail modals (`<Entity>DetailModal`) show data only; edits route through inline action buttons (Pay / Bill / Return) opening shared `PaymentActionModal` / `AttachmentActionModal` / `ReturnActionModal`, or the Edit link navigating to `/<entity>/[id]/edit`. The "+ Add" on list pages is a `<Link>` to `/new`, not a state-driven modal.
- **Inline bill section in form pages.** All four transactional form pages include a pre-upload bill section between line items and totals: file picker → `AttachmentPreview` (browser-native `URL.createObjectURL`). On submit, the upload chain runs AFTER the entry create/update succeeds. Sales/Purchases use discriminator-only (`prepareUpload → R2 PUT → confirmUpload`); Casting/Plating add a final FK update step (`attachAttachmentToCastingEntry` / `attachAttachmentToPlatingEntry`). Edit mode adds NEW attachments only; replace/remove uses the row-level 📎 action modal. On upload failure AFTER entry create, the entry stays saved and an error banner directs the user to the row-level modal for retry.
- **Stale-closure trap**: when a callback needs to set a value AND immediately trigger an async submit that reads it, use **`useRef`**, not `useState`. React state batches asynchronously; the submit closure may capture the previous value. Canonical example: `saveModeRef.current = m; handleSubmit(onSubmit)()` in `sale-form.tsx`.
- **Mobile-first responsive design is codebase-wide.** Every transactional list page, form page, detail/form modal, master data list page, and the sidebar all support 390×844 mobile viewport (`(max-width: 767px)`). Conventions: (a) page wrappers `p-4 md:p-10`, headings `text-2xl md:text-3xl`; (b) line items use the **`md:contents` trick** — outer `grid-cols-1 md:grid-cols-[…]` with inner sub-grid `grid-cols-[1fr_1fr_44px] md:contents` for qty/rate/× row, plus desktop-only line-total via `hidden md:flex` inside the sub-grid and mobile-only line-total row via `md:hidden` outside; (c) tables wrapped in `<ResponsiveTable>` with mobile-card render slot; (d) modals use `<ResponsiveDialog>` (Dialog on md+, bottom Sheet on mobile); (e) all interactive elements ≥44×44px on mobile (`h-11`, `w-11`). **Master data mobile cards have NO inline action buttons** — mutations through detail modal Edit. Hook: `useIsMobile()` (`src/lib/use-is-mobile.ts`) reads `matchMedia('(max-width: 767px)')`. **Visual regression detection requires DevTools 390x844 or real-phone walkthrough**; matchMedia unit tests verify branch logic but JSDOM doesn't evaluate CSS media queries.
- **Three-layer self-protection guards** (canonical example: User management's G1/G2/G3): write the guard in the action first (rejection with field-keyed error message), mirror in UI (button disabled with explanatory `title`/notice), then add an action test that asserts rejection AND an action test that asserts the non-self path succeeds. The security boundary is the action layer; UI mirror is for UX.
- **Single-row config tables enforced at the application layer.** `ShopSettings` is conceptually a singleton. Postgres has no native "exactly one row" constraint that's both ergonomic AND race-free. Use `findFirst` + create-or-update for both reads and writes (never `findUnique` — no stable ID). When to use: configuration data the app reads but rarely writes. When NOT to: any row that grows beyond ~1, or where strict uniqueness matters (use `@@unique` instead).
- **Print routes are a sibling route group with their own layout.** Print routes need to render WITHOUT sidebar / app chrome, but nested layouts in Next.js compose rather than override. Pattern: sibling route group `(print)/` with its own `layout.tsx` (auth check duplicated; proxy still gates URL prefix). Final URLs don't collide because route segments under `(app)/sales/[id]/` and `(print)/sales/[id]/` use different leaf names (`edit` vs `bill`). Print-specific CSS uses Tailwind's `print:` variant + `@page` margin rule.
- **Path alias:** `@/*` → `src/*`. No relative `../../` imports across feature boundaries.

## 7. Recent phases (last 3)

For phases ≤18, see [`docs/CLAUDE_ARCHIVE.md`](./docs/CLAUDE_ARCHIVE.md).

### Phase 19 — Completed transactions view

ADMIN-only `/completed` page aggregating settled history across all five entity types via tabs (Sales / Purchases / Casting / Plating / Payroll).

**Shared filters across tabs** (date range + party-or-employee search) apply uniformly — the workshop's mental model is "show me everything that happened in October," not per-tab filtering. Default range is the **current IST calendar month**.

**Strict completion**: Sales/Purchases/Casting/Plating filter to `status === 'completed'` (derived); Payroll shows every non-deleted `EmployeePayment` as inherently completed.

**Server-side filtering** in `src/lib/completed-queries.ts` (`getCompletedSales/Purchases/CastingEntries/PlatingEntries/EmployeePayments`) push date range + case-insensitive partyName/partyPhone search into Prisma; status post-filter runs after `serialize*` because status is derived. Client owns from/to/q state; date changes commit immediately to URL via `router.replace`; party search debounces 300ms.

**Tab content** uses entity-specific dedicated read-only tables in `src/app/(app)/completed/completed-*-table.tsx` (NOT the main entity list tables — those bake in mutation UX that doesn't fit a settled-history surface). Row click opens the entity's existing read-only detail modal. Payroll rows are non-clickable (no `EmployeePaymentDetailModal` yet).

**Role gate**: `canViewCompleted(role)` (ADMIN-only); enforced at three layers (proxy + page redirect + sidebar nav-item filter). The sidebar's `/reports` placeholder remains "Soon"; `canViewReports` + proxy gate preemptively wired.

### Phase 20 — Print bill + Shop settings

**Two pieces**:

**(1) `ShopSettings`** — single-row config (shop name + phone + address + footer). ADMIN-only `/settings` page edits via `upsertShopSettings`. Single-row enforcement at the application layer via `findFirst` + create-or-update (see §6 conventions).

**(2) Print bill route `/sales/[id]/bill`** — sibling route group `src/app/(print)/` with its own layout (no sidebar / app chrome; body bg overridden to white; `@page` margin set for A4). Bill content: shop header (live read from `ShopSettings`, fallback "Shree Creation") + date + customer name/phone + line items table + subtotal (derived) + discount (if > 0) + total (stored) + optional notes + optional footer.

**Locked exclusions**: NO payment status, NO bill number — kaccha-bill tradition.

**Print button** uses `window.print()`, hidden in output via `print:hidden`. Triggers: Printer-icon anchor in sales-table desktop row + 4th mobile-card button + "Print bill" button in sale-detail-modal footer — all open `/sales/[id]/bill` in a new tab.

**Disambiguated** from the existing "Manage bill" attachment action (relabeled "Manage invoice attachment", Paperclip icon stays) via icon + leading verb + target (modal vs new tab).

**Three-layer ADMIN gate**: proxy `ROUTE_ROLES["/settings"] = ["ADMIN"]` (bill route inherits `/sales` ADMIN gate via prefix match) + page server-component redirect via `canManageSettings(role)` + `upsertShopSettings` action `requireRole(["ADMIN"])`.

### Phase 21a — Party ledger model

New `LedgerEntry` table replaces per-bill `*Payment` allocation as the source of truth for **party-linked** transactions. A Sale / Purchase / Casting / Plating row whose `partyId` is non-null emits a `TRANSACTION_LINKED` INCREASE entry; payment / receipt / return events emit DECREASE entries. Walk-in transactions (`partyId IS NULL`) stay on the legacy `*Payment` rails — they're dropped in 21c.

`LedgerEntry` columns: `id, partyId, date, direction (INCREASE | DECREASE), amount (BigInt paise), description, entryType (TRANSACTION_LINKED | MANUAL_PAYMENT), sourceType (LedgerSourceType: SALE | PURCHASE | CASTING | PLATING | SALE_RETURN | PURCHASE_RETURN | null), sourceId (cuid of the source row | null), createdAt, updatedAt, deletedAt, createdById/updatedById/deletedById`. `MANUAL_PAYMENT` rows have `sourceType IS NULL` and `sourceId IS NULL`; they reconcile against the full party balance, not a specific bill.

**Atomicity invariant**: every ledger write helper takes a `Prisma.TransactionClient` and is called inside the parent action's `prisma.$transaction`. A parent-create-without-ledger-write OR a parent-soft-delete-without-ledger-cascade would desync the party balance — the wrapper guarantees both succeed or both roll back. Lives in `src/lib/ledger.ts`: `writeTransactionLedgerEntry`, `updateTransactionLedgerEntry` (handles the four party-change transitions on parent update), `softDeleteTransactionLedgerEntry`, `writeReturnLedgerEntry`, `softDeleteReturnLedgerEntry`.

**Raw-signed balance, NO clamp**: `computePartyBalance(entries)` returns `Σ(INCREASE) − Σ(DECREASE)` over non-deleted entries — never clamped to ≥0. Negative results represent credit balances (party prepaid; we owe them back). UI labels the sign at render time.

**Walk-in → party-link migration on update**: `updateTransactionLedgerEntry` migrates any existing `*Payment` rows on the transaction into `MANUAL_PAYMENT` ledger entries on the newly-linked party, then soft-deletes the `*Payment` rows. Preserves payment history across the rail switch.

**Per-party UI**: `/payables/[partyId]` and `/receivables/[partyId]` render the chronological `LedgerEntry` statement with running balance. Adding a payment opens `PartyLedgerPaymentModal` (single party-level entry, no bulk allocation — the Phase 17b bulk modal is removed).

**Status loses payment-meaning for party-linked transactions**: `serializeSale` / `serializePurchase` / `serializeCastingEntry` / `serializePlatingEntry` pass `paidAmount=0n` to `computeTransactionStatus` when the row is party-linked. Status still computes (and is still a TypeScript union, not a DB enum), but the chip is hidden from those rows in UI — see Phase 21a.1.

**Karigar handling and `/completed` rework deferred** to 21b and 21c respectively. The bill-wise `*Payment` tables remain alive in 21a for walk-in transactions only.

### Phase 21a.1 — Ledger corrections + chip cleanup + credit visibility

Polish phase landing real-usage gaps found within hours of 21a shipping:

**(1) Ledger payments are editable + deletable.** `updateLedgerPayment(id, { amount, date, description })` added to `parties/ledger-actions.ts`; `softDeleteLedgerEntry` (already present) surfaced in the per-party statement UI. Both reject `TRANSACTION_LINKED` entries with a field-error — those are corrected by editing or soft-deleting the parent transaction, which cascades via the 21a `updateTransactionLedgerEntry` / `softDeleteTransactionLedgerEntry` helpers. The per-party statement now renders a 6th "Actions" column: edit + delete icons on MANUAL_PAYMENT rows; a "via source" hint on TRANSACTION_LINKED rows. `PartyLedgerPaymentModal` gained an `editEntry` prop that prefills date / amount / description and switches the submit button to "Save changes".

**(2) Status chip walks-in-only.** The chip is hidden on party-linked rows across all four entity tables + detail modals (Sales / Purchases / Casting / Plating); rendered only when `partyId IS NULL`. Party-linked rows show a small "on ledger" hint (`data-testid="ledger-tracked-hint"`) in the Status column. See §5 for the rationale.

**(3) Credit-balance parties surface in lists.** `listPayables` and `listReceivables` already returned negative-balance rollups (only `balance === 0n` is filtered); the table render already supported the "Credit" badge + `−` prefix + secondary tint. 21a.1 pins the behavior with explicit tests covering both the credit `listReceivables` shape (customer overpaid by ₹9k → −900_000 paise) and the credit `listPayables` shape (supplier overpaid by ₹4k → −400_000 paise). See §6 conventions.

**Live confirmation**: 12/12 prod walkthrough PASS on commit `5aefca4` (deployment `dpl_6eL743MoWFVaA6bHZXvF7KR5hrJW`), marker `__phase21a1_walk_1779458405858` — the screenshot scenario reproduced end-to-end (₹1k sale + ₹10k payment → −₹9k credit → edit to ₹1k → ₹0 → delete → ₹1k → new ₹200 payment → ₹800), credit badge visible in `/receivables`, party-linked sale shows no chip, walk-in sale still shows chip. Marker rows tombstoned. **Lesson**: PartyLedgerPaymentModal button label varies by direction + mode — locate by `/record receipt/i` in receivable mode, `/save changes/i` in edit mode, `/record payment/i` only in payable-create mode.

## 8. Out of Scope (do not build)

- GST / tax calculation logic
- Multi-tenant / multi-org support
- Mobile app (responsive web is enough for now)
- Email notifications (transactional or marketing)
- Public-facing pages (landing, marketing, blog)
- Accounting integrations (Tally, Zoho Books)
- Inventory tracking (separate concern, deferred)

## 9. Deployment

Hosted on Vercel; production fed from `main`. **Operational reference lives in [`docs/HANDOFF.md`](./docs/HANDOFF.md)** — read that before changing prod env, rotating secrets, applying migrations, or rolling back a deploy.

- **Vercel project:** `jewlerytracker` (org: `darshan-somaiyas-projects`). Auto-detected Next.js; Node 24.x; Fluid Compute, region `iad1`.
- **Repository:** `Darshan36/jewelry-tracker`. Push to `main` auto-deploys; no PR gate yet.
- **Production database:** Supabase project `cseqdcrfnvgsalsyhjsz` (Mumbai, `ap-south-1`). Independent from dev. Schemas synchronized via `prisma migrate deploy`, never via data copy.
- **Auth gate:** Auth.js JWT cookie sessions only. Vercel's project-level SSO Deployment Protection is disabled (app does its own auth). Re-enable only if you also wire up a staff bypass.
- **Lazy Prisma + Auth diagnostic wrapper are load-bearing**: see §2 tech stack + §6 lazy-init Proxy convention. Do NOT revert either.
- **Direct user inserts to the production `users` table must specify `role` explicitly** (no DB default). Production currently has 4 users: 1 ADMIN (the owner) + 3 test accounts (one per non-admin role — see `docs/HANDOFF.md`). Test account passwords are in admin's password manager. New users go in via the ADMIN-only `/users` UI (Phase 16) or Supabase MCP.

---

## Phase-start instructions

When starting a new phase or returning after a context reset:

1. **Read this file (CLAUDE.md) first** — it's the lean working doc. Everything load-bearing for current architecture and conventions is here.
2. **Read [`KNOWN_GAPS.md`](./KNOWN_GAPS.md)** — active deferred items, recent decision lineage, items that need attention at known milestones.
3. **Consult [`docs/CLAUDE_ARCHIVE.md`](./docs/CLAUDE_ARCHIVE.md) only when you need historical context** — phase-by-phase milestones, superseded designs, "why did we change X" lookback. Reference-only; do NOT load preemptively.
4. **Consult [`docs/KNOWN_GAPS_ARCHIVE.md`](./docs/KNOWN_GAPS_ARCHIVE.md) only for Phase ≤11 decision lineage.** Reference-only.
5. **Consult [`docs/HANDOFF.md`](./docs/HANDOFF.md) for deployment operations** — env vars, secret rotation, rollback procedures, test accounts.
6. **Consult [`docs/TESTING.md`](./docs/TESTING.md) for test conventions.**

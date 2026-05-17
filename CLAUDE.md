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
- **Auth:** Auth.js v5 beta with Credentials provider, **JWT strategy** (no session table — sessions are stateless JWE cookies, 30-day expiry), **bcrypt** password hashing (cost 12), `Role` enum (`ADMIN | PURCHASE_DEPT | LABOUR_MGMT | CASTING_PLATING_MGMT`) in Prisma schema. Auth.js entry point: `src/lib/auth.ts` exporting `{ auth, handlers, signIn, signOut }`. Route protection lives in `src/proxy.ts` (Next.js 16 — see KNOWN_GAPS.md, was previously called `middleware.ts`).
- **RBAC:** Role-based access control via `requireRole(allowedRoles[])` at every server action + per-route gating in `src/proxy.ts` + per-role sidebar filtering in `src/app/(app)/sidebar.tsx`. Four roles: `ADMIN | PURCHASE_DEPT | LABOUR_MGMT | CASTING_PLATING_MGMT`. See KNOWN_GAPS decision lineage for boundary rationale.
- **Tables/grids:** TanStack Table v8
- **Charts:** Recharts
- **Excel:** ExcelJS for both export and import
- **File storage:** Cloudflare R2 (S3-compatible) for bill / receipt scans (Phase 8). `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Lazy-init wrapper at `src/lib/r2.ts` mirroring the `prisma.ts` Proxy pattern — env is read on first call, not at module load. Browser uploads directly to R2 via 10-min presigned PUT URLs (two-step prepare/confirm flow); server-side downloads issue 1-hr presigned GET URLs.
- **Casting & plating (Phase 9):** outsourced casting/plating jobs tracked via separate entity types (`CastingEntry`, `PlatingEntry`) sharing a single `CastingPlatingVendor` master table. Weight-based line items with `Decimal(10, 3)` kg + `BigInt` paise-per-kg rate; line totals computed via `computeLineTotal` helper in `src/lib/weight-helpers.ts` using Decimal.js `mul()` + `toDecimalPlaces(0, ROUND_HALF_EVEN)` (banker's rounding) and returned as `BigInt` paise. Bills integrate via Phase 8's `attachedToType` discriminator (`CASTING_ENTRY`, `PLATING_ENTRY`) with a `billId @unique` FK on each entry side.
- **UX migration (Phase 10 + 10.5 + 10.6):** completed the form-as-page + read-only-detail-modal + inline-action-button UX pattern across **all four transactional entities (Sales, Purchases, Casting, Plating)**. All four use dedicated `/<entity>/new` and `/<entity>/[id]/edit` routes, standalone form components, read-only detail modals, inline action buttons with prop-injection dispatch (`onSave` / `onAttach` / `onDetach` props on the shared `PaymentActionModal` / `BillActionModal` / `ReturnActionModal`), and an inline bill section in form pages (file picker → `BillPreview` → on-save chain `create/update → prepareUpload → R2 PUT → confirmUpload`). **Casting and Plating use FK-based bill attachment** (entry row carries `billId @unique` FK; the chain ends with `attach*BillTo*Entry`); **Sales and Purchases use discriminator-only attachment** (no FK column; `attachedToType` + `attachedToId` is the only link). The pattern is uniform; the implementation diverges where the data model legitimately differs. Bill upload preview via browser-native `URL.createObjectURL` (image `<img>`, PDF `<embed>`).
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

### User (built Phase 1, extended Phase 5)
`id, email (unique), passwordHash, name, role (Role enum: ADMIN | PURCHASE_DEPT | LABOUR_MGMT | CASTING_PLATING_MGMT), createdAt, updatedAt`

- **`role` is required on insert (no default).** STAFF was the historical default and has been removed; every new user must explicitly choose a role. Direct DB inserts to `users` must specify `role`.
- **No soft delete.** The User table is small (handful of rows) and tightly coupled to who can sign in; if a user leaves, the row is deleted outright rather than tombstoned.
- **`passwordHash`** is bcrypt cost 12, generated via `bcryptjs`. Plain passwords never touch the DB.
- **No `email` uniqueness on case folding.** Auth.js's `authorize()` lowercases the input via the zod schema (`z.string().email().toLowerCase().trim()`), so the case-sensitive UNIQUE on `email` is effectively case-insensitive in practice. Don't store mixed-case emails.

### Customer (built Phase 2.1) / Supplier (built Phase 2.2)
`id, name, phone, email, address, notes, createdAt, updatedAt, deletedAt`

- **Two separate DB tables (`customers`, `suppliers`) sharing the same schema.** Kept apart so Sales (Phase 3) can FK to `Customer` and Purchases (Phase 4) can FK to `Supplier` without cross-pollution. The Prisma models, zod schemas, server actions, table component, and modals are near-identical clones — Phase 2.2.5 will extract the genuinely-shared bits (`requireSession()`, the `<Field>` label-value component, form-input class constants) without forcing a generic "master-data entity" abstraction.
- **Soft delete via `deletedAt`** (nullable). List queries filter `where: { deletedAt: null }`. Deleted rows preserve history; restoring is via direct DB UPDATE (no UI yet — see KNOWN_GAPS).
- **No uniqueness on `email` or `phone`.** Real entry produces dupes (typos, alternate spellings); we surface them via party-autocomplete in Phase 3, not by hard-rejecting them at insert.
- **`phone` is normalized on save** (whitespace, dashes, parens stripped via `src/lib/phone.ts#normalizePhone`). Idempotent — re-saving an already-clean phone is a no-op. Master-data records may be created either explicitly via `/customers` / `/suppliers` UIs, OR auto-created by the walk-in auto-promotion path in `createSale` / `createPurchase` (Phase 6 — see the Sale / Purchase entries below).
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

### Sale (built Phase 3.1, restructured Phase 7)
`id, date, customerId (FK → Customer, nullable, onDelete: SetNull), partyName, partyPhone, discount (BigInt paise, @default(0)), total (BigInt paise, stored), notes, createdAt, updatedAt, deletedAt`

- **Phase 7: line items moved to a child table.** `qty`, `rate`, and `itemDescription` no longer live on `Sale` — they're rows in `SaleLineItem` (see below). The Sale row carries the per-transaction metadata (party, date, discount, total, notes) and the line items carry the items themselves. One Sale, one-or-more SaleLineItems.
- **Sale-level discount only.** `Sale.discount` applies to the whole-sale subtotal; there is **no per-line discount**. Matches workshop invoicing practice ("₹13,500 of items, give it for ₹13,000"). If per-line negotiated discounts surface as a real workflow later, the schema extends naturally with a `SaleLineItem.discount` column.
- **`total` is stored, not derived.** Computed at write time as `SUM(lineItems.qty × lineItems.rate) − Sale.discount` (all in BigInt paise) and persisted on the row. Trade-off vs. computing on read: enables straightforward `SUM(total)` aggregates AND preserves audit history. Must be recomputed on every `updateSale`. See KNOWN_GAPS.md decision lineage.
- **Dual-path party model.** Each sale either links to a `Customer` (FK `customerId` set; `partyName`/`partyPhone` are server-side snapshots of `Customer.name`/`Customer.phone` at sale time) OR is a walk-in (`customerId` null; the two strings are the only identity). Snapshot pattern preserves historical sale display correctness regardless of later customer rename or soft-delete. `onDelete: SetNull` is defensive — if a customer is ever hard-deleted, sales lose only the link, not their party data. See KNOWN_GAPS.md decision lineage.
- **`partyPhone` is normalized on storage** (whitespace, dashes, parens stripped via `src/lib/phone.ts#normalizePhone`). Phone is the identity anchor for **walk-in auto-promotion** (Phase 6): when a walk-in (`customerId IS NULL`) is saved with a populated `partyPhone`, the server normalizes, looks up an existing Customer by phone; if found, links via FK and snapshots canonical `Customer.name`; if not, auto-creates a new Customer row with the typed name + normalized phone. Walk-ins without phone stay as snapshot-only entries (no FK). The whole lookup-or-create + sale-create + line-item-create runs inside `prisma.$transaction` so the trio lands atomically.
- **Date is date-only.** Stored as DateTime in Prisma (midnight UTC by convention); rendered via `formatDate` (not `formatDateTime`). Form input is `<input type="date">` emitting "YYYY-MM-DD"; the schema's `z.coerce.date()` accepts both that string and Date instances (symmetric wire format).
- **`status` is derived on read.** Computed by `computeSaleStatus(sale)` in `src/lib/sale-status.ts` and attached by `serializeSale()` before the row reaches the client. Phase 3.1 always returns `'pending'` (no payments/returns yet); Phase 3.2/3.3 plug into the same function's forward-compatible signature. See §5.
- **Currency pipeline** identical to Employee — schema validates rupees as `z.number().nonnegative()` on every line and on the discount; action's `buildSaleData()` converts to BigInt paise at the Prisma boundary; `serializeSale()` converts back to Number at the action return for JSON safety. Two BigInt columns on Sale (`discount`, `total`) + one BigInt column per line item (`rate`).
- Soft delete via `deletedAt`; list queries filter `where: { deletedAt: null }`. Line items inherit visibility via the parent — soft-deleted Sales hide their lines from list views automatically.
- **Indexes:** `@@index([deletedAt])`, `@@index([date])` (for chronological queries), `@@index([customerId])` (for per-customer history).

### SaleLineItem (built Phase 7)
`id, saleId (FK → Sale, onDelete: Cascade), itemDescription, qty (Int, positive), rate (BigInt paise, non-negative), createdAt`

- **Minimum 1 per Sale.** Enforced at the schema layer (`saleInputSchema.lineItems = z.array(...).min(1)`). Empty `lineItems` array on insert rejects before any DB work.
- **Hard-deleted on parent edit** (no `deletedAt`). `updateSale` runs `tx.saleLineItem.deleteMany({ where: { saleId } })` followed by `tx.sale.update({ data: { ..., lineItems: { create: [...] } } })` inside `$transaction` — see §6 convention. Subordinate to parent; audit-relevant unit is the Sale itself.
- **Immutable after creation** (no `updatedAt`). Edits replace the entire line set, not modify individual lines.
- **Cascade delete only fires on actual delete.** Soft-deleting a Sale (`deletedAt` set) does NOT cascade — line items remain in DB and are filtered out of list queries via the parent's `deletedAt IS NULL` clause. Hard-deleting a Sale (currently never happens) would cascade and remove its line items.
- **No discount column.** Per-line discount is intentionally not represented — see Sale entry above.
- **Indexes:** `@@index([saleId])` for the join-on-saleId access pattern (every sale read joins its line items).

### SalePayment (built Phase 3.2, extended Phase 3.3)
`id, saleId (FK → Sale, onDelete: Cascade), date, amount (BigInt paise), type (PaymentType: PAYMENT | REFUND, default PAYMENT), note, createdAt, updatedAt, deletedAt`

- **Per-payment audit trail.** Child table — one row per payment event. Net `paidAmount` is derived live as `SUM(amount WHERE type=PAYMENT, deletedAt:null) − SUM(amount WHERE type=REFUND, deletedAt:null)` per sale. No cached column on `Sale` (rejected to avoid drift risk; the aggregation is cheap at ~100 sales/month).
- **`PaymentType` enum (Phase 3.3).** `PAYMENT` = money coming in; `REFUND` = money going back to customer. Same table, same form (date + amount + note), same workflow — just opposite direction in the aggregation. Refunds are recorded via `SalePayment` with `type=REFUND` rather than a separate `SaleRefund` table — see KNOWN_GAPS decision lineage.
- **Payments are immutable.** No `updateSalePayment` action exists — wrong payment (including a refund) is corrected by soft-deleting the bad entry and creating a new correct one. Both events stay in the history list; the soft-deleted one is filtered out of the aggregation. Preserves audit trail at the cost of slightly more UI work for corrections.
- **Currency pipeline** identical to Sale/Employee — `amount` is `BigInt` paise in Prisma, `serializeSalePayment()` converts to `Number` at the action return for client JSON safety.
- **`onDelete: Cascade`** on the Sale FK is defensive — if a sale is ever hard-deleted (currently soft-only), its payment children go too. Soft-delete of a sale doesn't trigger cascade (`deletedAt` filter in queries, not actual delete).
- **Overpayment blocked at action layer.** `createSalePayment` rejects PAYMENT entries where `amount > effectiveTotal − netPaid` with `errors.amount = ["Exceeds remaining balance. Outstanding: ₹X"]`. Rejects REFUND entries where `amount > netPaid` with `errors.amount = ["Refund exceeds amount paid. Maximum: ₹X"]` — the customer never gave us that money, can't refund it.
- **Indexes:** `@@index([saleId])` for aggregation queries, `@@index([saleId, type])` for type-discriminated aggregation (`SUM WHERE type=PAYMENT`), `@@index([deletedAt])` for soft-delete filtering.

### SaleReturn (built Phase 3.3)
`id, saleId (FK → Sale, onDelete: Cascade), date, qtyReturned (Int, positive), refundAmount (BigInt paise, non-negative), note, createdAt, updatedAt, deletedAt`

- **Discrete return events.** Child table — one row per return event. `returnTotal` is derived live via `SUM(refundAmount) WHERE deletedAt IS NULL` per sale; reduces the sale's `effectiveTotal = total − returnTotal` used in status computation. No cached column on `Sale`.
- **Returns are immutable** — same pattern as payments. No `updateSaleReturn`; wrong return → soft-delete + create new. Soft-deleting a return drops it out of `returnTotal` aggregation and triggers status recomputation (e.g., `refund_due → completed` if the refund hadn't been issued yet, `completed → partial` if undoing a return raises the effective total above what's been paid).
- **Cumulative validation at action layer.** `createSaleReturn` rejects `newQtyReturned + existingReturnedQty > sale.qty` with `errors.qtyReturned = ["Cannot return more than the original quantity. Already returned: N of M"]`. Rejects `newRefundAmount + existingReturnTotal > sale.total` with `errors.refundAmount = ["Refund exceeds remaining returnable value. Maximum: ₹X"]`. Can't return more items than were sold; can't refund more total than was originally invoiced.
- **Separate from `SalePayment`** by design — returns are "product back," payments are "money flow." Mixing them would have required `type` discrimination on every query and lost the audit-category distinction. See KNOWN_GAPS decision lineage.
- **Currency pipeline** identical to others — `refundAmount` is `BigInt` paise in Prisma, `serializeSaleReturn()` converts to `Number` at the action return.
- **`onDelete: Cascade`** on the Sale FK — defensive consistency with SalePayment.
- **Indexes:** `@@index([saleId])` for aggregation, `@@index([deletedAt])` for soft-delete filtering.

### Purchase (built Phase 4, restructured Phase 7)
`id, date, supplierId (FK → Supplier, nullable, onDelete: SetNull), partyName, partyPhone, discount (BigInt paise, @default(0)), total (BigInt paise, stored), notes, createdAt, updatedAt, deletedAt`

- **Structural mirror of `Sale`** — same Phase-7 restructure (line items moved to `PurchaseLineItem`), same dual-path party model, same currency pipeline, same stored-total convention, same `viewingPurchaseId` live-updating modal pattern, same **walk-in auto-promotion via normalized phone** (Phase 6 — see the Sale entry for the full pattern; the only inversion is `Supplier` for `Customer`), same replace-all line-item edit pattern (see §6). The FK is to `Supplier` (instead of `Customer`); everything else is identical.
- **Status meaning is semantically inverted** vs. Sales — derived from the same `computeTransactionStatus` (see §5) but interpreted from the shop's perspective on the OPPOSITE side of the transaction:
  - `pending` = shop owes supplier money (no payment to supplier yet)
  - `partial` = partial payment made to supplier
  - `completed` = shop fully paid the supplier (or fully resolved through returns)
  - `refund_due` = supplier owes the shop money back (a return reduced the effective total below what the shop paid)
- **UI label inversions** (see KNOWN_GAPS decision lineage): "Outstanding" → "Owed to supplier"; "Refund owed" → "Refund expected"; "+ Issue refund" → "+ Record refund received"; REFUND-row styling flips from red `text-error` + `−` prefix (Sales: money OUT) to blue `text-secondary` + `+` prefix (Purchases: money IN). Mental model: red = money out of shop, blue = money in to shop, regardless of which entity owns the row.
- **Indexes:** `@@index([deletedAt])`, `@@index([date])`, `@@index([supplierId])`.

### PurchaseLineItem (built Phase 7)
`id, purchaseId (FK → Purchase, onDelete: Cascade), itemDescription, qty (Int, positive), rate (BigInt paise, non-negative), createdAt`

- Mirror of `SaleLineItem`. Same min-1 enforcement, same hard-delete-on-edit (no `deletedAt`), same immutable-after-creation (no `updatedAt`), same `Cascade`-only-on-actual-delete behaviour, same no-per-line-discount stance. The only difference is the parent FK (`purchaseId` instead of `saleId`).
- **Indexes:** `@@index([purchaseId])`.

### PurchasePayment (built Phase 4)
`id, purchaseId (FK → Purchase, onDelete: Cascade), date, amount (BigInt paise), type (PaymentType: PAYMENT | REFUND, default PAYMENT), note, createdAt, updatedAt, deletedAt`

- **Reuses the `PaymentType` enum from `SalePayment`** — single enum definition, two payment models. Net `paidAmount = SUM(amount WHERE type=PAYMENT, deletedAt:null) − SUM(amount WHERE type=REFUND, deletedAt:null)` per purchase. Same aggregation pattern as Sales.
- **REFUND-type semantic inversion**: for Purchases, REFUND = supplier credited money back to the shop (money IN). Same form, same workflow as Sales — opposite money direction.
- **Action-layer validation** mirrors Sales: PAYMENT entries rejected if `amount > effectiveTotal − netPaid` with `errors.amount = ["Exceeds remaining balance. Owed to supplier: ₹X"]` (the "Owed to supplier" copy is the Purchases-direction inversion). REFUND entries rejected if `amount > netPaid` with `errors.amount = ["Refund exceeds amount paid. Maximum: ₹X"]`.
- **Indexes:** `@@index([purchaseId])`, `@@index([purchaseId, type])`, `@@index([deletedAt])`.

### Bill (built Phase 8)
`id, r2Key (unique), mimeType, sizeBytes, originalFilename, uploadedById (FK → User), attachedToType, attachedToId, status (BillStatus enum: PENDING | READY | FAILED), uploadedAt, confirmedAt, deletedAt`

- **Storage backend: Cloudflare R2** via S3-compatible API. The Bill row is the DB-side metadata; the actual file lives at `r2Key` inside the configured bucket. See §2 for the wrapper + the prepare/confirm convention.
- **Discriminator pattern — no FK on `attachedToId`.** `attachedToType` is a string-typed enum (validated at the schema layer against the `ATTACHED_TO_TYPES` allowlist: `PURCHASE | PURCHASE_PAYMENT | CASTING_ENTRY | PLATING_ENTRY`); `attachedToId` is an unconstrained `String?` carrying the parent's cuid. **Why no FK**: a single Bill table that can attach to any of 4+ entity kinds would need a polymorphic FK, which Postgres doesn't support natively. The discriminator pattern is the conventional workaround — extending to a new attached-to kind in a later phase = extend `ATTACHED_TO_TYPES` + add a row to the access matrix in `src/lib/bill-access.ts`. The Bill table itself never changes shape. **Trade-off**: orphan reference detection on parent delete is the caller's responsibility (no DB-level cascade); Phase 3.4 retrofit will need a per-parent-entity audit step.
- **`attachedToType` may be null** (standalone bills). Standalone bills are ADMIN-only and currently only exist via the `/admin/bills-test` sandbox. The walk-up flow (Phase 3.4) will always set the discriminator.
- **`status` is stored** (not derived). PENDING is the initial state from `prepareUpload`; READY after `confirmUpload` verifies the R2 object matches the registered mime + size; FAILED if verification mismatches or the R2 object is missing. Unlike Sale/Purchase `status` (derived from payment/return children — see §5), Bill status reflects the upload-pipeline state machine, not a derived business state. Once READY, the status doesn't change (except via soft-delete which tombstones the row).
- **Soft delete via `deletedAt`** (matches every other entity convention). `softDeleteBill` deletes the R2 object FIRST then sets `deletedAt`. If R2 delete fails, the DB tombstone still applies; the R2 orphan is left for a deferred cleanup job (see KNOWN_GAPS).
- **`uploadedById`** is set from the session at `prepareUpload` time. The FK has no cascade — deleting a user requires either deleting their bills or nulling out the link, which neither path currently does (User has no soft-delete anyway — see §4 User).
- **Indexes:** `@@index([uploadedById])`, `@@index([attachedToType, attachedToId])` (the discriminator-pair lookup is the dominant access pattern: "give me bills attached to purchase X"), `@@index([deletedAt])`, `@@index([status])`.
- **R2 key format:** `bills/YYYY/MM/<uuid>-<sanitized-filename-prefix>`. UUID via `crypto.randomUUID()` is independent of the Bill row's `id` because Prisma generates the cuid at INSERT time but `r2Key` is required-non-null on the same insert. `@@unique` on `r2Key` is the DB safety net against UUID collision.
- **Reverse relations (Phase 9 — Prisma-only, no SQL impact).** Bill carries virtual reverse fields `castingEntry: CastingEntry?` and `platingEntry: PlatingEntry?` so the FK relation on the entry side (`billId @unique`) validates. The FK itself lives on the *entity* side, so the Bills SQL row is untouched by this — the reverse fields exist purely for Prisma's schema validator. **The `attachedToType` + `attachedToId` discriminator columns remain the authoritative access-control source.** When Phase 3.4 retrofit lands and Sales / Purchases / payments grow their own `billId` FK, the same reverse-relation pattern repeats. Reading "who owns this bill?" should still go through the discriminator (it's universally populated; the FK side is per-entity-kind).

### PurchaseReturn (built Phase 4)
`id, purchaseId (FK → Purchase, onDelete: Cascade), date, qtyReturned (Int, positive), refundAmount (BigInt paise, non-negative), note, createdAt, updatedAt, deletedAt`

- **Semantically**: the shop returning items to the supplier (defective goods, oversupply, wrong order). `refundAmount` = what the supplier is expected to credit back.
- **Same shape as `SaleReturn`** — same immutability convention (no `updateSaleReturn`/`updatePurchaseReturn`; wrong return → soft-delete + create new), same cumulative qty + refundAmount validation at the action layer.
- **`returnTotal` aggregation** = `SUM(refundAmount) WHERE deletedAt IS NULL`. Feeds into `computeTransactionStatus({ total, paidAmount, returnTotal })` exactly like Sales — the supplier-direction interpretation is purely a UI concern.
- **Indexes:** `@@index([purchaseId])`, `@@index([deletedAt])`.

### WorkEntry  (debit on karigar's balance)
`id, employee_id, date, description, pieces, rate_per_piece, total, created_at`

### WorkPayment  (credit on karigar's balance — NOT tied to a specific WorkEntry)
`id, employee_id, date, amount, note, created_at`

### WorkReversal  (credit — defective work charged back)
`id, work_entry_id, date, pieces_reversed, total, reason, created_at`

Karigar balance (computed): `sum(WorkEntry.total) − sum(WorkPayment.amount) − sum(WorkReversal.total)`

### FixedSalary
`id, employee_id, month (YYYY-MM), attendance_days, salary, advances, deductions, net_payable, paid (boolean), paid_date, created_at`

### CastingPlatingVendor (built Phase 9)
`id, name, phone, address, notes, createdAt, updatedAt, deletedAt`

- **Single shared master table** — used by both `CastingEntry` and `PlatingEntry`. Real workshops often do both services, so duplicating into a `CastingVendor` + `PlatingVendor` pair would have created duplicate records for overlapping vendors. The entry's table determines the workflow type; the vendor record is the same person/shop regardless. See KNOWN_GAPS decision lineage.
- **No `email` field** (unlike Customer / Supplier — vendor contact is exclusively phone in this workflow).
- **Soft delete via `deletedAt`** (matches Customer / Supplier / Employee convention).
- **`phone` normalised on save** via `src/lib/phone.ts#normalizePhone` (Phase 6 identity-anchor pattern). Auto-promotion from walk-in entries uses the same normalised phone for `findFirst` lookup, just like Sales / Purchases.
- **Indexes:** `@@index([phone])` (auto-promotion lookup is the dominant access pattern), `@@index([deletedAt])`, `@@index([name])` (search).
- **Walk-in auto-promotion** identical pattern to Sales / Purchases: when an entry is saved with `vendorId IS NULL` AND a populated `partyPhone`, the action looks up an existing vendor by normalised phone; if found, links via FK and snapshots canonical `name`; if not, auto-creates a vendor row. The lookup-or-create runs inside `prisma.$transaction` alongside the entry create.

### CastingEntry / PlatingEntry (built Phase 9)
`id, date, vendorId (FK → CastingPlatingVendor, nullable, onDelete: SetNull), partyName, partyPhone, discount (BigInt paise, @default(0)), total (BigInt paise, stored), notes, billId (FK → Bill, unique, nullable, onDelete: SetNull), createdAt, updatedAt, deletedAt`

- **Two separate entity types** (not unified with a type discriminator) — separate sidebar items match separate workflow concepts. Structural mirror maintained via a reproducible mirror script (`scripts/_mirror-casting-to-plating.mjs`, gitignored). If future outsource categories emerge (polishing / welding / etc.), the pattern extends by adding new entity types rather than overloading a discriminator column.
- **Dual-path party model identical to Sale / Purchase.** Either `vendorId` is set with `partyName`/`partyPhone` as server-side snapshots of the linked vendor's `name`/`phone`, OR `vendorId IS NULL` and the two strings are the only identity (walk-in). `onDelete: SetNull` preserves entry history if a vendor is ever hard-deleted.
- **`total` stored, not derived.** Computed at write time as `SUM(lineItems.lineTotal) − discount`, recomputed on every `updateEntry`. Matches Sale / Purchase convention. Enables straightforward `SUM(total)` aggregates for the dashboard.
- **Sale-level discount only.** No per-line discount. Same trade-off as Sales / Purchases (workshop invoicing speaks "whole-job discount").
- **`billId @unique` FK to `Bill`** — each entry can have at most one bill. Bill upload happens *after* entry creation (the bill needs `attachedToType + attachedToId` set to the entry's id), via the prepare → R2 PUT → confirm → `attachBillToCastingEntry` flow. Edit-replace-bill detaches the old `billId` via `detachBillFrom*Entry` first to avoid tripping the unique constraint during the transient state.
- **No returns workflow.** Outsourced services don't have a returnable-goods analogue to `SaleReturn` / `PurchaseReturn`. Vendor rework is handled either by no transaction change (free rework) or by a `REFUND`-type `*Payment` row (mirrors the Sale / Purchase refund pattern). See KNOWN_GAPS decision lineage.
- **Status derived via `computeTransactionStatus`** (no `returnTotal` argument — there are no returns). Branches: `pending` / `partial` / `completed` / `refund_due`. Interpretation mirrors Purchases (shop owes vendor money → "Owed to vendor"; `refund_due` means vendor over-refunded the shop).
- **Currency pipeline** identical to Sale / Purchase — schema validates rupees as `z.number().nonnegative()`; action converts to BigInt paise at the Prisma boundary; `serializeCastingEntry()` / `serializePlatingEntry()` returns `Number` to the client.
- **Indexes:** `@@index([vendorId])`, `@@index([date])`, `@@index([deletedAt])`, unique on `billId`.

### CastingLineItem / PlatingLineItem (built Phase 9)
`id, <entry>Id (FK → parent, onDelete: Cascade), materialDescription, weightKg (Decimal(10, 3)), ratePerKg (BigInt paise/kg), lineTotal (BigInt paise, stored), createdAt`

- **`weightKg` is `Decimal(10, 3)`** — kg with 3-decimal-place gram precision. **Stored as kg, not grams** for readability — the workflow speaks kg, the UI accepts kg, the DB column reads kg. Decimal.js handles the arithmetic. See KNOWN_GAPS decision lineage for the trade-off rationale.
- **`ratePerKg` is `BigInt` paise per kg.** Money pattern preserved across the codebase. A ₹400/kg rate stores as `40000n`.
- **`lineTotal` is `BigInt` paise, stored.** Computed via `computeLineTotal(weightKg: Decimal, ratePerKg: bigint): bigint` in `src/lib/weight-helpers.ts` — Decimal × BigInt multiplication with `ROUND_HALF_EVEN` (banker's rounding) to integer paise. Stored on the row so parent-total aggregation and per-line audit history are both straightforward.
- **Same `Cascade`-only-on-actual-delete behaviour as Sale / Purchase line items.** Soft-deleting a parent (`deletedAt` set) does NOT cascade; line items remain attached and are hidden via the parent's `deletedAt IS NULL` filter in list queries.
- **Replace-all pattern on edit** — `tx.castingLineItem.deleteMany({ where: { castingEntryId } })` then `tx.castingEntry.update({ data: { ..., lineItems: { create: [...] } } })` inside `prisma.$transaction`. Mirrors Phase 7 Sale / Purchase line-item edit pattern.
- **No per-line discount** (consistent with Sale / Purchase line items).
- **Indexes:** `@@index([<entry>Id])` for the dominant join-on-parent-id access pattern.

### CastingPayment / PlatingPayment (built Phase 9)
`id, <entry>Id (FK → parent, onDelete: Cascade), date, amount (BigInt paise), type (PaymentType: PAYMENT | REFUND, default PAYMENT), note, createdAt, updatedAt, deletedAt`

- **Reuses the `PaymentType` enum** from Sales / Purchases (single enum definition, four payment models). REFUND-type rows reduce the entry's net paid amount in the same `SUM(amount WHERE type=PAYMENT) − SUM(amount WHERE type=REFUND)` aggregation used elsewhere.
- **REFUND semantics**: vendor refunds money back to the shop (money IN, same direction interpretation as Purchases REFUND).
- **Payments are immutable** — no `update*Payment` action; wrong payment → soft-delete + create new. Same audit-preservation pattern as Sales / Purchases.
- **Action-layer validation**:
  - PAYMENT rejected if `amount > entry.total − netPaid` with `errors.amount = ["Owed to vendor: ₹X"]` ("Owed to vendor" reflects the Purchases-direction inversion — the shop owes the vendor).
  - REFUND rejected if `amount > netPaid` with `errors.amount = ["Refund exceeds amount paid. Maximum: ₹X"]`.
- **Currency pipeline** identical to other payment models — `amount` is BigInt paise; `serializeCastingPayment` / `serializePlatingPayment` returns Number at the action boundary.
- **Indexes:** `@@index([<entry>Id])`, `@@index([<entry>Id, type])` (typed-aggregation speed), `@@index([deletedAt])`.

## 5. Status Logic

**Statuses are derived, never stored.** Computed at query time from the payment / return children.

For a Sale, status is computed by `computeSaleStatus({ total, paidAmount?, returnTotal? })` in `src/lib/sale-status.ts`:

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

`paidAmount` here is the **net** of `SUM(SalePayment.amount WHERE type=PAYMENT, deletedAt:null) − SUM(... WHERE type=REFUND, deletedAt:null)`. `returnTotal` is `SUM(SaleReturn.refundAmount WHERE deletedAt:null)`.

`serializeSale()` is the single call site that computes both aggregates and invokes `computeSaleStatus`. The page-level query (`prisma.sale.findMany({ include: { payments: { where: { deletedAt: null } }, returns: { where: { deletedAt: null } } } })`) fetches the rows that feed it.

The **"Completed transactions"** view (Phase 5) is just a filter where status is `completed` across Sales and Purchases.

Karigar balance follows the same derived pattern — `sum(WorkEntry.total) − sum(WorkPayment.amount) − sum(WorkReversal.total)`, see §4.

**Why derived:** lets returns and refunds amend history without manual status syncing. Source of truth is the payment + return children.

**Phase 3.3 active.** `refund_due` is now a live state, fires when a return reduces effectiveTotal below paidAmount. The full-return-no-payment edge (`returnTotal === total, paidAmount === 0n`) resolves to `completed` because the case is unreachable in production (action layer blocks `cumulative returns > sale.total`), but the function handles it gracefully if it ever arises via direct API access. **Refunds are recorded via `SalePayment` with `type=REFUND`** rather than a separate `SaleRefund` table — same form, same workflow, opposite sign in the aggregation. The Sales transaction model is structurally complete; only **Phase 3.4 (receipts)** remains.

**Phase 4 unified helper.** `computeTransactionStatus({ total, paidAmount?, returnTotal? })` in `src/lib/transaction-status.ts` serves both Sales and Purchases — same math, same four branches, no entity-specific divergence. Type aliases `SaleStatus` (in `sales/sale-helpers.ts`) and `PurchaseStatus` (in `purchases/purchase-helpers.ts`) preserve readability at the call site ("a SaleStatus is what a Sale has") without code duplication. The Purchases-direction interpretation of `refund_due` (supplier owes shop money back) and `pending` (shop owes supplier money) is purely a UI concern — see `purchases/payment-panel.tsx` for the label inversions. If business rules ever diverge between Sales and Purchases (different thresholds, different boundary behavior), `transaction-status.ts` is the natural extension point with predictable refactor cost. Same applies to the unified `<TransactionStatusChip>` in `src/components/` — single component, both folders import it.

**Walk-in auto-promotion (Phase 6).** When a sale or purchase is saved as a walk-in (no explicit `customerId`/`supplierId`) but WITH a populated `partyPhone`, the server transactionally either links to an existing Customer/Supplier (matched by normalized phone) or auto-creates one. The transaction guarantees atomicity: if the customer/supplier create fails, the sale/purchase is not created either. Auto-promotion paths trigger `revalidatePath('/customers')` or `revalidatePath('/suppliers')` in addition to the usual `revalidatePath('/sales' | '/purchases')`, so the master-data list reflects the new auto-created entity on next navigation. Walk-ins WITHOUT a phone stay as snapshot-only entries (no FK) because identity cannot be confirmed. The lookup-or-create logic lives in `buildSaleData` / `buildPurchaseData` in `sales/actions.ts` / `purchases/actions.ts`.

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
- **Role gates on every server action.** Every server action calls `await requireRole([...allowedRoles])` as its first await. The list is per-action and declares which roles can invoke it — reading the action's first line tells you the access matrix at a glance. `requireRole` throws `Unauthorized` (no session) or `Forbidden` (wrong role); both halt the action before any DB work. The older `requireSession()` helper still exists in `src/lib/auth-guards.ts` for cases where any authenticated user is sufficient (currently none — Phase 5 migrated every action).
- **Phone identity for parties.** `Customer.phone` and `Supplier.phone` are the identity anchors for walk-in auto-promotion. Phones are normalized via `src/lib/phone.ts#normalizePhone` (strips whitespace, dashes, parens; preserves leading `+` for international numbers; returns `null` for empty/whitespace-only). Normalization is **idempotent** — running it on an already-clean phone is a no-op. Apply at every **storage** boundary (`Customer.phone`, `Supplier.phone`, `Sale.partyPhone`, `Purchase.partyPhone` schemas) AND at every **lookup** boundary (`findFirst` calls in auto-promotion, party-picker phone-prefix match). Without symmetric normalization, the lookup misses already-stored records. Pattern established Phase 6.
- **Multi-item line items use replace-all on edit.** When updating a `Sale` or `Purchase`, the action runs `tx.saleLineItem.deleteMany({ where: { saleId } })` (or the purchase equivalent) followed by `tx.sale.update({ data: { ..., lineItems: { create: [...] } } })` inside `prisma.$transaction`. Atomicity guarantees either all line items replace cleanly or none do. Line items are subordinate to the parent (no `deletedAt` on `SaleLineItem` / `PurchaseLineItem`); the audit-relevant unit is the parent — `Sale.deletedAt` / `Purchase.deletedAt` is the right granularity. Pattern established Phase 7.
- **Browser → R2 file uploads use a two-step prepare/confirm flow.** `prepareUpload` (server action) validates the schema → creates a PENDING Bill row → returns a 10-min presigned PUT URL. The browser PUTs the bytes directly to R2 (no Vercel transit, no body size limit at the function layer). `confirmUpload` (server action) re-fetches the Bill row → calls `headObject` against R2 → checks the actual object's mime + size match what was registered at prepare time → flips the row to READY (or FAILED + R2 cleanup on mismatch). Both actions revalidate `/admin/bills-test`. Same pattern is the extension point for Phase 3.4 retrofit (attach a Bill to a Sale / Purchase / payment): the parent entity's form modal triggers `prepareUpload` with the appropriate `attachedToType` + `attachedToId`, the browser PUTs, then `confirmUpload` lands. Pattern established Phase 8.
- **Lazy-init Proxy wrappers for SDK clients** (Prisma, R2). Any module that constructs an SDK client from env vars must wrap the construction in a `globalThis`-cached `Proxy` so the env read defers until first property access. Next.js 16's build-time page-data collection imports route modules to extract metadata; if construction is eager, missing env at collection time crashes the build even when env is present for runtime requests. See `src/lib/prisma.ts` (Phase 4.5) and `src/lib/r2.ts` (Phase 8) for canonical examples.
- **Weight pipeline.** Weight stored as `Decimal(10, 3)` kg. Rate stored as `BigInt` paise per kg. Line total computed via `computeLineTotal(weightKg: Decimal, ratePerKg: bigint): bigint` from `src/lib/weight-helpers.ts` — Decimal.js `mul()` + `toDecimalPlaces(0, ROUND_HALF_EVEN)`. Returns `BigInt` paise. **Never inline `weightKg.mul(...)` outside this helper.** Banker's rounding (ROUND_HALF_EVEN) avoids systematic bias accumulating across many rounded transactions. Pattern established Phase 9 (`CastingLineItem` / `PlatingLineItem`).
- **Decimal serialisation at the action boundary.** Decimal columns serialise as strings at the action boundary (e.g., `weightKg: "2.500"`), not JS numbers. JS Number cannot safely round-trip 3-decimal-place values (`2.500 → 2.5` collapses trailing zeros and loses the gram-precision contract enforced at the DB column level). Use `formatKg(s: string)` from `src/lib/weight-helpers.ts` for display. Never `Number(decimalField)` before display arithmetic. Symmetric pattern with BigInt → Number paise at the action boundary — both are "storage primitives that need precision preservation across the JSON wire."
- **Weight pipeline arithmetic is exact to the paisa.** `computeLineTotal(weightKg, ratePerKg)` from `src/lib/weight-helpers.ts` returns `BigInt` paise. Verified Phase 9 → Phase 10.6 walkthrough: 2.500 kg × ₹400/kg + 1.875 kg × ₹350/kg − ₹100 = 155625 paise = ₹1,556.25 exactly. No floating-point drift, no rounding accumulation across multi-line entries. The Decimal × BigInt multiplication happens inside the helper with `ROUND_HALF_EVEN` (banker's rounding) and lands at integer paise; the parent's `total = SUM(lineTotal) − discount` operation is BigInt-on-BigInt with no precision loss. Live-preview math in the form (`Math.round(weight × rate × 100)`) is a UX hint only; the server's computeLineTotal output is the source of truth.
- **Phase 9 expanded role-aware feature surface.** `CASTING_PLATING_MGMT` now has real functionality (Casting + Plating + Vendors pages, real dashboard with 4 cards: casting/plating monthly counts + totals, total owed, vendor count). The role's dashboard was a placeholder for four phases; it is now a working surface. Sidebar order: Dashboard → Sales → Customers → Purchases → Suppliers → Employees → Casting → Plating → Vendors → (Soon items).
- **Forms as pages (all four transactional entities).** All transactional entities — Sales, Purchases, Casting, Plating — use dedicated `/<entity>/new` and `/<entity>/[id]/edit` routes with standalone form components (`sale-form.tsx`, `purchase-form.tsx`, `casting-form.tsx`, `plating-form.tsx`) — RHF + `useFieldArray` + `zodResolver`. The page wraps it with the data fetch (customers/suppliers/vendors + entity-if-edit). The list page's "+ Add" is a `<Link>` to `/new`, not a state-driven modal. Form modals removed. Cancel button + `<Link>` back to the list page for navigation out without saving.
- **Read-only detail modals (all four entities).** `SaleDetailModal` / `PurchaseDetailModal` / `CastingDetailModal` / `PlatingDetailModal` show data only — no Add Payment / Add Return / Replace Bill / Delete buttons inside. All edits route through: (a) the inline action buttons in the table row (Pay, Bill, Return where applicable) which open the shared `PaymentActionModal` / `BillActionModal` / `ReturnActionModal`, or (b) the bottom Edit link which navigates to `/<entity>/[id]/edit`. The Detail modals also render read-only Payments (and Returns, for Sales/Purchases) history alongside line items. Casting/Plating have no Returns workflow (Phase 9 decision); their detail modals + tables carry only Pay + Bill action buttons.
- **Inline bill section in form pages (all four entities).** All transactional form pages include a pre-upload bill section between line items and totals: file picker → `BillPreview` (browser-native `URL.createObjectURL`). On submit, the chain runs AFTER the entry create/update succeeds. Sales/Purchases use discriminator-only (`prepareUpload → R2 PUT → confirmUpload`); Casting/Plating add a final FK update step (`attachBillToCastingEntry` / `attachBillToPlatingEntry`) after `confirmUpload`. Edit mode adds NEW bills only; replace / remove of an existing bill uses the row-level 📎 action modal. On upload failure AFTER entry create, the entry stays saved and an error banner directs the user to the row-level 📎 modal for retry.
- **BillActionModal prop contract.** `onAttach` and `onDetach` props are optional. Absent → discriminator-only flow (Sales/Purchases) — the modal short-circuits both calls. Present → FK + discriminator flow (Casting/Plating) — `onDetach` runs FIRST in the replace path (clears the FK so the soft-delete can fire without tripping `@unique`), and `onAttach` runs LAST after `confirmUpload`. The internal chain `getBillForEntity → [onDetach] → softDelete → prepareUpload → R2 PUT → confirmUpload → [onAttach]` handles both cases via short-circuit on undefined props; the caller wires entity-specific actions via prop closure. Same component handles both attachment patterns cleanly. Pattern established Phase 10.5 (Sales/Purchases); extended Phase 10.6 (Casting/Plating).
- **Bill discoverability via two paths.** Casting / Plating use `entry.billId` FK on the parent row (direct lookup via `prisma.castingEntry.findUnique({ include: { bill: true } })`). Sales / Purchases use `getBillForEntity(attachedToType, attachedToId)` in `bills/actions.ts` — the discriminator-only lookup (no `billId` FK on the entity side). Same `Bill` table, different lookup paths — chosen based on whether the entity ever needs to attach exactly-one bill at the *schema* level. The 1:1 invariant for Sales/Purchases is enforced at the application layer (the replace flow soft-deletes the prior bill before uploading a new one) rather than via `@@unique`.
- **Stale-closure pattern for synchronous-read values in async submission.** When a callback needs to set a value AND immediately trigger an async submit that reads it, use **`useRef`** (not `useState`). React state batches asynchronously; the submit closure may capture the previous value. Symptom: the value flip is silently ignored — e.g., "Save and add another" behaves identically to "Save and return." See `sale-form.tsx`'s `saveModeRef.current = m; handleSubmit(onSubmit)()` for the canonical example. Caught by the Phase 10 walkthrough Step 2 timeout. The `SaveDropdown`'s tests pin the consumer-side contract that each click produces its own `onSave(mode)` call.
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

## 9. Deployment (Phase 4.5)

Hosted on Vercel; production fed from `main`. Operational reference lives in `docs/HANDOFF.md` — read that before changing prod env, rotating secrets, applying migrations, or rolling back a deploy.

- **Vercel project:** `jewlerytracker` (org: `darshan-somaiyas-projects`). Framework auto-detected as Next.js; node 24.x; Fluid Compute (Node serverless), region `iad1`.
- **Repository:** `Darshan36/jewelry-tracker`. Push to `main` auto-deploys; no PR gate yet.
- **Production database:** Supabase project `cseqdcrfnvgsalsyhjsz` (Mumbai, ap-south-1). Independent from the dev project — schemas synchronized via `prisma migrate deploy`, never via data copy.
- **Auth gate:** Auth.js JWT cookie sessions only. Vercel's project-level SSO Deployment Protection is disabled (the app does its own auth). Re-enable only if you also wire up a way for staff to bypass it.
- **Prisma client construction is lazy.** `src/lib/prisma.ts` uses a Proxy so `DATABASE_URL` is only read on first query, not at module load. This is required so Next.js 16's build-time page-data collection can import route modules without crashing when env-resolution timing differs from runtime. Do NOT revert to eager construction.
- **The `authorize()` callback in `src/lib/auth.ts` console.errors any thrown exception** before rethrowing. Auth.js v5 otherwise hides the underlying cause as a generic `Configuration` error. Keep this wrapper — it's the only diagnostic path for prod auth failures until proper observability is wired in.
- **Direct user inserts to the production `users` table must specify `role` explicitly** (no DB default since Phase 5). Production currently has 4 users: 1 ADMIN (the owner) + 3 test accounts (one per non-admin role — see [`HANDOFF.md` § Test accounts](./docs/HANDOFF.md)). Test account passwords are in admin's password manager. Until the user-management UI ships, new users go in via Supabase MCP or `pg` + `.env.production.local` with bcrypt-hashed passwords.
- **Cloudflare R2 bucket configuration (Phase 8).** The prod bucket name and account ID come from the 5 `R2_*` env vars (see `.env.example` for the key list). The bucket needs a one-time CORS policy applied via S3 API (`PutBucketCors`) allowing PUT/GET/HEAD/DELETE from `https://jewlerytracker-darshan-somaiyas-projects.vercel.app`, the git-main alias, `https://*.vercel.app` (preview deploys), and the local dev origins. Setting CORS requires an **Admin Read & Write** R2 token (the regular Object R&W token used by the app gets `AccessDenied`); rotate the app token back to Object R&W after CORS is in place. CORS rules persist independent of the token that set them, so this is a one-time setup. Env-var changes do NOT auto-redeploy on Vercel — after editing R2 keys in the Vercel dashboard, trigger a redeploy from the dashboard or via API.
- **Phase 9 migration was additive-only.** `20260517135837_add_casting_plating_tables` creates 7 new tables (`casting_plating_vendors` + 6 casting/plating tables) and adds FK constraints on the entry side to `bills(id)`. No existing-table modifications; the migration ran cleanly on both dev and prod via `prisma migrate deploy`. No special procedures or downtime needed. Verified via Supabase MCP that `weightKg` columns are `numeric(10, 3)`.

---

## Known gaps and deferred decisions

See [`KNOWN_GAPS.md`](./KNOWN_GAPS.md) at project root for the running list of deferred items, security debt, and decision lineage. Read it before starting a new phase — it flags items that need attention at known milestones (e.g. credential rotation before Phase 2, Prisma+PgBouncer compatibility flag when wiring Prisma).

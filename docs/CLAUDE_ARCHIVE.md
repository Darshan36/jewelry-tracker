# CLAUDE.md Archive — Historical Project Context

Historical project context, archived from CLAUDE.md to keep the working doc lean. Reference-only, not auto-loaded at phase start.

Working doc: [`../CLAUDE.md`](../CLAUDE.md) for current architecture, conventions, and recent phases.

Consult this archive when you need:
- "Why did we decide X?" — full decision lineage and rejected alternatives.
- "When did entity Y get column Z?" — phase-by-phase data-model evolution.
- "What did the system look like before phase N?" — superseded designs.
- Context for migrations that change a major model (e.g., the upcoming Phase 21a payment-model refactor needs the current bill-wise model documented for "why we changed" lookback).

---

## Phase milestone history

Phase ordering mirrors the project plan; sub-phase letters denote scope splits within a single milestone.

### Phase 1 — Foundation

Next.js + Tailwind + Prisma + Auth.js + base shell. Original design system was **deep-navy dark theme** (replaced Phase 11.5 by techno-artisanal LIGHT). Original speculative data model included `WorkEntry` / `WorkPayment` / `WorkReversal` / `FixedSalary` placeholder tables — superseded Phase 18 by `PieceEntry` + `EmployeePayment`. See "Superseded data model" below.

### Phase 2 — Master data (Customers / Suppliers / Employees)

- **Phase 2.1 Customers** (pre-Phase 17a Party unification): standalone `customers` table with `name, phone, email, address, notes, deletedAt`. No `email` uniqueness — real entry produced dupes. `phone` normalized on save via `src/lib/phone.ts#normalizePhone`. Soft-delete via `deletedAt`. Folded into Party in Phase 17a.
- **Phase 2.2 Suppliers** (pre-Phase 17a Party unification): structural mirror of Customer. Folded into Party in Phase 17a.
- **Phase 2.3 Employees**: established the currency pipeline (rupees in form, BigInt paise in DB, Number in JSON wire). Form's zod schema kept rupees; conversion happened in the action's `toPrismaData()` helper at the Prisma boundary — NOT in the schema's `.transform()` — to keep client-send / server-re-parse wire format symmetric. Pattern reused for every monetary field in Phase 3+.

### Phase 3 — Sales (3.1 entry, 3.2 payments, 3.3 returns/refunds, 3.4 receipts)

- **3.1 Sale entry**: introduced the dual-path party model (FK to Customer OR walk-in `partyName`/`partyPhone` snapshot). `total` stored, not derived — recomputed on every update. Status `computeSaleStatus(sale)` in `src/lib/sale-status.ts` was the original status function; Phase 3.1 always returned `'pending'` because no payments/returns existed yet. Forward-compatible signature was the design intent.
- **3.2 Payments**: added `SalePayment` child table. Net `paidAmount = SUM(SalePayment.amount WHERE deletedAt:null)` — no cached column on `Sale` (rejected to avoid drift risk; aggregation cheap at ~100 sales/month). Payments immutable — no `updateSalePayment`; wrong payment → soft-delete + create new.
- **3.3 Returns + refunds**: added `SaleReturn` (product back) + `PaymentType` enum (`PAYMENT | REFUND`) on `SalePayment` (money flow). **Refunds are recorded via `SalePayment` with `type=REFUND`** rather than a separate `SaleRefund` table — same form, same workflow, opposite sign in the aggregation. `refund_due` became a live state (return reduces `effectiveTotal` below `paidAmount`). Full-return-no-payment edge resolves to `completed` — case unreachable in production (cumulative-returns validation blocks it) but the helper handles it gracefully.
- **3.4 Receipts**: deferred at Phase 8 with the broader bill/attachment system.

**Decision lineage — refund via SalePayment.REFUND rather than SaleRefund table**: returns are "product back," refunds are "money flow." A separate `SaleRefund` table would have forced consumers to read three child tables for status; folding refunds into SalePayment with a type discriminator keeps the money-flow aggregation single-table and the workflow form symmetric (date + amount + note in both directions).

### Phase 4 — Purchases

Structural mirror of Sales. Same `partyId` FK + walk-in dual-path, same currency pipeline, same Payment/Return tables, same stored-total convention. UI label inversions baked in from day one: "Owed to supplier" (not "Outstanding"), "Refund expected" (not "Refund owed"), REFUND-row blue `+` styling (money IN to shop) vs Sales' red `−` (money OUT of shop). Mental model: red = money out, blue = money in, regardless of which entity owns the row.

**Phase 4 unified helper**: `computeTransactionStatus({ total, paidAmount?, returnTotal? })` in `src/lib/transaction-status.ts` serves both Sales and Purchases — same math, same four branches, no entity-specific divergence. Type aliases `SaleStatus` / `PurchaseStatus` preserve readability at the call site without duplicating logic. Unified `<TransactionStatusChip>` component used by both folders.

### Phase 4.5 — Production deploy

Deployed to Vercel (`jewlerytracker` project — pre-existing typo preserved) with production Supabase Postgres (`cseqdcrfnvgsalsyhjsz`, Mumbai). Established the **lazy-init Proxy wrappers for SDK clients** pattern (`src/lib/prisma.ts`): construction of the Prisma client must defer to first property access because Next.js 16's build-time page-data collection imports route modules before env is fully resolved; eager construction crashes the build with missing `DATABASE_URL` even when the runtime env is correct. Same pattern reused for R2 in Phase 8.

Also established that **`authorize()` in `src/lib/auth.ts` must console.error any thrown exception before rethrowing** — Auth.js v5 otherwise masks the underlying cause as a generic `Configuration` error, leaving prod auth failures undebuggable until proper observability is wired.

Operational reference moved to `docs/HANDOFF.md`.

### Phase 5 — RBAC

Introduced `Role` enum (`ADMIN | PURCHASE_DEPT | LABOUR_MGMT | CASTING_PLATING_MGMT`) and the `requireRole(allowedRoles[])` server-action guard pattern. STAFF default was removed; every new user must explicitly choose a role (direct DB inserts must specify `role`). `requireRole` throws `Unauthorized` (no session) or `Forbidden` (wrong role); both halt before any DB work. The older `requireSession()` helper in `src/lib/auth-guards.ts` remained available but went unused after Phase 5 migrated every action.

Three-layer access pattern established: (1) `src/proxy.ts` URL gate via `ROUTE_ROLES`; (2) page server-component redirect via `canX(role)` helpers in `src/lib/role-access.ts`; (3) every server action calls `requireRole([...])` as its first await.

**Phase 5.5 multi-permission refactor** was explicitly dropped — the four-role single-role-per-user model was sufficient for the workshop's actual workflows. If finer-grained permissions become useful later, the addition shape is a separate `permissions` table rather than expanding the Role enum further.

### Phase 6 — Walk-in auto-promotion

When a sale or purchase is saved as a walk-in (no explicit FK) but WITH a populated `partyPhone`, the server transactionally either links to an existing master record (matched by normalized phone) or auto-creates one. Atomicity: if the master create fails, the transactional record is not created either. Auto-promotion paths trigger `revalidatePath('/customers')` / `revalidatePath('/suppliers')` in addition to the usual transactional path so the master-data list reflects the new record on next navigation. Walk-ins WITHOUT a phone stay snapshot-only (no FK) because identity cannot be confirmed.

Established the **phone normalization convention**: `src/lib/phone.ts#normalizePhone` strips whitespace, dashes, parens; preserves leading `+`; returns `null` for empty/whitespace-only. Idempotent. Apply at every **storage** boundary (master phone columns, transactional `partyPhone`) AND at every **lookup** boundary (`findFirst` calls in auto-promotion, party-picker phone-prefix match). Asymmetric normalization → lookup misses already-stored records.

### Phase 7 — Multi-item line items

Restructured `Sale` and `Purchase` to move `qty` / `rate` / `itemDescription` from the parent row into child tables (`SaleLineItem` / `PurchaseLineItem`). Parent row now carries per-transaction metadata only. **Sale/Purchase-level discount only** — no per-line discount. Workshop invoicing speaks "whole-job discount" ("₹13,500 of items, give it for ₹13,000").

**Replace-all-on-edit** pattern established: `tx.saleLineItem.deleteMany({ where: { saleId } })` then `tx.sale.update({ data: { ..., lineItems: { create: [...] } } })` inside `prisma.$transaction`. Line items are subordinate (no `deletedAt`); audit-relevant unit is the parent.

**Cascade-only-on-actual-delete**: `onDelete: Cascade` on the line-item FK fires only on actual DELETE — soft-deleting the parent leaves line items in place, filtered out of list queries via the parent's `deletedAt IS NULL` clause.

### Phase 8 — Bills via Cloudflare R2 (later renamed Attachment)

File storage on Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3`. Originally named `Bill` model; renamed to `Attachment` in the polish session after Phase 12a added photo storage (the "Bill" name became semantically misleading once it stored invoices AND photos). **User-facing UI continues to use "bill" / "Add bill" / "View bill"** for invoice attachments — workshop users think of those as bills regardless of internal name.

**Two-step prepare/confirm browser upload flow**:
1. `prepareUpload` server action validates schema → creates PENDING Attachment row → returns 10-min presigned PUT URL.
2. Browser PUTs bytes directly to R2 (no Vercel transit, no body-size limit at the function layer).
3. `confirmUpload` server action re-fetches the row → calls `headObject` against R2 → checks actual mime + size match what was registered → flips row to READY (or FAILED + R2 cleanup on mismatch).

**Discriminator pattern — no FK on `attachedToId`**: `attachedToType` is a string-enum (validated against `ATTACHED_TO_TYPES` allowlist); `attachedToId` is unconstrained `String?` carrying the parent's cuid. Postgres has no native polymorphic FK; the discriminator is the conventional workaround. Extending to a new attached-to kind = extend `ATTACHED_TO_TYPES` + add a row to the access matrix in `src/lib/attachment-access.ts`. The Attachment table never changes shape. **Trade-off**: orphan reference detection on parent delete is the caller's responsibility (no DB-level cascade); Phase 3.4 retrofit will need a per-parent-entity audit step.

**R2 key format:** `bills/YYYY/MM/<uuid>-<sanitized-filename-prefix>`. The `bills/` prefix is retained for historical continuity with the Phase 8 keys in the bucket; new keys continue to use it. UUID via `crypto.randomUUID()` is independent of the Attachment row's `id` because Prisma generates the cuid at INSERT time but `r2Key` is required-non-null on the same insert. `@@unique` on `r2Key` is the DB safety net against UUID collision.

**Soft delete via `deletedAt`**: `softDeleteAttachment` deletes the R2 object FIRST then sets `deletedAt`. If R2 delete fails, the DB tombstone still applies; the R2 orphan is left for a deferred cleanup job (see KNOWN_GAPS).

**Cloudflare R2 production setup**: The prod bucket needs a one-time CORS policy applied via S3 API (`PutBucketCors`) allowing PUT/GET/HEAD/DELETE from `https://jewlerytracker-darshan-somaiyas-projects.vercel.app`, the git-main alias, `https://*.vercel.app` (preview deploys), and local dev origins. Setting CORS requires an **Admin Read & Write** R2 token (the regular Object R&W token used by the app gets `AccessDenied`); rotate the app token back to Object R&W after CORS is in place. CORS rules persist independent of the token that set them — one-time setup. Env-var changes do NOT auto-redeploy on Vercel.

### Phase 9 — Casting & plating

Outsourced casting/plating jobs tracked via two separate entity types (`CastingEntry`, `PlatingEntry`) sharing a single `CastingPlatingVendor` master (later folded into Party in Phase 17a). **Two separate entity types, not unified with a type discriminator** — separate sidebar items match separate workflow concepts. Structural mirror maintained via a reproducible mirror script (`scripts/_mirror-casting-to-plating.mjs`, gitignored). If future outsource categories emerge (polishing / welding / etc.), the pattern extends by adding new entity types rather than overloading a discriminator column.

**Weight pipeline**: weight stored as `Decimal(10, 3)` kg (kg with 3-decimal-place gram precision — stored as kg, not grams, for readability; the workflow speaks kg). Rate stored as `BigInt` paise per kg. Line total computed via `computeLineTotal(weightKg: Decimal, ratePerKg: bigint): bigint` from `src/lib/weight-helpers.ts` — Decimal.js `mul()` + `toDecimalPlaces(0, ROUND_HALF_EVEN)` (banker's rounding, to avoid systematic bias across many transactions). Returns `BigInt` paise. **Never inline `weightKg.mul(...)` outside this helper.**

**Decimal serialisation at the action boundary**: Decimal columns serialise as strings (e.g., `weightKg: "2.500"`), not JS numbers. JS Number cannot safely round-trip 3-decimal-place values (`2.500 → 2.5` collapses trailing zeros and loses the gram-precision contract). Use `formatKg(s: string)` from `src/lib/weight-helpers.ts` for display. Never `Number(decimalField)` before display arithmetic. Symmetric pattern with BigInt → Number paise at the action boundary — both are "storage primitives that need precision preservation across the JSON wire."

**No returns workflow on casting/plating**: outsourced services have no returnable-goods analogue. Vendor rework is handled either by no transaction change (free rework) or by a `REFUND`-type payment row.

**Attachments via FK on entry side**: `attachmentId @unique` FK on each entry, plus the same `attachedToType` + `attachedToId` discriminator on the Attachment row. The FK is the at-most-one-per-entry contract; the discriminator remains the authoritative access-control source. The Attachments SQL row was untouched by Phase 9 — reverse fields `castingEntry: CastingEntry?` / `platingEntry: PlatingEntry?` are Prisma-only inverse relations (no SQL change).

**Migration was additive-only**: `20260517135837_add_casting_plating_tables` creates 7 new tables (`casting_plating_vendors` + 6 casting/plating tables) and adds FK constraints on the entry side to `bills(id)`. No existing-table modifications; ran cleanly on both dev and prod via `prisma migrate deploy`. No downtime needed.

**Phase 9 expanded role-aware feature surface**: `CASTING_PLATING_MGMT` got real functionality (Casting + Plating + Vendors pages, dashboard with 4 cards: casting/plating monthly counts + totals, total owed, vendor count). The role's dashboard was a placeholder for four phases; Phase 9 made it a working surface. Sidebar order: Dashboard → Sales → Customers → Purchases → Suppliers → Employees → Casting → Plating → Vendors → (Soon items).

**Weight pipeline arithmetic exact to the paisa**: verified Phase 9 → Phase 10.6 walkthrough: 2.500 kg × ₹400/kg + 1.875 kg × ₹350/kg − ₹100 = 155625 paise = ₹1,556.25 exactly. No floating-point drift, no rounding accumulation across multi-line entries. The Decimal × BigInt multiplication inside the helper with ROUND_HALF_EVEN lands at integer paise; the parent's `total = SUM(lineTotal) − discount` is BigInt-on-BigInt with no precision loss. Live-preview math in the form (`Math.round(weight × rate × 100)`) is a UX hint only; the server's `computeLineTotal` output is the source of truth.

### Phase 10 / 10.5 / 10.6 — Forms-as-pages UX migration

Completed the form-as-page + read-only-detail-modal + inline-action-button UX pattern across **all four transactional entities (Sales, Purchases, Casting, Plating)**. All four use dedicated `/<entity>/new` and `/<entity>/[id]/edit` routes, standalone form components (`sale-form.tsx`, `purchase-form.tsx`, `casting-form.tsx`, `plating-form.tsx`) — RHF + `useFieldArray` + `zodResolver`. The page wraps the form with the data fetch (parties + entity-if-edit). The list page's "+ Add" is a `<Link>` to `/new`, not a state-driven modal. Form modals removed. Cancel button + `<Link>` back to the list page for navigation out without saving.

**Read-only detail modals**: `SaleDetailModal` / `PurchaseDetailModal` / `CastingDetailModal` / `PlatingDetailModal` show data only — no Add Payment / Add Return / Replace Bill / Delete buttons inside. All edits route through either (a) inline action buttons in the table row (Pay, Bill, Return where applicable) opening the shared `PaymentActionModal` / `AttachmentActionModal` / `ReturnActionModal`, or (b) the bottom Edit link navigating to `/<entity>/[id]/edit`. Detail modals render read-only Payments (and Returns, for Sales/Purchases) history alongside line items. Casting/Plating have no Returns workflow (Phase 9 decision); their modals + tables carry only Pay + Bill action buttons.

**Inline bill section in form pages**: all transactional form pages include a pre-upload bill section between line items and totals: file picker → `AttachmentPreview` (browser-native `URL.createObjectURL`). On submit, the chain runs AFTER the entry create/update succeeds. Sales/Purchases use discriminator-only (`prepareUpload → R2 PUT → confirmUpload`); Casting/Plating add a final FK update step (`attachAttachmentToCastingEntry` / `attachAttachmentToPlatingEntry`) after `confirmUpload`. Edit mode adds NEW attachments only; replace / remove of an existing attachment uses the row-level 📎 action modal. On upload failure AFTER entry create, the entry stays saved and an error banner directs the user to the row-level 📎 modal for retry.

**AttachmentActionModal prop contract**: `onAttach` and `onDetach` props are optional. Absent → discriminator-only flow (Sales/Purchases). Present → FK + discriminator flow (Casting/Plating) — `onDetach` runs FIRST in the replace path (clears the FK so the soft-delete can fire without tripping `@unique`), and `onAttach` runs LAST after `confirmUpload`. Same component handles both attachment patterns cleanly. Pattern established Phase 10.5 (Sales/Purchases); extended Phase 10.6 (Casting/Plating).

**Attachment discoverability via two paths**: Casting/Plating use `entry.attachmentId` FK on the parent row (direct lookup via `prisma.castingEntry.findUnique({ include: { attachment: true } })`). Sales/Purchases use `getAttachmentForEntity(attachedToType, attachedToId)` in `attachments/actions.ts` — discriminator-only lookup. Same `Attachment` table, different lookup paths — chosen based on whether the entity ever needs to attach exactly-one at the *schema* level. The 1:1 invariant for Sales/Purchases is enforced at the application layer (replace flow soft-deletes the prior attachment before uploading a new one) rather than via `@@unique`.

**Stale-closure pattern for synchronous-read values in async submission**: when a callback needs to set a value AND immediately trigger an async submit that reads it, use **`useRef`** (not `useState`). React state batches asynchronously; the submit closure may capture the previous value. Symptom: the value flip is silently ignored — e.g., "Save and add another" behaves identically to "Save and return." See `sale-form.tsx`'s `saveModeRef.current = m; handleSubmit(onSubmit)()` for the canonical example. Caught by the Phase 10 walkthrough Step 2 timeout. The `SaveDropdown`'s tests pin the consumer-side contract that each click produces its own `onSave(mode)` call.

### Phase 11 / 11.1 / 11.2 — Mobile compatibility

Mobile coverage is codebase-wide. **Phase 11.1** shipped the foundation: `useIsMobile()` hook (`src/lib/use-is-mobile.ts`) reading `matchMedia('(max-width: 767px)')`, `<ResponsiveTable>` wrapper (desktop table vs mobile cards branch), `<ResponsiveDialog>` (Dialog on md+, full-width bottom Sheet on mobile), sidebar drawer via `<Sheet>` on mobile, and mobile-card surfaces on all four transactional list pages.

**Phase 11.2** completed coverage:
- All eight form pages (sales/purchases/casting/plating × new/edit) use `p-4 md:p-10` and `text-2xl md:text-3xl`.
- All four form components use the `md:contents` trick for line items (single-column on mobile with qty/rate/× sub-grid row 2 + line total row 3; flat 5-col grid on desktop).
- SaveDropdown is full-width sticky-bottom on mobile (`flex w-full md:inline-flex md:w-auto`, `h-11 md:h-10`).
- All four master data tables (customers/suppliers/employees/vendors) wrap in `<ResponsiveTable>` with simpler mobile cards (name + phone + entity-specific aggregates — no inline action buttons; mutations through detail modal Edit).
- All four master data detail modals + form modals swap `Dialog → ResponsiveDialog`.
- Touch targets ≥44×44px on every mobile interactive element.

Conventions: (a) page wrappers `p-4 md:p-10`, headings `text-2xl md:text-3xl`, header spacing `mb-6 pb-4 md:mb-10 md:pb-6`; (b) search-row + add button `flex flex-col sm:flex-row sm:items-center`, input `w-full sm:flex-1 min-w-0`, button `h-11 sm:h-10 w-full sm:w-auto`; (c) line items use **`md:contents` trick** — outer `grid-cols-1 md:grid-cols-[…]` with inner sub-grid `grid-cols-[1fr_1fr_44px] md:contents` for qty/rate/× row, plus desktop-only line-total via `hidden md:flex` inside the sub-grid and mobile-only line-total row via `md:hidden` outside (Sales/Purchases use `[1fr_80px_120px_120px_40px]`, Casting/Plating use `[1fr_110px_130px_130px_40px]`); (d) form footers `flex flex-col-reverse sticky bottom-0 -mx-4 px-4 pb-4 bg-surface md:static md:flex-row md:justify-end`; (e) tables wrapped in `<ResponsiveTable>` with mobile-card render slot; (f) modals use `<ResponsiveDialog>`; (g) all interactive elements ≥44×44px on mobile.

**Master data mobile cards have NO inline action buttons** — cleaner; mutations through detail modal Edit. The workflow shape differs from transactional entities.

**Visual regression detection requires DevTools 390x844 or real-phone walkthrough**; matchMedia unit tests verify branch logic but not viewport-level layout (JSDOM doesn't evaluate CSS media queries).

### Phase 11.5 — Techno-artisanal LIGHT theme

Replaced deep-navy dark theme (Phase 1 through 11.2) with cream / slate / gold light theme. **No light/dark switcher** — future dark mode would refactor token VALUES (not the token names) in `globals.css`; every consumer is already token-aware.

Cream `#f5f0e6` background, white `#ffffff` card surfaces, warm gold `#c9a14a` primary accents, slate text (`#1a1f2e` body, `#525868` muted). Sharp 0px corners (`--radius-*` tokens all 0px), defined 1px borders (`border-outline-variant` = `#e8e0cd`), no drop shadows. Tonal layering (`bg-surface-container-low` ↔ `bg-surface-container-high`) replaces shadow for elevation. Zebra-stripe data tables by default.

**Components consume semantic tokens only** (`bg-surface`, `text-on-surface`, `border-outline-variant`, etc.) — never inline hex values in components. **Sole exception**: `transaction-status-chip.tsx` pins the four chip-color hexes directly (`#8a8e9a` / `#c9844a` / `#5e8c4f` / `#5a7ba6`) so the tinted-pill semantics survive future surface-token remaps.

shadcn components inherit the palette via compat aliases in `globals.css` (`--color-foreground`, `--color-card`, `--color-primary-foreground`, `--color-muted`, etc.).

### Phase 12a — Purchase photos

Added gallery photo attachments to Purchases. Locked decision: extend `ATTACHED_TO_TYPES` with a new `PURCHASE_PHOTO` value rather than (a) creating a parallel `Attachment` table, or (b) renaming `Bill → Attachment` (the latter happened anyway in the polish session, conceptually independent). The Bill table already encapsulated everything needed — R2 key, MIME, size, status state machine, soft-delete, role-aware access. Adding a new discriminator extends `ATTACHED_TO_TYPES` (one line), `ROLE_MATRIX` (one line), and the photo-specific MIME allowlist (`PHOTO_MIME_TYPES`, excludes PDF) — zero schema changes, zero migration. **Trade-off accepted**: the table name "Bill" became semantically misleading; resolved in polish session via Bill → Attachment rename.

**Photos attach to parent Purchase, not per-line-item**: workshop workflow is "photograph the receipt + the goods collectively" — no per-item lens. If a use case emerges (disputed quality on a specific SKU), revisit with a `PURCHASE_LINE_ITEM_PHOTO` discriminator.

**Multi-photo gallery (no hard limit)** — R2 capacity is the practical ceiling. Free tier 10GB ≈ 1000 photos at 10MB; realistic workload ~12000 photos in year one (still under cost threshold given typical sizes <2MB).

**Create-mode photos use collect-then-batch; edit-mode uses immediate uploads**: create mode holds `pendingPhotos: File[]` locally + thumbnails via `URL.createObjectURL`; on save, chain runs sequentially per photo. Failures surface in a banner but don't block the form. Edit mode's `<PhotoGallery mode="edit">` self-loads + uploads/deletes immediately. Hybrid because create mode needs the parent id to attach to (chicken-and-egg).

**Photo gallery + lightbox primitives**: `src/components/photo-gallery.tsx` is a self-loading thumbnail grid (`getPhotosForEntity` on mount + after add/delete). 2-column grid on mobile, 3-column on md+. Edit mode adds per-thumb X delete + "+ Add photo" tile. View mode is read-only thumbnails. Both click → open `src/components/photo-lightbox.tsx` for full-screen viewing with prev/next arrow overlays + ← / → keyboard nav (built on `ResponsiveDialog`). Both components fetch presigned GET URLs lazily via `getAttachmentViewUrl`.

### Phase 12c — Sale photos

Pure mirror of Phase 12a. Adds one allowlist value (`SALE_PHOTO`), one `ROLE_MATRIX` row (ADMIN-only, mirroring SALE's read access), one prop-union extension (`PhotoGallery`'s `entityType: "PURCHASE_PHOTO" | "SALE_PHOTO"`), one options arg on `serializeSale`. **Zero schema changes, zero migration.** Smallest phase by net source code (~250 LOC on Sales side); largest by infrastructure reuse.

**Sale photo access ADMIN-only** — inherits the SALE matrix. Rejected: give `LABOUR_MGMT` photo-only read access. The karigar's mental model is per-piece counts, not per-sale lookup. If a "show me sales of items I worked on" UX surfaces later, the right shape is a karigar-facing view querying from PieceEntry → Sale association.

**Adding photo support to a new entity** is the canonical extension: extend `ATTACHED_TO_TYPES`, add a `ROLE_MATRIX` entry, extend `PhotoGallery`'s `entityType` prop union, mount `<PhotoGallery>` on the parent's form/detail surfaces, add the `Photos (optional)` section to the entity form (create-mode `pendingPhotos: File[]` batched after entity create; edit-mode live `<PhotoGallery mode="edit">`), add the `<PhotoCountBadge>` to the table, extend `serializeEntity` with `options.photoCount`, and add a `prisma.attachment.groupBy` aggregate to the page query. `<PhotoGallery>` and `<PhotoLightbox>` reused as-is. ~1.5 hours per new entity; Phase 12c took +21 tests on top of existing infrastructure.

### Phase 16 — User management UI

ADMIN-only `/users` route replaces SQL-only user creation. List / create / edit / reset-password / deactivate / reactivate via UI. **Single-role-per-user model unchanged** (4 existing roles); the Phase 5.5 multi-permission refactor was explicitly dropped.

**Admin-set passwords + out-of-band communication** — no email infrastructure, no user-initiated self-reset. Passwords hashed via `src/lib/password.ts#hashPassword` (bcryptjs cost 12, exact match to `scripts/generate-test-users.mjs` + `src/lib/authorize-credentials.ts` compare).

**Soft-delete via `User.deletedAt`** for deactivation (was: no soft delete) — matches every other entity's convention; preserves audit-trail FK references on Party / PieceEntry / EmployeePayment / Attachment. Auth flow rejects deactivated users at `authorizeCredentials` BEFORE bcrypt — a correct password against a deactivated account still fails.

**Three server-side self-protection guardrails** in `users/actions.ts`:
- **G1**: admin cannot deactivate own account (`session.user.id === id` rejection in `deactivateUser`).
- **G2**: admin cannot change own role away from ADMIN (`isSelf && newRole !== 'ADMIN'` rejection in `updateUser`).
- **G3**: last-active-admin guard (`prisma.user.count({where:{role:'ADMIN',deletedAt:null}})` ≤ 1 rejection in both demote and deactivate paths).

Guardrails mirrored in UI for UX (disabled buttons + notices) but the security boundary is the action layer.

**Three-layer access** matches `/completed`/`/receivables`: proxy `ROUTE_ROLES["/users"] = ["ADMIN"]` + page server-component redirect via `canManageUsers(role)` + every action `requireRole(["ADMIN"])`.

**`UserForClient` strips `passwordHash` via explicit destructure** in `serializeUser` (not `...rest`) — future User-shape additions can't accidentally leak the hash through React Flight chunks or test snapshots.

**Authorize callback extraction**: Credentials provider's `authorize` callback delegates to `src/lib/authorize-credentials.ts` (extracted Phase 16 so unit tests can pin deactivation/bcrypt/null branches without standing up the full NextAuth runtime).

**Adding a self-protection guard for a future feature**: write it in the action first (rejection with field-keyed error message), then mirror in UI (button disabled with explanatory `title`/notice), then add an action test that asserts rejection AND an action test that asserts the non-self path succeeds. Three-layer (action + UI + test) is the canonical pattern.

### Phase 17a — Party unification

Customer / Supplier / CastingPlatingVendor consolidated into a single `Party` table with boolean role flags (`isCustomer`, `isSupplier`, `isCastingVendor`, `isPlatingVendor`). A single party can hold multiple roles — a regular who both sells to and buys from the shop is one row, not two. The four parallel master-data folders (`customers/`, `suppliers/`, `vendors/`) preserve their routes and UI labels but each queries Party filtered by the matching role flag.

**Role flags chosen over enum array**: rejected Postgres enum array column (`roles ARRAY OF Role`) — would require `roles @> ARRAY['CUSTOMER']` containment queries for every list-by-role page, awkward in Prisma's typed query API. Boolean-flag shape gives clean `where: { isCustomer: true }` filtering, indexable per role, zero raw-SQL escape hatches. Flag count bounded by actual workshop role taxonomy (~4–6 max even with future "polishing vendor" / "welding vendor" additions); enum-array extensibility doesn't outweigh query ergonomic loss at this scale.

**Casting/Plating flags split intentionally**, even though Phase 9 `CastingPlatingVendor` didn't distinguish — real workshops often do one but not the other. Migration sets both flags on existing rows (matching prior semantics); new walk-ins set only the form-context flag.

**Phone globally unique** across Party — phone-collision dedup in the migration consolidates rows sharing a phone with all relevant role flags set (most-recent source row wins canonical name/email/etc; older duplicates' transactions still resolve to canonical Party via phone join). Walk-in auto-promotion uses the same phone identity — collision adds the appropriate flag rather than duplicating.

**Walk-in auto-promotion implicit role from form context**: `/sales/new` → `isCustomer`; `/purchases/new` → `isSupplier`; `/casting/new` → `isCastingVendor`; `/plating/new` → `isPlatingVendor`. Phone-collision behavior: existing Party at the typed phone gets the new flag added (rather than duplicating). If user explicitly picks an existing Party from the picker dropdown that doesn't have the matching role flag, the action ALSO flips the flag. All inside `prisma.$transaction`. Rejected: require explicit role selection on walk-in form — would add a click for the common case; the form context is enough.

**Master data route names preserved**: `/customers`, `/suppliers`, `/vendors` remain after the unification — each page queries Party filtered by the matching role flag. User-facing UI labels preserved verbatim. Rejected: single `/parties` unified page — muscle memory ("`/customers` shows my customers") was the dominant constraint. If a unified party admin view becomes useful later, it can be added at `/parties` without disturbing existing routes. Type imports aliased (`import type { Party as Customer } from "@/generated/prisma"`) so existing UI code keeps its descriptive local type names. The Party type structurally satisfies all three legacy types.

**Transactional FKs renamed** (`Sale.customerId` / `Purchase.supplierId` / `CastingEntry.vendorId` / `PlatingEntry.vendorId` → `partyId`). The four per-entity pickers consolidated into a single `<PartyPicker>` (`src/components/party-picker.tsx`) parameterised by `role: 'CUSTOMER' | 'SUPPLIER' | 'CASTING_VENDOR' | 'PLATING_VENDOR'` + `inputIdPrefix` (entity-specific DOM ids to avoid cross-page portal collisions; pattern from polish session SP1).

**Adding a new role**: add a boolean column to Party, add a new `PartyRole` value to `src/components/party-picker.tsx`'s union, update walk-in auto-promotion logic in the relevant action. ~30 min for a new role.

### Phase 17b — Payables / Receivables UI

Party-level rollup views built on Phase 17a's unified model.
- **`/payables`** — list of parties with outstanding balances scoped by role (ADMIN sees all sources; PURCHASE_DEPT sees only purchase payables; CASTING_PLATING_MGMT sees only casting+plating payables; LABOUR_MGMT excluded).
- **`/receivables`** — ADMIN-only list of customers with outstanding sale balances.

**Party-rollup primary view**: default to one-row-per-party rollup with summed outstanding across all in-scope transactions; per-party detail page (`/payables/[partyId]`) one click away. Rejected: transaction-list-first view ("unpaid Bill #142, unpaid Bill #156"). Workshop user thinks "I owe Ramesh ₹30,000," not "I owe Ramesh ₹15k on Bill #142 + ₹15k on Bill #156." Party-first matches that mental model; one extra click surfaces the bill-level breakdown when needed.

**Bulk payment with user-picked allocation**: `<PartyPaymentModal>` lists all unpaid transactions for the chosen party; user checks ones to pay + edits per-row amounts; sum is the actual payment value. Rejected: FIFO auto-allocate. Typing "₹20,000" and having the system auto-apply to oldest-first transactions is faster but loses transparency. The accountant needs to see "which bill am I paying right now" to reconcile with the supplier's invoice. `createPartyPayment` in `src/app/(app)/parties/actions.ts` runs all `*Payment.create` calls inside one `prisma.$transaction` — if any single create fails, all roll back. Per-allocation validation rejects over-allocation with `errors.allocations[i]` so the modal surfaces the error on the failing row.

**Role-scoped payables, ADMIN-only receivables**: matches Phase 5 RBAC principle (each role sees the slice its workflow touches). Defense-in-depth at three layers — proxy `ROUTE_ROLES`, page server-component `canViewPayables(role, scope)` / `canViewReceivables(role)` redirect, `createPartyPayment` role-intersection gate across all allocations (a mixed sale+purchase bulk requires ADMIN).

**Outstanding balance pipeline** in `src/lib/outstanding-balances.ts` — single source-of-truth helper `computeOutstanding({ total, payments, returns? })` returns `bigint` paise per transaction, clamped to non-negative (overpaid → 0, not negative). Party-level aggregators (`listPayables(scope)`, `listReceivables()`, `getPayablesForParty(id, scope)`, `getReceivablesForParty(id)`); bulk-fetch attachments in a single `prisma.attachment.findMany` per aggregator to avoid N+1. **Scope** = `'purchase' | 'casting_plating' | 'all'`.

**Dashboard** gets per-role payables/receivables summary cards + top-3 party lists. **Missing-attachment badges** on payables/receivables list rows + on per-transaction rows inside `<PartyPaymentModal>`. **`<PartyRoleChips>`** (`src/components/party-role-chips.tsx`) — multi-role chip row added to customer/supplier/vendor detail modals (Phase 17a deferred UX, resolved in 17b).

### Phase 18 / 18.1 — Labour management

Day-to-day labour ops layered on top of the existing Employee master.

**Two new tables**:
- **`PieceEntry`** — per-day piece counts for LABOUR employees: `employeeId, date, count, ratePerPiece, totalAmount = count × ratePerPiece, note`.
- **`EmployeePayment`** — unified payment ledger with `EmployeePaymentType { SALARY, WAGE }` discriminator: `employeeId, type, paidAt, amount, periodStart, periodEnd, note`.

**Piece rate is dynamic, entered per piece-entry** (Phase 18.1 narrowing — was a default `Employee.ratePerPiece` column in Phase 18; dropped because real usage showed rates vary by job, not by worker). LABOUR employee form is name + phone + type only; no rate input. **Note column** (Phase 18.1) records what the piece work was for ("polishing", "setting", etc.).

**`/labour` route** (ADMIN + LABOUR_MGMT only) has three sections: (1) Pending salaries — FIXED employees missing a SALARY-type payment for the current IST calendar month; (2) Outstanding wages — LABOUR employees with PieceEntry rows not covered by any WAGE-type payment's period; (3) Bulk piece entry — one row per active LABOUR employee with rate input (empty by default, typed per entry), count input, and Note column; filters zero-count rows on submit, `createBulkPieceEntries` atomic via `prisma.$transaction`.

**`<EmployeePaymentModal>`** (`src/components/action-modals/employee-payment-modal.tsx`) — single-employee payment record with type chip (SALARY/WAGE), pre-fills amount + period from caller-provided defaults.

**Wage coverage via period overlap, NOT per-entry paid flag**: a PieceEntry dated X is "covered" iff at least one non-deleted WAGE-type EmployeePayment has `periodStart ≤ X ≤ periodEnd`. The `isPieceEntryCovered` helper in `labour-balances.ts` is the single source of truth. **Why period-overlap rather than FK relation between PieceEntry and EmployeePayment**: production tracking stays decoupled from payment tracking. User can record a "pay for these 9 days" payment without touching individual piece rows; soft-deleting the payment unpays all entries in that window without per-row updates; entry reconciliation is purely metadata.

**For SALARY payments, `periodStart` doubles as the month identifier** — `isMonthSalaryPaid(payments, monthStart, monthEnd)` checks `periodStart >= monthStart AND periodStart < monthEnd`. The labour page pre-fills SALARY `periodStart`/`periodEnd` from `startOfCurrentMonthIST()` / `endOfCurrentMonthIST() − 1 day` so the half-open IST-month semantics match.

**Type-vs-employee-type guard at the action layer**: `createEmployeePayment` rejects `SALARY` for LABOUR employees and `WAGE` for FIXED, with `errors.type` keyed to the form field.

**Schema-level cross-field validation**: `periodEnd >= periodStart` enforced via `superRefine` (single-day pay period allowed).

**No overpayment check at the action layer** (unlike Sale/Purchase payments). For SALARY, advances/corrections are valid amounts; for WAGE, paying more than computed outstanding might reflect rounding or out-of-band cash adjustments. Acceptable at workshop scale; trusts the entry.

**Immutable corrections via soft-delete + recreate** — no `updatePieceEntry` / `updateEmployeePayment`. Same pattern as Sale/Purchase payments.

**`labour-balances.ts` pipeline** mirrors `outstanding-balances.ts` shape — pure `computeOutstandingWages` / `isPieceEntryCovered` / `isMonthSalaryPaid` + DB aggregators (`listEmployeesWithOutstandingWages`, `listEmployeesMissingSalaryThisMonth`, `getOutstandingWages`, `getLabourSummary`, `countPieceEntriesForIstDay`).

**IST-aware month helpers** added to `src/lib/format.ts`: `startOfMonthIST(y, m)`, `endOfMonthIST(y, m)`, `startOfCurrentMonthIST()`, `endOfCurrentMonthIST()`, `formatMonthIST(date)`, `monthIsoIST(date)`, `currentIstYearMonth()`. **All period calculations use these IST helpers** — never browser local time. The polish-session SP1 IST-hydration-drift bug is the rationale; recreate it here and the app silently mis-reports "this month" for any user outside Asia/Kolkata.

**Dashboard** gets a labour section for ADMIN + LABOUR_MGMT (Salaries due / Outstanding wages / [Pieces today on LABOUR_MGMT only]); each card links to `/labour`. **Employee detail modal** extended with Pieces history (LABOUR only — per-entry rate + note surfaced) and Payment history sections — fetched via `getEmployeeHistory(employeeId)` server action on modal open.

**Role gates**: `canViewLabour(role)` + `canManageLabour(role)` in `src/lib/role-access.ts`; `/labour` in proxy `ROUTE_ROLES`; every action calls `requireRole(['ADMIN','LABOUR_MGMT'])`.

### Phase 19 — Completed transactions view

ADMIN-only `/completed` page aggregating settled history across all five entity types via tabs (Sales / Purchases / Casting / Plating / Payroll).

**Shared filters across tabs**: date range + party-or-employee search apply uniformly. The workshop's mental model is "show me everything that happened in October," not "what's completed in October by Sales tab specifically." Default range is the **current IST calendar month** via `startOfCurrentMonthIST()` / `endOfCurrentMonthIST()`.

**Strict completion**: Sales/Purchases/Casting/Plating filter to `status === 'completed'` (derived via `computeTransactionStatus`, never stored); Payroll shows every non-deleted `EmployeePayment` as inherently completed.

**Server-side filtering**: query helpers in `src/lib/completed-queries.ts` (`getCompletedSales/Purchases/CastingEntries/PlatingEntries/EmployeePayments`) push date range + party search into Prisma; status post-filter runs in memory after `serialize*` (status is derived). Date range + case-insensitive partyName/partyPhone OR'd via Prisma `mode: 'insensitive'`.

**Filter wire**: client component owns from/to/q state; date changes commit immediately to URL via `router.replace`, party search debounces 300ms.

**Tab content** uses entity-specific dedicated read-only tables in `src/app/(app)/completed/completed-*-table.tsx` (NOT the main entity list tables — those bake in mutation UX that doesn't belong on a settled-history surface). Row click opens the entity's existing read-only detail modal (`SaleDetailModal` / `PurchaseDetailModal` / `CastingDetailModal` / `PlatingDetailModal`) — already Phase-10 read-only-friendly. Payroll rows are non-clickable on this iteration (no `EmployeePaymentDetailModal` yet; row layout shows all relevant fields inline).

**Role gate**: `canViewCompleted(role)` in `role-access.ts` (ADMIN-only); enforced at three layers (proxy `ROUTE_ROLES['/completed']`, page server-component redirect, sidebar nav-item filter). The sidebar's `/reports` placeholder remains "Soon" (Phase 15 territory); `canViewReports` + proxy gate preemptively wired so the future page lands without a security regression.

**Adding a new entity to /completed**: extend `getCompleted<Entity>` in the query helpers, add a `<TabsTrigger value="..">` + `<TabsContent>` slot in `completed-client.tsx`, ship a dedicated `completed-<entity>-table.tsx` mirroring the existing shape, ensure the entity has a read-only detail modal. ~30 min per new entity.

### Phase 20 — Print bill + Shop settings

Two pieces:

**(1) `ShopSettings`** — single-row config table for the bill header (shop name + phone + address + footer). ADMIN-only `/settings` page edits via `upsertShopSettings`. **Single-row enforcement at the application layer** via `findFirst` + create-or-update, NOT by a DB constraint (Postgres has no native "exactly one row" check that's both ergonomic and race-free; a `singleton: 'shop'` unique column would clutter the schema for a single-row table). The read pattern is also `findFirst`.

`shopName` required; `phone` / `address` / `footer` optional. Empty-string inputs normalize to `null` in the zod schema so the bill page can branch on falsy values. `updatedById` set on every write from the session; nullable FK to `User` (`ON DELETE SET NULL`). No soft delete — it's config, not transactional. No audit trail beyond `updatedById` + `updatedAt`.

Read is gate-free at the action layer (`getShopSettings` doesn't call `requireRole`). All callers are server-side ADMIN-gated surfaces (`/settings` page + `/sales/[id]/bill` page).

**(2) Print bill route `/sales/[id]/bill`** — sibling route group `src/app/(print)/`, separate from `(app)/` so the layout has no sidebar / app chrome. Body bg overridden to white via inline `<style>` in the (print) layout; `@page` margin set for A4.

Bill content: shop header (live read from `ShopSettings`, fallback "Shree Creation" when null) + date + customer name/phone + line items table + subtotal (derived from line items) + discount (if > 0) + total (stored) + optional notes + optional footer.

**Locked-decision exclusions**: NO payment status, NO bill number — kaccha-bill tradition.

**Print button** uses `window.print()`, hidden in output via Tailwind `print:hidden`. Triggers: Printer-icon anchor in sales-table desktop row + 4th mobile-card button + "Print bill" button in sale-detail-modal footer — all open `/sales/[id]/bill` in a new tab. **Disambiguated** from the existing "Manage bill" attachment action (relabeled "Manage invoice attachment", Paperclip icon stays) via icon + leading verb + target (modal vs new tab).

**Three-layer ADMIN gate**: proxy `ROUTE_ROLES["/settings"] = ["ADMIN"]` (bill route inherits the `/sales` ADMIN gate via prefix match) + page server-component redirect via `canManageSettings(role)` + `upsertShopSettings` action `requireRole(["ADMIN"])`.

**Print routes are a sibling route group with their own layout (Phase 20)**: the `(app)/` layout wraps every child with the Sidebar. A print route needs to render WITHOUT that chrome, but nested layouts in Next.js compose rather than override — a deeper `layout.tsx` can't unwrap from the `(app)` layout. Pattern: create a sibling route group `(print)/` with its own `layout.tsx` (with the auth check duplicated; the proxy still gates the URL prefix). Final URLs don't collide because the route segments under `(app)/sales/[id]/` and `(print)/sales/[id]/` point to different leaf names (`edit` vs `bill`). Print-specific CSS uses Tailwind's `print:` variant + an `@page` margin rule.

**Single-row config tables enforced at the application layer (Phase 20)**: `ShopSettings` is conceptually a singleton. Postgres has no native "exactly one row" constraint that's both ergonomic AND race-free; a unique `singleton: 'shop'` column would clutter the schema. Actions use `findFirst` + create-or-update. Both reads and writes use `findFirst`, never `findUnique` (no stable ID to look up). Brief race window where two admins create concurrently is acceptable at workshop scale (1–3 concurrent users); future hardening could wrap in `prisma.$transaction` with isolation level if real contention surfaces. **When to use**: configuration data the app reads but rarely writes. **When NOT to**: any row that grows beyond ~1 instance, or where strict uniqueness matters (use a real `@@unique` constraint).

**Print bill disambiguation from upload-attachment "Bill" (Phase 20)**: the app already had a "Bill" action (Paperclip icon) that opens the invoice-attachment upload modal. Phase 20 added a SECOND "Bill" concept (Printer icon) that generates a customer receipt. Kept distinct via three layers: (1) different icons (Paperclip vs Printer), (2) different leading verb in labels ("Manage invoice attachment" vs "Print bill") — the EXISTING "Manage bill" got relabeled, (3) different UX targets (modal vs new tab). When adding a future feature that overloads an existing label, prefer renaming the existing usage to be more specific rather than letting two distinct things both be called "Bill" / "Sale" / etc.

---

## Original Phase 1 plan (superseded; actual scope diverged significantly)

The Phase 1 CLAUDE.md spec scoped a 7-step plan. Actual project scope diverged significantly — by Phase 21a we have ~20 numbered phases including sub-phases, with substantially more functionality than the original 7 steps anticipated. Preserved here for historical "what we originally thought we were building" context.

1. **Foundation** — Next.js + Tailwind + Prisma + Auth + base shell *(was current at the time of writing)*
2. **Master data** — Customers, Suppliers, Employees CRUD
3. **Purchases** — entry, listing, payments, returns
4. **Sales** — entry, listing, payments, returns
5. **Completed transactions** — unified view of `balance = 0` records across sales + purchases
6. **Employees** — fixed-salary monthly tracking + karigar ledger (per-piece)
7. **Dashboard** — summary cards + monthly line graphs

Diverged because: Phase 3 came BEFORE Phase 4 in actual sequence (Sales before Purchases); Phase 5 became RBAC (not Completed); Phase 7 became line-item restructure (not Dashboard); Phase 9 added Casting/Plating (not anticipated); Phases 11–11.5 added mobile + theme refresh (not anticipated); Phases 12a/12c added photos (not anticipated); Phase 16 added user-management UI; Phases 17a/17b added Party unification + Payables/Receivables; Phase 18 added labour management; Phase 19 added the completed-history aggregation across all entity types; Phase 20 added the print bill + shop settings. Dashboard exists (Phase 9) but as a per-role landing surface, not a separate "Phase 7" milestone.

## Superseded data model

The original Phase 1 schema speculated these tables for the karigar workflow. **All superseded by Phase 18 PieceEntry + EmployeePayment**; never implemented in production.

### WorkEntry (speculative — never built)
`id, employee_id, date, description, pieces, rate_per_piece, total, created_at`
Debit on karigar's balance.

### WorkPayment (speculative — never built)
`id, employee_id, date, amount, note, created_at`
Credit on karigar's balance — NOT tied to a specific WorkEntry.

### WorkReversal (speculative — never built)
`id, work_entry_id, date, pieces_reversed, total, reason, created_at`
Credit — defective work charged back.

Karigar balance was originally specified as: `sum(WorkEntry.total) − sum(WorkPayment.amount) − sum(WorkReversal.total)`.

### FixedSalary (speculative — never built)
`id, employee_id, month (YYYY-MM), attendance_days, salary, advances, deductions, net_payable, paid (boolean), paid_date, created_at`

**What was actually built (Phase 18)**: the karigar workflow uses `PieceEntry` (per-day count + dynamic per-entry rate) and `EmployeePayment` (unified ledger with `SALARY | WAGE` discriminator + period-overlap coverage). Period coverage replaces the per-entry paid-flag concept; production tracking is decoupled from payment tracking. Defective-work reversal is handled via soft-delete + recreate, not a parallel reversal table.

---

## Bill-wise payment model (current as of Phase 20 — preserve for Phase 21a "why we changed" context)

> Phase 21a will refactor this. This section preserves the bill-wise design and its rationale so the migration's "what we replaced" is documented.

Each transactional entity (Sale, Purchase, CastingEntry, PlatingEntry) carries its own `*Payment` child table. Payments are **tied to a specific bill** (transaction row): one `SalePayment` row has a non-null `saleId` FK to one Sale; one `PurchasePayment` row → one Purchase; etc.

**Why bill-wise originally**:
- Status derivation per row is trivial: `SUM(payments)` per row → `computeTransactionStatus(total, paidAmount, returnTotal)` → one of `pending | partial | completed | refund_due`. Atomic; no cross-row reconciliation.
- Audit trail per bill is exact: each payment row links to exactly one bill, so "what did we pay against this bill?" is a one-query lookup.
- Cascade semantics are clean: `onDelete: Cascade` on the FK means a soft-deleted-then-hard-deleted Sale takes its payment children with it (defensive — soft-delete is the normal path).
- Walk-in auto-promotion fits naturally: the Sale row already carries `partyName`/`partyPhone` snapshots, and the payment row needs no party reference (it links via the Sale).

**Phase 17b retrofit on top**: `<PartyPaymentModal>` lets the user record a *bulk* party-level payment that the action splits into N `*Payment` rows via `prisma.$transaction`. The user mental model is party-level ("I'm paying Ramesh ₹30,000") but the storage is still per-bill — the modal asks "which bills?" and writes one row per checked allocation. This bridged the UX gap without changing the data model.

**Why Phase 21a will move beyond it**: see KNOWN_GAPS.md for the active items driving the refactor. The bill-wise model has friction at the parts of the workflow where money flow is genuinely party-level — e.g., a single bank transfer covering multiple bills with no clean per-bill split, or a party-level credit balance that's not yet allocated. The refactor is expected to introduce a party-level payment ledger as the source of truth, with per-bill allocations as a derived view rather than the underlying storage.

---

## Other historical conventions

These were active conventions during phases ≤20; preserved for archival reference. Some remain active and are restated more tersely in the current `CLAUDE.md`.

- **Stale-closure pattern for synchronous-read values** (Phase 10): when a callback needs to set a value AND immediately trigger an async submit that reads it, use `useRef`, not `useState`. React state batches asynchronously. Symptom: silently-ignored value flips. Canonical example: `saveModeRef.current = m; handleSubmit(onSubmit)()` in `sale-form.tsx`.
- **Photos vs bills share `Attachment` table with discriminator-only dispatch** (Phase 12a, extended Phase 12c): see Phase 12c entry above for the extension recipe.
- **Period-based payment ledger** (Phase 18): wage coverage uses period overlap, not per-entry paid flag. Decouples production from payment.
- **User management self-protection three-layer pattern** (Phase 16): action layer rejection + UI mirror + test pair (rejection + non-self success). See Phase 16 entry above.
- **Completed-history aggregation** (Phase 19): cross-entity surface via tabs + shared filters + entity-specific read-only tables + reuse of detail modals.
- **Print routes via sibling route group** (Phase 20): see Phase 20 entry above.
- **Single-row config via application-layer enforcement** (Phase 20): `findFirst` + create-or-update.
- **Walk-in auto-promotion implicit role from form context** (Phase 17a): see Phase 17a entry above.
- **Outstanding balance pipeline + party-level rollups** (Phase 17b): see Phase 17b entry above.

---

## Deferred decisions (Phase ≤11 lineage)

For Phase ≤11 decision lineage (the bulk of the data-model and pattern decisions), see [`KNOWN_GAPS_ARCHIVE.md`](./KNOWN_GAPS_ARCHIVE.md). That archive holds the rejected-alternatives prose for: per-line discounts, stored-vs-derived totals, dual-path party model snapshot semantics, ROUND_HALF_EVEN choice, RBAC boundary rationale, kg-vs-grams storage choice, etc.

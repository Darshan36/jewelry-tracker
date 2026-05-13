JEWELRY-TRACKER — INITIAL SETUP PROMPT
=======================================

I'm building a jewelry manufacturing management web app. This is the first setup prompt — we're initializing the project from scratch in an empty folder. Please follow the steps below in order, and pause after each major step to confirm before continuing. Do not run all steps in one go.


PROJECT CONTEXT
---------------
- App name: jewelry-tracker
- Purpose: Internal web app for a small imitation jewelry manufacturing company to track sales, purchases, returns, employees (fixed-salary + per-piece karigars), and receipts. Roughly 100 transactions per month.
- Users: Single org, initially 1–3 users (owner + accountant)
- GitHub repo: already created, empty (I'll provide the URL)
- Supabase project: already created in Mumbai region (I'll provide credentials)
- Vercel project: already created, empty


LOCKED TECH STACK — do not substitute
-------------------------------------
- Framework: Next.js 14+ with App Router, TypeScript (strict mode)
- Styling: Tailwind CSS + shadcn/ui
- Database: Supabase Postgres
- ORM: Prisma
- Auth: Auth.js (NextAuth v5 / beta) with email+password (Credentials provider)
- Tables/grids: TanStack Table v8
- Charts: Recharts
- Excel: SheetJS (xlsx) for export, ExcelJS for import
- File storage: Supabase Storage (for receipt uploads later)
- Hosting: Vercel
- Package manager: npm


DESIGN SYSTEM (apply throughout)
--------------------------------
Dark theme, "techno-artisanal" — high-end jewelry meets industrial precision. The full DESIGN.md will be added to CLAUDE.md in step 5 below. Key tokens for now:

- Background: #0b1326 (deep navy)
- Surface: #171f33
- Surface elevated: #222a3d
- Primary (gold accent): #f2ca50
- Secondary (electric blue): #adc6ff
- Text primary: #dae2fd
- Text muted: #99907c
- Border: #4d4635
- Fonts: Geist for headings/labels, Inter for body
- 0px border radius on all primary containers, buttons, inputs (sharp corners — this is core to the aesthetic, do not round corners)
- No drop shadows — use 1px borders and tonal layering for depth


STEPS (pause for confirmation between each)
===========================================

STEP 1 — Initialize Next.js
---------------------------
Run `npx create-next-app@latest .` in the current directory (note the . — install into the existing empty folder, not a subfolder) with these answers:
- TypeScript: Yes
- ESLint: Yes
- Tailwind CSS: Yes
- src/ directory: Yes
- App Router: Yes
- Turbopack: Yes
- Import alias: Yes, use default @/*

After this, show me the resulting folder structure and pause.


STEP 2 — Install dependencies
-----------------------------
Install in two groups so I can review:

Group A (core runtime):
prisma @prisma/client next-auth@beta @auth/prisma-adapter bcryptjs @supabase/supabase-js @tanstack/react-table recharts xlsx exceljs zod react-hook-form @hookform/resolvers lucide-react clsx tailwind-merge class-variance-authority date-fns

Group B (dev):
@types/bcryptjs prisma

Then initialize shadcn/ui:
`npx shadcn@latest init`
When prompted, use these answers: Style = Default, Base color = Slate, CSS variables = Yes.

Pause and show me the updated package.json.


STEP 3 — Set up environment variables
-------------------------------------
Create .env.local in the project root (and ensure it's gitignored — it already is by default in Next.js). Use this template, with placeholders. Ask me one at a time for each value, don't ask for all of them at once:

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Database - Prisma uses these two
# DATABASE_URL = Transaction pooler (port 6543) for the app
# DIRECT_URL   = Session pooler (port 5432) for migrations
DATABASE_URL=
DIRECT_URL=

# Auth.js
AUTH_SECRET=
AUTH_TRUST_HOST=true

For AUTH_SECRET, generate it yourself by running `openssl rand -base64 32` and using the output.

Also create .env.example with the same keys but empty values (this one IS committed).

Pause after setup.


STEP 4 — Configure Tailwind with the design tokens
--------------------------------------------------
Update tailwind.config.ts to add the techno-artisanal color tokens listed in the Design system section above as CSS variables, exposed as Tailwind classes (bg-surface, text-primary, border-outline, etc.). Set the default border-radius to 0 globally.

Update src/app/globals.css to:
- Import Geist and Inter from next/font (set up in layout.tsx instead — use next/font/google)
- Set the default background to #0b1326 and text to #dae2fd
- Set body font-family to Inter, headings to Geist

Update src/app/layout.tsx to load both fonts via next/font/google and apply them as CSS variables on the <html> tag.

Pause and let me run `npm run dev` to verify the dark theme is applied.


STEP 5 — Create CLAUDE.md (project context file)
------------------------------------------------
Create CLAUDE.md at the project root with the full project context. Include these sections:

1. Project overview — what we're building and why
2. Tech stack — copy the "Locked tech stack" section above
3. Design system — copy the design tokens above plus: sharp 0px corners everywhere, 1px borders for depth, no drop shadows, zebra-stripe data tables, status chips with leading colored dot
4. Data model — paste the full schema sketch below
5. Status logic — derived not stored, computed from payment children
6. Conventions — TypeScript strict, server components by default, client components only when needed ('use client'), all forms use react-hook-form + zod, all currency in paise (integer) stored, displayed as ₹ with Indian comma grouping
7. Phase plan — list the 7 phases at one line each
8. Out of scope (do not build) — GST/tax logic, multi-tenant, mobile app, email notifications

For section 4, use this schema:

Customer / Supplier
  id, name, phone, address, notes, created_at

Employee
  id, name, phone, type (FIXED | LABOUR), monthly_salary (nullable),
  notes, created_at

Sale
  id, date, customer_id, item_description, qty, rate, discount, total,
  receipt_url, created_at
  → effective_total = total − sum(SaleReturn.total)
  → paid_amount = sum(SalePayment.amount where type=payment) − sum(where type=refund)
  → balance = effective_total − paid_amount
  → status (computed): pending | partial | completed | refund_due

SalePayment
  id, sale_id, date, amount, type (PAYMENT | REFUND), note, created_at

SaleReturn
  id, sale_id, date, item_description, qty_returned, rate, discount,
  total, reason, receipt_url, created_at

Purchase / PurchasePayment / PurchaseReturn — mirror Sale exactly

WorkEntry (debit on karigar's balance)
  id, employee_id, date, description, pieces, rate_per_piece, total, created_at

WorkPayment (credit on karigar's balance, NOT tied to a specific WorkEntry)
  id, employee_id, date, amount, note, created_at

WorkReversal (credit — defective work)
  id, work_entry_id, date, pieces_reversed, total, reason, created_at

Karigar balance (computed):
  sum(WorkEntry.total) − sum(WorkPayment.amount) − sum(WorkReversal.total)

FixedSalary
  id, employee_id, month (YYYY-MM), attendance_days, salary, advances,
  deductions, net_payable, paid (boolean), paid_date, created_at

For section 7 (phases), use:
1. Foundation — Next.js + Tailwind + Prisma + Auth + base shell
2. Master data — Customers, Suppliers, Employees
3. Purchases — entry, listing, payments, returns
4. Sales — entry, listing, payments, returns
5. Completed transactions — unified view of balance==0 records
6. Employees — fixed salary tracking + karigar ledger
7. Dashboard — summary cards + monthly line graphs

Pause after creating the file and show me its contents.


STEP 6 — Git initial commit and push
------------------------------------
- Verify .env.local is in .gitignore (it should be by default)
- `git init` if not already initialized, then add the remote I'll provide
- Stage everything, commit with message: `chore: initial project setup with Next.js, Tailwind, design tokens, and CLAUDE.md`
- Push to main

Pause and confirm the push succeeded.


FINAL ACCEPTANCE CRITERIA FOR THIS PROMPT
=========================================
Before ending this session, confirm all of:

[ ] `npm run dev` runs without errors on http://localhost:3000
[ ] The default page shows the dark navy background with light text
[ ] Geist and Inter fonts are loading (check DevTools → Network)
[ ] package.json has all listed dependencies
[ ] .env.local has all 7 keys filled in (not committed)
[ ] .env.example exists (committed, empty values)
[ ] CLAUDE.md exists at root with all 8 sections
[ ] Initial commit pushed to GitHub main branch


Do not proceed to Prisma schema, Supabase migration, Auth.js setup, or any UI building in this session — those are separate prompts. Stop after Step 6.

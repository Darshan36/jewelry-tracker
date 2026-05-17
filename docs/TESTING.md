# Testing

Quick reference for writing tests in this codebase. **Read this before
adding tests to a new feature.** The patterns here are stable; deviating
without reason creates inconsistency for future contributors.

## Runner

[Vitest](https://vitest.dev) with `jsdom`. `@testing-library/react` for
component rendering, `@testing-library/user-event` for realistic
interaction simulation, `vitest-mock-extended` for type-safe Prisma mocks.

No e2e (Playwright) yet — deferred to Phase 8 polish.

## Where tests live

**Colocated** next to the file under test, with the `.test` suffix:

```
src/app/(app)/customers/
  schema.ts
  schema.test.ts              ← tests for schema.ts
  actions.ts
  actions.test.ts             ← tests for actions.ts
  customers-table.tsx
  customers-table.test.tsx    ← tests for customers-table.tsx
```

Vitest's default discovery glob is `**/*.{test,spec}.?(c|m)[jt]s?(x)`,
so any `.test.ts` or `.test.tsx` is picked up automatically. No central
`__tests__/` directory.

## How to run

```bash
npm test          # watch mode — re-runs on file save during development
npm run test:run  # one-shot — used by CI and pre-commit hooks
```

Run a single file: `npx vitest run path/to/file.test.ts`
Run with coverage: `npx vitest run --coverage` (requires `@vitest/coverage-v8`,
not installed by default)

## Three test categories

### 1. Schema tests — pure zod, no React, no DB

Fast, deterministic, no mocks needed. Test the validator's behavior at
the boundary: what inputs pass, what fail, and what the transform output
shape is.

**Example** (`src/app/(app)/customers/schema.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { customerInputSchema } from "./schema";

describe("customerInputSchema", () => {
  it("accepts a valid input with all fields", () => {
    const result = customerInputSchema.safeParse({
      name: "Test Customer",
      phone: "9876543210",
      email: "test@example.com",
      address: "123 Main St",
      notes: "Regular client",
    });
    expect(result.success).toBe(true);
  });

  it("transforms empty-string phone to null (NOT undefined)", () => {
    const result = customerInputSchema.safeParse({
      name: "Test",
      phone: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBeNull();
  });

  it("rejects missing name with 'Name is required'", () => {
    const result = customerInputSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.name).toContain(
        "Name is required",
      );
    }
  });
});
```

**Coverage target for schema tests:** every code path through `.transform`,
`.pipe`, and any `.refine`. Boundary cases for `.min` / `.max` / `.email`.

### 2. Action tests — server actions with mocked Prisma

The action layer is where validation meets the database. Mock Prisma so
tests are fast and deterministic. Mock the `requireRole()` guard so the
auth dependency is explicit per test. (Phase 5 migrated every action to
`requireRole([...allowedRoles])`; the older `requireSession()` helper
still exists in `src/lib/auth-guards.ts` for any future endpoint where
authentication alone is sufficient.)

**Setup** — `src/lib/__mocks__/prisma.ts` provides the shared deep mock:

```typescript
import { PrismaClient } from "@/generated/prisma";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import { beforeEach, vi } from "vitest";

export const prisma: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>();

beforeEach(() => {
  vi.clearAllMocks();
});
```

Test files opt in with `vi.mock("@/lib/prisma")` at the top — Vitest
auto-resolves `__mocks__/prisma.ts` as the replacement.

**Example** (`src/app/(app)/customers/actions.test.ts`):

```typescript
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCustomer } from "./actions";

vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireRole: vi
    .fn()
    .mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("createCustomer", () => {
  it("happy path — returns ok with the created row", async () => {
    vi.mocked(prisma.customer.create).mockResolvedValue({
      id: "cuid-1",
      name: "Test Customer",
      phone: null,
      email: null,
      address: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    const result = await createCustomer({
      name: "Test Customer",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.customer.id).toBe("cuid-1");
    expect(prisma.customer.create).toHaveBeenCalledOnce();
  });

  it("returns ok=false with field errors when name is empty", async () => {
    const result = await createCustomer({
      name: "",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeDefined();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});
```

**Mocking pattern reminders:**
- Mock at module path: `vi.mock("@/lib/prisma")` — Vitest auto-resolves
  `src/lib/__mocks__/prisma.ts`
- Mock `@/lib/auth-guards` to return a fake session; tests without auth
  set `requireRole` to reject (test the throw-Forbidden / Unauthorized path)
- Mock `next/cache` so `revalidatePath()` is a no-op spy
- Reset mocks in `beforeEach` (the shared helper does this once)

**Mock reset conventions (split by test category):**

| Test type | Pattern | Where the reset lives |
|---|---|---|
| Action tests | `beforeEach(mockReset(prisma))` at module scope + file-level `beforeEach` for `requireRole` / `revalidatePath` | `src/lib/__mocks__/prisma.ts` (Prisma) + each test file's top-level (others) |
| Component tests | `beforeEach(vi.clearAllMocks)` inside the `describe` block | each test file's `describe` |

The action layer touches a deep mock object (every Prisma method on
every model is a mock) — `mockReset` from `vitest-mock-extended` clears
both call history AND any per-test `mockResolvedValue` overrides.
Component tests use shallow mocks (one `vi.fn()` per mocked function);
`vi.clearAllMocks()` clears call history while keeping the mock
implementations in place from the top-level `vi.mock(...)` factory.

Both work for their case. Don't mix the two reset approaches in one file.

**Test inputs match `z.output<schema>`, not the raw form-input shape.**
Server actions take `z.infer<typeof schema>` as their parameter type,
which is the schema's **OUTPUT** type after every transform / coercion
runs. Tests bypass the form layer, so the fixture you hand to the action
must already be in the post-coercion shape.

Concrete example from Phase 3.1: the Sale schema has
`date: z.coerce.date()`. `z.input` is `unknown` (anything that can be
coerced); `z.output` is `Date`. The action's signature has `date: Date`.
A test that passes `date: "2026-05-14"` (the form's string shape) will
fail `tsc --noEmit` with *"Argument of type 'string' is not assignable
to parameter of type 'Date'"*. Fix is the helper, not a cast:

```typescript
function validInput(overrides = {}) {
  return {
    date: new Date("2026-05-14T00:00:00Z"), // ← z.output shape
    customerId: null,
    partyName: "Test Walkin",
    // ...
    ...overrides,
  };
}
```

The schema's coercion path itself is exercised separately in
`schema.test.ts` — that's where strings like `"2026-05-14"` belong.

Inverse case for currency: rate/discount stay as `number` rupees in
the schema output (no `.transform` to BigInt — see KNOWN_GAPS), so
tests pass `rate: 250` (rupees number), not `25000n` (paise BigInt).
The BigInt conversion happens inside the action, and the action *test*
asserts on `prisma.sale.create.mock.calls[0][0].data.rate === 25000n`.

**`vi.mock` is hoisted above imports.** Vitest moves `vi.mock(...)` calls
to the top of the file at parse time, so they run **before** any import
statements. Consequence:

- You can't share `vi.mock` calls between files via re-export. The
  hoisting happens per-file at parse time; re-exporting from a helper
  module wouldn't move the hoisting up in the consumer.
- Copy-paste the mock block at the top of each test file. The
  `docs/TESTING.md` examples above are the canonical reference.
- Inside the factory function passed to `vi.mock`, **don't reference
  variables defined later in the file** — they're not in scope at
  hoisted execution. Inline the values, or use `vi.hoisted(() => ...)`
  to declare hoist-safe references.

**Role-based access tests via `describe.each`.** Every role-gated server
action gets a parameterised role-matrix block alongside its happy-path
tests. The four-role matrix is shared shape; the booleans flip per
action depending on the action's `requireRole([...allowedRoles])` list.

```typescript
const ROLE_MATRIX = [
  ["ADMIN", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", false],
  ["CASTING_PLATING_MGMT", false],
] as const;

function sessionFor(
  role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT",
) {
  return {
    user: { id: "u", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

describe.each(ROLE_MATRIX)("createSale role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());
      const result = await createSale(validInput());
      expect(result.ok).toBe(true);
      expect(prisma.sale.create).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createSale(validInput())).rejects.toThrow("Forbidden");
      expect(prisma.sale.create).not.toHaveBeenCalled();
    }
  });
});
```

The `prisma.sale.create.not.toHaveBeenCalled()` assertion on the deny
branch is the critical check — it catches the failure mode where the
role check is bypassed silently and the action proceeds to the
database. Without that assertion, the test would pass against a buggy
action that swallowed the guard rejection. Always assert presence on
allow AND absence on deny.

Use `mockResolvedValueOnce` / `mockRejectedValueOnce` (the "once"
variants) so the per-test override doesn't bleed into subsequent tests
running off the file-level `mockResolvedValue(fakeSession)` default.

The flip pattern per action (which roles get `true`) maps directly to
the action's `requireRole([...])` list — Customers/Sales: only ADMIN;
Suppliers/Purchases: ADMIN + PURCHASE_DEPT; Employees: ADMIN + LABOUR_MGMT.

### Mocking SDK constructors (AWS S3 / R2)

The Phase 8 `@aws-sdk/client-s3` mock uses a constructor pattern not seen
elsewhere in the codebase. Tests on `src/lib/r2.ts` (and any future SDK
wrapper) need this idiom.

**Problem**: the wrapper calls `new S3Client(config)`, `new HeadObjectCommand(...)`,
etc. — these MUST be invokable as constructors. Vitest's `vi.fn()` IS
constructible by default, but `.mockImplementation(arrow_fn)` replaces the
inner function with an arrow, and **arrow functions can't be `new`'d in
JS**. The error is `TypeError: () => (...) is not a constructor`.

**Fix**: in the `vi.mock()` factory, use `vi.fn(function (input) { ... })`
with a regular function expression. JS lets constructors that explicitly
return an object override `this` with that object — which is exactly what
we want for capturing the constructor args:

```typescript
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@aws-sdk/client-s3");
  // Each Command mock must be CONSTRUCTIBLE. Regular `function` expressions
  // work as constructors; the `function (input)` form's explicit object
  // return becomes the instance when called with `new`.
  return {
    ...actual,                      // pass through error classes (NotFound, etc.)
    S3Client: vi.fn(),
    PutObjectCommand: vi.fn(function (input: unknown) {
      return { __cmd: "Put", input };
    }),
    HeadObjectCommand: vi.fn(function (input: unknown) {
      return { __cmd: "Head", input };
    }),
    // ...
  };
});
```

For `S3Client` itself (which the wrapper does `new S3Client(config)` →
calls `.send(cmd)` on the result), use a `function` expression that
attaches `send` to `this`:

```typescript
let sendMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendMock = vi.fn();
  vi.mocked(S3Client).mockImplementation(function (
    this: { send: typeof sendMock },
  ) {
    this.send = sendMock;
  } as unknown as typeof S3Client);
});
```

Per-test, configure the send mock to return what the test needs:

```typescript
sendMock.mockResolvedValueOnce({ ContentType: "application/pdf", ContentLength: 4096 });
```

**Pass through error classes via `...actual`** — `NotFound`, `S3ServiceException`,
etc. are checked via `instanceof` in production code. Spreading
`importOriginal()` keeps them as the real constructors so the `instanceof
NotFound` branch in `headObject` / `deleteObject` works in tests.

**Clear the wrapper's singleton cache between tests.** The lazy-init
Proxy in `src/lib/r2.ts` caches the client on `globalThis` after first
use — without resetting, every test after the first gets the same
S3Client instance with the same (potentially stale) sendMock binding:

```typescript
function clearR2Cache() {
  const g = globalThis as unknown as { r2Client: unknown; r2Bucket: unknown };
  delete (g as Record<string, unknown>).r2Client;
  delete (g as Record<string, unknown>).r2Bucket;
}

beforeEach(() => {
  clearR2Cache();
  // ...
});
```

Pattern established Phase 8 (`src/lib/r2.test.ts`). Same approach works
for any future SDK wrapper that lazy-initialises a constructible client.

### 3. Component tests — `@testing-library/react` + `user-event`

For interactive components. Render, query, simulate user behavior, assert
on what the user would see.

**Standard mocks** for components that use Next.js navigation:

```typescript
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(),
}));
```

**Standard mocks** for components that import server actions (so the
test doesn't try to invoke a real server function):

```typescript
vi.mock("./actions", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  softDeleteCustomer: vi.fn(),
}));
```

**Example** (`src/app/(app)/customers/customers-table.test.tsx`):

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomersTable } from "./customers-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./actions", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  softDeleteCustomer: vi.fn(),
}));

const customers = [
  { id: "1", name: "Priya Shah", phone: "9876543210", email: null, ... },
  { id: "2", name: "Ankit Patel", phone: "9988776655", email: null, ... },
];

describe("CustomersTable search filter", () => {
  it("filters rows by partial name match", async () => {
    const user = userEvent.setup();
    render(<CustomersTable customers={customers} />);

    expect(screen.getByText("Priya Shah")).toBeInTheDocument();
    expect(screen.getByText("Ankit Patel")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Search customers/i), "priya");

    expect(screen.getByText("Priya Shah")).toBeInTheDocument();
    expect(screen.queryByText("Ankit Patel")).not.toBeInTheDocument();
  });
});
```

**Query priority** (per RTL guidance):
1. `getByRole` — most user-meaningful
2. `getByLabelText` — for form fields
3. `getByPlaceholderText` — for inputs without labels
4. `getByText` — for non-interactive elements
5. `getByTestId` — last resort, when nothing else fits

**Anchored regexes for ambiguous button names.** When multiple buttons
on a page contain a common substring (e.g., the "Name" sort header and
the "+ Add Customer" button both contain N-A-M-E somewhere in their
accessible names), use an anchored regex:

```typescript
// Without anchor, ambiguous: matches multiple buttons
screen.getByRole("button", { name: /name/i });

// Anchored at start — only matches buttons whose name STARTS with "Name"
screen.getByRole("button", { name: /^name/i });
```

Save the diagnostic time: anchor your regex when you know the structure.

**Scope queries with `within(container)` when text appears in multiple
regions.** Companion to the anchored-regex pattern — both disambiguate
queries. When the same string exists in two parts of the UI (e.g. the
filter pills above an Employees table render "Fixed" / "Labour" as
radio labels, AND each row's Type chip renders the same words), an
unscoped `screen.getAllByText("Fixed")` returns *both* sources. Scope
to the relevant container:

```typescript
const table = screen.getByRole("table");
expect(within(table).getAllByText("Fixed")).toHaveLength(2); // chips only

// And for inputs in a specific subtree:
const filterGroup = screen.getByRole("radiogroup", { name: /filter by type/i });
await user.click(within(filterGroup).getByRole("radio", { name: /^fixed$/i }));
```

Pick the smallest stable container that uniquely contains the target —
`getByRole('table')`, `getByRole('radiogroup', { name })`, `getByRole('dialog')`.
Phase 2.3 caught this when an "all 'Fixed' count = 2" assertion fired
with 3 matches because the filter pills also said "Fixed."

### Inversion tests: assert both presence and absence

When testing UI changes that **flip semantics** — Sales↔Purchases label
inversions ("Outstanding" ↔ "Owed to supplier"), REFUND-direction color
flips (`text-error` ↔ `text-secondary`), or any other inversion where
the old and new states use related-but-not-identical wording — include
**both** a positive assertion (the new label IS rendered) and a
negative assertion (the old label is NOT).

Without the negative assertion, a copy-paste regression that leaves the
original label still rendering would silently pass: the new label IS
present, the test asserts that, and the leaked old label sits
invisibly alongside it.

```typescript
// Positive: the Purchases-direction label is rendered
expect(screen.getByText(/owed to supplier:/i)).toBeInTheDocument();

// Negative: the Sales-direction label is NOT rendered
expect(screen.queryByText(/^outstanding:/i)).not.toBeInTheDocument();
```

Same pattern for class assertions where the inversion is purely
visual:

```typescript
const indicator = screen.getByText(/refund expected:/i);
// Positive: Purchases uses text-secondary (blue) for the "money in"
// direction
expect(indicator).toHaveClass("text-secondary");
// Negative: Purchases must NOT use text-error (the Sales convention
// for refund-direction)
expect(indicator).not.toHaveClass("text-error");
```

The dual assertion catches incomplete clones at the test layer.
**Apply by default for any inversion test** — the cost is almost
nothing, but it catches the class of regression that's hardest to
spot during code review (the leaked-old-label kind, where the rendered
output still "kind of works" because the inverted label happens to be
true in both directions). Phase 4 (Sales→Purchases) used this
extensively in `purchases/payment-panel.test.tsx`.

**The dual-assertion pattern applies to non-UI assertions too.** When
verifying that a server action snapshots the **canonical** value
rather than the typed input (Phase 6 walk-in auto-promotion is the
canonical example — the action should override the typed `partyName`
with the linked customer's `name`), assert BOTH that the canonical
value IS used AND that the typed input is NOT. The negative check
catches the failure mode where the action accidentally short-circuits
and uses the typed string.

```typescript
// Walk-in with a phone that matches an existing Customer ("Real Customer")
await createSale(validInput({
  customerId: null,
  partyName: "TYPED — should be overridden",
  partyPhone: "9876500001",
}));

const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
// Positive: canonical name from the matched Customer row
expect(call.data.partyName).toBe("Real Customer");
// Negative: the typed string did NOT leak through
expect(call.data.partyName).not.toBe("TYPED — should be overridden");
```

Same rationale as the UI inversion pattern: a positive-only assertion
would still pass against a buggy action that *also* writes the typed
string somewhere it shouldn't (or that returns the wrong field as
canonical). Phase 6 (`sales/actions.test.ts`, `purchases/actions.test.ts`)
uses this for the typed-vs-canonical snapshot assertion.

### `useFieldArray` — assert that field re-keying survives middle-row removal

Forms with dynamic row arrays (Phase 7's sale-form-modal /
purchase-form-modal use `useFieldArray` from react-hook-form for the
line items) must use the field's stable RHF id (`field.id`) as the
React key, never the array index. Index-keyed rows produce silent
data swaps when a middle row is removed: React reuses the wrong
`<input>` element for the surviving rows and the user's typed values
end up attached to the wrong row.

To catch this in component tests, render the form, add enough rows to
have a middle one to remove, type **distinct sentinel values into
non-adjacent rows**, remove a middle row, and assert the surviving
rows still hold their sentinels:

```typescript
it("removing a middle line re-keys the survivors cleanly", async () => {
  const user = userEvent.setup();
  render(<SaleFormModal open onOpenChange={() => {}} customers={[]} />);

  // Get to 3 lines.
  await user.click(screen.getByRole("button", { name: /add line/i }));
  await user.click(screen.getByRole("button", { name: /add line/i }));

  // Type sentinels into rows 1 and 3 (non-adjacent).
  await user.type(
    screen.getByLabelText(/^line 1$/i).querySelector("input")!,
    "FIRST",
  );
  await user.type(
    screen.getByLabelText(/^line 3$/i).querySelector("input")!,
    "THIRD",
  );

  // Remove the middle row.
  await user.click(screen.getByRole("button", { name: /remove line 2/i }));

  // Survivors keep their typed values.
  const groups = screen.getAllByRole("group", { name: /^Line \d+$/i });
  expect(groups).toHaveLength(2);
  const line1Input = within(groups[0]).getByRole("textbox") as HTMLInputElement;
  const line2Input = within(groups[1]).getByRole("textbox") as HTMLInputElement;
  expect(line1Input.value).toBe("FIRST");
  expect(line2Input.value).toBe("THIRD"); // ← was line 3 before removal
});
```

If the assertion fails (typed values appear in the wrong row), the
React key is index-based and would silently corrupt user data in
production. See `sale-form-modal.test.tsx` for the canonical
implementation.

### Playwright + portal-based modals (Radix Dialog)

Radix Dialog — and any portal-based modal with click-outside-to-
dismiss behaviour — closes the dialog when `page.locator("body").click(...)`
is called to blur an input inside the modal. The body click lands
outside the dialog's `DialogContent` portal and triggers Radix's
`onPointerDownOutside` handler, which calls `onOpenChange(false)`.

Symptoms in a Playwright walkthrough: step 2 PASSes (its assertions
run before the close animation completes), step 3 fails to find an
in-dialog element with "Timeout exceeded waiting for `[role='dialog']`."

**Fix**: blur via `page.keyboard.press("Tab")` instead of a body
click — keyboard events don't trigger the outside-pointer handler.

```typescript
// WRONG — closes the dialog
await rateInput.fill("250");
await page.locator("body").click({ position: { x: 1, y: 1 } });

// RIGHT — blurs without dismissing
await rateInput.fill("250");
await rateInput.press("Tab");
```

Same applies to any modal with default `closeOnOutsideClick`
behaviour (Radix Dialog, Headless UI Dialog, shadcn's Sheet/Drawer).
Discovered during Phase 7's `walkthrough-p7-line-items.mjs` — the
`fillLine` helper originally body-clicked to commit each rate input
and silently dropped the dialog between steps.

### Triggering React synthetic events in jsdom

**Programmatic `element.focus()` does NOT trigger React's synthetic
`onFocus` handler in jsdom.** It dispatches a native focus event, but
React's synthetic event system doesn't reliably pick it up. Tests that
depend on `onFocus` running (e.g., a dropdown that opens on input focus,
an "active" style toggled by focus) need explicit React-event dispatch:

```typescript
import { fireEvent } from "@testing-library/react";

// ❌ DOES NOT fire React's onFocus in jsdom
const input = screen.getByPlaceholderText(/customer name/i);
input.focus();
expect(screen.getByText(/dropdown is open/i)).toBeInTheDocument(); // fails

// ✓ Fires React's synthetic onFocus
fireEvent.focus(input);
expect(screen.getByText(/dropdown is open/i)).toBeInTheDocument();
```

`userEvent.click(input)` is the user-flow alternative — it dispatches
the full `mousedown → focus → mouseup → click` sequence through React,
which includes a synthetic focus event. Use `userEvent.click` when the
test is simulating realistic user behavior; use `fireEvent.focus` when
the test cares specifically about the focus event in isolation.

**Same gotcha applies to other synthetic-only events**: `onBlur`,
`onMouseEnter`, `onMouseLeave`, and any handler React intercepts and
re-dispatches through its event system. If a test sets up an element,
calls a programmatic method that "should" trigger a handler, and the
handler doesn't run — reach for `fireEvent.<eventName>(element)` first.

Discovered Phase 3.1 — five party-picker tests failed because the
dropdown-opening `onFocus` handler never fired from `input.focus()`.

### Unicode minus-sign regex gotcha

When asserting on negative-amount strings (e.g. `−₹400.00` in refund
history), the naive character class `[−-]` is an **invalid regex range**
because `−` (U+2212 MINUS SIGN) is a higher codepoint than `-` (U+002D
HYPHEN-MINUS). JS rejects with `SyntaxError: Invalid regular expression:
Range out of order in character class`. Fix by putting the literal `-`
first — a leading dash in a character class is always literal, never a
range start:

```typescript
// ❌ SyntaxError: range out of order
expect(text).toMatch(/[−-]\s*₹/);

// ✓ Valid: leading `-` is literal; the other minus codepoints follow
expect(text).toMatch(/[-–—−]\s*₹/);
```

The four characters above are hyphen-minus (U+002D), en-dash (U+2013),
em-dash (U+2014), and math minus (U+2212). `formatCurrency()` prepended
with U+2212 in `payment-panel.tsx` produces this case in the refund
display path; the same trap is in the Phase 3.3 walkthrough script for
the same reason. **Rule**: if you write `[X-Y]` in a character class
where either X or Y is a codepoint above U+00FF, double-check the
order and prefer the leading-`-`-as-literal idiom.

### Component tests vs Playwright walkthroughs — `router.refresh()` timing

The two test layers differ in how they handle Next.js's
`router.refresh()` async re-fetch:

- **Component tests** mock `next/navigation` so `useRouter().refresh()`
  is a synchronous `vi.fn()`. After a mutation calls refresh, there's
  nothing to wait for — the next render reads from the same in-memory
  props the test set up. Assertions run immediately.
- **Playwright walkthroughs** run against a real dev server. A real
  `router.refresh()` triggers an RSC re-fetch → server re-renders the
  page → Flight payload streams to client → React reconciles. This is
  meaningfully async (tens to hundreds of ms). After Save, the form
  closes synchronously but the new entity row appears only after the
  re-fetch completes. Tests must `waitForFunction(...)` for the
  expected post-refresh state rather than asserting immediately.

```javascript
// Playwright — after a mutation that triggers router.refresh:
await page.click('form button[type="submit"]:has-text("Save")');
// Don't assert here — refresh hasn't run yet.
await page.waitForFunction(() => {
  const dialog = document.querySelector('[role="dialog"]');
  return /Expected new state/.test(dialog?.textContent || "");
}, null, { timeout: 8000 });
// Now assert.
```

Both layers have value. Component tests give fast behavior coverage;
walkthroughs verify end-to-end timing realism. **Walkthrough scripts
in `scripts/walkthrough-*.mjs` are NOT part of `npm run test:run`** —
invoke them directly (`node scripts/walkthrough-<name>.mjs`) to verify
a sub-phase build against a running dev server.

### Asserting sort order in a table

For sortable tables, after clicking a header, assert the row order by
walking `getAllByRole('row')`. Skip the header row, then pull the first
cell's text content from each:

```typescript
function rowOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1) // first row is the <thead>
    .map((row) => {
      const nameCell = within(row).getAllByRole("cell")[0];
      return nameCell?.textContent ?? "";
    });
}

// Default sort: createdAt desc — newest first
expect(rowOrder()).toEqual(["Cara", "Bob", "Alice"]);

await user.click(screen.getByRole("button", { name: /^name/i }));

// Now sorted by Name asc
expect(rowOrder()).toEqual(["Alice", "Bob", "Cara"]);
```

Reusable for any sortable table — fixture data needs distinct values in
the sorted column, and the function reads the first cell. Adjust the
cell index if the column you're asserting on isn't first.

### Asserting modal isolation (stopPropagation)

When a row has multiple clickable surfaces (row click opens detail modal,
icon click opens edit modal), tests need to verify `stopPropagation()`
prevents the row handler from firing when the icon is clicked. **Count
open Radix Dialogs:**

```typescript
await user.click(screen.getByRole("button", { name: /edit customer/i }));

// If stopPropagation works: only the Edit modal opens → 1 dialog
// If it broke: row click ALSO fires → BOTH modals open → 2 dialogs
const openDialogs = screen.getAllByRole("dialog");
expect(openDialogs).toHaveLength(1);
```

Radix Dialog renders into a portal at `document.body`, but
`screen.getByRole("dialog")` searches the entire document — so the
count is accurate regardless of where the dialog's JSX is mounted in
the component tree.

### Factory helpers for entity test data — always spread overrides

Both action tests and component tests use factory helpers to build
entity rows for setup. The shape is consistent across entities:

```typescript
function makeEmployee(
  overrides: Partial<EmployeeForClient> = {},
): EmployeeForClient {
  return {
    id: "emp-1",
    name: "Default Employee",
    phone: "9876543210",
    type: "LABOUR",
    monthlySalary: null,
    // ...other defaults
    ...overrides, // ← MANDATORY; without this every "different" row is identical
  };
}
```

**The trailing `...overrides` spread is mandatory.** Without it, callers
that pass per-test overrides (`makeEmployee({ name: "Alice", type: "FIXED" })`)
get the defaults back, and every row looks the same. Symptoms: tests
that should filter or sort by name produce identical results, asserts
that look like they should pass at glance somehow find duplicated rows.
Phase 2.3 hit this exactly — a copy-paste-adapted factory dropped the
spread; 10 component tests failed silently with identical row data.

Pair the factory with a `mixedFixture()` builder when several distinct
rows are needed for filter / sort / search tests:

```typescript
function mixedEmployees(): EmployeeForClient[] {
  return [
    makeEmployee({ id: "1", name: "Alice Karigar", type: "LABOUR" }),
    makeEmployee({ id: "2", name: "Bob Salaried", type: "FIXED",  monthlySalary: 1800000 }),
    makeEmployee({ id: "3", name: "Cara Karigar", type: "LABOUR" }),
    makeEmployee({ id: "4", name: "Dan Salaried", type: "FIXED",  monthlySalary: 2500000 }),
  ];
}
```

Factories live alongside the test file for now; shared extraction is
deferred until a generic shape is visible (see `KNOWN_GAPS.md`).

## What NOT to test

Skip:
- **Third-party library internals.** Don't test that TanStack Table
  actually sorts an array; trust the library. Test the data flowing
  through (column definitions, predicate functions).
- **Auth.js internals.** Don't test that JWE encoding works; trust the
  library. Mock `auth()` / `requireSession()` at the boundary.
- **Pure styling / layout.** Don't assert `expect(el).toHaveClass('bg-primary')`
  — refactoring class names shouldn't break tests. Test what the user
  sees and does.
- **Static markup without logic.** A header that just renders a string
  doesn't need a test. The page test that uses it does.
- **CSS / Tailwind theme tokens.** Visual regression is a separate
  category (deferred — Playwright + visual diff).

## When to skip writing a test (this phase)

- Pure UI with no logic — e.g., the LabeledField component is two `<p>`
  tags with a null-coalesce. No test until something complex emerges.
- Throwaway debug code (smoke pages, dev-only routes). If it ships,
  it gets a test.
- Components fully covered by parent-component tests. The form modal's
  internal field structure is exercised by clicking through a form — no
  need for a separate test of each `<FormInput>` instance.

## Per-phase reporting

From Phase 2.3 onward, the "Test count delta" line in every phase report
should include:

- **Total tests passing after this phase** — single number
- **Net new tests added** — `+N` or `−N`
- **Any tests intentionally skipped** — only if applicable, with reason

Replaces the previous `N/A` placeholder.

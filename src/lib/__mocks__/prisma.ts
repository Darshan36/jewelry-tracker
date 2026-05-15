// Shared Prisma mock for tests.
//
// Vitest's auto-mock convention: when a test file calls `vi.mock('@/lib/prisma')`
// without a factory, Vitest resolves the alias to `src/lib/prisma.ts` and looks
// for a `__mocks__/prisma` file alongside it. This file is that replacement.
//
// `vitest-mock-extended`'s `mockDeep` produces a deeply-mocked PrismaClient
// where every model and every method is a `vi.fn()`-style mock. Tests use
// `vi.mocked(prisma.customer.create).mockResolvedValue(...)` to set per-call
// return values.
//
// `mockReset(prisma)` between tests clears both call history AND any
// per-test return-value configuration, so each test starts from a clean slate.

import type { PrismaClient } from "@/generated/prisma";
import {
  mockDeep,
  mockReset,
  type DeepMockProxy,
} from "vitest-mock-extended";
import { beforeEach, vi } from "vitest";

export const prisma: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>();

// `$transaction(callback)` default: invoke the callback with the same deep
// mock as the tx client and return its result. Phase 6 introduced `prisma.
// $transaction(async (tx) => …)` around the sales / purchases action flow,
// and tests that mock per-model methods need the callback path to actually
// run so those mocks fire. Tests can still override per-test if they want
// to assert tx-rollback behaviour.
function defaultTransactionImpl(arg: unknown): unknown {
  if (typeof arg === "function") {
    return (arg as (tx: typeof prisma) => unknown)(prisma);
  }
  // Array form: `$transaction([promise1, promise2])` → Promise.all-ish.
  if (Array.isArray(arg)) return Promise.all(arg);
  return undefined;
}

beforeEach(() => {
  mockReset(prisma);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(prisma.$transaction as any).mockImplementation(
    defaultTransactionImpl,
  );
});

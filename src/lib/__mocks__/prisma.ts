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
import { beforeEach } from "vitest";

export const prisma: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>();

beforeEach(() => {
  mockReset(prisma);
});

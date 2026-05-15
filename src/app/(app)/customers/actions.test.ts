import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be declared before any imports of the modules they replace.
// `vi.mock('@/lib/prisma')` resolves to `src/lib/__mocks__/prisma.ts`.
vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guards";
import { revalidatePath } from "next/cache";

import {
  createCustomer,
  softDeleteCustomer,
  updateCustomer,
} from "./actions";

const fakeSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    name: "Test Admin",
    role: "ADMIN" as const,
  },
  expires: "2099-12-31T00:00:00.000Z",
};

function makeCustomer(
  overrides: Partial<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "cuid-test",
    name: "Test Customer",
    phone: null,
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  // Default: auth succeeds with an ADMIN session. Tests can override via
  // vi.mocked(requireRole).mockRejectedValueOnce(...).
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(fakeSession);
  vi.mocked(revalidatePath).mockClear();
});

describe("createCustomer", () => {
  it("happy path — returns ok=true and writes through Prisma", async () => {
    vi.mocked(prisma.customer.create).mockResolvedValue(
      makeCustomer({ id: "new-cuid", name: "New Customer" }),
    );

    const result = await createCustomer({
      name: "New Customer",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.customer.id).toBe("new-cuid");
    expect(prisma.customer.create).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("rejects empty name — returns ok=false, DB not touched", async () => {
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
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid email — returns ok=false, DB not touched", async () => {
    const result = await createCustomer({
      name: "Test",
      phone: null,
      email: "notanemail",
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBeDefined();
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("propagates auth failure — throw bubbles up, DB not touched", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      createCustomer({
        name: "Test",
        phone: null,
        email: null,
        address: null,
        notes: null,
      }),
    ).rejects.toThrow("Unauthorized");

    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateCustomer", () => {
  it("happy path — Prisma update called with where.deletedAt=null guard", async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue(
      makeCustomer({ id: "abc", name: "Updated" }),
    );

    const result = await updateCustomer("abc", {
      name: "Updated",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("rejects empty name — DB update not called", async () => {
    const result = await updateCustomer("abc", {
      name: "",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("clearing phone passes null (not undefined) to Prisma — Phase 2.1 regression check", async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue(makeCustomer());

    await updateCustomer("abc", {
      name: "Test",
      phone: "", // user cleared the form field
      email: null,
      address: null,
      notes: null,
    });

    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
        data: expect.objectContaining({ phone: null }), // critical: null, not undefined
      }),
    );
    // Belt-and-suspenders: directly inspect the call args.
    const call = vi.mocked(prisma.customer.update).mock.calls[0][0];
    expect(call.data.phone).toBeNull();
    expect(call.data.phone).not.toBeUndefined();
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      updateCustomer("abc", {
        name: "Test",
        phone: null,
        email: null,
        address: null,
        notes: null,
      }),
    ).rejects.toThrow("Unauthorized");

    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});

describe("softDeleteCustomer", () => {
  it("happy path — Prisma update called with where.deletedAt=null + data.deletedAt=<Date>", async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue(
      makeCustomer({ deletedAt: new Date() }),
    );

    const result = await softDeleteCustomer("abc");

    expect(result.ok).toBe(true);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("deletedAt is a Date instance, not a string or number", async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue(makeCustomer());

    await softDeleteCustomer("abc");

    const call = vi.mocked(prisma.customer.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeleteCustomer("abc")).rejects.toThrow("Unauthorized");

    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});

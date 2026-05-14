import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be declared before any imports of the modules they replace.
// `vi.mock('@/lib/prisma')` resolves to `src/lib/__mocks__/prisma.ts`.
vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireSession: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guards";
import { revalidatePath } from "next/cache";

import {
  createSupplier,
  softDeleteSupplier,
  updateSupplier,
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

function makeSupplier(
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
    name: "Test Supplier",
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
  // vi.mocked(requireSession).mockRejectedValueOnce(...).
  vi.mocked(requireSession).mockReset();
  vi.mocked(requireSession).mockResolvedValue(fakeSession);
  vi.mocked(revalidatePath).mockClear();
});

describe("createSupplier", () => {
  it("happy path — returns ok=true and writes through Prisma", async () => {
    vi.mocked(prisma.supplier.create).mockResolvedValue(
      makeSupplier({ id: "new-cuid", name: "New Supplier" }),
    );

    const result = await createSupplier({
      name: "New Supplier",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.supplier.id).toBe("new-cuid");
    expect(prisma.supplier.create).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/suppliers");
  });

  it("rejects empty name — returns ok=false, DB not touched", async () => {
    const result = await createSupplier({
      name: "",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeDefined();
    expect(prisma.supplier.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid email — returns ok=false, DB not touched", async () => {
    const result = await createSupplier({
      name: "Test",
      phone: null,
      email: "notanemail",
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBeDefined();
    expect(prisma.supplier.create).not.toHaveBeenCalled();
  });

  it("propagates auth failure — throw bubbles up, DB not touched", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      createSupplier({
        name: "Test",
        phone: null,
        email: null,
        address: null,
        notes: null,
      }),
    ).rejects.toThrow("Unauthorized");

    expect(prisma.supplier.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateSupplier", () => {
  it("happy path — Prisma update called with where.deletedAt=null guard", async () => {
    vi.mocked(prisma.supplier.update).mockResolvedValue(
      makeSupplier({ id: "abc", name: "Updated" }),
    );

    const result = await updateSupplier("abc", {
      name: "Updated",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    expect(prisma.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/suppliers");
  });

  it("rejects empty name — DB update not called", async () => {
    const result = await updateSupplier("abc", {
      name: "",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    expect(prisma.supplier.update).not.toHaveBeenCalled();
  });

  it("clearing phone passes null (not undefined) to Prisma — Phase 2.1 regression check", async () => {
    vi.mocked(prisma.supplier.update).mockResolvedValue(makeSupplier());

    await updateSupplier("abc", {
      name: "Test",
      phone: "", // user cleared the form field
      email: null,
      address: null,
      notes: null,
    });

    expect(prisma.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
        data: expect.objectContaining({ phone: null }), // critical: null, not undefined
      }),
    );
    // Belt-and-suspenders: directly inspect the call args.
    const call = vi.mocked(prisma.supplier.update).mock.calls[0][0];
    expect(call.data.phone).toBeNull();
    expect(call.data.phone).not.toBeUndefined();
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      updateSupplier("abc", {
        name: "Test",
        phone: null,
        email: null,
        address: null,
        notes: null,
      }),
    ).rejects.toThrow("Unauthorized");

    expect(prisma.supplier.update).not.toHaveBeenCalled();
  });
});

describe("softDeleteSupplier", () => {
  it("happy path — Prisma update called with where.deletedAt=null + data.deletedAt=<Date>", async () => {
    vi.mocked(prisma.supplier.update).mockResolvedValue(
      makeSupplier({ deletedAt: new Date() }),
    );

    const result = await softDeleteSupplier("abc");

    expect(result.ok).toBe(true);
    expect(prisma.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/suppliers");
  });

  it("deletedAt is a Date instance, not a string or number", async () => {
    vi.mocked(prisma.supplier.update).mockResolvedValue(makeSupplier());

    await softDeleteSupplier("abc");

    const call = vi.mocked(prisma.supplier.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeleteSupplier("abc")).rejects.toThrow("Unauthorized");

    expect(prisma.supplier.update).not.toHaveBeenCalled();
  });
});

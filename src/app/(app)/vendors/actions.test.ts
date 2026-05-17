import { beforeEach, describe, expect, it, vi } from "vitest";

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
import type { Role } from "@/generated/prisma";

import {
  createVendor,
  softDeleteVendor,
  updateVendor,
} from "./actions";

function sessionFor(role: Role) {
  return {
    user: { id: "user-1", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

function makeVendor(
  overrides: Partial<{
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "vendor-1",
    name: "Test Vendor",
    phone: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-05-17T00:00:00Z"),
    updatedAt: new Date("2026-05-17T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

const validInput = {
  name: "Mahesh Casting Works",
  phone: "9876543210",
  address: null,
  notes: null,
};

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(sessionFor("ADMIN"));
  vi.mocked(revalidatePath).mockClear();
});

describe("createVendor", () => {
  it("happy path — returns ok=true and writes through Prisma", async () => {
    vi.mocked(prisma.castingPlatingVendor.create).mockResolvedValue(
      makeVendor({ id: "new-cuid", name: "Mahesh Casting Works", phone: "9876543210" }),
    );

    const result = await createVendor(validInput);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.vendor.id).toBe("new-cuid");
    expect(prisma.castingPlatingVendor.create).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("normalises the phone before saving (auto-promotion identity prep)", async () => {
    vi.mocked(prisma.castingPlatingVendor.create).mockResolvedValue(makeVendor());

    await createVendor({ ...validInput, phone: "(987) 654-3210" });

    const call = vi.mocked(prisma.castingPlatingVendor.create).mock.calls[0][0];
    expect(call.data.phone).toBe("9876543210");
  });

  it("rejects empty name — returns ok=false, DB not touched", async () => {
    const result = await createVendor({ ...validInput, name: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeDefined();
    expect(prisma.castingPlatingVendor.create).not.toHaveBeenCalled();
  });
});

describe("updateVendor", () => {
  it("happy path — Prisma update called with where.deletedAt=null guard", async () => {
    vi.mocked(prisma.castingPlatingVendor.update).mockResolvedValue(
      makeVendor({ id: "abc", name: "Updated" }),
    );

    const result = await updateVendor("abc", { ...validInput, name: "Updated" });

    expect(result.ok).toBe(true);
    expect(prisma.castingPlatingVendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("clearing phone passes null (not undefined) to Prisma", async () => {
    vi.mocked(prisma.castingPlatingVendor.update).mockResolvedValue(makeVendor());

    await updateVendor("abc", { ...validInput, phone: "" });

    const call = vi.mocked(prisma.castingPlatingVendor.update).mock.calls[0][0];
    expect(call.data.phone).toBeNull();
    expect(call.data.phone).not.toBeUndefined();
  });
});

describe("softDeleteVendor", () => {
  it("happy path — sets deletedAt and revalidates", async () => {
    vi.mocked(prisma.castingPlatingVendor.update).mockResolvedValue(
      makeVendor({ deletedAt: new Date() }),
    );

    const result = await softDeleteVendor("abc");

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.castingPlatingVendor.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });
});

// Vendor role matrix: ADMIN and CASTING_PLATING_MGMT allowed; others denied.
const ROLE_MATRIX = [
  ["ADMIN", true],
  ["CASTING_PLATING_MGMT", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", false],
] as const;

describe.each(ROLE_MATRIX)("createVendor role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.castingPlatingVendor.create).mockResolvedValue(makeVendor());
      const r = await createVendor(validInput);
      expect(r.ok).toBe(true);
      expect(prisma.castingPlatingVendor.create).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createVendor(validInput)).rejects.toThrow("Forbidden");
      expect(prisma.castingPlatingVendor.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(ROLE_MATRIX)("updateVendor role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.castingPlatingVendor.update).mockResolvedValue(makeVendor());
      const r = await updateVendor("abc", validInput);
      expect(r.ok).toBe(true);
      expect(prisma.castingPlatingVendor.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(updateVendor("abc", validInput)).rejects.toThrow("Forbidden");
      expect(prisma.castingPlatingVendor.update).not.toHaveBeenCalled();
    }
  });
});

describe.each(ROLE_MATRIX)("softDeleteVendor role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.castingPlatingVendor.update).mockResolvedValue(
        makeVendor({ deletedAt: new Date() }),
      );
      const r = await softDeleteVendor("abc");
      expect(r.ok).toBe(true);
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeleteVendor("abc")).rejects.toThrow("Forbidden");
      expect(prisma.castingPlatingVendor.update).not.toHaveBeenCalled();
    }
  });
});

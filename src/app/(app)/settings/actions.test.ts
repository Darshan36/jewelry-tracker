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

import { getShopSettings, upsertShopSettings } from "./actions";

const ADMIN_ID = "admin-1";

const adminSession = {
  user: {
    id: ADMIN_ID,
    email: "admin@example.com",
    name: "Admin",
    role: "ADMIN" as const,
  },
  expires: "2099-12-31T00:00:00.000Z",
};

function makeSettings(
  overrides: Partial<{
    id: string;
    shopName: string;
    phone: string | null;
    address: string | null;
    footer: string | null;
    updatedById: string | null;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: "settings-1",
    shopName: "Shree Creation",
    phone: null,
    address: null,
    footer: null,
    updatedById: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(adminSession);
  vi.mocked(revalidatePath).mockClear();
});

// =====================================================================
// getShopSettings
// =====================================================================

describe("getShopSettings", () => {
  it("returns the single row when configured", async () => {
    const row = makeSettings({ shopName: "Acme Jewels" });
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(row);

    const result = await getShopSettings();

    expect(result).toEqual(row);
    expect(prisma.shopSettings.findFirst).toHaveBeenCalledWith({
      orderBy: { updatedAt: "desc" },
    });
  });

  it("returns null when shop has never been configured", async () => {
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(null);
    const result = await getShopSettings();
    expect(result).toBeNull();
  });

  // Read intentionally has no role gate at the action level — page
  // server-components that read this are themselves ADMIN-gated.
  // Document the contract here.
  it("does NOT call requireRole — read is callable from any ADMIN-gated server context", async () => {
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(null);
    await getShopSettings();
    expect(requireRole).not.toHaveBeenCalled();
  });
});

// =====================================================================
// upsertShopSettings — create-then-update single-row behavior
// =====================================================================

describe("upsertShopSettings", () => {
  it("CREATE — when no row exists, creates a new row with updatedById from session", async () => {
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.shopSettings.create).mockResolvedValueOnce(
      makeSettings({ id: "new", shopName: "Shree Creation" }),
    );

    const result = await upsertShopSettings({
      shopName: "Shree Creation",
      phone: "+91 99999 11111",
      address: "12 Zaveri Bazaar",
      footer: "Thank you!",
    });

    expect(result.ok).toBe(true);
    expect(prisma.shopSettings.create).toHaveBeenCalledOnce();
    expect(prisma.shopSettings.update).not.toHaveBeenCalled();
    const callArg = vi.mocked(prisma.shopSettings.create).mock.calls[0][0];
    expect(callArg.data.shopName).toBe("Shree Creation");
    expect(callArg.data.updatedById).toBe(ADMIN_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/sales", "layout");
  });

  it("UPDATE — when a row exists, updates by id and does not create a new row", async () => {
    const existing = makeSettings({ id: "existing-row" });
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(existing);
    vi.mocked(prisma.shopSettings.update).mockResolvedValueOnce(
      makeSettings({ id: "existing-row", shopName: "New Name" }),
    );

    const result = await upsertShopSettings({
      shopName: "New Name",
      phone: null,
      address: null,
      footer: null,
    });

    expect(result.ok).toBe(true);
    expect(prisma.shopSettings.update).toHaveBeenCalledWith({
      where: { id: "existing-row" },
      data: expect.objectContaining({
        shopName: "New Name",
        updatedById: ADMIN_ID,
      }),
    });
    expect(prisma.shopSettings.create).not.toHaveBeenCalled();
  });

  it("rejects empty shopName — DB never touched", async () => {
    const result = await upsertShopSettings({
      shopName: "",
      phone: null,
      address: null,
      footer: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const flat = result.errors as Record<string, string[] | undefined>;
      expect(flat.shopName?.[0]).toMatch(/required/i);
    }
    expect(prisma.shopSettings.create).not.toHaveBeenCalled();
    expect(prisma.shopSettings.update).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only shopName", async () => {
    const result = await upsertShopSettings({
      shopName: "   ",
      phone: null,
      address: null,
      footer: null,
    });
    expect(result.ok).toBe(false);
    expect(prisma.shopSettings.create).not.toHaveBeenCalled();
  });

  it("normalizes empty-string phone/address/footer to null on write", async () => {
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.shopSettings.create).mockResolvedValueOnce(makeSettings());

    await upsertShopSettings({
      shopName: "Shop",
      phone: "",
      address: "   ",
      footer: "",
    });

    const callArg = vi.mocked(prisma.shopSettings.create).mock.calls[0][0];
    expect(callArg.data.phone).toBeNull();
    expect(callArg.data.address).toBeNull();
    expect(callArg.data.footer).toBeNull();
  });

  it("rejects shopName > 200 chars", async () => {
    const result = await upsertShopSettings({
      shopName: "x".repeat(201),
      phone: null,
      address: null,
      footer: null,
    });
    expect(result.ok).toBe(false);
  });

  it("gates with requireRole(['ADMIN'])", async () => {
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.shopSettings.create).mockResolvedValueOnce(makeSettings());
    await upsertShopSettings({
      shopName: "X",
      phone: null,
      address: null,
      footer: null,
    });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });

  it("propagates auth failure — DB never touched", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      upsertShopSettings({
        shopName: "X",
        phone: null,
        address: null,
        footer: null,
      }),
    ).rejects.toThrow("Forbidden");
    expect(prisma.shopSettings.findFirst).not.toHaveBeenCalled();
    expect(prisma.shopSettings.create).not.toHaveBeenCalled();
    expect(prisma.shopSettings.update).not.toHaveBeenCalled();
  });

  it("CREATE → UPDATE — the upsert pattern: create on first call, update on second", async () => {
    // First call: no row → CREATE
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.shopSettings.create).mockResolvedValueOnce(
      makeSettings({ id: "row-id" }),
    );
    await upsertShopSettings({
      shopName: "First",
      phone: null,
      address: null,
      footer: null,
    });
    expect(prisma.shopSettings.create).toHaveBeenCalledOnce();
    expect(prisma.shopSettings.update).not.toHaveBeenCalled();

    // Second call: row exists → UPDATE
    vi.mocked(prisma.shopSettings.findFirst).mockResolvedValueOnce(
      makeSettings({ id: "row-id" }),
    );
    vi.mocked(prisma.shopSettings.update).mockResolvedValueOnce(
      makeSettings({ id: "row-id", shopName: "Second" }),
    );
    await upsertShopSettings({
      shopName: "Second",
      phone: null,
      address: null,
      footer: null,
    });
    expect(prisma.shopSettings.create).toHaveBeenCalledOnce(); // still only once
    expect(prisma.shopSettings.update).toHaveBeenCalledOnce();
  });
});

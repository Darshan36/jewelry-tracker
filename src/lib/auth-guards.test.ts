// Phase 21.fix — auth-guards DB re-check tests.
//
// Pins the LAYER-2 defense: requireSession / requireRole must
// independently catch stale-JWT cases (deactivated user, role change)
// EVEN if the jwt callback regressed and let a stale token through.
//
// The asymmetric error handling vs the jwt callback:
//   - jwt callback FAILS SAFE on DB error (keeps token; prevents
//     mass logout on DB blip).
//   - These guards FAIL CLOSED on DB error (reject the action with
//     "Auth check failed"). Actions write data — better to bounce
//     one user with an error toast than allow a stale-token write
//     during a transient DB outage.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/prisma");

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "./auth-guards";

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(prisma.user.findUnique).mockReset();
});

// Build a minimal session that matches what auth() returns post-decode.
function makeSession(overrides: { id?: string; role?: string } = {}) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: {
      id: overrides.id ?? "u-1",
      email: "a@b.c",
      name: "Test",
      role: overrides.role ?? "ADMIN",
    } as any,
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

// --- requireSession -----------------------------------------------------

describe("requireSession — Phase 21.fix DB re-check", () => {
  it("throws Unauthorized when auth() returns null (no session)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    await expect(requireSession()).rejects.toThrow("Unauthorized");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("throws Unauthorized when session has no user", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce({ user: undefined } as any);
    await expect(requireSession()).rejects.toThrow("Unauthorized");
  });

  it("active user passes — returns enriched session", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession() as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const s = await requireSession();
    expect(s.user!.id).toBe("u-1");
    expect(s.user!.role).toBe("ADMIN");
  });

  it("DEACTIVATED user (deletedAt set) → throws Unauthorized", async () => {
    // Critical case: token says valid, DB says deactivated.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession() as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
      deletedAt: new Date("2026-05-23"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await expect(requireSession()).rejects.toThrow("Unauthorized");
  });

  it("user GONE (DB returns null) → throws Unauthorized", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession({ id: "ghost" }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    await expect(requireSession()).rejects.toThrow("Unauthorized");
  });

  it("FAIL-CLOSED on DB error → throws 'Auth check failed'", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession() as any);
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(
      new Error("connection terminated"),
    );
    // Intentionally fail closed at the action layer (writes are
    // dangerous; better to reject than allow a stale-token bypass).
    await expect(requireSession()).rejects.toThrow("Auth check failed");
  });
});

// --- requireRole --------------------------------------------------------

describe("requireRole — Phase 21.fix DB re-check + fresh role", () => {
  it("active user with allowed role passes", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession({ role: "ADMIN" }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const s = await requireRole(["ADMIN"]);
    expect(s.user!.role).toBe("ADMIN");
  });

  it("DEACTIVATED user → Unauthorized (NOT Forbidden — they're gone)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession({ role: "ADMIN" }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
      deletedAt: new Date("2026-05-23"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // Critical: even though token says ADMIN AND ADMIN is allowed, the
    // user is deactivated. requireRole must reject as Unauthorized.
    await expect(requireRole(["ADMIN"])).rejects.toThrow("Unauthorized");
  });

  it("STALE TOKEN role — token says ADMIN, DB says PURCHASE_DEPT → Forbidden when ADMIN required", async () => {
    // The defense-in-depth case the user explicitly called out:
    // requireRole must catch a stale token even if the jwt callback
    // somehow let one through.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession({ role: "ADMIN" }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "PURCHASE_DEPT",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // FRESH role (PURCHASE_DEPT) is NOT in [ADMIN]. Reject.
    await expect(requireRole(["ADMIN"])).rejects.toThrow("Forbidden");
  });

  it("STALE TOKEN role — token says PURCHASE_DEPT, DB says ADMIN → ALLOWED when ADMIN required (promotion)", async () => {
    // Mirror case: user was promoted; the jwt callback should have
    // refreshed the token but even if it didn't, the fresh DB role
    // wins. They get access immediately.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession({ role: "PURCHASE_DEPT" }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const s = await requireRole(["ADMIN"]);
    expect(s.user!.role).toBe("ADMIN");
  });

  it("active user, fresh role NOT in allowed list → Forbidden", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession({ role: "PURCHASE_DEPT" }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "PURCHASE_DEPT",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await expect(requireRole(["ADMIN"])).rejects.toThrow("Forbidden");
  });

  it("no session → Unauthorized (no DB call)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    await expect(requireRole(["ADMIN"])).rejects.toThrow("Unauthorized");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("FAIL-CLOSED on DB error → throws 'Auth check failed'", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession() as any);
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(
      new Error("ECONNRESET"),
    );
    await expect(requireRole(["ADMIN"])).rejects.toThrow("Auth check failed");
  });

  it("multi-role list — fresh role matches one of N allowed roles", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(auth).mockResolvedValueOnce(makeSession({ role: "LABOUR_MGMT" }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "LABOUR_MGMT",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const s = await requireRole(["ADMIN", "LABOUR_MGMT"]);
    expect(s.user!.role).toBe("LABOUR_MGMT");
  });
});

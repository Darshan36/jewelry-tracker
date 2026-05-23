import { describe, expect, it } from "vitest";

import {
  canManageLabour,
  canManageSettings,
  canManageUsers,
  canViewCompleted,
  canViewLabour,
  canViewLedger,
  canViewPayables,
  canViewReceivables,
  canViewReports,
  effectivePayableScope,
} from "./role-access";

describe("canViewPayables — role × scope matrix", () => {
  it("ADMIN can view any scope", () => {
    expect(canViewPayables("ADMIN", "purchase")).toBe(true);
    expect(canViewPayables("ADMIN", "casting_plating")).toBe(true);
    expect(canViewPayables("ADMIN", "all")).toBe(true);
  });

  it("PURCHASE_DEPT can view ONLY purchase scope", () => {
    expect(canViewPayables("PURCHASE_DEPT", "purchase")).toBe(true);
    expect(canViewPayables("PURCHASE_DEPT", "casting_plating")).toBe(false);
    expect(canViewPayables("PURCHASE_DEPT", "all")).toBe(false);
  });

  it("CASTING_PLATING_MGMT can view ONLY casting_plating scope", () => {
    expect(canViewPayables("CASTING_PLATING_MGMT", "purchase")).toBe(false);
    expect(canViewPayables("CASTING_PLATING_MGMT", "casting_plating")).toBe(
      true,
    );
    expect(canViewPayables("CASTING_PLATING_MGMT", "all")).toBe(false);
  });

  it("LABOUR_MGMT has no access at any scope", () => {
    expect(canViewPayables("LABOUR_MGMT", "purchase")).toBe(false);
    expect(canViewPayables("LABOUR_MGMT", "casting_plating")).toBe(false);
    expect(canViewPayables("LABOUR_MGMT", "all")).toBe(false);
  });
});

describe("effectivePayableScope", () => {
  it("ADMIN → all", () => {
    expect(effectivePayableScope("ADMIN")).toBe("all");
  });
  it("PURCHASE_DEPT → purchase", () => {
    expect(effectivePayableScope("PURCHASE_DEPT")).toBe("purchase");
  });
  it("CASTING_PLATING_MGMT → casting_plating", () => {
    expect(effectivePayableScope("CASTING_PLATING_MGMT")).toBe(
      "casting_plating",
    );
  });
  it("LABOUR_MGMT → null", () => {
    expect(effectivePayableScope("LABOUR_MGMT")).toBeNull();
  });
});

describe("canViewReceivables — ADMIN-only", () => {
  it("ADMIN can view", () => {
    expect(canViewReceivables("ADMIN")).toBe(true);
  });
  it("non-ADMIN roles cannot view", () => {
    expect(canViewReceivables("PURCHASE_DEPT")).toBe(false);
    expect(canViewReceivables("LABOUR_MGMT")).toBe(false);
    expect(canViewReceivables("CASTING_PLATING_MGMT")).toBe(false);
  });
});

describe("canViewLabour — Phase 18", () => {
  it("ADMIN can view", () => {
    expect(canViewLabour("ADMIN")).toBe(true);
  });
  it("LABOUR_MGMT can view", () => {
    expect(canViewLabour("LABOUR_MGMT")).toBe(true);
  });
  it("PURCHASE_DEPT cannot view", () => {
    expect(canViewLabour("PURCHASE_DEPT")).toBe(false);
  });
  it("CASTING_PLATING_MGMT cannot view", () => {
    expect(canViewLabour("CASTING_PLATING_MGMT")).toBe(false);
  });
});

describe("canManageLabour — Phase 18", () => {
  it("ADMIN can manage", () => {
    expect(canManageLabour("ADMIN")).toBe(true);
  });
  it("LABOUR_MGMT can manage", () => {
    expect(canManageLabour("LABOUR_MGMT")).toBe(true);
  });
  it("PURCHASE_DEPT cannot manage", () => {
    expect(canManageLabour("PURCHASE_DEPT")).toBe(false);
  });
  it("CASTING_PLATING_MGMT cannot manage", () => {
    expect(canManageLabour("CASTING_PLATING_MGMT")).toBe(false);
  });
});

describe("canViewLedger — Phase 21c.1 (open to every role)", () => {
  it("ADMIN can view", () => {
    expect(canViewLedger("ADMIN")).toBe(true);
  });
  it("PURCHASE_DEPT can view", () => {
    expect(canViewLedger("PURCHASE_DEPT")).toBe(true);
  });
  it("LABOUR_MGMT can view", () => {
    expect(canViewLedger("LABOUR_MGMT")).toBe(true);
  });
  it("CASTING_PLATING_MGMT can view", () => {
    expect(canViewLedger("CASTING_PLATING_MGMT")).toBe(true);
  });
});

describe("canViewCompleted — Phase 19", () => {
  it("ADMIN can view", () => {
    expect(canViewCompleted("ADMIN")).toBe(true);
  });
  it("PURCHASE_DEPT cannot view", () => {
    expect(canViewCompleted("PURCHASE_DEPT")).toBe(false);
  });
  it("LABOUR_MGMT cannot view", () => {
    expect(canViewCompleted("LABOUR_MGMT")).toBe(false);
  });
  it("CASTING_PLATING_MGMT cannot view", () => {
    expect(canViewCompleted("CASTING_PLATING_MGMT")).toBe(false);
  });
});

describe("canViewReports — Phase 19 (placeholder for Phase 15)", () => {
  it("ADMIN can view", () => {
    expect(canViewReports("ADMIN")).toBe(true);
  });
  it("non-ADMIN roles cannot view", () => {
    expect(canViewReports("PURCHASE_DEPT")).toBe(false);
    expect(canViewReports("LABOUR_MGMT")).toBe(false);
    expect(canViewReports("CASTING_PLATING_MGMT")).toBe(false);
  });
});

describe("canManageUsers — Phase 16 (admin-only user management)", () => {
  it("ADMIN can manage users", () => {
    expect(canManageUsers("ADMIN")).toBe(true);
  });
  it("non-ADMIN roles cannot manage users", () => {
    expect(canManageUsers("PURCHASE_DEPT")).toBe(false);
    expect(canManageUsers("LABOUR_MGMT")).toBe(false);
    expect(canManageUsers("CASTING_PLATING_MGMT")).toBe(false);
  });
});

describe("canManageSettings — Phase 20 (admin-only shop settings)", () => {
  it("ADMIN can manage settings", () => {
    expect(canManageSettings("ADMIN")).toBe(true);
  });
  it("non-ADMIN roles cannot manage settings", () => {
    expect(canManageSettings("PURCHASE_DEPT")).toBe(false);
    expect(canManageSettings("LABOUR_MGMT")).toBe(false);
    expect(canManageSettings("CASTING_PLATING_MGMT")).toBe(false);
  });
});

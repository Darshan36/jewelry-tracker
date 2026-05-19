import { describe, expect, it } from "vitest";

import {
  canViewPayables,
  canViewReceivables,
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

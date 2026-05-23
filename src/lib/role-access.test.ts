import { describe, expect, it } from "vitest";

import {
  canManageLabour,
  canManageSettings,
  canManageUsers,
  canViewLabour,
  canViewLedger,
  canViewReports,
} from "./role-access";

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

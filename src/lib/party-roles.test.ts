// Tests for the Party role-flag defense-in-depth helper.

import { describe, expect, it } from "vitest";

import {
  assertPartyHasRole,
  hasAnyPartyRole,
  PARTY_ROLE_FLAGS,
} from "./party-roles";

describe("hasAnyPartyRole", () => {
  it("returns false when every flag is absent", () => {
    expect(hasAnyPartyRole({})).toBe(false);
  });

  it("returns false when every flag is explicitly false", () => {
    expect(
      hasAnyPartyRole({
        isCustomer: false,
        isSupplier: false,
        isCastingVendor: false,
        isPlatingVendor: false,
      }),
    ).toBe(false);
  });

  it("returns false when every flag is null", () => {
    expect(
      hasAnyPartyRole({
        isCustomer: null,
        isSupplier: null,
        isCastingVendor: null,
        isPlatingVendor: null,
      }),
    ).toBe(false);
  });

  it.each(PARTY_ROLE_FLAGS)("returns true when only %s is true", (flag) => {
    expect(hasAnyPartyRole({ [flag]: true })).toBe(true);
  });

  it("returns true when multiple flags are true", () => {
    expect(
      hasAnyPartyRole({ isCastingVendor: true, isPlatingVendor: true }),
    ).toBe(true);
  });
});

describe("assertPartyHasRole", () => {
  it("throws when no role flag is set", () => {
    expect(() => assertPartyHasRole({})).toThrow(
      /at least one role flag/i,
    );
  });

  it("throws when every flag is false", () => {
    expect(() =>
      assertPartyHasRole({
        isCustomer: false,
        isSupplier: false,
        isCastingVendor: false,
        isPlatingVendor: false,
      }),
    ).toThrow(/at least one role flag/i);
  });

  it("does not throw when isCustomer is true", () => {
    expect(() => assertPartyHasRole({ isCustomer: true })).not.toThrow();
  });

  it("does not throw when isSupplier is true", () => {
    expect(() => assertPartyHasRole({ isSupplier: true })).not.toThrow();
  });

  it("does not throw when isCastingVendor is true", () => {
    expect(() =>
      assertPartyHasRole({ isCastingVendor: true }),
    ).not.toThrow();
  });

  it("does not throw when isPlatingVendor is true", () => {
    expect(() =>
      assertPartyHasRole({ isPlatingVendor: true }),
    ).not.toThrow();
  });

  it("includes all four role flag names in the error message", () => {
    try {
      assertPartyHasRole({});
      throw new Error("did not throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("isCustomer");
      expect(msg).toContain("isSupplier");
      expect(msg).toContain("isCastingVendor");
      expect(msg).toContain("isPlatingVendor");
    }
  });
});

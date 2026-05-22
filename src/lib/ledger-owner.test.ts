// Phase 21b — tests for the LedgerEntry owner-discriminator helpers.

import { describe, expect, it } from "vitest";

import {
  assertOwnerExactlyOne,
  hasExactlyOneOwner,
  resolveLedgerOwner,
} from "./ledger-owner";

describe("hasExactlyOneOwner", () => {
  it("true when partyId is set and employeeId is null", () => {
    expect(hasExactlyOneOwner({ partyId: "p1", employeeId: null })).toBe(true);
  });

  it("true when employeeId is set and partyId is null", () => {
    expect(hasExactlyOneOwner({ partyId: null, employeeId: "e1" })).toBe(true);
  });

  it("false when both are null", () => {
    expect(hasExactlyOneOwner({ partyId: null, employeeId: null })).toBe(false);
  });

  it("false when both are set (the DB CHECK rejects this too)", () => {
    expect(hasExactlyOneOwner({ partyId: "p1", employeeId: "e1" })).toBe(false);
  });

  it("treats empty string as not-set", () => {
    expect(hasExactlyOneOwner({ partyId: "", employeeId: "e1" })).toBe(true);
    expect(hasExactlyOneOwner({ partyId: "p1", employeeId: "" })).toBe(true);
    expect(hasExactlyOneOwner({ partyId: "", employeeId: "" })).toBe(false);
  });

  it("treats undefined as not-set", () => {
    expect(hasExactlyOneOwner({ partyId: undefined, employeeId: "e1" })).toBe(
      true,
    );
    expect(hasExactlyOneOwner({ partyId: "p1", employeeId: undefined })).toBe(
      true,
    );
  });
});

describe("assertOwnerExactlyOne", () => {
  it("does not throw when partyId is set alone", () => {
    expect(() =>
      assertOwnerExactlyOne({ partyId: "p1", employeeId: null }),
    ).not.toThrow();
  });

  it("does not throw when employeeId is set alone", () => {
    expect(() =>
      assertOwnerExactlyOne({ partyId: null, employeeId: "e1" }),
    ).not.toThrow();
  });

  it("throws with a 'missing' message when neither owner is set", () => {
    expect(() =>
      assertOwnerExactlyOne({ partyId: null, employeeId: null }),
    ).toThrow(/missing/i);
  });

  it("throws with an 'ambiguous' message when both owners are set", () => {
    expect(() =>
      assertOwnerExactlyOne({ partyId: "p1", employeeId: "e1" }),
    ).toThrow(/ambiguous/i);
  });
});

describe("resolveLedgerOwner", () => {
  it("returns { kind: 'PARTY', partyId } for a party-owned slice", () => {
    expect(
      resolveLedgerOwner({ partyId: "p1", employeeId: null }),
    ).toEqual({ kind: "PARTY", partyId: "p1" });
  });

  it("returns { kind: 'EMPLOYEE', employeeId } for a karigar-owned slice", () => {
    expect(
      resolveLedgerOwner({ partyId: null, employeeId: "e1" }),
    ).toEqual({ kind: "EMPLOYEE", employeeId: "e1" });
  });

  it("throws (via assertOwnerExactlyOne) on invalid slices", () => {
    expect(() => resolveLedgerOwner({ partyId: null, employeeId: null })).toThrow();
    expect(() => resolveLedgerOwner({ partyId: "p", employeeId: "e" })).toThrow();
  });
});

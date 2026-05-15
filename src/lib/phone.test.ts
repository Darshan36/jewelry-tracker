import { describe, expect, it } from "vitest";

import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("returns a clean string unchanged", () => {
    expect(normalizePhone("9876543210")).toBe("9876543210");
  });

  it("strips dashes", () => {
    expect(normalizePhone("9876-543-210")).toBe("9876543210");
  });

  it("strips whitespace (including internal and surrounding)", () => {
    expect(normalizePhone("  9876 543 210  ")).toBe("9876543210");
  });

  it("strips parentheses", () => {
    expect(normalizePhone("(987) 654-3210")).toBe("9876543210");
  });

  it("returns null for empty string", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizePhone("   ")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("is idempotent — re-normalising an already-clean phone is a no-op", () => {
    const first = normalizePhone("(987) 654 3210");
    const second = normalizePhone(first);
    expect(first).toBe(second);
    expect(second).toBe("9876543210");
  });

  it("preserves a leading + so international format survives the strip", () => {
    // Schema's max-length is 20; + is allowed. The action's findFirst
    // compares exact strings, so two records typed with vs. without "+"
    // would NOT match. That's a known trade-off, not a normaliser bug.
    expect(normalizePhone("+91 9876543210")).toBe("+919876543210");
  });
});

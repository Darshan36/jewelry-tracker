import { describe, expect, it } from "vitest";

import { vendorInputSchema } from "./schema";

function validInput() {
  return {
    name: "Mahesh Casting Works",
    phone: "9876543210",
    address: "Plot 42, Industrial Estate",
    notes: "Brass + aluminium specialist",
  };
}

describe("vendorInputSchema", () => {
  describe("happy path", () => {
    it("accepts a valid input with all four fields populated", () => {
      const result = vendorInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: "Mahesh Casting Works",
          phone: "9876543210",
          address: "Plot 42, Industrial Estate",
          notes: "Brass + aluminium specialist",
        });
      }
    });

    it("preserves name as a string", () => {
      const result = vendorInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
      if (result.success) expect(typeof result.data.name).toBe("string");
    });
  });

  describe("name", () => {
    it("rejects empty name with 'Name is required'", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        name: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.name).toContain(
          "Name is required",
        );
      }
    });

    it("rejects whitespace-only name (trim then min)", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        name: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name >200 chars", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        name: "x".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 200-char name (boundary)", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        name: "x".repeat(200),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("phone — normalize transform", () => {
    it("preserves a clean phone number unchanged", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        phone: "9876543210",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBe("9876543210");
    });

    it("strips whitespace, dashes, parens from phone via normalizePhone", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        phone: "(987) 654-3210",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBe("9876543210");
    });

    it("transforms empty string phone to null", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        phone: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeNull();
    });

    it("transforms undefined phone to null", () => {
      const { phone: _omit, ...rest } = validInput();
      const result = vendorInputSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeNull();
    });
  });

  describe("address", () => {
    it("transforms empty-string address to null", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        address: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.address).toBeNull();
    });

    it("rejects address >1000 chars", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        address: "x".repeat(1001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("notes", () => {
    it("transforms empty-string notes to null", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        notes: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.notes).toBeNull();
    });

    it("rejects notes >2000 chars", () => {
      const result = vendorInputSchema.safeParse({
        ...validInput(),
        notes: "x".repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("output shape", () => {
    it("returns name:string and 3 nullable fields when only name is supplied", () => {
      const result = vendorInputSchema.safeParse({ name: "X" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: "X",
          phone: null,
          address: null,
          notes: null,
        });
      }
    });
  });
});

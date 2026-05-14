import { describe, expect, it } from "vitest";

import { customerInputSchema } from "./schema";

// A valid happy-path object used as the baseline for every "tweak one
// field" test. Calls to safeParse use `{ ...validInput(), <field>: ... }`.
function validInput() {
  return {
    name: "Test Customer",
    phone: "9876543210",
    email: "test@example.com",
    address: "123 Main St",
    notes: "Regular client",
  };
}

describe("customerInputSchema", () => {
  describe("happy path", () => {
    it("accepts a valid input with all 5 fields populated", () => {
      const result = customerInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: "Test Customer",
          phone: "9876543210",
          email: "test@example.com",
          address: "123 Main St",
          notes: "Regular client",
        });
      }
    });

    it("preserves the name as a string", () => {
      const result = customerInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
      if (result.success) expect(typeof result.data.name).toBe("string");
    });
  });

  describe("name", () => {
    it("rejects empty name with 'Name is required'", () => {
      const result = customerInputSchema.safeParse({
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
      const result = customerInputSchema.safeParse({
        ...validInput(),
        name: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name >200 chars", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        name: "x".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 200-char name (boundary)", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        name: "x".repeat(200),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("phone — empty-string-to-null transform", () => {
    it("transforms empty string to null (NOT undefined)", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        phone: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeNull();
    });

    it("transforms whitespace-only phone to null (trim then transform)", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        phone: "   ",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeNull();
    });

    it("transforms undefined phone to null", () => {
      const { phone: _omit, ...withoutPhone } = validInput();
      const result = customerInputSchema.safeParse(withoutPhone);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeNull();
    });

    it("transforms explicit null phone to null", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        phone: null,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeNull();
    });

    it("preserves a normal phone string", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        phone: "9876543210",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBe("9876543210");
    });

    it("rejects phone >20 chars", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        phone: "1".repeat(21),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("email — transform then format validation via pipe", () => {
    it("transforms empty string to null WITHOUT triggering 'Invalid email'", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        email: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBeNull();
      }
      // explicit: no email error was raised
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.email).toBeUndefined();
      }
    });

    it("transforms whitespace-only email to null", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        email: "   ",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.email).toBeNull();
    });

    it("rejects malformed email with 'Invalid email'", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        email: "notanemail",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.email).toContain(
          "Invalid email",
        );
      }
    });

    it("accepts a valid email and preserves it", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        email: "test@example.com",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.email).toBe("test@example.com");
    });

    it("rejects email >200 chars", () => {
      // 201-char string with "@" mid-way so it'd pass format if not for size.
      const long = "x".repeat(100) + "@" + "y".repeat(100);
      const result = customerInputSchema.safeParse({
        ...validInput(),
        email: long,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("address", () => {
    it("transforms empty string to null", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        address: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.address).toBeNull();
    });

    it("rejects address >1000 chars", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        address: "x".repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 1000-char address (boundary)", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        address: "x".repeat(1000),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("notes", () => {
    it("transforms empty string to null", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        notes: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.notes).toBeNull();
    });

    it("rejects notes >2000 chars", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        notes: "x".repeat(2001),
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 2000-char notes (boundary)", () => {
      const result = customerInputSchema.safeParse({
        ...validInput(),
        notes: "x".repeat(2000),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("output shape", () => {
    it("returns name:string and 4 nullable fields when only name is supplied", () => {
      const result = customerInputSchema.safeParse({ name: "Test" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: "Test",
          phone: null,
          email: null,
          address: null,
          notes: null,
        });
      }
    });
  });
});

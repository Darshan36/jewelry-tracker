import { describe, expect, it } from "vitest";

import { employeeInputSchema } from "./schema";

// Happy-path baseline. Each test overrides one field via spread.
function validFixedInput() {
  return {
    name: "Test Salaried",
    phone: "9876543210",
    type: "FIXED" as const,
    monthlySalary: 18000,
    address: "123 Main St",
    notes: "Regular",
  };
}

function validLabourInput() {
  return {
    name: "Test Karigar",
    phone: "9876543210",
    type: "LABOUR" as const,
    monthlySalary: null,
    address: "123 Main St",
    notes: "Per-piece worker",
  };
}

describe("employeeInputSchema", () => {
  describe("happy path", () => {
    it("accepts a valid FIXED input with all fields populated", () => {
      const result = employeeInputSchema.safeParse(validFixedInput());
      expect(result.success).toBe(true);
    });

    it("accepts a valid LABOUR input with null monthlySalary", () => {
      const result = employeeInputSchema.safeParse(validLabourInput());
      expect(result.success).toBe(true);
    });

    it("accepts a minimal input (just name + type)", () => {
      const result = employeeInputSchema.safeParse({
        name: "Test",
        type: "LABOUR",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: "Test",
          phone: null,
          type: "LABOUR",
          monthlySalary: null,
          ratePerPiece: null,
          address: null,
          notes: null,
        });
      }
    });
  });

  describe("name", () => {
    it("rejects empty name with 'Name is required'", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        name: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.name).toContain(
          "Name is required",
        );
      }
    });

    it("rejects whitespace-only name", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        name: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name >200 chars", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        name: "x".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 200-char name (boundary)", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        name: "x".repeat(200),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("phone — empty-string-to-null transform", () => {
    it("transforms empty string to null", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        phone: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeNull();
    });

    it("transforms whitespace-only phone to null", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        phone: "   ",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.phone).toBeNull();
    });

    it("rejects phone >20 chars", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        phone: "1".repeat(21),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("type", () => {
    it("accepts FIXED", () => {
      const result = employeeInputSchema.safeParse({
        name: "Test",
        type: "FIXED",
      });
      expect(result.success).toBe(true);
    });

    it("accepts LABOUR", () => {
      const result = employeeInputSchema.safeParse({
        name: "Test",
        type: "LABOUR",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown type value", () => {
      const result = employeeInputSchema.safeParse({
        name: "Test",
        type: "BOTH",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("monthlySalary (FIXED)", () => {
    it("FIXED + positive integer preserves the value as a number (rupees)", () => {
      const result = employeeInputSchema.safeParse({
        ...validFixedInput(),
        monthlySalary: 18000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.monthlySalary).toBe(18000);
        expect(typeof result.data.monthlySalary).toBe("number");
      }
    });

    it("FIXED + null monthlySalary is allowed (salary may be undecided at hire)", () => {
      const result = employeeInputSchema.safeParse({
        ...validFixedInput(),
        monthlySalary: null,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.monthlySalary).toBeNull();
    });

    it("rejects zero salary (must be greater than zero)", () => {
      const result = employeeInputSchema.safeParse({
        ...validFixedInput(),
        monthlySalary: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative salary", () => {
      const result = employeeInputSchema.safeParse({
        ...validFixedInput(),
        monthlySalary: -1000,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer salary (e.g., 250.5)", () => {
      const result = employeeInputSchema.safeParse({
        ...validFixedInput(),
        monthlySalary: 250.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("conditional refinement: type + monthlySalary", () => {
    it("LABOUR + null monthlySalary passes refinement", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        monthlySalary: null,
      });
      expect(result.success).toBe(true);
    });

    it("LABOUR + positive monthlySalary fails refinement on monthlySalary field", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        monthlySalary: 18000,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.monthlySalary).toContain(
          "Monthly salary applies only to fixed-salary employees.",
        );
      }
    });

    it("FIXED + null monthlySalary passes refinement (still valid)", () => {
      const result = employeeInputSchema.safeParse({
        ...validFixedInput(),
        monthlySalary: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("address", () => {
    it("transforms empty string to null", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        address: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.address).toBeNull();
    });

    it("rejects address >1000 chars", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        address: "x".repeat(1001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("notes", () => {
    it("transforms empty string to null", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        notes: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.notes).toBeNull();
    });

    it("rejects notes >2000 chars", () => {
      const result = employeeInputSchema.safeParse({
        ...validLabourInput(),
        notes: "x".repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });
});

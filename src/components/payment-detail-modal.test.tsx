// Tests for the lightweight PaymentDetailModal (polish session follow-up
// to Phase 19). The modal is purely a richer rendering of EmployeePayment
// fields already loaded on the calling row — no server actions, no
// useEffect data fetching. Tests verify field rendering, type-chip
// switching, and conditional return on null.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { EmployeePaymentForCompleted } from "@/lib/completed-queries";

import { PaymentDetailModal } from "./payment-detail-modal";

afterEach(cleanup);

function makeSalary(
  overrides: Partial<EmployeePaymentForCompleted> = {},
): EmployeePaymentForCompleted {
  return {
    id: "p-1",
    employeeId: "e-1",
    employeeName: "Anita Sharma",
    employeeType: "FIXED",
    type: "SALARY",
    paidAt: "2026-05-10T05:30:00.000Z",
    amount: 1500000, // ₹15,000.00
    periodStart: "2026-05-01T00:00:00.000Z",
    periodEnd: "2026-05-31T00:00:00.000Z",
    note: "May salary cycle",
    ...overrides,
  };
}

function makeWage(
  overrides: Partial<EmployeePaymentForCompleted> = {},
): EmployeePaymentForCompleted {
  return {
    id: "p-2",
    employeeId: "e-2",
    employeeName: "Ramesh Karigar",
    employeeType: "LABOUR",
    type: "WAGE",
    paidAt: "2026-05-12T05:30:00.000Z",
    amount: 432500, // ₹4,325.00
    periodStart: "2026-05-01T00:00:00.000Z",
    periodEnd: "2026-05-09T00:00:00.000Z",
    note: null,
    ...overrides,
  };
}

describe("PaymentDetailModal — open/close", () => {
  it("returns null when payment is null (no modal rendered)", () => {
    const { container } = render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render dialog content when open=false", () => {
    render(
      <PaymentDetailModal
        open={false}
        onOpenChange={() => {}}
        payment={makeSalary()}
      />,
    );
    expect(screen.queryByTestId("payment-detail-modal")).toBeNull();
  });

  it("renders the modal with the payment id as data attribute", () => {
    render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={makeSalary({ id: "p-abc" })}
      />,
    );
    const modal = screen.getByTestId("payment-detail-modal");
    expect(modal.getAttribute("data-payment-id")).toBe("p-abc");
  });
});

describe("PaymentDetailModal — SALARY rendering", () => {
  it("renders employee name in the title and Salary type chip", () => {
    render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={makeSalary()}
      />,
    );
    expect(screen.getByText("Anita Sharma")).toBeInTheDocument();
    expect(screen.getByText("Salary")).toBeInTheDocument();
  });

  it("labels the period as 'Salary month start/end' for SALARY type", () => {
    render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={makeSalary()}
      />,
    );
    expect(screen.getByText("Salary month start")).toBeInTheDocument();
    expect(screen.getByText("Salary month end")).toBeInTheDocument();
    expect(screen.queryByText("Period start")).toBeNull();
    expect(screen.queryByText("Period end")).toBeNull();
  });

  it("displays the formatted amount and Fixed salary employee type", () => {
    render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={makeSalary()}
      />,
    );
    expect(screen.getByText(/₹15,000\.00/)).toBeInTheDocument();
    expect(screen.getByText("Fixed salary")).toBeInTheDocument();
  });

  it("renders the note when present", () => {
    render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={makeSalary({ note: "Bonus paid this cycle" })}
      />,
    );
    expect(screen.getByText("Bonus paid this cycle")).toBeInTheDocument();
  });
});

describe("PaymentDetailModal — WAGE rendering", () => {
  it("renders Wage type chip and Labour employee type", () => {
    render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={makeWage()}
      />,
    );
    expect(screen.getByText("Ramesh Karigar")).toBeInTheDocument();
    expect(screen.getByText("Wage")).toBeInTheDocument();
    expect(screen.getByText("Labour")).toBeInTheDocument();
  });

  it("labels the period as 'Period start/end' for WAGE type", () => {
    render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={makeWage()}
      />,
    );
    expect(screen.getByText("Period start")).toBeInTheDocument();
    expect(screen.getByText("Period end")).toBeInTheDocument();
    expect(screen.queryByText("Salary month start")).toBeNull();
    expect(screen.queryByText("Salary month end")).toBeNull();
  });

  it("renders an em-dash placeholder when the note is null", () => {
    render(
      <PaymentDetailModal
        open={true}
        onOpenChange={() => {}}
        payment={makeWage({ note: null })}
      />,
    );
    // LabeledField renders "—" when value is null.
    const noteLabel = screen.getByText("Note");
    const noteValue = noteLabel.parentElement?.querySelector("p:last-child");
    expect(noteValue?.textContent).toBe("—");
  });
});

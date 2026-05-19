import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/(app)/labour/actions", () => ({
  createEmployeePayment: vi.fn(),
}));

import { createEmployeePayment } from "@/app/(app)/labour/actions";
import { EmployeePaymentModal } from "./employee-payment-modal";

const employee = {
  id: "fix1",
  name: "Test Fixed Emp",
  type: "FIXED" as const,
};

beforeEach(() => {
  vi.mocked(createEmployeePayment).mockReset();
});

describe("EmployeePaymentModal", () => {
  it("renders with employee name + Salary chip when paymentType=SALARY", () => {
    render(
      <EmployeePaymentModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
        paymentType="SALARY"
      />,
    );
    expect(screen.getByText(/Pay Test Fixed Emp/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Salary/i).length).toBeGreaterThan(0);
  });

  it("renders Wage chip when paymentType=WAGE", () => {
    render(
      <EmployeePaymentModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={{ id: "lab1", name: "Karigar", type: "LABOUR" }}
        paymentType="WAGE"
      />,
    );
    expect(screen.getAllByText(/Wage/i).length).toBeGreaterThan(0);
  });

  it("pre-fills the amount field from defaultAmount (paise → rupees)", () => {
    render(
      <EmployeePaymentModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
        paymentType="SALARY"
        defaultAmount={1500000}
      />,
    );
    const amount = screen.getByLabelText(/Amount/i) as HTMLInputElement;
    expect(amount.value).toBe("15000.00");
  });

  it("Save button is disabled when amount is empty", () => {
    render(
      <EmployeePaymentModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
        paymentType="SALARY"
      />,
    );
    const save = screen.getByTestId("employee-payment-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("Save button enables after the user types a positive amount", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePaymentModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
        paymentType="SALARY"
      />,
    );
    const amount = screen.getByLabelText(/Amount/i);
    await user.type(amount, "100");
    const save = screen.getByTestId("employee-payment-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("calls createEmployeePayment with the right shape on save", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSaved = vi.fn();
    vi.mocked(createEmployeePayment).mockResolvedValue({ ok: true });

    render(
      <EmployeePaymentModal
        open
        onClose={onClose}
        onSaved={onSaved}
        employee={employee}
        paymentType="SALARY"
        defaultAmount={1500000}
      />,
    );

    await user.click(screen.getByTestId("employee-payment-save"));

    await waitFor(() => {
      expect(createEmployeePayment).toHaveBeenCalled();
    });
    const call = vi.mocked(createEmployeePayment).mock.calls[0][0];
    expect(call.employeeId).toBe("fix1");
    expect(call.type).toBe("SALARY");
    expect(call.amount).toBe(15000);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces server-side field errors", async () => {
    const user = userEvent.setup();
    vi.mocked(createEmployeePayment).mockResolvedValue({
      ok: false,
      errors: { amount: ["Amount must be greater than zero"] },
    });

    render(
      <EmployeePaymentModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
        paymentType="SALARY"
        defaultAmount={1500000}
      />,
    );

    await user.click(screen.getByTestId("employee-payment-save"));

    await waitFor(() => {
      expect(
        screen.getByText(/Amount must be greater than zero/i),
      ).toBeInTheDocument();
    });
  });

  it("renders the contextLabel when provided", () => {
    render(
      <EmployeePaymentModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
        paymentType="SALARY"
        contextLabel="May 2026"
      />,
    );
    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });
});

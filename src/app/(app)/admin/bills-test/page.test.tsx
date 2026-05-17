// Tests for the Bills Test admin server page. Verifies the role gate,
// the empty/populated rendering, and the date serialisation contract
// between the server component and its client child.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mocks — must be declared before importing the page module.
vi.mock("@/lib/prisma");
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
// Stub the client child so server-component tests don't try to render
// the real interactive UI (XHR upload + file picker). We just verify
// the props the page passes through.
vi.mock("./bills-test-client", () => ({
  BillsTestClient: (props: { bills: Array<Record<string, unknown>> }) => (
    <div data-testid="bills-test-client">
      <span data-testid="bill-count">{props.bills.length}</span>
      {props.bills.map((b) => (
        <div key={b.id as string} data-testid="bill-row">
          {b.originalFilename as string}
        </div>
      ))}
    </div>
  ),
}));

import { auth as _auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

import BillsTestPage from "./page";

// `auth` from next-auth is a polymorphic helper whose typed signature
// includes a middleware overload. Test code only exercises the no-arg
// session form; narrow the type so `vi.mocked(...).mockResolvedValue(...)`
// resolves to the simple Session | null shape instead of NextMiddleware.
type Session = {
  user: { id: string; email: string; name: string; role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT" };
  expires: string;
};
const auth = _auth as unknown as () => Promise<Session | null>;

function adminSession() {
  return {
    user: {
      id: "user-1",
      email: "admin@example.com",
      name: "Admin",
      role: "ADMIN" as const,
    },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BillsTestPage — auth gate", () => {
  it("redirects to /auth/login when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    await expect(BillsTestPage()).rejects.toThrow("REDIRECT:/auth/login");
    expect(redirect).toHaveBeenCalledWith("/auth/login");
    expect(prisma.bill.findMany).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when the user is not ADMIN", async () => {
    vi.mocked(auth).mockResolvedValue({
      ...adminSession(),
      user: { ...adminSession().user, role: "PURCHASE_DEPT" },
    });

    await expect(BillsTestPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
    expect(prisma.bill.findMany).not.toHaveBeenCalled();
  });
});

describe("BillsTestPage — rendering", () => {
  it("queries non-deleted bills ordered by uploadedAt desc, capped at 50", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession());
    vi.mocked(prisma.bill.findMany).mockResolvedValue([]);

    await BillsTestPage();

    expect(prisma.bill.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { uploadedAt: "desc" },
      take: 50,
    });
  });

  it("renders the page header and passes empty list to the client component", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession());
    vi.mocked(prisma.bill.findMany).mockResolvedValue([]);

    const tree = await BillsTestPage();
    render(tree);

    expect(screen.getByRole("heading", { name: /bills test/i })).toBeInTheDocument();
    expect(screen.getByTestId("bills-test-client")).toBeInTheDocument();
    expect(screen.getByTestId("bill-count").textContent).toBe("0");
  });

  it("serialises bill rows (Date → ISO string) and passes them to the client", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession());
    const uploadedAt = new Date("2026-05-17T12:00:00.000Z");
    vi.mocked(prisma.bill.findMany).mockResolvedValue([
      {
        id: "bill-1",
        r2Key: "bills/2026/05/x",
        mimeType: "application/pdf",
        sizeBytes: 4096,
        originalFilename: "receipt.pdf",
        uploadedById: "user-1",
        attachedToType: null,
        attachedToId: null,
        status: "READY",
        uploadedAt,
        confirmedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "bill-2",
        r2Key: "bills/2026/05/y",
        mimeType: "image/png",
        sizeBytes: 70,
        originalFilename: "tag.png",
        uploadedById: "user-1",
        attachedToType: null,
        attachedToId: null,
        status: "READY",
        uploadedAt,
        confirmedAt: new Date(),
        deletedAt: null,
      },
    ]);

    const tree = await BillsTestPage();
    render(tree);

    expect(screen.getByTestId("bill-count").textContent).toBe("2");
    expect(screen.getAllByTestId("bill-row")).toHaveLength(2);
    expect(screen.getByText("receipt.pdf")).toBeInTheDocument();
    expect(screen.getByText("tag.png")).toBeInTheDocument();
  });
});

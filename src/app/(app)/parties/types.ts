// Shared types for the parties bulk-payment server action.
//
// NOT 'use server' — imports of these types in client components would
// otherwise break per the KNOWN_GAPS 'types from a use-server file'
// caveat. Keep this module pure (no Prisma, no runtime side effects).

export type PartyPaymentAllocation = {
  entityType: "SALE" | "PURCHASE" | "CASTING_ENTRY" | "PLATING_ENTRY";
  entityId: string;
  amount: number; // rupees
};

export type PartyPaymentInput = {
  date: Date | string;
  type: "PAYMENT" | "REFUND";
  note?: string | null;
  allocations: PartyPaymentAllocation[];
};

export type PartyPaymentResult =
  | { ok: true; created: number }
  | {
      ok: false;
      errors: {
        message?: string;
        allocations?: Record<number, string[]>;
      };
    };

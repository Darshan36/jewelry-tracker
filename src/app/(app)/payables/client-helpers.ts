"use server";

// Client-component-callable wrapper that returns the unpaid transactions
// for a party in a single, flattened, JSON-safe shape that the
// PartyPaymentModal can render directly. Used by the quick-pay path on
// the payables (and receivables) list pages.

import { auth } from "@/lib/auth";
import {
  canViewPayables,
  canViewReceivables,
} from "@/lib/role-access";
import {
  getPayablesForParty,
  getReceivablesForParty,
  type PayableScope,
} from "@/lib/outstanding-balances";

import type { PartyPaymentTransaction } from "@/components/action-modals/party-payment-modal";

function trimLabel(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export async function getPartyTransactionsForPayment(
  partyId: string,
  scope: PayableScope,
): Promise<PartyPaymentTransaction[]> {
  const session = await auth();
  if (!session?.user) return [];
  if (!canViewPayables(session.user.role, scope)) return [];

  const detail = await getPayablesForParty(partyId, scope);
  if (!detail) return [];

  const rows: PartyPaymentTransaction[] = [];
  for (const p of detail.purchases) {
    rows.push({
      entityType: "PURCHASE",
      entityId: p.id,
      date: p.date,
      label: trimLabel(`Purchase · ${p.partyName ?? "Walk-in"}`),
      total: Number(p.total),
      outstanding: p.outstanding,
      hasAttachment: p.hasAttachment,
    });
  }
  for (const e of detail.castingEntries) {
    rows.push({
      entityType: "CASTING_ENTRY",
      entityId: e.id,
      date: e.date,
      label: trimLabel(`Casting · ${e.partyName ?? "Walk-in"}`),
      total: Number(e.total),
      outstanding: e.outstanding,
      hasAttachment: e.hasAttachment,
    });
  }
  for (const e of detail.platingEntries) {
    rows.push({
      entityType: "PLATING_ENTRY",
      entityId: e.id,
      date: e.date,
      label: trimLabel(`Plating · ${e.partyName ?? "Walk-in"}`),
      total: Number(e.total),
      outstanding: e.outstanding,
      hasAttachment: e.hasAttachment,
    });
  }
  return rows;
}

export async function getPartyTransactionsForReceivable(
  partyId: string,
): Promise<PartyPaymentTransaction[]> {
  const session = await auth();
  if (!session?.user) return [];
  if (!canViewReceivables(session.user.role)) return [];

  const detail = await getReceivablesForParty(partyId);
  if (!detail) return [];

  return detail.sales.map((s) => ({
    entityType: "SALE",
    entityId: s.id,
    date: s.date,
    label: trimLabel(`Sale · ${s.partyName ?? "Walk-in"}`),
    total: Number(s.total),
    outstanding: s.outstanding,
    hasAttachment: s.hasAttachment,
  }));
}

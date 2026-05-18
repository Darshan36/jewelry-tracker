"use client";

// Dual-path party input — the heart of Phase 3.1's design.
//
// State model:
//   - When `value.customerId` is non-null, the picker shows a "linked
//     customer" chip and a clear (×) button. The party-name input is
//     not rendered (the chip is the indicator).
//   - When `value.customerId` is null (walk-in mode), the picker shows
//     an editable text input. Typing opens a dropdown that lists up to
//     6 matching existing customers + a "Use as walk-in" footer.
//
// Caller integration: parents register hidden RHF fields for `customerId`,
// `partyName`, `partyPhone` and feed/receive a `{ customerId, partyName,
// partyPhone }` triple via this component's `value` / `onChange`.

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import {
  FormError,
  FormInput,
  FormLabel,
} from "@/components/form-controls";
import { normalizePhone } from "@/lib/phone";

export type CustomerOption = {
  id: string;
  name: string;
  phone: string | null;
};

export type PartyValue = {
  customerId: string | null;
  partyName: string;
  partyPhone: string | null;
};

type Props = {
  customers: CustomerOption[];
  value: PartyValue;
  onChange: (value: PartyValue) => void;
  error?: string;
};

const MAX_MATCHES = 6;

export function PartyPicker({ customers, value, onChange, error }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const matches = useMemo(() => {
    if (value.customerId !== null) return [];
    const q = value.partyName.trim();
    if (!q) return [];
    const qLower = q.toLowerCase();
    // Phone-prefix match (Phase 6) only fires when the query contains at
    // least one digit — pure-alphabetic queries skip phone matching to
    // avoid spurious hits when a stored phone happens to contain letters.
    // The query and the candidate phone are both normalized so that
    // "9876-543-210" stored matches "9876" typed.
    const qPhone = /\d/.test(q) ? normalizePhone(q) : null;
    return customers
      .filter((c) => {
        if (c.name.toLowerCase().includes(qLower)) return true;
        if (qPhone === null || c.phone === null) return false;
        return (normalizePhone(c.phone) ?? "").startsWith(qPhone);
      })
      .slice(0, MAX_MATCHES);
  }, [customers, value.partyName, value.customerId]);

  if (value.customerId !== null) {
    return (
      <div>
        <FormLabel>
          Party <span className="text-error ml-1" aria-hidden>*</span>
        </FormLabel>
        <div className="mt-1 flex items-start gap-3">
          <span className="inline-flex items-center gap-2 bg-secondary-container text-on-secondary-container px-3 py-1.5 border border-outline-variant text-sm">
            <span className="font-medium">{value.partyName}</span>
            <button
              type="button"
              onClick={() =>
                onChange({
                  customerId: null,
                  partyName: "",
                  partyPhone: null,
                })
              }
              aria-label="Clear linked customer"
              className="hover:opacity-70 transition-opacity"
            >
              <X className="size-3.5" />
            </button>
          </span>
          {value.partyPhone && (
            <span className="text-xs text-on-surface-variant tabular-nums pt-2">
              {value.partyPhone}
            </span>
          )}
        </div>
        {error && <FormError>{error}</FormError>}
      </div>
    );
  }

  return (
    <div>
      <FormLabel htmlFor="sales-party-name">
        Party <span className="text-error ml-1" aria-hidden>*</span>
      </FormLabel>
      <div className="relative">
        <FormInput
          id="sales-party-name"
          type="text"
          autoComplete="off"
          value={value.partyName}
          placeholder="Customer name or walk-in"
          onChange={(e) => {
            onChange({
              customerId: null,
              partyName: e.target.value,
              partyPhone: value.partyPhone,
            });
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          // Delay closing so a click on a dropdown item registers before blur.
          onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          aria-invalid={!!error}
        />
        {dropdownOpen && value.partyName.trim() && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-surface-container-high border border-outline-variant z-50 max-h-64 overflow-y-auto">
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({
                    customerId: c.id,
                    partyName: c.name,
                    partyPhone: c.phone,
                  });
                  setDropdownOpen(false);
                }}
                className="block w-full text-left px-3 py-2 hover:bg-surface-container-highest transition-colors border-b border-outline-variant/30 last:border-b-0"
              >
                <div className="text-sm text-on-surface">{c.name}</div>
                {c.phone && (
                  <div className="text-xs text-on-surface-variant tabular-nums">
                    {c.phone}
                  </div>
                )}
              </button>
            ))}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setDropdownOpen(false)}
              className="block w-full text-left px-3 py-2 text-xs uppercase tracking-wider text-on-surface-variant border-t border-outline-variant hover:bg-surface-container-highest transition-colors"
            >
              Use as walk-in:{" "}
              <span className="font-medium text-on-surface normal-case">
                {value.partyName.trim()}
              </span>
            </button>
          </div>
        )}
      </div>
      <FormError>{error}</FormError>

      <div className="mt-3">
        <FormLabel htmlFor="sales-party-phone">Phone (optional)</FormLabel>
        <FormInput
          id="sales-party-phone"
          type="tel"
          autoComplete="off"
          value={value.partyPhone ?? ""}
          onChange={(e) =>
            onChange({
              customerId: null,
              partyName: value.partyName,
              partyPhone: e.target.value === "" ? null : e.target.value,
            })
          }
        />
      </div>
    </div>
  );
}

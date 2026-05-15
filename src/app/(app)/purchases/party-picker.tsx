"use client";

// Dual-path party input — mirror of sales/party-picker.tsx.
//
// Structurally identical; the only inversions are the prop name
// (`suppliers` instead of `customers`), the FK key in `PartyValue`
// (`supplierId`), and the placeholder + aria labels ("supplier"
// instead of "customer"). Phase 4 redundancy observation: this is the
// SECOND instance of this component. Phase 6 (karigar payments) will
// likely create the third — at that point a generic <PartyPicker>
// extraction with a `directory` prop becomes the right move.

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import {
  FormError,
  FormInput,
  FormLabel,
} from "@/components/form-controls";
import { normalizePhone } from "@/lib/phone";

export type SupplierOption = {
  id: string;
  name: string;
  phone: string | null;
};

export type PartyValue = {
  supplierId: string | null;
  partyName: string;
  partyPhone: string | null;
};

type Props = {
  suppliers: SupplierOption[];
  value: PartyValue;
  onChange: (value: PartyValue) => void;
  error?: string;
};

const MAX_MATCHES = 6;

export function PartyPicker({ suppliers, value, onChange, error }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const matches = useMemo(() => {
    if (value.supplierId !== null) return [];
    const q = value.partyName.trim();
    if (!q) return [];
    const qLower = q.toLowerCase();
    // Phone-prefix match (Phase 6) only fires when the query contains at
    // least one digit — pure-alphabetic queries skip phone matching to
    // avoid spurious hits when a stored phone happens to contain letters.
    // The query and the candidate phone are both normalized so that
    // "9876-543-210" stored matches "9876" typed.
    const qPhone = /\d/.test(q) ? normalizePhone(q) : null;
    return suppliers
      .filter((s) => {
        if (s.name.toLowerCase().includes(qLower)) return true;
        if (qPhone === null || s.phone === null) return false;
        return (normalizePhone(s.phone) ?? "").startsWith(qPhone);
      })
      .slice(0, MAX_MATCHES);
  }, [suppliers, value.partyName, value.supplierId]);

  if (value.supplierId !== null) {
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
                  supplierId: null,
                  partyName: "",
                  partyPhone: null,
                })
              }
              aria-label="Clear linked supplier"
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
      <FormLabel htmlFor="party-name-input">
        Party <span className="text-error ml-1" aria-hidden>*</span>
      </FormLabel>
      <div className="relative">
        <FormInput
          id="party-name-input"
          type="text"
          autoComplete="off"
          value={value.partyName}
          placeholder="Supplier name or walk-in"
          onChange={(e) => {
            onChange({
              supplierId: null,
              partyName: e.target.value,
              partyPhone: value.partyPhone,
            });
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          aria-invalid={!!error}
        />
        {dropdownOpen && value.partyName.trim() && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-surface-container-high border border-outline-variant z-50 max-h-64 overflow-y-auto">
            {matches.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({
                    supplierId: s.id,
                    partyName: s.name,
                    partyPhone: s.phone,
                  });
                  setDropdownOpen(false);
                }}
                className="block w-full text-left px-3 py-2 hover:bg-surface-container-highest transition-colors border-b border-outline-variant/30 last:border-b-0"
              >
                <div className="text-sm text-on-surface">{s.name}</div>
                {s.phone && (
                  <div className="text-xs text-on-surface-variant tabular-nums">
                    {s.phone}
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
        <FormLabel htmlFor="party-phone-input">Phone (optional)</FormLabel>
        <FormInput
          id="party-phone-input"
          type="tel"
          autoComplete="off"
          value={value.partyPhone ?? ""}
          onChange={(e) =>
            onChange({
              supplierId: null,
              partyName: value.partyName,
              partyPhone: e.target.value === "" ? null : e.target.value,
            })
          }
        />
      </div>
    </div>
  );
}

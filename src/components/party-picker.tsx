"use client";

// Unified party picker (Phase 17a) — replaces the four per-entity
// pickers (sales/customer, purchases/supplier, casting/vendor,
// plating/vendor) with a single component parameterised by `role`.
//
// Each entity passes a `parties` list pre-filtered to the matching role
// (customer for /sales/new, supplier for /purchases/new, etc.). The
// component exposes a {partyId, partyName, partyPhone} triple via
// `value`/`onChange`. Walk-in auto-promotion happens server-side in the
// transaction action — the picker just emits the form values.
//
// State model:
//   - When `value.partyId` is non-null, the picker shows a "linked party"
//     chip and a clear (×) button. The party-name input is not rendered.
//   - When `value.partyId` is null (walk-in mode), the picker shows an
//     editable text input. Typing opens a dropdown that lists up to
//     6 matching existing parties + a "Use as walk-in" footer.
//
// DOM IDs use the `inputIdPrefix` prop to avoid cross-page collisions in
// shared modal portals — pattern from the KNOWN_GAPS party-picker DOM ID
// onboarding note.

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import {
  FormError,
  FormInput,
  FormLabel,
} from "@/components/form-controls";
import { normalizePhone } from "@/lib/phone";

export type PartyRole = "CUSTOMER" | "SUPPLIER" | "CASTING_VENDOR" | "PLATING_VENDOR";

export type PartyOption = {
  id: string;
  name: string;
  phone: string | null;
};

export type PartyValue = {
  partyId: string | null;
  partyName: string;
  partyPhone: string | null;
};

type Props = {
  role: PartyRole;
  parties: PartyOption[];
  value: PartyValue;
  onChange: (value: PartyValue) => void;
  error?: string;
  inputIdPrefix: string;
};

const MAX_MATCHES = 6;

const ROLE_LABELS: Record<PartyRole, { single: string; placeholder: string; clearAria: string }> = {
  CUSTOMER: {
    single: "customer",
    placeholder: "Customer name or walk-in",
    clearAria: "Clear linked customer",
  },
  SUPPLIER: {
    single: "supplier",
    placeholder: "Supplier name or walk-in",
    clearAria: "Clear linked supplier",
  },
  CASTING_VENDOR: {
    single: "vendor",
    placeholder: "Vendor name or walk-in",
    clearAria: "Clear linked vendor",
  },
  PLATING_VENDOR: {
    single: "vendor",
    placeholder: "Vendor name or walk-in",
    clearAria: "Clear linked vendor",
  },
};

export function PartyPicker({
  role,
  parties,
  value,
  onChange,
  error,
  inputIdPrefix,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const labels = ROLE_LABELS[role];
  const nameId = `${inputIdPrefix}-party-name`;
  const phoneId = `${inputIdPrefix}-party-phone`;

  const matches = useMemo(() => {
    if (value.partyId !== null) return [];
    const q = value.partyName.trim();
    if (!q) return [];
    const qLower = q.toLowerCase();
    const qPhone = /\d/.test(q) ? normalizePhone(q) : null;
    return parties
      .filter((p) => {
        if (p.name.toLowerCase().includes(qLower)) return true;
        if (qPhone === null || p.phone === null) return false;
        return (normalizePhone(p.phone) ?? "").startsWith(qPhone);
      })
      .slice(0, MAX_MATCHES);
  }, [parties, value.partyName, value.partyId]);

  if (value.partyId !== null) {
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
                onChange({ partyId: null, partyName: "", partyPhone: null })
              }
              aria-label={labels.clearAria}
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
      <FormLabel htmlFor={nameId}>
        Party <span className="text-error ml-1" aria-hidden>*</span>
      </FormLabel>
      <div className="relative">
        <FormInput
          id={nameId}
          type="text"
          autoComplete="off"
          value={value.partyName}
          placeholder={labels.placeholder}
          onChange={(e) => {
            onChange({
              partyId: null,
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
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({
                    partyId: p.id,
                    partyName: p.name,
                    partyPhone: p.phone,
                  });
                  setDropdownOpen(false);
                }}
                className="block w-full text-left px-3 py-2 hover:bg-surface-container-highest transition-colors border-b border-outline-variant/30 last:border-b-0"
              >
                <div className="text-sm text-on-surface">{p.name}</div>
                {p.phone && (
                  <div className="text-xs text-on-surface-variant tabular-nums">
                    {p.phone}
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
        <FormLabel htmlFor={phoneId}>Phone (optional)</FormLabel>
        <FormInput
          id={phoneId}
          type="tel"
          autoComplete="off"
          value={value.partyPhone ?? ""}
          onChange={(e) =>
            onChange({
              partyId: null,
              partyName: value.partyName,
              partyPhone: e.target.value === "" ? null : e.target.value,
            })
          }
        />
      </div>
    </div>
  );
}

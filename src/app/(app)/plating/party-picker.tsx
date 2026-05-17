"use client";

// Vendor picker for plating/plating entries. Mirrors the Sales/Purchases
// PartyPicker shape — phone-prefix matching for known vendors, plus a
// walk-in path that captures partyName + partyPhone strings on the entry.

import { useEffect, useMemo, useRef, useState } from "react";

import { FormError, FormInput, FormLabel } from "@/components/form-controls";
import { normalizePhone } from "@/lib/phone";

export type VendorOption = {
  id: string;
  name: string;
  phone: string | null;
};

type PartyValue = {
  vendorId: string | null;
  partyName: string;
  partyPhone: string | null;
};

type Props = {
  vendors: VendorOption[];
  value: PartyValue;
  onChange: (value: PartyValue) => void;
  error?: string;
};

export function PartyPicker({ vendors, value, onChange, error }: Props) {
  const [query, setQuery] = useState<string>(value.partyName);
  const [phoneInput, setPhoneInput] = useState<string>(value.partyPhone ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-sync local state when the parent resets the value (e.g., modal
  // reopens with a different entry).
  useEffect(() => {
    setQuery(value.partyName);
    setPhoneInput(value.partyPhone ?? "");
  }, [value.partyName, value.partyPhone]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qNormalized = normalizePhone(query);
    if (!q && !qNormalized) return vendors.slice(0, 8);
    return vendors
      .filter((v) => {
        if (v.name.toLowerCase().includes(q)) return true;
        if (qNormalized && v.phone?.startsWith(qNormalized)) return true;
        return false;
      })
      .slice(0, 8);
  }, [query, vendors]);

  const isLinked = value.vendorId !== null;

  function pickVendor(v: VendorOption) {
    onChange({ vendorId: v.id, partyName: v.name, partyPhone: v.phone });
    setQuery(v.name);
    setPhoneInput(v.phone ?? "");
    setOpen(false);
  }

  function clearLink() {
    onChange({ vendorId: null, partyName: "", partyPhone: null });
    setQuery("");
    setPhoneInput("");
  }

  return (
    <div ref={containerRef} className="space-y-3">
      <div className="relative">
        <FormLabel htmlFor="plating-party-name" required>
          Vendor
        </FormLabel>
        <FormInput
          id="plating-party-name"
          type="text"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Typing breaks the vendor link — treat as walk-in until they
            // pick a result from the dropdown.
            if (isLinked) {
              onChange({
                vendorId: null,
                partyName: e.target.value,
                partyPhone: normalizePhone(phoneInput),
              });
            } else {
              onChange({
                vendorId: null,
                partyName: e.target.value,
                partyPhone: normalizePhone(phoneInput),
              });
            }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          aria-invalid={!!error}
          placeholder="Search vendor or type a new name"
        />
        {open && matches.length > 0 && (
          <ul className="absolute z-10 left-0 right-0 mt-1 bg-surface-container-high border border-outline-variant max-h-60 overflow-y-auto">
            {matches.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => pickVendor(v)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface-container-highest border-b border-outline-variant/50 last:border-b-0"
                >
                  <span className="text-on-surface">{v.name}</span>
                  {v.phone && (
                    <span className="ml-2 text-on-surface-variant tabular-nums text-xs">
                      {v.phone}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <FormError>{error}</FormError>}
      </div>

      <div>
        <FormLabel htmlFor="plating-party-phone">Phone</FormLabel>
        <FormInput
          id="plating-party-phone"
          type="tel"
          autoComplete="off"
          value={phoneInput}
          onChange={(e) => {
            setPhoneInput(e.target.value);
            const normalized = normalizePhone(e.target.value);
            onChange({
              vendorId: isLinked ? value.vendorId : null,
              partyName: query,
              partyPhone: normalized,
            });
          }}
          placeholder="Optional"
        />
        {isLinked && (
          <p className="mt-1 text-xs text-on-surface-variant">
            Linked vendor.{" "}
            <button
              type="button"
              onClick={clearLink}
              className="underline hover:text-on-surface"
            >
              Clear link
            </button>{" "}
            to treat as walk-in.
          </p>
        )}
      </div>
    </div>
  );
}

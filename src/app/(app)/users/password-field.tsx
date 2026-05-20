"use client";

// Phase 16 polish — password input with a show/hide toggle.
//
// Wraps the standard `<FormInput>` plus an eye-icon button anchored to
// the right edge. Owns the visibility state locally; each instance
// toggles independently (a form with two password fields — e.g.,
// "new password" + "confirm" — gets two independent eye toggles).
//
// RHF compatibility: this component forwards refs through to the
// underlying `<input>` so `register('field')` continues to work
// without changes at the call site.

import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

import { FormInput } from "@/components/form-controls";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const PasswordField = forwardRef<HTMLInputElement, Props>(
  function PasswordField({ className = "", ...rest }, ref) {
    const [shown, setShown] = useState(false);
    return (
      <div className="relative">
        <FormInput
          ref={ref}
          type={shown ? "text" : "password"}
          // Reserve right-side padding so the toggle button doesn't
          // overlap typed text. h-11 button = 44x44px touch target.
          className={`pr-11 ${className}`}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          title={shown ? "Hide password" : "Show password"}
          data-testid="password-toggle"
          className="absolute right-0 top-1/2 -translate-y-1/2 h-11 w-11 inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
        >
          {shown ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
    );
  },
);

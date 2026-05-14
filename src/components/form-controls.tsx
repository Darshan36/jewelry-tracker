"use client";

// Styled form controls for the techno-artisanal form aesthetic.
//
// Use these instead of raw `<label>` / `<input>` / `<textarea>` in form
// modals so each form gets consistent styling without per-call className
// strings. RHF's `register('field')` spread plays through `forwardRef`
// transparently — the ref callback returned by RHF lands on the underlying
// DOM element.
//
// Class names are preserved verbatim from the previous per-modal FIELD_*
// constants (Phase 2.1 / 2.2). No visual changes.

import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

const LABEL_CLASS =
  "block font-display text-xs uppercase tracking-wider text-on-surface-variant";
const INPUT_CLASS =
  "w-full bg-transparent border-0 border-b border-outline-variant focus:border-secondary focus:outline-none py-2 text-on-surface placeholder:text-on-surface-variant/40 transition-colors";
const TEXTAREA_CLASS =
  "w-full bg-transparent border border-outline-variant focus:border-secondary focus:outline-none p-3 text-on-surface placeholder:text-on-surface-variant/40 transition-colors resize-none";
const ERROR_CLASS = "text-error text-xs mt-1";

type FormLabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  required?: boolean;
};

export const FormLabel = forwardRef<HTMLLabelElement, FormLabelProps>(
  function FormLabel({ children, required, className = "", ...rest }, ref) {
    return (
      <label ref={ref} className={`${LABEL_CLASS} ${className}`} {...rest}>
        {children}
        {required && (
          <span className="text-error ml-1" aria-hidden="true">
            *
          </span>
        )}
      </label>
    );
  },
);

export const FormInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function FormInput({ className = "", ...rest }, ref) {
  return (
    <input ref={ref} className={`${INPUT_CLASS} ${className}`} {...rest} />
  );
});

export const FormTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function FormTextarea({ className = "", ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={`${TEXTAREA_CLASS} ${className}`}
      {...rest}
    />
  );
});

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className={ERROR_CLASS}>{children}</p>;
}

// Read-only label/value pair used by detail-view modals.
//
// Lives under src/components/, NOT src/components/ui/ — that namespace is
// reserved for shadcn primitives. This is a project-specific composition.
//
// Renders an uppercase tracking-wider label above the value. Null or
// undefined values display as `—` so callers can pass through optional
// fields without a per-call null check. Set `multiline` for fields whose
// content may contain newlines (address, notes) — preserves whitespace
// and wraps long words.

type LabeledFieldProps = {
  label: string;
  value: string | null | undefined;
  multiline?: boolean;
};

export function LabeledField({
  label,
  value,
  multiline = false,
}: LabeledFieldProps) {
  return (
    <div>
      <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-1">
        {label}
      </p>
      <p
        className={
          multiline
            ? "text-sm text-on-surface whitespace-pre-wrap break-words"
            : "text-sm text-on-surface"
        }
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

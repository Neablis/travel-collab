"use client";
import { cn } from "../../lib/cn";
import { PHONE_TOUCH } from "./button";

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  variant = "pill",
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  variant?: "pill" | "subtle";
  "aria-label": string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex",
        variant === "pill" ? "gap-0.5 rounded-md bg-moss p-0.5" : "gap-3",
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onValueChange(o.value)}
          className={cn(
            // §13.1's phone floor, M26 link 14's sweep. These are `<button>`
            // rather than `Button` — a segmented option is not a
            // `buttonVariants` action, the same escape hatch a tag chip takes —
            // so the base's own floor does not reach them, and the unit toggle
            // measured 28px tall at 411px. `PHONE_TOUCH` is the primitive for
            // exactly this: an element styled like a control without being one.
            PHONE_TOUCH,
            "cursor-pointer text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
            variant === "pill"
              ? cn(
                  "rounded-sm px-2.5 py-1",
                  value === o.value ? "bg-surface font-semibold text-ink shadow-raised" : "text-slate hover:text-ink",
                )
              : cn(
                  "rounded-sm px-1 py-0.5",
                  value === o.value ? "font-semibold text-ink underline underline-offset-4" : "text-slate hover:text-ink",
                ),
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

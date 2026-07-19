"use client";
import { cn } from "../../lib/cn";

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
        "inline-flex gap-0.5",
        variant === "pill" ? "rounded-md bg-moss p-0.5" : "gap-3",
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

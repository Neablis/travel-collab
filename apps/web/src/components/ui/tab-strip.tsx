"use client";
import { cn } from "../../lib/cn";

// The moss-pill tab look of ui/tabs.tsx applied to plain role="tab" buttons —
// NOT Radix Tabs. Radix TabsTrigger is pointer-only, which silently breaks
// fireEvent.click tests (comment #11 / M5 Track B1). Driven by owned state.
export function TabStrip<T extends string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
}: {
  // `undefined` is for a caller whose selection can legitimately fall
  // outside this strip's own options (TripViewTabs: the trip view is on one
  // of the 4 lenses tucked behind its "More" menu) — every tab just renders
  // unselected in that case, same as passing a value that matches no option.
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  "aria-label": string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex gap-0.5 rounded-md bg-moss p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onValueChange(o.value)}
          className={cn(
            "cursor-pointer rounded-sm px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
            value === o.value ? "bg-surface font-semibold text-ink shadow-raised" : "text-slate hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

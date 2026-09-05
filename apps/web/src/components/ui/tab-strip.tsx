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
  // `undefined` is for a caller whose selection can legitimately fall outside
  // this strip's own options; every tab renders unselected in that case. No
  // caller needs it today — TripViewTabs' four tabs cover every lens since the
  // tab-less ones were retired (KI-20) — but it stays as the primitive's
  // contract rather than forcing a future caller to invent a sentinel option.
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  "aria-label": string;
}) {
  return (
    // `h-8` pins the strip at the design's 32px (`hint-size="auto,32px"`), and it
    // has to be pinned rather than left to content: this repo overrides
    // `--text-sm` to 13px/1.4 (globals.css), so the intrinsic height is
    // 2 + 4 + 18.2 + 4 + 2 = 30.2px — not the 32 that stock Tailwind's 14px/20px
    // would give. The Notebooks pill beside it is 32px, and 1.8px of mismatch on
    // two controls sharing a row reads as a misalignment rather than as a
    // rounding error (Mitchell, 2026-09-03: "should be aligned with the tabs").
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex h-8 items-center gap-0.5 rounded-md bg-moss p-0.5"
    >
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

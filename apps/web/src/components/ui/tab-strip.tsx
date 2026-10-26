"use client";
import { useRef } from "react";
import { cn } from "../../lib/cn";
import { useIndicator } from "../../lib/useIndicator";
import { PHONE_TOUCH } from "./button";

// The moss-pill tab look applied to plain role="tab" buttons — NOT Radix Tabs.
// Radix TabsTrigger is pointer-only, which silently breaks fireEvent.click
// tests (review comment 11, M5 Track B1). Driven by owned state.
export function TabStrip<T extends string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
}: {
  // `undefined` is for a caller whose selection can legitimately fall outside
  // this strip's own options; every tab renders unselected in that case. The
  // admin console's `TierPanel` passes it when there are no plans to select.
  // TripViewTabs no longer does — its four tabs cover every lens since the
  // tab-less ones were retired (KI-20).
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  "aria-label": string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const { indicator, trigger, ready } = useIndicator(list, value);
  return (
    // `h-8` pins the strip at the design's 32px (`hint-size="auto,32px"`), and it
    // has to be pinned rather than left to content: this repo overrides
    // `--text-sm` to 13px/1.4 (globals.css), so the intrinsic height is
    // 2 + 4 + 18.2 + 4 + 2 = 30.2px — not the 32 that stock Tailwind's 14px/20px
    // would give. The Notebooks pill beside it is 32px, and 1.8px of mismatch on
    // two controls sharing a row reads as a misalignment rather than as a
    // rounding error (Mitchell, 2026-09-03: "should be aligned with the tabs").
    //
    // **Pinned for a mouse only** (`fine:h-8`, M39 D3). Under a finger each tab
    // carries SPEC §13.1's 44px floor (`PHONE_TOUCH`) and the strip grows to
    // hold it: at 820px on a tablet these tabs measured 26px (KI-2026-09-24-j).
    <div
      ref={list}
      role="tablist"
      aria-label={ariaLabel}
      className="relative inline-flex items-center gap-0.5 rounded-md bg-moss p-0.5 fine:h-8"
    >
      {/* The raised pill, one for the strip, sliding between tabs (M54). */}
      <span
        ref={indicator}
        aria-hidden
        data-testid="tab-indicator"
        className="tab-indicator tab-indicator-box pointer-events-none absolute top-0 left-0 rounded-sm bg-surface shadow-raised"
      />
      {options.map((o) => (
        <button
          key={o.value}
          ref={trigger(o.value)}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onValueChange(o.value)}
          className={cn(
            PHONE_TOUCH,
            // `relative` paints the label over the indicator, which is
            // positioned and comes first.
            "relative cursor-pointer rounded-sm px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
            // The pill is the indicator's once it is placed; until then (the
            // server's HTML, the hydrating paint) the selected tab draws its own.
            value === o.value && !ready && "bg-surface shadow-raised",
            value === o.value ? "font-semibold text-ink" : "text-slate hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

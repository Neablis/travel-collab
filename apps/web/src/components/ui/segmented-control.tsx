"use client";
import { useRef } from "react";
import { cn } from "../../lib/cn";
import { useIndicator } from "../../lib/useIndicator";
import { PHONE_TOUCH } from "./button";
import { useRovingRadio } from "./use-roving-radio";

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  variant = "pill",
  fullWidth = false,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  variant?: "pill" | "subtle";
  /**
   * Fill the row, every option the same width — a form's own choice (the stop
   * editor's Kind, SPEC §36.9) rather than a toggle sitting in a toolbar.
   */
  fullWidth?: boolean;
  "aria-label": string;
}) {
  // A radiogroup owes the keyboard what a native one gives: one tab stop, and
  // arrows that move the choice (the stop editor's Kind lost it, PR 242 review).
  const radioProps = useRovingRadio(
    options.map((o) => o.value),
    value,
    onValueChange,
  );
  const list = useRef<HTMLDivElement>(null);
  const { indicator, trigger, ready } = useIndicator(list, value);
  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "relative",
        fullWidth ? "grid auto-cols-fr grid-flow-col" : "inline-flex",
        variant === "pill" ? "gap-0.5 rounded-md bg-moss p-0.5" : "gap-3",
      )}
    >
      {/* The selection, one for the group, sliding between options (M54): the
          raised pill, or the subtle look's underline. It dims with the
          options inside a `fieldset disabled`. */}
      <span
        ref={indicator}
        aria-hidden
        data-testid="tab-indicator"
        className={cn(
          "tab-indicator pointer-events-none absolute left-0 in-disabled:opacity-50",
          variant === "pill"
            ? "tab-indicator-box top-0 rounded-sm bg-surface shadow-raised"
            : "tab-indicator-line bottom-0 h-px bg-ink",
        )}
      />
      {options.map((o, i) => {
        const roving = radioProps(i);
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            {...roving}
            ref={(node) => {
              roving.ref(node);
              trigger(o.value)(node);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onValueChange(o.value)}
            className={cn(
              // §13.1's phone floor, M26 link 14's sweep. These are `<button>`
              // rather than `Button` — a segmented option is not a
              // `buttonVariants` action, the same escape hatch a tag chip takes —
              // so the base's own floor does not reach them, and the unit toggle
              // measured 28px tall at 411px. `PHONE_TOUCH` is the primitive for
              // exactly this: an element styled like a control without being one.
              PHONE_TOUCH,
              // `disabled:` as `Button` draws it, reached from an enclosing
              // `fieldset disabled` too (the gated invite form, W8). `relative`
              // paints the label over the indicator.
              "relative cursor-pointer text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50",
              // The selection is the indicator's once it is placed; until then
              // (the server's HTML, the hydrating paint) the option draws its own.
              variant === "pill"
                ? cn(
                    "rounded-sm px-2.5 py-1",
                    selected && !ready && "bg-surface shadow-raised",
                    selected ? "font-semibold text-ink" : "text-slate hover:text-ink",
                  )
                : cn(
                    "rounded-sm px-1 py-0.5",
                    // The indicator's own line, where it lands: a text
                    // underline sat higher and jumped at hydration.
                    selected && !ready && "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-ink",
                    selected ? "font-semibold text-ink" : "text-slate hover:text-ink",
                  ),
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

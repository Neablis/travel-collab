"use client";
import { useRef } from "react";
import { cn } from "../../lib/cn";

// SPEC §33.2's tab treatment: a 2px `--color-brand` underline, `--color-ink`
// active against `--color-slate` idle, sitting on a `--color-hairline` base
// line that the selected tab's edge overlaps.
//
// **Why this is not `TabStrip`.** That primitive is the moss PILL — a control
// that switches a view in place. This one says "you are on a different page of
// this thing". §33.2 draws the distinction as a rule for any list surface: a
// **place** is a tab, a **question** is a chip, a **property of the list** rides
// the results sentence. A place never reads as a filter, and a pill reads as a
// filter. The design system ships no underlined tab, so this is built from
// tokens; `DS-UPSTREAM.md` is where it goes if it should become a DS component.
//
// **Presentational on purpose.** `value`/`onValueChange` rather than any router
// awareness, because both callers put the tab somewhere different: Account puts
// it in `?tab=` (the tab IS the route — DRIFT §6 build-check 4) and Discover
// puts it in its own query state. A primitive that pushed to the router would
// have to know which.
//
// Same `<button role="tab">` shape the artboard uses, and the same reason
// `TabStrip` gives for not using Radix: `TabsTrigger` is pointer-only and
// silently breaks `fireEvent.click` tests.

/** The tab button's id — a panel points at it with `aria-labelledby`. */
export const tabId = (idPrefix: string, value: string) => `${idPrefix}-tab-${value}`;
/** The panel's id — the tab points at it with `aria-controls`. */
export const tabPanelId = (idPrefix: string, value: string) => `${idPrefix}-panel-${value}`;

export function UnderlineTabs<T extends string>({
  value,
  onValueChange,
  options,
  idPrefix,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  /** Namespaces the tab/panel ids so two strips on one page cannot collide. */
  idPrefix: string;
  className?: string;
  "aria-label": string;
}) {
  // The buttons are held by ref rather than found with a DOM query. The first
  // cut used `querySelector` + `CSS.escape`, and `CSS.escape` does not exist in
  // this jsdom — which threw inside the key handler while every test still
  // reported PASS, because an uncaught listener error is not a failed
  // assertion. A ref map has no such dependency and no escaping problem.
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  // A `role="tablist"` owes arrow-key movement — without it the tabs are a row
  // of buttons wearing a tab's clothes. `TabStrip` predates this and does not do
  // it; that is a gap in that primitive rather than a precedent to copy.
  // Selection follows focus, which is the right pattern when switching is cheap
  // and reversible (both callers are, and both keep the selection in a query
  // parameter the back button walks).
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const last = options.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowLeft"
            ? (index <= 0 ? last : index - 1)
            : (index >= last ? 0 : index + 1);
    const target = options[next];
    if (target === undefined) return;
    onValueChange(target.value);
    buttons.current.get(target.value)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      // 22px between tabs and a hairline base line, per the artboard. The -1px
      // pull that makes the selected edge overlap that line is on each BUTTON,
      // not here — see below.
      className={cn("flex items-stretch gap-5.5 border-b border-hairline", className)}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            ref={(node) => {
              if (node === null) buttons.current.delete(o.value);
              else buttons.current.set(o.value, node);
            }}
            id={tabId(idPrefix, o.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, o.value)}
            // Roving tabindex: the strip is one tab stop, and the arrow keys
            // move within it.
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(o.value)}
            className={cn(
              // `-mb-px` pulls each tab down by exactly the base line's width,
              // so the selected tab's 2px edge sits ON that line instead of
              // above it. Without it the two stack and read as a border with a
              // stripe under it rather than as one rule with a thick segment.
              // 40px min-height and 14px text are the artboard's, not a guess:
              // this repo's `--text-base` IS 14px, so `text-sm` (13px here)
              // would be a notch small.
              // **44px on a phone, the artboard's 40px from `md` up.** SPEC
              // §13.1 is "44px targets, always" and §34.3 repeats it for these
              // screens; the desktop artboard draws 40px. `min-h-`, not `h-`,
              // so a wrapped label pushes the row taller rather than
              // overflowing it (the same reason `button.tsx`'s `touch` size is
              // a min).
              "-mb-px min-h-11 cursor-pointer border-b-2 px-px text-base transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:min-h-10",
              selected
                ? "border-brand font-semibold text-ink"
                : "border-transparent font-medium text-slate hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

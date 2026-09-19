import { cn } from "../../lib/cn";

/**
 * **A chip that is on or off** — one member of a set somebody is picking from,
 * rendered as a tile rather than as a row with a box.
 *
 * Written rather than bypassed, for the reason `Checkbox` above it records:
 * the lint wall refused a raw `<button aria-pressed>` in the Keep-a-day picker,
 * correctly, so the design system grows the pattern instead of the rule growing
 * an exception. This is the first surface in the product where somebody picks
 * SEVERAL things from a short fixed list and the things have a shape worth
 * showing — a day with a date and a stop count. `CheckboxField` is the right
 * control when the members are sentences; this is the right one when they are
 * tiles you scan.
 *
 * **A real `<button>` with `aria-pressed`, not a checkbox and not a div.**
 * `aria-pressed` is the state on the control itself, so a screen reader hears
 * "Day 2, not pressed" from the thing being operated — which is what a toggle
 * is. A checkbox would be defensible; a `div` with a click handler would not,
 * and that is the failure this primitive exists to make unavailable.
 *
 * `type="button"` explicitly: these live inside dialogs that have a submit, and
 * the HTML default would make every chip submit the form.
 */
export function ToggleChip({
  pressed,
  className,
  children,
  ...props
}: { pressed: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed">) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "flex min-w-16 flex-col items-start rounded-md border px-2 py-1 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        pressed
          ? "border-brand bg-brand-subtle text-brand"
          : "border-border-input bg-surface text-muted hover:border-border-strong",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

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
        // **`h-full w-full`, not a content-sized chip.** A chip that sizes to
        // its own label gives a ragged grid — "Day 1 / no stops" is narrower
        // and shorter than "Day 12 / Sep 14 · 6 stops", so a row of them lines
        // up on nothing. Filling the cell moves the sizing decision to the
        // container, which is the only thing that can see all the labels at
        // once and make them agree (Mitchell, preview feedback on #192:
        // *"they should fit the longest text, but also all be aligned in height
        // and width"*). `justify-center` so a one-line chip sits level with a
        // two-line one instead of riding at the top of a taller cell.
        "flex h-full w-full flex-col items-start justify-center rounded-md border px-2 py-1 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        // **`brand-tint` and `slate`, and the names matter.** This shipped as
        // `bg-brand-subtle` / `text-muted`, and NEITHER is a token this app
        // defines — `globals.css` has `--color-brand-tint` and `--color-slate`.
        // Tailwind emits nothing for an unknown utility, so a pressed chip had
        // a transparent background and the unpressed label fell through to the
        // default ink: the selected state, which is this control's entire
        // purpose, was carried by a border alone. Found by walking the preview
        // (M23), not by any check — the colour wall scans for raw hex, so an
        // undefined TOKEN NAME passes it clean.
        pressed
          ? "border-brand bg-brand-tint text-brand"
          : "border-border-input bg-surface text-slate hover:border-border-strong",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

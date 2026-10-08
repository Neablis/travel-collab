import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

// **The design system had no checkbox until M22 Phase 3**, because nothing in
// the product had asked a person to pick several things from a fixed list. The
// token scope picker is the first, and the lint wall is what surfaced the gap —
// a raw `<input type="checkbox">` is refused, correctly, so the primitive gets
// written rather than the rule bypassed.
//
// Still a real `input`: it keeps the keyboard behaviour, the form semantics and
// the accessibility tree that a div-with-a-role reimplements badly.
//
// **The input is the 44px hit target on a phone; the 16px box is drawn beside
// it** (SPEC §13.1). The public-name checkbox on `/account` failed
// `m26-phone-targets` at 16px on pull request 359. A native checkbox cannot be
// a small glyph in a large box — Chromium ignores its padding and scales the
// glyph to fill whatever size it is given, measured — so the real input is
// laid transparent over the drawn box, centred on it, 44px square below `md`
// and the box's own 16px above it (`PHONE_TOUCH`'s line). It overflows the box
// rather than growing it, so neither the label's layout nor the desktop moves.
// The drawn box follows the input through `peer-*`: checked, focus-visible,
// disabled.
export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cn("relative inline-grid size-4 shrink-0 place-items-center", className)}>
      <input
        type="checkbox"
        className="peer absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-not-allowed md:size-4"
        {...props}
      />
      <span
        aria-hidden
        className="pointer-events-none col-start-1 row-start-1 size-4 rounded-xs border border-border-input bg-surface peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-brand peer-disabled:opacity-50"
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none col-start-1 row-start-1 hidden size-3 text-surface peer-checked:block"
      />
    </span>
  );
}

/**
 * A checkbox with its label and an explanatory line beside it.
 *
 * **The description is part of the control, not decoration.** Every caller so
 * far is asking someone to grant a capability, and a checkbox whose meaning is
 * a two-word title is one people tick without deciding anything.
 */
export function CheckboxField({
  checked,
  onCheckedChange,
  title,
  description,
  ...props
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title: string;
  description?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange" | "type">) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox
        className="mt-1"
        checked={checked}
        // **`checked` is read here, never inside a state updater.** An updater
        // runs during the next render, by which point React has released the
        // synthetic event and `currentTarget` is null. Hoisting it into this
        // primitive means no caller can make that mistake again — the first one
        // did, and its own test caught it.
        onChange={(e) => onCheckedChange(e.currentTarget.checked)}
        {...props}
      />
      <span>
        <span className="font-medium text-ink">{title}</span>
        {description === undefined ? null : (
          <span className="block text-xs text-slate">{description}</span>
        )}
      </span>
    </label>
  );
}

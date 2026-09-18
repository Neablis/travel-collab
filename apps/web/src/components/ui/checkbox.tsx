import { cn } from "../../lib/cn";

// **The design system had no checkbox until M22 Phase 3**, because nothing in
// the product had asked a person to pick several things from a fixed list. The
// token scope picker is the first, and the lint wall is what surfaced the gap —
// a raw `<input type="checkbox">` is refused, correctly, so the primitive gets
// written rather than the rule bypassed.
//
// Deliberately minimal and native: a real `input` keeps the keyboard behaviour,
// the form semantics and the accessibility tree that a div-with-a-role
// reimplements badly. What this adds is the focus ring and the brand colour
// every other control here already has.
export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 shrink-0 rounded-xs border border-border-input accent-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        className,
      )}
      {...props}
    />
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

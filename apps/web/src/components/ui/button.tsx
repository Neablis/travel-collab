import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/**
 * **The 44px floor, released above the phone** — SPEC §13.1's *"44px targets,
 * always"* applied to a control the design draws smaller on a desktop.
 *
 * Use this when the drawn height is a design decision worth keeping at width
 * (a 28px `sm` button in a row of three plan cards); use `size: "touch"` when
 * the control should be 44px everywhere, as the sheet header, the Ask pill and
 * the front door's controls are.
 *
 * **It lives here rather than in `NewTripWizard`, and it releases at `md`
 * rather than `sm`.** It was `NewTripWizard`'s exported `TOUCH`, owned by a
 * wizard and imported by anything that needed a floor — and it released at
 * `sm` (640px), which left **640–767px with no floor at all** while every other
 * phone rule in this app draws the line at 767 (`useIsPhone`'s
 * `PHONE_MAX_WIDTH_PX`, `.assistant-rail`, `.unscheduled-rack`, `md:hidden` on
 * the tab bar). A control 28px tall on a 700px-wide phone in landscape was
 * inside the band KI-046 measured and outside the only rule meant to protect
 * it.
 *
 * `min-h`, not `h`: a wrapped label on a 390px screen must push the control
 * taller rather than spill out of it, and `min-height` beats the variants'
 * fixed `h-*` without having to restate it.
 *
 * **Both axes, since M26 link 13.** It was height-only, which is enough for
 * every control that carries a label — those are already wider than 44px — and
 * is exactly half a target for an ICON-only one. A stop card's Edit and Remove
 * measured 32x32 on a 390px phone with this class applied to nothing; the card
 * is where link 14's chrome pass did not reach. `size: "touch"` had already
 * made this call for the same reason, in its own note: *"Both axes, so an
 * icon-only control gets a real 44px target from this same size and there is
 * no fifth one to keep in sync."* The two now agree.
 *
 * Costs the labelled call sites nothing: a button with words in it already
 * exceeds 44px wide, so `min-w-11` never binds there.
 */
export const PHONE_TOUCH = "min-h-11 min-w-11 md:min-h-0 md:min-w-0";

export const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-surface hover:bg-brand-hover active:bg-brand-pressed",
        secondary: "border border-border-strong bg-surface text-ink hover:bg-moss",
        ghost: "text-slate hover:bg-moss hover:text-ink",
        destructive: "bg-danger text-surface hover:bg-danger-ink",
      },
      size: {
        sm: "h-7 px-2.5 text-sm",
        md: "h-9 px-3.5 text-base",
        icon: "h-8 w-8 text-base",
        // The 44px touch floor — design handoff SPEC §13.1, "44px targets,
        // always". A fourth size exists rather than the `min-h-11` six phone
        // call sites write by hand today because those overrides have to fight
        // the variant, not just extend it: `TripBoardScreen` pairs it with
        // `h-auto` to undo `md`'s fixed `h-9`, and every one of them restates a
        // number the design system should own.
        //
        // `min-h`/`min-w`, not `h`/`w`, because §13.1 says the control grows by
        // min-height — a wrapped two-line label on a 390px screen must push the
        // button taller instead of spilling out of it. Both axes, so an
        // icon-only control gets a real 44px target from this same size and
        // there is no fifth one to keep in sync. `text-base` is `md`'s on
        // purpose: the control grows, the font does not, and the type scale
        // stays shared with desktop.
        touch: "min-h-11 min-w-11 px-3.5 text-base",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

// `ref` is a plain prop, not `forwardRef`: React 19 passes it straight through
// to function components, and the wrapper exists only to add classes. Declared
// explicitly because `ButtonHTMLAttributes` does not include it — without this
// line a caller that needs the element (the day chips, which move DOM focus as
// arrow keys walk the row) has to reach around this component.
export function Button({
  variant,
  size,
  className,
  type = "button",
  ref,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { ref?: React.Ref<HTMLButtonElement> }) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

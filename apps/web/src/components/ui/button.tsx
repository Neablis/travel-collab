import { Children, isValidElement } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";
import { TypingDots } from "./typing-dots";

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
 * rather than `sm` — and, since M39 D3, only for a mouse.** It was
 * `NewTripWizard`'s exported `TOUCH`, owned by a wizard and imported by
 * anything that needed a floor — and it released at
 * `sm` (640px), which left **640–767px with no floor at all** while every other
 * phone rule in this app draws the line at 767 (`useIsPhone`'s
 * `PHONE_MAX_WIDTH_PX`, `.unscheduled-rack`, `md:hidden` on
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
 *
 * **`fine:`, not `md:`, since M39 D3** (KI-2026-09-24-j). Released by width
 * alone, a tablet at 820px got the desktop's 28px controls under a finger. The
 * `fine` variant (globals.css) is "a fine pointer, at `md` and up", so a
 * touchscreen keeps the floor at any width and a mouse keeps today's density.
 */
export const PHONE_TOUCH = "min-h-11 min-w-11 fine:min-h-0 fine:min-w-0";

export const buttonVariants = cva(
  // **SPEC §13.1's floor, on the base and not on 48 call sites** — M26 link 14's
  // sweep, finished 2026-09-20 after link 13's census measured it unfinished.
  //
  // The census (411px, seven phone routes, rendered heights in a browser —
  // never a class scan): **48 of 91 controls under 44px, 53%.** `Account menu`
  // at 30x30 on every route, `Add stop` and `History` at 36, a template's
  // *Use this* at 28, the unit toggles at 28. `touch` and `PHONE_TOUCH` both
  // existed and between them covered five call sites.
  //
  // §13.1 is "44px targets, ALWAYS", so the floor belongs where every button
  // inherits it rather than where somebody remembers it. `fine:min-h-0
  // fine:min-w-0` releases it for a mouse from the same 768px line
  // `useIsPhone` draws, so the desktop's density — a 28px `sm` in a row of
  // three plan cards — is unchanged, and a tablet keeps 44px (M39 D3). `min-*`, never `h-*`: a wrapped label must push the control
  // taller rather than spill out of it, and it wins over the size variants'
  // fixed `h-*` without restating them.
  //
  // `PHONE_TOUCH` below and `size: "touch"` are now both REDUNDANT with this
  // for a phone. They are kept and neither is a duplicate: `touch` is 44px at
  // EVERY width, which the sheet header and the Ask pill want, and
  // `PHONE_TOUCH` is what an `<a>` styled by `buttonVariants` still needs when
  // it is not a `Button`. `phoneTouch.test.tsx` holds the relationship.
  //
  // **The press gives, on every variant** (M54): `scale-97` while pressed,
  // with colour, outline and the disabled fade on the same short timing.
  // `transition`, not `transition-colors`, so `scale` and `opacity` ride it.
  // Under reduced motion the press is colour alone.
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium transition duration-fast ease-calm active:scale-97 motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50 fine:min-h-0 fine:min-w-0",
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
        // **`fine:min-h-11 fine:min-w-11` re-asserts the floor the BASE now
        // releases.** Since M26 link 14's sweep the base carries §13.1's phone
        // floor and `fine:min-h-0 fine:min-w-0` lets the desktop's own density
        // through — which would have silently turned this size, whose whole
        // meaning is "44px at EVERY width", into a phone-only one. The sheet
        // header, the Ask pill and the front door are drawn at 44px on both
        // surfaces. `phoneTouch.test.tsx` caught it, and holds it here.
        touch: "min-h-11 min-w-11 px-3.5 text-base fine:min-h-11 fine:min-w-11",
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
//
// **`pending`, M54 decision 2: the box never changes.** The dots replace no
// words. An icon button's icon slot (its first child, when that is an element)
// shows the dots over the icon's own space; a label-only button fades its label
// and keeps its space, the dots centred where it was. `aria-busy` says so, and
// `pendingLabel`, if given, is the accessible name meanwhile ("Asking…"). Not
// `disabled`, which would drop keyboard focus mid-press: a click is refused
// instead, and `preventDefault` stops a submit button sending its form twice.
export function Button({
  variant,
  size,
  className,
  type = "button",
  ref,
  pending = false,
  pendingLabel,
  children,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    ref?: React.Ref<HTMLButtonElement>;
    pending?: boolean;
    pendingLabel?: string;
  }) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
      aria-busy={pending || undefined}
      aria-label={pending && pendingLabel !== undefined ? pendingLabel : props["aria-label"]}
      onClick={pending ? (event) => event.preventDefault() : onClick}
    >
      {pending ? <PendingContent>{children}</PendingContent> : children}
    </button>
  );
}

function PendingContent({ children }: { children: React.ReactNode }) {
  const [first, ...rest] = Children.toArray(children);
  if (isValidElement(first)) {
    return (
      <>
        <Held>{first}</Held>
        {rest}
      </>
    );
  }
  return <Held>{children}</Held>;
}

// What it holds stays laid out, only faded (`data-pending-held`, globals.css),
// so its box is still the button's; the dots sit over it and add no size.
function Held({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span data-pending-held className="inline-flex items-center">
        {children}
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        <TypingDots size="sm" />
      </span>
    </span>
  );
}

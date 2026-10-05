import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";
import { initialsFor } from "../../lib/initials";

// Extracted from the invite landing's two hand-rolled circles (the inviter at
// 44px, the crew stack at 30px) so the People panel's rows draw the same shape
// rather than a third copy of it.
const avatarVariants = cva("grid shrink-0 place-items-center rounded-full font-semibold", {
  variants: {
    size: {
      // A People row. Under the row's 44px touch floor on purpose: the ROW is
      // the target, the circle only identifies it.
      sm: "size-7 text-2xs",
      // The crew stack and the header's account button (handoff `…dc.html:97`).
      md: "size-7.5 text-2xs",
      // The invite landing's "who asked".
      lg: "size-11 text-md",
    },
    tone: {
      moss: "bg-moss text-ink",
      info: "bg-info-tint text-info-ink",
    },
  },
  defaultVariants: { size: "sm", tone: "moss" },
});

/**
 * A round initials avatar. Decorative by default (`aria-hidden`): every place
 * that draws one also prints the name beside it, and a screen reader hearing
 * "D R, Dana Reyes" learns nothing from the first half.
 *
 * `initials` overrides `initialsFor(name)` for a caller whose source is a
 * display name with its own rule (the invite landing). `icon` replaces the
 * initials outright, for a row that is not a person yet — a pending invite.
 */
export function Avatar({
  name,
  initials,
  icon,
  size,
  tone,
  className,
  ...props
}: Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> &
  VariantProps<typeof avatarVariants> & {
    name: string;
    initials?: string;
    icon?: React.ReactNode;
  }) {
  return (
    <span aria-hidden className={cn(avatarVariants({ size, tone }), className)} {...props}>
      {icon ?? initials ?? initialsFor(name)}
    </span>
  );
}

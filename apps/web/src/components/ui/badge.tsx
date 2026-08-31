import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

// `whitespace-nowrap`: a badge is a chip, and a chip that breaks across two
// lines reads as broken layout rather than as one label — reported on a
// 446px phone in the 2026-08-30 design pass, where the header's badge row
// split mid-label. Badges wrap as whole items in their flex row; they do not
// wrap inside themselves.
const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        neutral: "bg-moss text-slate",
        danger: "bg-danger-tint text-danger-ink",
        warning: "bg-warning-tint text-warning-ink",
        success: "bg-success-tint text-success-ink",
        info: "bg-info-tint text-info-ink",
        brand: "bg-brand-tint text-brand-pressed",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({ variant, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

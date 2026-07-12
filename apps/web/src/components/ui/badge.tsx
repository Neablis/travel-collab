import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", {
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
});

export function Badge({ variant, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

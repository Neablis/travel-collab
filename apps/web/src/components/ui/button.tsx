import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
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
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({ variant, size, className, type = "button", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

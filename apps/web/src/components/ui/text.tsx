import { cn } from "../../lib/cn";

const variants = {
  body: "text-base text-ink",
  secondary: "text-sm text-slate",
  muted: "text-xs text-slate",
} as const;

export function Text({ variant = "body", as: Tag = "p", className, ...props }: { variant?: keyof typeof variants; as?: "p" | "span" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn(variants[variant], className)} {...props} />;
}

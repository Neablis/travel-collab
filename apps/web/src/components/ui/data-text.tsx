import { cn } from "../../lib/cn";

const sizes = { xs: "text-xs", sm: "text-sm", base: "text-base" } as const;

// The Field Kit signature: every time, date, duration, and currency amount
// renders through this — mono digits align ledger-style (design-system.md).
export function DataText({ size = "sm", as: Tag = "span", className, ...props }: { size?: keyof typeof sizes; as?: "span" | "time" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("font-mono tabular-nums text-slate", sizes[size], className)} {...props} />;
}

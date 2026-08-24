import { cn } from "../../lib/cn";

const sizes = { xs: "text-xs", sm: "text-sm", base: "text-base" } as const;

// The Field Kit signature: every time, date, duration, and currency amount
// renders through this — mono digits align ledger-style (design-system.md).
// `React.HTMLAttributes` alone doesn't declare `dateTime` (it's specific to
// `<time>`'s own attribute set, `React.TimeHTMLAttributes`), so a caller
// rendering `as="time"` with a real machine-readable date — the honest
// pairing a semantic `<time>` element wants — couldn't type-check without
// this (CodeRabbit, PR #35).
export function DataText({ size = "sm", as: Tag = "span", className, ...props }: { size?: keyof typeof sizes; as?: "span" | "time" } & React.HTMLAttributes<HTMLElement> & Pick<React.TimeHTMLAttributes<HTMLElement>, "dateTime">) {
  return <Tag className={cn("font-mono tabular-nums text-slate", sizes[size], className)} {...props} />;
}

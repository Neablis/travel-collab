import { cn } from "../../lib/cn";

const styles = {
  1: "font-display text-2xl font-semibold text-ink",
  2: "font-display text-xl font-semibold text-ink",
  3: "font-display text-lg font-semibold text-ink",
  4: "font-display text-md font-medium text-ink",
} as const;

export function Heading({ level, className, ...props }: { level: 1 | 2 | 3 | 4 } & React.HTMLAttributes<HTMLHeadingElement>) {
  const Tag = `h${level}` as const;
  return <Tag className={cn(styles[level], className)} {...props} />;
}

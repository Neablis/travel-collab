import { cn } from "../../lib/cn";

const styles = {
  1: "font-display text-2xl font-semibold text-ink",
  2: "font-display text-xl font-semibold text-ink",
  3: "font-display text-lg font-semibold text-ink",
  4: "font-display text-md font-medium text-ink",
} as const;

// `ComponentPropsWithRef`, not `HTMLAttributes`: `PageTitle` renders the
// notebook's `h1` as a `contentEditable` and has to hold a ref to it, because
// React must not own the text while someone is typing into it. React 19 passes
// `ref` through as an ordinary prop on a function component, so this widening
// is the whole of it — no `forwardRef` wrapper.
export function Heading({ level, className, ...props }: { level: 1 | 2 | 3 | 4 } & React.ComponentPropsWithRef<"h1">) {
  const Tag = `h${level}` as const;
  return <Tag className={cn(styles[level], className)} {...props} />;
}

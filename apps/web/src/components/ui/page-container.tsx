import { cn } from "../../lib/cn";

const widths = {
  content: "max-w-content",   // Tailwind v4 generates these from --container-* (globals.css)
  measure: "max-w-measure",
  full: "",
} as const;

export function PageContainer({
  width = "content",
  as: Tag = "div",
  className,
  ...props
}: { width?: keyof typeof widths; as?: "div" | "main" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("mx-auto w-full px-6", widths[width], className)} {...props} />;
}

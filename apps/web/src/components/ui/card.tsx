import { cn } from "../../lib/cn";

export function Card({ raised = false, as: Tag = "div", className, ...props }: { raised?: boolean; as?: "div" | "li" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("rounded-md border border-hairline bg-surface p-3", raised && "shadow-raised", className)} {...props} />;
}

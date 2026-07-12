import { cn } from "../../lib/cn";
import { Heading } from "./heading";

export function Panel({ title, actions, className, children, ...props }: { title: string; actions?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <aside className={cn("rounded-lg border border-hairline bg-surface", className)} {...props}>
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <Heading level={4}>{title}</Heading>
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </aside>
  );
}

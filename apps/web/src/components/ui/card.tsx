import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export const Card = forwardRef<HTMLElement, { raised?: boolean; as?: "div" | "li" } & React.HTMLAttributes<HTMLElement>>(
  function Card({ raised = false, as: Tag = "div", className, ...props }, ref) {
    return (
      <Tag
        ref={ref as never}
        className={cn("rounded-md border border-hairline bg-surface p-3", raised && "shadow-raised", className)}
        {...props}
      />
    );
  },
);

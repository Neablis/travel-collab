import { cn } from "../../lib/cn";

// Deliberately a native <select> (ADR-010): Radix Select would swap native
// semantics and turn e2e selectOption updates behavioral.
export function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-sm border border-border-input bg-surface px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

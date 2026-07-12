import { cn } from "../../lib/cn";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-sm border border-border-input bg-surface px-3 text-base text-ink placeholder:text-slate focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        className,
      )}
      {...props}
    />
  );
}

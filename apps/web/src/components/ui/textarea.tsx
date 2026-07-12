import { cn } from "../../lib/cn";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full min-h-20 rounded-sm border border-border-input bg-surface px-3 py-2 text-base text-ink placeholder:text-slate focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        className,
      )}
      {...props}
    />
  );
}

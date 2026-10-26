import { cn } from "../../lib/cn";

/**
 * The one "working" signal (M54 decision 2: no spinners). Three dots in the
 * current colour, run by `[data-typing-dot]` in globals.css, which Cass's
 * typing row already used.
 *
 * `sm` is 16px across, the width of a `size-4` icon, so it fits a button's
 * icon slot without moving anything; `md` is the transcript's size.
 * Decorative: whatever stands next to it (a status line, `aria-busy`) says
 * what is happening.
 */
export function TypingDots({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center", size === "sm" ? "gap-0.5" : "gap-1", className)}>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          data-typing-dot={dot}
          className={cn("rounded-full bg-current", size === "sm" ? "size-1" : "size-1.5")}
        />
      ))}
    </span>
  );
}

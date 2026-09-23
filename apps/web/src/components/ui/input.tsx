import { cn } from "../../lib/cn";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // **§13.1's phone floor, the same shape `Button`'s base took** (M26
        // link 14's sweep). A field is a tap target too: the search box and the
        // account's name and home-airport fields measured 36px at 411px, which
        // is the whole of what was left under the floor once the buttons and
        // the nav items had it.
        //
        // `min-h-11` over `h-9`, released at 768px so the desktop keeps its own
        // density — exactly as the button base does, and at the same breakpoint
        // every other phone rule in this app draws.
        "h-9 min-h-11 w-full rounded-sm border border-border-input bg-surface px-3 text-base text-ink placeholder:text-slate focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand md:min-h-0",
        className,
      )}
      {...props}
    />
  );
}

import { PREVIEW_REGISTRY, type PreviewId } from "@/lib/preview-registry";

export function Preview({
  id,
  note,
  children,
  className,
}: {
  id: PreviewId;
  note?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { milestone } = PREVIEW_REGISTRY[id];
  return (
    <div
      role="group"
      aria-disabled="true"
      data-preview-id={id}
      title={note ?? `Coming in ${milestone}`}
      className={`relative ${className ?? ""}`}
    >
      {/* Shield: renders above children, swallows pointer events so no control
          inside a Preview ever fires. children keep their real markup/prop API.
          `style` (not just the Tailwind class) is load-bearing: jsdom's test
          environment never loads compiled CSS, so only an inline style is
          visible to getComputedStyle for @testing-library/user-event's
          pointer-events ancestor check. */}
      <div
        className="pointer-events-none select-none [&_a]:pointer-events-none [&_button]:pointer-events-none"
        style={{ pointerEvents: "none" }}
      >
        {children}
      </div>
      <span className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-surface">
        Preview · {milestone}
      </span>
    </div>
  );
}

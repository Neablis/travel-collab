import { PREVIEW_REGISTRY, type PreviewId } from "@/lib/preview-registry";

// A caller's own positioning class (e.g. TripBoardScreen's assistant-rail
// `fixed inset-y-0 right-0 z-50`) has the same specificity as the `relative`
// below, so Tailwind's compiled stylesheet — not the order these two classes
// appear in the string — decides which one wins the cascade, and `.relative`
// happens to be emitted after `.fixed`. That silently pinned every
// caller-positioned Preview to `position: relative` regardless of what it
// asked for (confirmed via getComputedStyle: `position: relative`, zero
// height, badge anchored nowhere useful). Only omit the hardcoded `relative`
// when the caller's own className establishes a positioning context, so the
// large majority of Preview usages (no className, or a className with no
// position keyword) keep the unchanged default.
const POSITION_KEYWORD = /\b(?:fixed|absolute|sticky)\b/;

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
  const callerSetsPosition = className !== undefined && POSITION_KEYWORD.test(className);
  return (
    <div
      role="group"
      aria-disabled="true"
      data-preview-id={id}
      title={note ?? `Coming in ${milestone}`}
      className={`${callerSetsPosition ? "" : "relative "}${className ?? ""}`}
    >
      {/* Shield: renders above children, swallows pointer events so no control
          inside a Preview ever fires. children keep their real markup/prop API.
          `style` (not just the Tailwind class) is load-bearing: jsdom's test
          environment never loads compiled CSS, so only an inline style is
          visible to getComputedStyle for @testing-library/user-event's
          pointer-events ancestor check. */}
      <div
        // pointer-events is inherited — no descendant (including Button,
        // which only sets pointer-events on its own disabled state) sets an
        // explicit override, so the plain class + inline style below already
        // blocks pointer events on every descendant. The former
        // `[&_a]:pointer-events-none [&_button]:pointer-events-none`
        // arbitrary-variant selectors were redundant.
        className="pointer-events-none select-none"
        style={{ pointerEvents: "none" }}
      >
        {children}
      </div>
      {/* Anchored OUTSIDE the box's own top-right corner (negative offsets,
          not the `right-2 top-2` this replaced) so the badge never sits on
          top of the host's real content — confirmed via getBoundingClientRect
          that on a compact host (e.g. AddSavedDayButton, 134x36px) an
          inside-corner badge covered most of the button's own label text,
          not just a harmless corner. Hanging mostly outside the box instead
          means it overlaps at most a sliver of the host's border/padding,
          regardless of host size, with no per-host tuning needed.
          `max-w-full truncate` covers the remaining case: a host narrower
          than the badge's own natural text width (e.g. a bare "Share"
          button, ~67px, next to a ~90px badge) — without a cap the badge
          stays full-width and swallows the host regardless of offset;
          capped, it clips to the host's own width instead. This only
          affects rendered layout, not textContent, so it doesn't change
          what `getByText(/Preview/)` finds in tests. */}
      <span
        className="absolute -right-1.5 -top-1.5 max-w-full truncate rounded-full bg-ink/80 px-2 py-0.5 font-mono uppercase tracking-wide text-surface"
        style={{ fontSize: "10px" }}
      >
        Preview · {milestone}
      </span>
    </div>
  );
}

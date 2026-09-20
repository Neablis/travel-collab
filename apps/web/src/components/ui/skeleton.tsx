import { Button } from "./button";
import { cn } from "../../lib/cn";

/**
 * **The three states a region owes between "asked" and "answered"** — M26
 * link 7, handoff §3b (`dc.html:6863-6947`, the `LOAD_PLAN` block).
 *
 * §3b's model, in its own words: *"A page paints its own shape immediately and
 * fills in region by region: each one swaps the moment its own request lands,
 * so a slow list never holds up a fast one."* Three rules follow from it, and
 * this file exists so that no screen has to restate them:
 *
 * 1. **Chrome and primary actions are real from the first frame.** Nothing in
 *    here draws a heading, a tab row or a button — a placeholder for a control
 *    that already works is a control the reader cannot press for no reason.
 *    That is why `Skeleton` is a leaf and never a layout.
 * 2. **A failed region retries IN PLACE**, while every region that did arrive
 *    stays on the page. `RegionError` is that retry, and its second line says
 *    so out loud, because the reader cannot otherwise tell a broken region
 *    from a broken page.
 * 3. **Placeholders are outlines, never invented values.** The hairline border
 *    with no background is the whole point; see `globals.css`'s `[data-sk]`
 *    block for the breathe that separates "arriving" from "empty".
 *
 * Why a primitive rather than markup per screen: before this, `Skeleton`,
 * `animate-pulse`, `data-sk` and `breathe` matched **nothing at all** in
 * `apps/web/src`. Four surfaces were about to grow their own, and the first
 * one to reach for a `bg-hairline` fill would have broken rule 3 silently —
 * there is no wall that catches a filled placeholder.
 */
export function Skeleton({
  className,
  delay = 1,
  circle = false,
  ...rest
}: {
  /** Size and shape — `w-*`/`h-*`. Never a `bg-*`: see rule 3 above. */
  className?: string;
  /** 1, 2 or 3: the handoff's three stagger bands (0ms / 220ms / 440ms). */
  delay?: 1 | 2 | 3;
  /** A pill/avatar rather than the default 6px-radius bar. */
  circle?: boolean;
  /** `aria-hidden` puts these out of every accessible query, so the only way
   *  a test can reach one is a test id. */
  "data-testid"?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-sk={delay}
      className={cn("block border border-hairline", circle ? "rounded-full" : "rounded-md", className)}
      {...rest}
    />
  );
}

/**
 * The group wrapper a screen puts its `Skeleton`s in.
 *
 * It carries `role="status"` and `aria-busy` so a screen reader is told the
 * region is working, and `aria-label` names WHICH region — because §3b's whole
 * claim is that regions arrive separately, and "Loading…" said once for a page
 * that is three-quarters painted is a lie. The `Skeleton` leaves are
 * `aria-hidden`, so this label is the only thing announced.
 */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

/**
 * **A region that failed, with its retry in place** (dc.html:1637-1644).
 *
 * `role="alert"`, where `SkeletonRegion` is `role="status"`: a failure that
 * lands after the reader has moved on is worth interrupting for; a "still
 * arriving" is not.
 *
 * `note` defaults to the handoff's own sentence. It is not decoration — it is
 * the only thing that tells the reader the rest of the page is still true, and
 * without it a region-sized error box reads as a page-sized one.
 */
export function RegionError({
  title,
  note = "Only this part failed. Everything else on the page is current.",
  onRetry,
  className,
  ...rest
}: {
  title: string;
  note?: string;
  onRetry: () => void;
  className?: string;
} & Pick<React.HTMLAttributes<HTMLDivElement>, "id"> & { "data-testid"?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-hairline bg-surface px-5 py-4",
        className,
      )}
      {...rest}
    >
      <span className="flex min-w-60 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold text-ink">{title}</span>
        <span className="text-pretty text-sm text-slate">{note}</span>
      </span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

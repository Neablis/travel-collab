"use client";

import {
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * **How many of a row's items fit on one line beside its "+N" chip.**
 *
 * `widths` are the items' own widths in order, `more` the "+N" chip's widest
 * label, `gap` the space between any two, `room` the row's width. Every item
 * fits on its own and needs no chip; otherwise as many as leave the chip room,
 * and never fewer than one, which then truncates rather than leaving a row of
 * nothing but a count. `max` caps the answer whatever the room; `min` is how
 * many must be drawn whatever the room, which the last of them then truncates.
 */
export function fitCount({
  widths,
  more,
  gap,
  room,
  max = Infinity,
  min = 1,
}: {
  widths: readonly number[];
  more: number;
  gap: number;
  room: number;
  max?: number;
  min?: number;
}): number {
  if (widths.length === 0) return 0;
  const limit = Math.min(widths.length, max);
  const floor = Math.min(Math.max(min, 1), limit);
  let end = 0;
  const ends = widths.map((width, i) => (end += width + (i === 0 ? 0 : gap)));
  if (limit === widths.length && ends[limit - 1]! <= room) return limit;
  for (let k = limit; k > floor; k -= 1) {
    if (ends[k - 1]! + gap + more <= room) return k;
  }
  return floor;
}

/**
 * **A row of chips that keeps to one line** (Mitchell, 2026-10-28: a card's
 * city and tag chips wrapped onto two and three rows, and on a phone the 44px
 * reach between rows left a 24px hole). The items that fit are drawn, and the
 * rest fold into `more(hidden)`.
 *
 * It measures, so the first render draws every item on one clipped line, which
 * is what the server's HTML shows; on the client the row counts the items'
 * widths, then draws the ones that fit, before the browser paints. A change of
 * the row's width, or the web font arriving, measures again.
 *
 * `py-3 -my-3` on a phone: an item's 44px reach (`min-h-11 -my-3`) stands 12px
 * past the row either way, and the row clips at its padding edge. With a
 * mouse, the 2px either side is the room a focus outline needs.
 */
export function FitRow({
  items,
  more,
  max,
  min,
  as: Tag = "div",
  className,
  ...rest
}: {
  /** Each a child of the row, in order: an `li` under `as="ul"`. */
  items: readonly ReactNode[];
  /** The chip that stands for the items not drawn, given how many that is. */
  more: (hidden: number) => ReactNode;
  /** At most this many items, however many fit. */
  max?: number;
  /** At least this many items, however few fit: the ones a reader asked for. */
  min?: number;
  as?: "div" | "ul" | "span";
  className?: string;
  "data-testid"?: string;
}) {
  const row = useRef<HTMLElement>(null);
  const count = items.length;
  // What was measured, and for which items: a count measured for other items
  // is no count of these, even as many of them in another order. Null while
  // measuring, when every item is drawn, so each has its own width.
  const key = [
    max ?? "",
    min ?? "",
    ...items.map((item) => (isValidElement(item) ? String(item.key) : "")),
  ].join("\u0000");
  const [fit, setFit] = useState<{ key: string; shown: number } | null>(null);
  const shown = fit?.key === key ? fit.shown : null;

  useLayoutEffect(() => {
    if (shown !== null) return;
    const el = row.current;
    if (el === null) return;
    const children = [...el.children] as HTMLElement[];
    const chip = children.find((child) => child.dataset.fitMore !== undefined);
    // Fractional widths: whole pixels rounded down a little at a time leave
    // the last chip a pixel or two past the edge.
    const widthOf = (child: HTMLElement) => child.getBoundingClientRect().width;
    const widths = children.filter((child) => child !== chip).map(widthOf);
    const style = getComputedStyle(el);
    setFit({
      key,
      shown: fitCount({
        widths,
        more: chip === undefined ? 0 : widthOf(chip),
        gap: parseFloat(style.columnGap) || 0,
        room:
          el.clientWidth -
          (parseFloat(style.paddingLeft) || 0) -
          (parseFloat(style.paddingRight) || 0),
        max,
        min,
      }),
    });
  }, [shown, key, max, min]);

  // A new width, or the font the items are drawn in: measure again.
  useEffect(() => {
    const el = row.current;
    if (el === null) return;
    let width = el.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (el.clientWidth === width) return;
            width = el.clientWidth;
            setFit(null);
          });
    observer?.observe(el);
    let live = true;
    void document.fonts?.ready.then(() => live && setFit(null));
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, []);

  const measuring = shown === null;
  const drawn = measuring ? count : shown;
  const hidden = count - drawn;
  const slot = Tag === "ul" ? "li" : "span";
  return (
    <Tag
      ref={row as never}
      className={cn(
        "-mx-0.5 flex min-w-0 flex-nowrap items-center overflow-hidden px-0.5 py-3 -my-3 fine:-my-0.5 fine:py-0.5",
        // Measuring, every item at its own width; drawn, the one that does
        // not fit on its own may shrink and truncate.
        measuring && "[&>*]:shrink-0",
        className,
      )}
      {...rest}
    >
      {items.slice(0, drawn)}
      {/* While measuring, the chip at its widest label and out of the flow:
          its width is wanted, not its place. */}
      {measuring
        ? count > 1 && (
            <FitMore as={slot} invisible>
              {more(count - 1)}
            </FitMore>
          )
        : hidden > 0 && <FitMore as={slot}>{more(hidden)}</FitMore>}
    </Tag>
  );
}

/** The "+N" chip's slot, which the row knows by `data-fit-more`. */
function FitMore({
  as: Slot,
  invisible = false,
  children,
}: {
  as: "li" | "span";
  invisible?: boolean;
  children: ReactNode;
}) {
  return (
    <Slot
      data-fit-more=""
      aria-hidden={invisible || undefined}
      className={cn("flex shrink-0", invisible && "invisible absolute")}
    >
      {children}
    </Slot>
  );
}

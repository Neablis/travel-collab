/**
 * **Where the floating assistant sits, and the one rule that keeps it
 * reachable** — SPEC §9, M26 link 10b.
 *
 * §9: *"Position is clamped to the viewport with a 16px pad, and re-clamped on
 * resize. A narrow window no longer evicts the assistant — floating costs no
 * layout width, so there is nothing to evict."*
 *
 * Pure and separate from the component for the usual reason plus a specific
 * one: the clamp's failure mode is a panel dragged half off the screen and left
 * there across a reload, which is the kind of thing a unit test catches in a
 * millisecond and a browser walk catches only if somebody happens to resize.
 */
export const ASSISTANT_PAD_PX = 16;

/**
 * §9's floating card: 364×476. Kept here rather than read from the element,
 * because the clamp has to run on a resize that may arrive before layout has
 * settled — and a measured 0×0 would clamp the panel into the top-left corner
 * and then survive every later re-clamp, which is the defect the artboard's own
 * `measured()` guard exists for (`dc.html:8784`).
 */
export const ASSISTANT_FLOAT_SIZE = { width: 364, height: 476 } as const;

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Viewport = { width: number; height: number };

/**
 * Bring a point inside the viewport, leaving a 16px pad on every side.
 *
 * **The `Math.max(pad, …)` on each bound is not belt and braces.** On a
 * viewport narrower than the panel plus two pads, `width - panel - pad` is less
 * than `pad`, so the upper bound falls BELOW the lower one and a naive
 * `min(max(pad, x), upper)` pins the panel to the upper bound — off the left
 * edge. Clamping the bound itself means a too-small viewport parks the panel at
 * the pad and lets it overflow to the right, where the part the reader needs
 * (the header, the Hide button) is still on screen.
 */
export function clampToViewport(
  point: Point,
  size: Size,
  viewport: Viewport,
  pad: number = ASSISTANT_PAD_PX,
): Point {
  const maxX = Math.max(pad, viewport.width - size.width - pad);
  const maxY = Math.max(pad, viewport.height - size.height - pad);
  return {
    x: Math.min(Math.max(pad, point.x), maxX),
    y: Math.min(Math.max(pad, point.y), maxY),
  };
}

/**
 * The bottom-right corner the panel opens in when nobody has moved it.
 *
 * §9: *"Expanding and collapsing keep the bottom-right corner planted, so the
 * panel grows out of the bubble rather than jumping across the screen."* The
 * CSS (`.assistant-float`) pins that corner with `right`/`bottom`, which is the
 * static half; this is the same corner expressed as a top-left point, for the
 * moment a drag turns the panel into something positioned by `left`/`top`.
 */
export function floatHome(viewport: Viewport, size: Size = ASSISTANT_FLOAT_SIZE): Point {
  return clampToViewport(
    { x: viewport.width - size.width - ASSISTANT_PAD_PX, y: viewport.height - size.height - ASSISTANT_PAD_PX },
    size,
    viewport,
  );
}

/**
 * Is this viewport big enough to compute a position against?
 *
 * The artboard's `measured()` (`dc.html:8784`), and its comment is the whole
 * reason: *"A position computed before the frame has a size is worse than no
 * position: it clamps to the top-left pad and then survives every later
 * re-clamp."* A zero or near-zero viewport is a frame that has not laid out
 * yet, not a real window.
 */
export function isMeasuredViewport(viewport: Viewport): boolean {
  return viewport.width > 200 && viewport.height > 200;
}

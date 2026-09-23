"use client";

import type { ButtonHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";

/**
 * **A new-trip answer, drawn as a control** (SPEC §35.9): *"an action in a
 * chat is a control, not a sentence."* The chips were `secondary` buttons —
 * surface ground, hairline, ink — which is what the rest of the dock looks
 * like, so the answers read as more furniture. Brand tint, a brand border and
 * brand-pressed text say "tap me"; picked, the pill fills.
 *
 * A `Button` restyled here rather than a new variant: nothing else in the app
 * is this, and a variant would be a design-system decision made for one dock.
 *
 * Sizes, from §35.9 and §32.2:
 * - **sheet** — 13px, 5px × 12px, the desktop sheet's density;
 * - **page** — first run's page, 34px tall and 13px across;
 * - **phone**, both places — 14px and 15px across, at §13.1's 44px floor
 *   (`Button`'s own). The design draws 40px there, and the dock's note had
 *   already declined that height: a sixth control size, 4px under a floor
 *   §13.1 calls absolute.
 */
const PLACE = {
  sheet: "md:px-3 md:py-1.25 md:text-sm",
  page: "md:min-h-8.5 md:px-3.25 md:text-sm",
} as const;

/**
 * One answer chip on the new-trip dock.
 *
 * @param place - `sheet` or `page`: which surface's desktop density to take.
 * @param pressed - The multi-select turn's picked state; omit on single-answer turns.
 * @returns A pill-shaped button that commits or toggles its answer.
 */
export function AnswerPill({
  place,
  pressed,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className" | "aria-pressed"> & {
  place: keyof typeof PLACE;
  /** Set on the multi-select turn only. A single answer commits; it has no "on". */
  pressed?: boolean;
}) {
  const on = pressed === true;
  const sized = PLACE[place];
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      className={`h-auto rounded-full border-brand px-3.75 text-base font-semibold ${sized} ${
        on ? "bg-brand text-surface hover:bg-brand-hover" : "bg-brand-tint text-brand-pressed hover:bg-brand-tint"
      }`}
      {...props}
    >
      {/* The tick is the picked state said in something other than colour;
          `aria-pressed` says it to a screen reader, so the glyph is hidden and
          the accessible name stays the answer itself. */}
      {on && <span aria-hidden>✓</span>}
      {children}
    </Button>
  );
}

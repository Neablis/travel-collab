"use client";

import type { Ref } from "react";
import { ImagePlus } from "lucide-react";
import type { TripCover } from "@tc/contracts";
import { CoverCredit } from "@/components/cover/CoverCredit";
import { CoverImage } from "@/components/cover/CoverImage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * The band's three heights, shared with `TripHeader` (which pulls itself up by
 * `OVERLAP`) and `TripHeaderSkeleton` (which reserves `EXPOSED`). Tailwind
 * classes, not numbers, so the scanner sees each one whole — which is also why
 * nothing computes them: **`BAND` must equal `EXPOSED` + `OVERLAP`** (384 =
 * 240 + 144), and `.cover-veil-trip`'s stops are placed against that split.
 *
 * - `BAND` — the photo, 384px: tall enough to show what a landscape photo is
 *   of, where the 112px strip it replaced showed a slice through its middle
 *   (Mitchell, 2026-10-10: the Seneca Lake cover read as a roof).
 * - `OVERLAP` — the band's foot, 144px, that the header sits on. The veil is
 *   82% page at its top and solid page 40px below, so the header's words read
 *   on a dark photo as well as a light one.
 *   The header is held at least this tall (`min-h-36`), so the band never
 *   reaches past it into the board.
 * - `EXPOSED` — what is left above the header: the part that is a photo.
 */
export const COVER_BAND = { BAND: "h-96", EXPOSED: "h-60", OVERLAP: "md:-mt-36 md:min-h-36" } as const;

/**
 * **The trip's cover, on the trip** — a tall photo at the top of the desktop
 * trip page that fades into the page, with the trip header laid over its faded
 * foot: the playbook day's treatment (`SharedDayScreen`, `veil="paper"`, with
 * the fade pulled up to finish under the header — `.cover-veil-trip`),
 * chosen from mockups on 2026-10-10 over a colour wash and an inset photo.
 * Still center-cropped; letting an editor drag the crop is a candidate
 * (`docs/candidates.md`, *Reposition a cover*).
 *
 * From 768px up only. A phone keeps its one-row pinned header and gets no
 * band: a photo above it would push the plan down on the screen that has least
 * room for it, and the cover is a tap away in Trip settings. Decided by the
 * caller in JS (`TripHeader`'s `useIsAbovePhone`), not here by a CSS `hidden`:
 * hidden, it still cost a phone the cover read and a full-width download
 * (PR #384 review). Outside the sticky header, so it scrolls away and the
 * pinned stack (`--sticky-stack-height`) does not grow.
 *
 * It never pushes the board down after it paints: the board holds its header
 * skeleton until the cover read has answered (`TripBoardScreen`), so the band
 * arrives in the same paint as the header over it.
 *
 * For whoever may change the cover, the exposed part of the band is the button
 * that opens Trip settings at Cover photo; the faded foot belongs to the
 * header's own controls. Unsplash's credit stays on it, as their guidelines
 * require wherever the photo appears, on a chip above the button so its two
 * links stay their own targets.
 *
 * `sentinelRef` gets a 1px line where the header's top sits before it pins:
 * `TripHeader` watches it to know when it has pinned, and only then paints its
 * own background (until then it is see-through, so the photo shows under it).
 */
export function TripCoverBanner({
  cover,
  onChangeCover,
  sentinelRef,
}: {
  cover: TripCover;
  /** Opens the cover picker; `undefined` for a reader, whose band is not a control. */
  onChangeCover?: () => void;
  sentinelRef?: Ref<HTMLDivElement>;
}) {
  return (
    <CoverImage photo={cover} priority sizes="100vw" className={cn(COVER_BAND.BAND, "shrink-0")}>
      <div aria-hidden className="cover-veil-trip absolute inset-0" />
      {onChangeCover !== undefined && (
        <Button
          variant="ghost"
          onClick={onChangeCover}
          aria-label="Change cover photo"
          title="Change cover photo"
          className={cn(COVER_BAND.EXPOSED, "absolute inset-x-0 top-0 w-full rounded-none p-0 hover:bg-transparent")}
        />
      )}
      <div className="absolute top-2 right-3 rounded-md bg-surface/85 px-2">
        <CoverCredit photo={cover} />
      </div>
      {/* The sentinel: a line at the foot of the exposed part, where the header's top rests. */}
      <div aria-hidden className={cn(COVER_BAND.EXPOSED, "pointer-events-none absolute inset-x-0 top-0")}>
        <div ref={sentinelRef} className="absolute inset-x-0 bottom-0 h-px" />
      </div>
    </CoverImage>
  );
}

/**
 * The band's place when there is no cover yet: a quiet *Add cover* at the end
 * of the `← Your trips` row, for whoever may set one. Opens the same picker.
 */
export function AddCoverButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="hidden gap-1.5 text-slate md:inline-flex">
      <ImagePlus className="size-3.5" aria-hidden />
      Add cover
    </Button>
  );
}

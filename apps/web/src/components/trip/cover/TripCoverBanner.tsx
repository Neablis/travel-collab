"use client";

import { ImagePlus } from "lucide-react";
import type { TripCover } from "@tc/contracts";
import { CoverCredit } from "@/components/cover/CoverCredit";
import { CoverImage } from "@/components/cover/CoverImage";
import { Button } from "@/components/ui/button";

/**
 * **The trip's cover, on the trip** — a short full-width band above the
 * desktop trip header, the trip's name over a gradient at its foot (Mitchell,
 * 2026-10-10 preview: "the header of the trip on desktop should also have the
 * image in some way … clicking the image should allow you to change it").
 *
 * Above 768px only (`hidden md:block`). A phone keeps its one-row pinned
 * header and gets no band: 112px of photo above it would push the plan down
 * on the screen that has least room for it, and the cover is a tap away in
 * Trip settings. Outside the sticky header, so it scrolls away and the pinned
 * stack (`--sticky-stack-height`) does not grow.
 *
 * The name here is decoration (`aria-hidden`): the header's own title below is
 * the page's h1 and the way into Trip settings, and a second copy in the
 * accessibility tree would be a second heading-shaped thing with one name.
 *
 * For whoever may change the cover, the whole band is the button that opens
 * Trip settings at Cover photo. Unsplash's credit stays on it, as their
 * guidelines require wherever the photo appears, on a chip above the button so
 * its two links stay their own targets.
 */
export function TripCoverBanner({
  cover,
  tripName,
  onChangeCover,
}: {
  cover: TripCover;
  tripName: string;
  /** Opens the cover picker; `undefined` for a reader, whose band is not a control. */
  onChangeCover?: () => void;
}) {
  return (
    <CoverImage
      photo={cover}
      eager
      sizes="100vw"
      className="hidden h-28 shrink-0 md:block"
    >
      <div aria-hidden className="cover-veil-title absolute inset-0" />
      {onChangeCover !== undefined && (
        <Button
          variant="ghost"
          onClick={onChangeCover}
          aria-label="Change cover photo"
          title="Change cover photo"
          className="absolute inset-0 h-auto w-full rounded-none p-0 hover:bg-transparent"
        />
      )}
      <p
        aria-hidden
        className="cover-over-text pointer-events-none absolute bottom-3 left-6 right-56 truncate font-display text-2xl font-semibold text-surface"
      >
        {tripName}
      </p>
      <div className="absolute right-3 bottom-2 rounded-md bg-surface/85 px-2">
        <CoverCredit photo={cover} />
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

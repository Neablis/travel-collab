"use client";

import { useRef, useState, type Ref } from "react";
import type { TripCover } from "@tc/contracts";
import { CoverCredit } from "@/components/cover/CoverCredit";
import { CoverImage } from "@/components/cover/CoverImage";
import { CoverMenu, type CoverAction } from "@/components/cover/CoverMenu";
import { clearTripCover, setTripCoverPosition } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { primeCached } from "@/lib/queryCache";
import { coverKeys } from "@/lib/queryKeys";
import { PILL, RepositionCover } from "./RepositionCover";

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
 * Framed at the cover's `position`, which an editor drags (M49 decision 10).
 *
 * From 768px up only. A phone keeps its one-row pinned header and gets no
 * band: a photo above it would push the plan down on the screen that has least
 * room for it, and the cover is a tap away in Trip settings. Hidden by CSS
 * here, and that alone once cost a phone the cover read and a full-width
 * download (PR 384 review), so neither depends on it: the read is the caller's
 * (`TripHeader` reads only from 768px up, or takes the cover the server sent),
 * and the photo is in a `<picture>` whose phone source is blank (`notOnPhone`).
 * CSS rather than the caller's `useIsAbovePhone` alone, because that is unknown
 * until hydration and the band is in the server's HTML. Outside the sticky
 * header, so it scrolls away and the pinned stack (`--sticky-stack-height`)
 * does not grow.
 *
 * It never pushes the board down after it paints: the board holds its header
 * skeleton until the cover read has answered (`TripBoardScreen`), so the band
 * arrives in the same paint as the header over it.
 *
 * For whoever may change the cover, the exposed part of the band is the cover
 * itself as a control (decision 10, amended 2026-10-25): it shows no buttons,
 * and hovering it dims it and shows a faint *Edit cover*. A click, a tap or
 * `Enter` opens `CoverMenu`: *Change cover* opens Trip settings at Cover
 * photo, *Remove* clears it here, and *Reposition* lays `RepositionCover` over
 * the band, where the photo moves as it is dragged. A saved position, like a
 * removal, is stored into the cover's cache entry, as a pick is, so the band
 * keeps it without a read. Unsplash's credit stays on it, as their guidelines
 * require wherever the photo appears, on a chip above the control so its two
 * links stay their own targets.
 *
 * `sentinelRef` gets a 1px line where the header's top sits before it pins:
 * `TripHeader` watches it to know when it has pinned, and only then paints its
 * own background (until then it is see-through, so the photo shows under it).
 */
export function TripCoverBanner({
  tripId,
  cover,
  onChangeCover,
  onRemoved,
  sentinelRef,
}: {
  tripId: string;
  cover: TripCover;
  /** Opens the cover picker; `undefined` for a reader, whose band is not a control. */
  onChangeCover?: () => void;
  /** Heard once *Remove* has cleared the cover, so the caller can move focus to what replaces the band. */
  onRemoved?: () => void;
  sentinelRef?: Ref<HTMLDivElement>;
}) {
  // The position being tried while repositioning; `null` when not.
  const [draft, setDraft] = useState<number | null>(null);
  // The photo a save found gone (a co-editor removed the cover since it was
  // read): no retry can store a position on it, so the mode closes and says
  // so. Held against the cover it was found for, so any newer read clears it.
  const [removed, setRemoved] = useState<TripCover | null>(null);
  // The cover a *Remove* failed on. Held against it, as `removed` is, so a
  // saved position or a new cover (each a newer cover) drops the alert.
  const [removeFailed, setRemoveFailed] = useState<TripCover | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Back to the cover itself, not to <body>: the mode's controls are gone.
  const done = () => {
    setDraft(null);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = async (position: number) => {
    const result = await setTripCoverPosition(tripId, position);
    if (!result.ok) {
      if (result.error.message !== "no-cover") return false;
      setRemoved(cover);
      done();
      return false;
    }
    primeCached(coverKeys.trip(tripId), result.value);
    done();
    return true;
  };
  const remove = async () => {
    setRemoveFailed(null);
    const result = await clearTripCover(tripId);
    if (!result.ok) {
      setRemoveFailed(cover);
      trigger.current?.focus();
      return;
    }
    primeCached(coverKeys.trip(tripId), null);
    onRemoved?.();
  };
  const onAction = (action: CoverAction) => {
    if (action === "change") onChangeCover?.();
    else if (action === "reposition") setDraft(cover.position);
    else void remove();
  };
  const notice =
    removed === cover
      ? "This cover was removed, so its position wasn’t saved."
      : removeFailed === cover
        ? "Couldn’t remove the cover. Try again."
        : null;
  return (
    <CoverImage
      photo={draft === null ? cover : { ...cover, position: draft }}
      priority
      notOnPhone
      sizes="100vw"
      className={cn(COVER_BAND.BAND, "shrink-0 max-md:hidden")}
    >
      <div aria-hidden className="cover-veil-trip absolute inset-0" />
      {onChangeCover !== undefined && draft === null && (
        <>
          <CoverMenu
            actions={removed === cover ? ["change", "remove"] : ["change", "reposition", "remove"]}
            onAction={onAction}
            triggerRef={trigger}
            className={cn(COVER_BAND.EXPOSED, "inset-x-0 top-0 w-full")}
          />
          {notice !== null && (
            <div className={cn(COVER_BAND.EXPOSED, "pointer-events-none absolute inset-x-0 top-0")}>
              <p role="alert" className={cn(PILL, "absolute bottom-3 left-3 py-1.5")}>
                {notice}
              </p>
            </div>
          )}
        </>
      )}
      {draft !== null && (
        <RepositionCover
          initial={cover.position}
          onChange={setDraft}
          onSave={save}
          onCancel={done}
          className={COVER_BAND.EXPOSED}
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

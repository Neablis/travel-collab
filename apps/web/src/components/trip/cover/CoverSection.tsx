"use client";

import { useMemo } from "react";
import { CoverPicker, type CoverApi } from "@/components/cover/CoverPicker";
import { clearTripCover, fetchTripCover, searchTripCovers, setTripCover } from "@/lib/apiClient";
import { setCachedTripCover } from "./tripCoverStore";

// Trip settings → Cover photo (M37 part 4): the shared picker
// (`components/cover/CoverPicker.tsx`), pointed at the trip's cover routes.
// Shown to every member; only an editor gets the search and *Remove cover*.

/**
 * The trip's cover in Trip settings: editable for an editor, read-only for
 * everyone else. `onSettled` is the picker's: called once its opening reads
 * have landed, so `SettingsSheet` can land on a section below it again.
 */
export function CoverSection({
  tripId,
  canEdit,
  onSettled,
}: {
  tripId: string;
  canEdit: boolean;
  onSettled?: () => void;
}) {
  const api = useMemo<CoverApi>(
    () => ({
      read: () => fetchTripCover(tripId),
      search: (q, page) => searchTripCovers(tripId, q, page),
      set: (candidate) => setTripCover(tripId, candidate),
      clear: () => clearTripCover(tripId),
    }),
    [tripId],
  );
  // `onChange` writes each pick or removal into the page's cover cache, which
  // the trip header's banner reads: setting a cover shows on the trip at once
  // (Mitchell, 2026-10-10: "adding a cover photo makes no changes right away").
  return (
    <CoverPicker
      api={api}
      canEdit={canEdit}
      onSettled={onSettled}
      onChange={(cover) => setCachedTripCover(tripId, cover)}
    />
  );
}

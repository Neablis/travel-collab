"use client";

import { useMemo } from "react";
import { CoverPicker, type CoverApi } from "@/components/cover/CoverPicker";
import { clearTripCover, fetchTripCover, searchTripCovers, setTripCover } from "@/lib/apiClient";

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
  return <CoverPicker api={api} canEdit={canEdit} onSettled={onSettled} />;
}

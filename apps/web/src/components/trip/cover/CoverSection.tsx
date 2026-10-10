"use client";

import { useMemo } from "react";
import type { TripCover } from "@tc/contracts";
import { CoverPicker, type CoverApi } from "@/components/cover/CoverPicker";
import { clearTripCover, fetchTripCover, searchTripCovers, setTripCover } from "@/lib/apiClient";
import { cachedRead, DEDUPE, invalidate, peekCached } from "@/lib/queryCache";
import { coverKeys } from "@/lib/queryKeys";

// Trip settings → Cover photo (M37 part 4): the shared picker
// (`components/cover/CoverPicker.tsx`), pointed at the trip's cover routes.
// Shown to every member; only an editor gets the search and *Remove cover*.

/**
 * The trip's cover in Trip settings: editable for an editor, read-only for
 * everyone else. `onSettled` is the picker's: called once its opening reads
 * have landed, so `SettingsSheet` can land on a section below it again.
 *
 * **Read through the cache, and painted from it** (Mitchell, Vercel Toolbar on
 * the trip preview: *"whatever our caching is on request doesnt seem to work,
 * since it refetches on every open"*). The sheet's content unmounts when it
 * closes, so this section mounts on every open; its read was a bare
 * `fetchTripCover`, so every open was a request and a skeleton the photo then
 * replaced. Now the last answer paints at once (`peek`) and the read revalidates
 * it through `cachedRead`, at `DEDUPE.DOCUMENT` — a cover is set once and read
 * on every open.
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
  const api = useMemo<CoverApi>(() => {
    const key = coverKeys.trip(tripId);
    const read = () => cachedRead(key, () => fetchTripCover(tripId), { dedupeMs: DEDUPE.DOCUMENT });
    /** After a write: drop the old answer, and read the new one in for the next open. */
    const refresh = () => {
      invalidate(key);
      void read();
    };
    return {
      read,
      peek: () => peekCached<TripCover | null>(key),
      search: (q, page) => searchTripCovers(tripId, q, page),
      set: async (candidate) => {
        const result = await setTripCover(tripId, candidate);
        if (result.ok) refresh();
        return result;
      },
      clear: async () => {
        const result = await clearTripCover(tripId);
        if (result.ok) refresh();
        return result;
      },
    };
  }, [tripId]);
  return <CoverPicker api={api} canEdit={canEdit} onSettled={onSettled} />;
}

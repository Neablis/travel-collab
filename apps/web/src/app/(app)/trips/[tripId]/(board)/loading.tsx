"use client";

import { useParams } from "next/navigation";
import { PageContainer } from "@/components/ui/page-container";
import { TripHeaderSkeleton } from "@/components/trip/TripHeaderSkeleton";

// **The trip's first frame on a client navigation.** Without a loading
// boundary a link from Home held the old page until the trip's server render
// answered, and only then drew the header skeleton `TripBoardScreen` shows
// while `TripProvider` reads. With one, Next prefetches this and swaps it in
// at the click. It is that same skeleton in that same frame — the page's
// `<main>` shell, `TripBoardScreen`'s `.trip-board-content` column — so the
// hand-over to the screen's own copy does not move a pixel.
//
// In the `(board)` route group so it bounds the board alone: at
// `trips/[tripId]/` it would also stand in for the notebook routes nested
// there, whose screens look nothing like a trip header.
//
// A client component for `useParams`: a loading boundary is given no params,
// and the skeleton needs the trip id (the demo's chrome differs, and a cover
// already in the cache draws its band).
/** `/trips/<id>` while its page is on the way: the trip header's skeleton. */
export default function TripLoading() {
  const { tripId } = useParams<{ tripId: string }>();
  return (
    <PageContainer as="main" width="full" className="px-0">
      <div className="flex items-start">
        <div className="trip-board-content min-w-0 flex-1">
          <TripHeaderSkeleton tripId={tripId} />
        </div>
      </div>
    </PageContainer>
  );
}

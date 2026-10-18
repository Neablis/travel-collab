import { historyFixture, tripAccessFixture, tripCoverFactory, tripDetailFixture } from "@tc/factories";
import type { TripCover } from "@tc/contracts";
import type { TripFirstData } from "@/lib/tripFirstData";

// Each fixture is a fresh answer, as each server render is: a provider adopts
// an answer once per document (`firstDataSpent`), and tests share a document.
let served = 0;

/** The Overview notebook's id in {@link tripFirstDataFixture}. */
export const FIRST_DATA_OVERVIEW_ID = "3f5a1c22-9b4e-4d77-8a21-5c6d7e8f9a01";

/**
 * What the trip page sends with its HTML (`server/tripFirstData.ts`), for the
 * factories' trip: an owner's read, the trip's Overview notebook saying
 * `overviewText`, and a cover unless `cover` says `null`.
 */
export function tripFirstDataFixture({
  overviewText = "Dear crew",
  cover = tripCoverFactory.build(),
}: { overviewText?: string; cover?: TripCover | null } = {}): TripFirstData {
  const trip = tripDetailFixture();
  const tripId = trip.tripId;
  const summary = {
    id: FIRST_DATA_OVERVIEW_ID,
    tripId,
    title: "Trip Overview",
    context: { tripId, kind: "overview" as const },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    actorId: "system",
  };
  return {
    served: `fixture-${++served}`,
    trip: { trip },
    history: { history: historyFixture(tripId) },
    access: { access: tripAccessFixture({ tripId, accessRev: "1" }) },
    cover: { cover },
    pages: { pages: [summary], viewerId: "dev-alice" },
    overview: {
      page: {
        ...summary,
        content: { v: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: overviewText }] }] },
      },
    },
    globals: { globals: { days: [], cities: [], tags: [], description: null, homeTimeZone: "UTC" } },
  };
}

import { TripEvent, isPageEventType, type EventEnvelope, type TripSummary } from "@tc/contracts";

export function projectTripSummaries(envelopes: EventEnvelope[]): TripSummary[] {
  const byStream = new Map<string, TripSummary>();
  for (const env of envelopes) {
    // Page events share this stream and belong to the other aggregate
    // (`pageState.ts`). Skipped BY NAME, exactly as `foldEnvelopes` does, so an
    // envelope belonging to neither still reaches the parse below and throws.
    //
    // This is the REBUILD path, and it was the thing that broke: a projection
    // rebuild reads every stream on the instance, so one trip with a notebook
    // event took out the rebuild for all of them. Caught by
    // `commands.int.test.ts`'s GOLDEN test, which passes in isolation and
    // fails in the full run precisely because it rebuilds everything.
    if (isPageEventType(env.type)) continue;
    const event = TripEvent.parse({
      type: env.type,
      version: env.version,
      payload: env.payload,
    });
    switch (event.type) {
      case "TripCreated":
        byStream.set(env.streamId, {
          tripId: event.payload.tripId,
          name: event.payload.name,
          status: "active",
          members: [{ userId: event.payload.createdBy, role: "owner" }],
          createdAt: env.occurredAt,
        });
        break;
      case "TripNameSet": {
        const s = byStream.get(env.streamId);
        if (s !== undefined) s.name = event.payload.name;
        break;
      }
      case "TripDeleted": {
        const s = byStream.get(env.streamId);
        if (s !== undefined) s.status = "deleted";
        break;
      }
      case "TripRestored": {
        const s = byStream.get(env.streamId);
        if (s !== undefined) s.status = "active";
        break;
      }
    }
  }
  return [...byStream.values()];
}

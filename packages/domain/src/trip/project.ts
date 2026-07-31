import { TripEvent, type EventEnvelope, type TripSummary } from "@tc/contracts";

export function projectTripSummaries(envelopes: EventEnvelope[]): TripSummary[] {
  const byStream = new Map<string, TripSummary>();
  for (const env of envelopes) {
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

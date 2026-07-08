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
          members: [{ userId: event.payload.createdBy, role: "owner" }],
          createdAt: env.occurredAt,
        });
        break;
    }
  }
  return [...byStream.values()];
}

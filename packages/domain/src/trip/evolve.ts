import type { TripEvent } from "@tc/contracts";
import type { TripState } from "./state";

export function evolveTrip(state: TripState | null, event: TripEvent): TripState {
  switch (event.type) {
    case "TripCreated":
      return {
        tripId: event.payload.tripId,
        name: event.payload.name,
        members: [{ userId: event.payload.createdBy, role: "owner" }],
      };
  }
}

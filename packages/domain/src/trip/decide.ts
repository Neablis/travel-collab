import type { CreateTrip, TripEvent } from "@tc/contracts";
import type { TripState } from "./state";

export type Rejection = { code: string; message: string };
export type Decision =
  | { ok: true; events: TripEvent[] }
  | { ok: false; rejection: Rejection };

export type DecideContext = { actorId: string };

export function decideCreateTrip(
  state: TripState | null,
  command: CreateTrip,
  ctx: DecideContext,
): Decision {
  if (state !== null) {
    return {
      ok: false,
      rejection: {
        code: "trip-already-exists",
        message: "A trip with this id already exists.",
      },
    };
  }
  return {
    ok: true,
    events: [
      {
        type: "TripCreated",
        version: 1,
        payload: {
          tripId: command.tripId,
          name: command.name,
          createdBy: ctx.actorId,
        },
      },
    ],
  };
}

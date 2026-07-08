import type { TripMember } from "@tc/contracts";

export type TripState = {
  tripId: string;
  name: string;
  members: TripMember[];
};

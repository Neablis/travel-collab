import { z } from "zod";
import { TripMember } from "@tc/contracts";
import { route } from "@/server/public-api/route";

// **Endpoint N+1, added to measure what it costs.** Nothing else was touched.
export const { GET } = route({
  GET: {
    summary: "List the people on a trip and their roles",
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    collection: { item: TripMember, cursorOf: (m: z.infer<typeof TripMember>) => m.userId },
    handle: ({ trip, page }) => {
      const after = page.after;
      const all = trip!.members;
      return (after === null ? all : all.filter((m) => m.userId > after)).slice(0, page.limit);
    },
  },
});

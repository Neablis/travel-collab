import { CreateSavedDayInput, SavedDay } from "@tc/contracts";
import { keepDays, savedDayCollection } from "@/server/public-api/library";
import { route } from "@/server/public-api/route";

// **Your Playbooks** — the same `saved_days` rows `/v1/library` serves, in the
// shape M23 gave them: a Playbook is an ordered set of days (ADR-048, ADR-050).
//
// **A second view, not a second object.** Listing here and listing the library
// return the same items; the difference is that saving here takes `dayIds`,
// the library's own `CreateSavedDayInput`, where `/v1/library` is frozen on a
// singular `dayId`. The body IS that contract schema rather than a copy of it
// (invariant 5): the UI's keep and this endpoint cannot disagree about what a
// Playbook is made of.
export const { GET, POST } = route({
  GET: savedDayCollection("List the Playbooks you have kept, newest first"),
  POST: {
    summary: "Keep one or more days of a trip you can see as a Playbook, in the order given",
    scope: "library:write",
    body: CreateSavedDayInput,
    response: SavedDay,
    handle: ({ actor, body }) => keepDays(actor, body as CreateSavedDayInput),
  },
});

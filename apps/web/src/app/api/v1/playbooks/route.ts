import { savedDayCollection } from "@/server/public-api/library";
import { createPlaybookDef } from "@/server/public-api/playbooks";
import { route } from "@/server/public-api/route";

// **Your Playbooks** — the same `saved_days` rows `/v1/library` serves, in the
// shape M23 gave them: a Playbook is an ordered set of days (ADR-048, ADR-050).
//
// **A second view, not a second object.** Listing here and listing the library
// return the same items (here filterable by `?visibility=`). Creating differs:
// the library is frozen on a singular `dayId`, while this takes days — or some
// of their activities — of a trip, or a Playbook written inline (ADR-050,
// Pass A). The declarations are in `server/public-api/playbooks.ts`.
export const { GET, POST } = route({
  GET: savedDayCollection("List the Playbooks you have kept, newest first", { filterable: true }),
  POST: createPlaybookDef,
});

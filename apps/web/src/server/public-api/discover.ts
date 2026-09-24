import { z } from "zod";
import { DiscoverDay, DiscoverSort, LengthBand, RatingFloor } from "@/lib/playbooks";
import { discoverPage } from "@/server/playbooks";
import type { CollectionDef } from "./route";

// **`GET /v1/discover/playbooks`** (ADR-050, Pass C): the app's Discover over
// v1 — published Playbooks from everyone, as the same cards.
//
// **The item is `DiscoverDay`, the card the app draws**, so the API exposes
// exactly what Discover already shows a signed-in stranger: derived facts, the
// first day's preview, rating and review count, `ownerId` — and never the full
// stops (those are `GET /v1/playbooks/{id}`, which a published Playbook
// answers too).
//
// **Published only, whoever asks.** The app's `everyone` scope also shows the
// reader their own private days; an API listing called "discover" that
// sometimes held private rows would need every caller to filter `visibility`
// themselves. `publishedOnly` is the profile's rule, and it also drops a
// moderated day even for its owner.
//
// **One place per parameter.** The wrapper reads one value per query key, so
// `city` and `country` take one each rather than the app's repeated keys.

const Query = z.object({
  city: z.string().trim().min(1).max(200).optional().describe("Playbooks that touch this city, spelled as stored (see GET /v1/cities)."),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .describe("Playbooks that touch this country, as an ISO 3166-1 alpha-2 code. With `city`, either matches."),
  length: LengthBand.optional().describe("How many days: one, two-three, four-six or seven-plus. Default any."),
  rating: RatingFloor.optional().describe("Minimum average rating; any floor drops unrated Playbooks. Default any."),
  sort: DiscoverSort.optional().describe(
    "Default most-added. Places matched always rank first. `newest` is the only sort whose order does not move as people add and review.",
  ),
});
type Query = z.infer<typeof Query>;

export const discoverPlaybooksDef: CollectionDef<DiscoverDay> = {
  summary: "Discover published Playbooks from everyone — filter by place, length and rating, ranked as the app ranks them",
  scope: "library:read",
  query: Query,
  collection: {
    item: DiscoverDay,
    // The cursor is the last card's id; the next page is what ranks after that
    // row now. See `discoverPage` for what that does and does not promise.
    cursorOf: (day: DiscoverDay) => day.savedDayId,
  },
  handle: ({ actor, page, query }) => {
    const q = query as Query;
    return discoverPage(
      {
        cities: q.city === undefined ? [] : [q.city],
        countries: q.country === undefined ? [] : [q.country],
        scope: "everyone",
        publishedOnly: true,
        sort: q.sort ?? "most-added",
        length: q.length ?? "any",
        rating: q.rating ?? "any",
        readerId: actor.userId,
      },
      page,
    );
  },
};

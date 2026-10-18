import {
  TripAccess,
  TripCoverResponse,
  TripDetail,
  TripGlobals,
  TripHistory,
  type Page,
  type PageListEntry,
} from "@tc/contracts";
import type { TripAccessResult } from "@/server/access/trip-access";
import { withProfiles } from "@/server/access/members";
import { listGuests } from "@/server/access/guests";
import { listInvites } from "@/server/access/invites";
import { demoTripMembers } from "@/server/demoTrip";
import { accountCan } from "@/server/entitlements/resolver";
import { getTripHistory } from "@/server/history";
import { isUuid } from "@/server/ids";
import { getPage, listPageEntries } from "@/server/pages";
import { buildTripGlobals } from "@/server/tripGlobals";
import { getTripCover } from "@/server/tripCovers";
import { readPreferences } from "@/server/users";
import { isDemoTripId } from "@/lib/demoTrip";

// **The trip reads' bodies, built once for two callers**: the GET routes the
// board fetches, and the trip page, which sends the same bodies with its HTML
// (`tripFirstData.ts`). Each builder takes an access result already granted by
// `requireTripAccess` — the one policy — and answers exactly what its route
// sends, so the page and the route cannot drift apart.

/** A `requireTripAccess` result that let the reader in. */
export type GrantedTripAccess = Exclude<TripAccessResult, { error: Response }>;

/** `GET /api/trips/:id`'s body. Contract-honest: validated against the schema before it is returned. */
export function tripDetailView(access: GrantedTripAccess): { trip: TripDetail } {
  return { trip: TripDetail.parse(access.detail) };
}

/** `GET /api/trips/:id/history`'s body, or `null` for a trip with no stream (the route's 404). */
export async function tripHistoryView(tripId: string): Promise<{ history: TripHistory } | null> {
  const history = await getTripHistory(tripId);
  return history === null ? null : { history: TripHistory.parse(history) };
}

/**
 * `GET /api/trips/:id/access`'s body: who is on this trip, what am I, and
 * (owner only) which links are outstanding.
 *
 * `accessRev` is read by the CALLER, before it asked `requireTripAccess`: see
 * the access route for why that order is the point.
 */
export async function tripAccessView(
  tripId: string,
  access: GrantedTripAccess,
  accessRev: string | undefined,
): Promise<{ access: TripAccess }> {
  const demo = isDemoTripId(tripId);
  const owner = access.detail.members[0]?.userId ?? null;
  // The four reads below are independent of each other, so they run together:
  // this route is on the trip page's opening path.
  const [invites, members, collaboratorsEntitled, guests] = await Promise.all([
    // Any member may see who else is here. Only the owner sees invites,
    // because a `TripInvite` carries its token — an editor who could list them
    // could hand out access the owner never granted.
    access.role === "owner" ? listInvites(tripId) : [],
    // `withProfiles` reads the users table to put a name and a face on each
    // member id. The demo trip's travellers are invented people (ADR-031), so
    // there is nothing to look up and — more to the point — nothing that
    // should be looked up: the demo is served without touching the database,
    // and this is the one read on its path that would otherwise have.
    demo ? demoTripMembers(tripId) : withProfiles(access.detail.members, access.userId),
    // **The OWNER's entitlement, not the reader's** (M20 link 6). The owner is
    // the billing subject — collaboration on a trip is paid for by whoever
    // owns it — so an editor reading this learns whether the trip they are on
    // is collaborative, not whether their own account could pay for one.
    //
    // Advisory, exactly like `myRole`: it decides whether the invite form
    // renders at all, and `POST /invites` refuses server-side regardless of
    // what the client did with it.
    //
    // The demo trip is entitled by construction. Its travellers are invented
    // people (ADR-031) and it is served without touching the database, so
    // asking Entitlements about an owner who is not an account would be both a
    // lookup that cannot succeed and the one database read this path exists
    // to avoid.
    demo || owner === null ? true : accountCan(owner, "trip.collaborators"),
    // The trip's guests ride on the access read so the People section does not
    // chase a second read after every access load. The demo trip is served
    // without touching the database, as `members` above.
    demo ? [] : listGuests(tripId),
  ]);
  // Who is reading, so the People section marks "You" without waiting on the
  // session probe. Only a reader on the list: the demo visitor carries a
  // stand-in id that names nobody.
  const viewerId = members.some((m) => m.userId === access.userId) ? access.userId : undefined;
  return {
    access: TripAccess.parse({
      tripId,
      myRole: access.role,
      members,
      invites,
      collaboratorsEntitled,
      accessRev,
      viewerId,
      guests,
    }),
  };
}

/** `GET /api/trips/:id/cover`'s body. Asks Unsplash nothing. */
export async function tripCoverView(tripId: string): Promise<TripCoverResponse> {
  return TripCoverResponse.parse({ cover: await getTripCover(tripId) });
}

/** `GET /api/trips/:id/pages`'s body: the notebook list, and who is reading it. */
export async function tripPagesView(
  tripId: string,
  access: GrantedTripAccess,
): Promise<{ pages: PageListEntry[]; viewerId: string }> {
  // `viewerId` rides along so the index's provenance line can say "Yours"
  // truthfully. `actorId` alone only proves a PERSON wrote a notebook, not that
  // the reader did — so on a shared trip every collaborator's notebook was
  // labelled "Yours" (Copilot, PR 126; it was filed as KI-20260903 on the
  // assumption this needed a `users` join, and it does not — the guard already
  // resolved the reader).
  // `listPageEntries`, not `listPages`: each row carries what the notebook says
  // (ADR-056), which a link card and the index print. The public API stays on
  // `listPages`, whose rows are `PageSummary` exactly.
  return { pages: await listPageEntries(tripId), viewerId: access.userId };
}

/**
 * `GET /api/trips/:id/pages/:pageId`'s body, or `null` for the route's 404: a
 * page id that is not a uuid, no such page, or a page of another trip.
 *
 * `pages.id` is a uuid column, so `getPage("not-a-uuid")` is not a miss — it is
 * `22P02` out of the driver (KI-2026-09-05-x). The caller asks this only AFTER
 * the access check: answering "that is not an id" to somebody with no access to
 * the trip would tell them something the access seam has just decided not to.
 */
export async function tripPageView(tripId: string, pageId: string): Promise<{ page: Page } | null> {
  if (!isUuid(pageId)) return null;
  const page = await getPage(pageId);
  return page && page.tripId === tripId ? { page } : null;
}

/**
 * `GET /api/trips/:id/globals`'s body. `readerId` is whoever is signed in —
 * the home zone is the READER's (M14 link 11) — and `undefined` for nobody,
 * who has none and costs no query.
 */
export async function tripGlobalsView(
  access: GrantedTripAccess,
  readerId: string | undefined,
): Promise<{ globals: TripGlobals }> {
  const reader = readerId ? await readPreferences(readerId) : undefined;
  // Contract-honest response, matching the detail route: validate against the
  // schema before returning rather than trusting the builder.
  return { globals: TripGlobals.parse(buildTripGlobals(access.detail, reader)) };
}

import { z } from "zod";
import { travellerIds, type Location, type PreviewPlace, type TripDetail, type TripPreview } from "@tc/contracts";
import { cityFor } from "@/lib/dayChips";
import { displayNameFor } from "@/lib/displayName";
import { db } from "./db/client";
import { inviteByToken } from "./access/invites";
import { effectiveMembers, withProfiles } from "./access/members";
import { overlayMembers } from "./access/overlay";
import { getTripDetail } from "./projections";

/**
 * The invite preview (M38 part 4, D4 and D6): what a pending invite's holder
 * may see of the trip before joining it, as `TripPreview`.
 *
 * Composed here beside `inviteLanding.ts`, and for its reason: Access owns the
 * invite and does not know what a trip contains, so this is where the invite,
 * the member list, the trip's read model and Identity's names meet.
 *
 * **Every refusal is decided before the trip is read into the answer**, and a
 * refusal carries nothing: the route sends an empty body. Revoked and accepted
 * are both `gone` — invites never expire (ADR-026), so "expired" in the gate
 * reads as those two. Unlike the landing there is no `member` state: a member
 * already reads the whole trip, and this read is keyed on the token alone, so
 * a session is not consulted at all.
 */
export async function readInvitePreview(
  token: string,
): Promise<{ ok: true; preview: TripPreview } | { ok: false; reason: "not-found" | "gone" }> {
  const invite = await inviteByToken(token);
  if (invite === null) return { ok: false, reason: "not-found" };
  if (invite.status !== "pending") return { ok: false, reason: "gone" };

  // A stored doc that will not parse is a trip nobody can read — gone, as the
  // landing answers it, rather than a 500 on a read that can never succeed.
  let detail: TripDetail | null;
  try {
    detail = await getTripDetail(invite.tripId);
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, reason: "gone" };
    throw error;
  }
  if (detail === null || detail.status === "deleted") return { ok: false, reason: "gone" };

  // The effective members, travelling flags included, and the totals they
  // imply: the same two steps the board's own read takes (`readTrip`), so the
  // total here is the total the trip's people see.
  const members = await effectiveMembers(db, detail.tripId, detail.members);
  const costed = overlayMembers(detail, members);
  // No viewer: nobody here may read an address, and `name` below never takes one.
  const profiles = await withProfiles(members, "");
  const travellers = new Set(travellerIds(members));

  return {
    ok: true,
    preview: {
      name: detail.name,
      startDate: detail.days[0]?.date ?? detail.startDate,
      endDate: detail.days.at(-1)?.date ?? null,
      days: detail.days.map((day) => ({
        date: day.date,
        city: cityFor(day, detail.activities),
        stops: day.activityIds.flatMap((id) => {
          const stop = detail.activities[id];
          return stop === undefined ? [] : [{ title: stop.title, location: placeOf(stop.location) }];
        }),
      })),
      people: profiles.map((p) => ({
        // `email: null` for `inviteLanding.ts`'s `namesFor` reason: the chain
        // ends `?? email ?? handle`, and this is a stranger's page.
        name: displayNameFor({ userId: p.userId, displayName: p.displayName, name: p.name, email: null }),
        avatar: p.avatar,
        color: p.color,
        travelling: travellers.has(p.userId),
      })),
      total: { amountMinor: costed.tripCostTotal, currency: costed.currency },
    },
  };
}

/** The map's fields of a location, copied by name so nothing else rides along. */
function placeOf(location: Location | null): PreviewPlace | null {
  if (location === null) return null;
  const { name, city, lat, lng, precision } = location;
  return {
    name,
    ...(city === undefined ? {} : { city }),
    ...(lat === undefined || lng === undefined ? {} : { lat, lng }),
    ...(precision === undefined ? {} : { precision }),
  };
}

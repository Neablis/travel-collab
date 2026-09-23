import { z } from "zod";
import { SavedDay, SavedDayVisibility, type TripDetail } from "@tc/contracts";
import {
  deleteSavedDay,
  getSavedDay,
  listSavedDays,
  saveDay,
  setSavedDayVisibility,
} from "@/server/savedDays";
import { tripAccessFor } from "@/server/access/trip-access";
import { actorMayReachTrip, type Actor } from "./actor";
import { PublicApiError } from "./commands";
import {
  decodeKeyedCursor,
  keyedCursor,
  type CollectionDef,
  type CollectionItem,
  type HandlerContext,
  type ResourceDef,
} from "./route";

// **The declarations `/v1/library` and `/v1/playbooks` share** (ADR-050).
//
// Both are views over the same `saved_days` rows — ADR-048 made a Playbook a
// saved day, and refused a second publishable object type — so the two URL
// trees are two spellings of one set of handlers, not two implementations that
// agree today. `/v1/library` is published and frozen: what lives here was moved
// out of its route files byte for byte, and its `openapi.json` entries are the
// check that it stayed that way.

/** `GET` over your saved days, newest first, keyset-paged. `summary` is the only difference. */
export function savedDayCollection(summary: string): CollectionDef<CollectionItem> {
  return {
    summary,
    scope: "library:read",
    collection: {
      item: SavedDay,
      cursorOf: (day: z.infer<typeof SavedDay>) => keyedCursor(day.createdAt, day.savedDayId),
    },
    handle: async ({ actor, page }) => {
      const all = await listSavedDays(actor.userId);
      const after = decodeKeyedCursor(page.after);
      if (after === null) return all.slice(0, page.limit);
      // `listSavedDays` is newest first with `savedDayId` breaking ties, so
      // "after" is strictly lower on that pair.
      return all
        .filter(
          (d) =>
            d.createdAt < after.sortKey ||
            (d.createdAt === after.sortKey && d.savedDayId < after.id),
        )
        .slice(0, page.limit);
    },
  };
}

/**
 * The source trip of a save, gated by hand — or a refusal thrown.
 *
 * **The trip gate runs here, by hand, and that is the honest cost of putting
 * these collections outside `/trips/:id`.** The wrapper checks the trip in the
 * path; a save's trip is in the body, so the same seam is called directly
 * rather than a weaker check being invented.
 *
 * **The confinement half is unreachable for a token today.** Neither route
 * declares `trip`, so `route()` refuses every trip-confined token before a
 * handler runs. It is kept so the gate stays whole if that ever changes.
 */
async function sourceTrip(actor: Actor, tripId: string): Promise<TripDetail> {
  if (!actorMayReachTrip(actor, tripId)) {
    throw new PublicApiError(403, "This token is not scoped to that trip.", "trip-out-of-scope");
  }
  const access = await tripAccessFor(actor.userId, tripId, "viewer");
  if (!access.ok) {
    // The same three answers `route()`'s own gate gives, because this is the
    // same gate called by hand. `malformed-trip` is a stored document this
    // server could not parse — ours to own as a 500, and telling the caller
    // they lack access to a trip they may well own is both wrong and
    // unfixable from their side.
    const mapped = {
      "not-found": { status: 404, message: "No such trip." },
      forbidden: { status: 403, message: "You do not have access to this trip." },
      "malformed-trip": {
        status: 500,
        message: "This trip could not be read. The failure has been logged.",
      },
    }[access.denial];
    throw new PublicApiError(mapped.status, mapped.message);
  }
  return access.detail;
}

/** Keep `dayIds` of a trip you can see as one saved day, or throw the refusal. */
export async function keepDays(
  actor: Actor,
  input: { tripId: string; name: string; dayIds: readonly string[] },
): Promise<z.infer<typeof SavedDay>> {
  const detail = await sourceTrip(actor, input.tripId);
  const saved = await saveDay({ name: input.name, dayIds: input.dayIds }, detail, actor.userId);
  if (!saved.ok) throw new PublicApiError(400, saved.error.message);
  return saved.value;
}

/**
 * `GET`, `PATCH` (visibility) and `DELETE` on one saved day, addressed by the
 * path segment `param`. The words are the caller's, so each tree says them in
 * its own noun; everything else is shared.
 *
 * **Publishing is a `PATCH` of a two-state field, not two verbs.** *"A patch is
 * a patch"* — the API does not need `/publish` and `/unpublish` endpoints to
 * express one boolean, and inventing them would leak how the UI happens to
 * present it.
 */
export function savedDayItem(words: {
  readonly param: string;
  readonly summaries: { readonly get: string; readonly patch: string; readonly delete: string };
  readonly missing: string;
  readonly published: string;
}): { GET: ResourceDef; PATCH: ResourceDef; DELETE: ResourceDef } {
  const id = ({ params }: HandlerContext) => params[words.param]!;
  return {
    GET: {
      summary: words.summaries.get,
      scope: "library:read",
      response: SavedDay,
      handle: async (ctx) => {
        const day = await getSavedDay(id(ctx), ctx.actor.userId);
        if (day === null) throw new PublicApiError(404, words.missing);
        return day;
      },
    },
    PATCH: {
      summary: words.summaries.patch,
      scope: "library:write",
      body: z.object({ visibility: SavedDayVisibility }),
      response: SavedDay,
      handle: async (ctx) => {
        const updated = await setSavedDayVisibility(
          id(ctx),
          ctx.actor.userId,
          (ctx.body as { visibility: z.infer<typeof SavedDayVisibility> }).visibility,
        );
        if (updated === null) throw new PublicApiError(404, words.missing);
        return updated;
      },
    },
    DELETE: {
      summary: words.summaries.delete,
      scope: "library:write",
      response: z.object({ savedDayId: z.string(), deleted: z.literal(true) }),
      handle: async (ctx) => {
        const outcome = await deleteSavedDay(id(ctx), ctx.actor.userId);
        if (outcome === "not-found") throw new PublicApiError(404, words.missing);
        if (outcome === "published") {
          // It exists and you own it; it is published, so unpublish it first.
          // 409, because the caller can fix this and the fix is one PATCH away.
          throw new PublicApiError(409, words.published, "invalid-request");
        }
        return { savedDayId: id(ctx), deleted: true as const };
      },
    },
  };
}

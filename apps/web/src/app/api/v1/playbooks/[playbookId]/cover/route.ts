import { z } from "zod";
import { SetCoverPositionBody, TripCover, TripCoverResponse } from "@tc/contracts";
import { RemoteImageRefused } from "@/server/external/remoteImage/guard";
import { PublicApiError } from "@/server/public-api/commands";
import { route, type HandlerContext } from "@/server/public-api/route";
import { readableSavedDay } from "@/server/savedDays";
import {
  clearSavedDayCover,
  getSavedDayCover,
  setSavedDayCoverFromUrl,
  setSavedDayCoverPosition,
} from "@/server/savedDayCovers";

// A playbook day's cover on the public API (Mitchell, 2026-10-26): the trip
// cover's shape, under playbook ownership instead of trip roles — a Playbook
// has no members list, so there is no viewer/editor to gate on, only the
// author. This reverses M49 decision 8's "playbook-day covers stay off the
// API" for URL covers only: only a URL cover can be set here, picking from
// Unsplash stays in the app, whose search would spend Caesura's quota on
// another program's behalf. Moving and clearing work on either kind, as they
// do for trips.

/** What `PUT` takes: the URL cover's own fields, without the path we mint. */
const SetUrlCoverBody = TripCover.options[1].pick({ url: true, alt: true, credit: true, position: true });

/**
 * The day, when the caller is its author. Anything else — missing, private
 * to someone else, deleted — is the same 404, so probing ids cannot tell
 * those apart; the message matches `PATCH /v1/playbooks/{playbookId}`'s.
 */
async function ownDay(ctx: HandlerContext) {
  const day = await readableSavedDay(ctx.params["playbookId"]!, ctx.actor.userId);
  if (day === null || day.ownerId !== ctx.actor.userId) {
    throw new PublicApiError(404, "No such playbook of yours.");
  }
  return day;
}

export const { GET, PUT, PATCH, DELETE } = route({
  GET: {
    summary: "Get a playbook's cover image, or null when it has none",
    scope: "library:read",
    response: TripCoverResponse,
    handle: async ({ params, actor }) => {
      // The playbook GET's own rule: yours, or anybody's published one.
      // Somebody else's private Playbook is the same 404 as one that does
      // not exist, so its cover is not enumerable by strangers.
      const day = await readableSavedDay(params["playbookId"]!, actor.userId);
      if (day === null) throw new PublicApiError(404, "No such playbook.");
      return { cover: await getSavedDayCover(params["playbookId"]!) };
    },
  },
  PUT: {
    summary: "Set a playbook's cover to the image at a URL",
    scope: "library:write",
    body: SetUrlCoverBody,
    response: TripCoverResponse,
    handle: async (ctx) => {
      await ownDay(ctx);
      try {
        const cover = await setSavedDayCoverFromUrl(
          ctx.params["playbookId"]!,
          ctx.body as z.infer<typeof SetUrlCoverBody>,
          ctx.actor.userId,
        );
        return { cover };
      } catch (error) {
        // The reason only. The refusal's message can name the address a host
        // resolved to, and a caller is not told what is inside our network.
        if (error instanceof RemoteImageRefused) {
          throw new PublicApiError(422, `That URL cannot be a cover (${error.reason}).`, "cover-url-rejected", {
            reason: error.reason,
          });
        }
        throw error;
      }
    },
  },
  PATCH: {
    summary: "Move where a playbook's cover is framed, from 0 (top) to 100 (bottom)",
    scope: "library:write",
    body: SetCoverPositionBody,
    response: TripCoverResponse,
    handle: async (ctx) => {
      await ownDay(ctx);
      const { position } = ctx.body as SetCoverPositionBody;
      const cover = await setSavedDayCoverPosition(ctx.params["playbookId"]!, position);
      if (cover === null) throw new PublicApiError(404, "This playbook has no cover to move.");
      return { cover };
    },
  },
  DELETE: {
    summary: "Remove a playbook's cover",
    scope: "library:write",
    response: TripCoverResponse,
    handle: async (ctx) => {
      await ownDay(ctx);
      await clearSavedDayCover(ctx.params["playbookId"]!);
      return { cover: null };
    },
  },
});

import { z } from "zod";
import { SetCoverPositionBody, TripCover, TripCoverResponse } from "@tc/contracts";
import { RemoteImageRefused } from "@/server/external/remoteImage/guard";
import { PublicApiError } from "@/server/public-api/commands";
import { route, type HandlerContext } from "@/server/public-api/route";
import { clearTripCover, getTripCover, setTripCoverFromUrl, setTripCoverPosition } from "@/server/tripCovers";

// A trip's cover on the public API (M49 decision 8, ADR-081 item 7). Only a
// URL cover can be set here: picking from Unsplash stays in the app, whose
// search would spend Caesura's quota on another program's behalf. Moving and
// clearing work on either kind, on the editor's terms the app's routes use.

/** What `PUT` takes: the URL cover's own fields, without the path we mint. */
const SetUrlCoverBody = TripCover.options[1].pick({ url: true, alt: true, credit: true, position: true });

/** The app's cover routes refuse a deleted trip's cover the same way. */
function notDeleted({ trip }: HandlerContext): void {
  if (trip!.status === "deleted") throw new PublicApiError(400, "This trip has been deleted.");
}

export const { GET, PUT, PATCH, DELETE } = route({
  GET: {
    summary: "Get a trip's cover image, or null when it has none",
    scope: "trips:read",
    trip: "path",
    role: "viewer",
    response: TripCoverResponse,
    handle: async ({ params }) => ({ cover: await getTripCover(params["tripId"]!) }),
  },
  PUT: {
    summary: "Set a trip's cover to the image at a URL",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: SetUrlCoverBody,
    response: TripCoverResponse,
    handle: async (ctx) => {
      notDeleted(ctx);
      try {
        const cover = await setTripCoverFromUrl(ctx.params["tripId"]!, ctx.body as z.infer<typeof SetUrlCoverBody>, ctx.actor.userId);
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
    summary: "Move where a trip's cover is framed, from 0 (top) to 100 (bottom)",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    body: SetCoverPositionBody,
    response: TripCoverResponse,
    handle: async (ctx) => {
      notDeleted(ctx);
      const { position } = ctx.body as SetCoverPositionBody;
      const cover = await setTripCoverPosition(ctx.params["tripId"]!, position);
      if (cover === null) throw new PublicApiError(404, "This trip has no cover to move.");
      return { cover };
    },
  },
  DELETE: {
    summary: "Remove a trip's cover",
    scope: "trips:write",
    trip: "path",
    role: "editor",
    response: TripCoverResponse,
    handle: async (ctx) => {
      notDeleted(ctx);
      await clearTripCover(ctx.params["tripId"]!);
      return { cover: null };
    },
  },
});

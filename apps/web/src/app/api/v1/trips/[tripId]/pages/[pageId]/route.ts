import { z } from "zod";
import { Page, UpdatePageInput } from "@tc/contracts";
import { deletePage, getPage, updatePage } from "@/server/pages";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

/** A page that is not this trip's is not found, never someone else's to read. */
async function ofThisTrip(pageId: string, tripId: string) {
  const page = await getPage(pageId);
  if (page === null || page.tripId !== tripId) {
    throw new PublicApiError(404, "No such page on this trip.");
  }
  return page;
}

export const { GET, PATCH, DELETE } = route({
  GET: {
    scope: "notebook:read",
    trip: "path",
    role: "viewer",
    response: Page,
    handle: ({ params }) => ofThisTrip(params["pageId"]!, params["tripId"]!),
  },
  PATCH: {
    scope: "notebook:write",
    trip: "path",
    role: "editor",
    body: UpdatePageInput,
    response: Page,
    handle: async ({ params, body }) => {
      await ofThisTrip(params["pageId"]!, params["tripId"]!);
      const updated = await updatePage(params["pageId"]!, body as z.infer<typeof UpdatePageInput>);
      // `ofThisTrip` just proved it exists, so a null here is a row that
      // vanished between two statements — rare, and a 404 rather than a 500,
      // because from the caller's side that is exactly what happened.
      if (updated === null) throw new PublicApiError(404, "No such page on this trip.");
      return updated;
    },
  },
  DELETE: {
    scope: "notebook:write",
    trip: "path",
    role: "editor",
    response: z.object({ pageId: z.string(), deleted: z.literal(true) }),
    handle: async ({ params }) => {
      await ofThisTrip(params["pageId"]!, params["tripId"]!);
      const outcome = await deletePage(params["pageId"]!);
      if (!outcome.ok) {
        // The Overview page is editable and not removable (§25), which is a
        // 409 rather than a 404: it exists, and the caller may not do this to
        // it. `not-found` keeps its own status.
        throw new PublicApiError(
          outcome.reason === "not-found" ? 404 : 409,
          outcome.message,
          outcome.reason === "not-found" ? "not-found" : "invalid-request",
        );
      }
      return { pageId: params["pageId"]!, deleted: true as const };
    },
  },
});

import { z } from "zod";
import { Page, UpdatePageInput, serializePageDoc } from "@tc/contracts";
import { getPage } from "@/server/pages";
import { executePageCommand } from "@/server/pageCommands";
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
    summary: "Get one Notebook page on a trip",
    scope: "notebook:read",
    trip: "path",
    role: "viewer",
    response: Page,
    handle: ({ params }) => ofThisTrip(params["pageId"]!, params["tripId"]!),
  },
  PATCH: {
    summary: "Edit a Notebook page on a trip",
    scope: "notebook:write",
    trip: "path",
    role: "editor",
    body: UpdatePageInput,
    response: Page,
    handle: async ({ actor, params, body }) => {
      await ofThisTrip(params["pageId"]!, params["tripId"]!);
      const patch = body as z.infer<typeof UpdatePageInput>;
      // The same check `POST` makes, for the same reason: `context` is optional
      // on a patch, but one naming a different trip from the URL would leave a
      // page filed under this trip while claiming to belong to another. The BFF
      // route has refused this since the Notebook shipped; v1 was the copy that
      // dropped it.
      if (patch.context !== undefined && patch.context.tripId !== params["tripId"]) {
        throw new PublicApiError(400, "This page's context names a different trip from the URL.");
      }
      // **Through the command pipeline, same as the BFF route.** This was a
      // direct `updatePage` and that was not merely a missed feature: a v1
      // edit changed the ROW without writing an event, so the log and the
      // table disagreed about the page's content — and the next command
      // against it would have decided from the log's stale copy. The public
      // API cannot be the one door that skips the write path (M22).
      const result = await executePageCommand(
        {
          type: "EditPage",
          tripId: params["tripId"]!,
          pageId: params["pageId"]!,
          ...(patch.title === undefined ? {} : { title: patch.title }),
          // The wire form, not the parse output — see the BFF route.
          ...(patch.content === undefined ? {} : { content: serializePageDoc(patch.content) }),
        },
        actor.userId,
      );
      if (!result.ok) {
        if (result.error.code === "page-not-found") {
          throw new PublicApiError(404, "No such page on this trip.");
        }
        if (result.error.code === "concurrency-conflict") {
          throw new PublicApiError(409, result.error.message, "invalid-request");
        }
        throw new PublicApiError(400, result.error.message, "invalid-request");
      }
      // `ofThisTrip` just proved it exists, so a null here is a row that
      // vanished between two statements — rare, and a 404 rather than a 500,
      // because from the caller's side that is exactly what happened.
      if (result.page === null) throw new PublicApiError(404, "No such page on this trip.");
      return result.page;
    },
  },
  DELETE: {
    summary: "Delete a Notebook page from a trip",
    scope: "notebook:write",
    trip: "path",
    role: "editor",
    response: z.object({ pageId: z.string(), deleted: z.literal(true) }),
    handle: async ({ actor, params }) => {
      await ofThisTrip(params["pageId"]!, params["tripId"]!);
      const outcome = await executePageCommand(
        { type: "DeletePage", tripId: params["tripId"]!, pageId: params["pageId"]! },
        actor.userId,
      );
      if (!outcome.ok) {
        // The Overview page is editable and not removable (§25), which is a
        // 409 rather than a 404: it exists, and the caller may not do this to
        // it. `not-found` keeps its own status.
        const missing = outcome.error.code === "page-not-found";
        throw new PublicApiError(
          missing ? 404 : 409,
          outcome.error.message,
          missing ? "not-found" : "invalid-request",
        );
      }
      return { pageId: params["pageId"]!, deleted: true as const };
    },
  },
});

import { z } from "zod";
import { CreatePageInput, Page, PageSummary, serializePageDoc } from "@tc/contracts";
import { MAX_PAGE_BODY_BYTES, listPages } from "@/server/pages";
import { executePageCommand } from "@/server/pageCommands";
import { randomUUID } from "node:crypto";
import { PublicApiError } from "@/server/public-api/commands";
import { decodeKeyedCursor, keyedCursor, route } from "@/server/public-api/route";

// **Textbook single-resource CRUD already**, which is why the Notebook was the
// easiest thing in the inventory to publish: the read is a projection and the
// write is a row.
//
// **A viewer may read the Notebook; only an editor may add to it** — the same
// split the BFF makes, expressed here as two `role:` fields rather than two
// guard calls.
export const { GET, POST } = route({
  GET: {
    summary: "List the Notebook pages on a trip",
    scope: "notebook:read",
    trip: "path",
    role: "viewer",
    // **Paged on the key the rows are ordered by, ascending.** This cursor was
    // `updatedAt` while `listPages` orders `(createdAt asc, id asc)`, compared
    // with `<` while the list runs the other way — so editing an old page moved
    // it in the cursor's opinion but not in the list's, and page two answered
    // with pages the caller had already been given.
    collection: {
      item: PageSummary,
      cursorOf: (page: z.infer<typeof PageSummary>) => keyedCursor(page.createdAt, page.id),
    },
    handle: async ({ params, page }) => {
      const all = await listPages(params["tripId"]!);
      // `listPages` answers with the whole notebook — a trip's pages are tens,
      // not thousands — so the page is taken here rather than pushed into a
      // query nobody else needs.
      const after = decodeKeyedCursor(page.after);
      if (after === null) return all.slice(0, page.limit);
      return all
        .filter(
          (p) => p.createdAt > after.sortKey || (p.createdAt === after.sortKey && p.id > after.id),
        )
        .slice(0, page.limit);
    },
  },
  POST: {
    summary: "Create a Notebook page on a trip",
    scope: "notebook:write",
    trip: "path",
    role: "editor",
    body: CreatePageInput,
    // The same ceiling the session route has (KI-2026-09-05-f item 1): a
    // token must not be the way round it.
    maxBodyBytes: MAX_PAGE_BODY_BYTES,
    response: Page,
    handle: async ({ actor, params, body }) => {
      const input = body as z.infer<typeof CreatePageInput>;
      // The body names its own trip, and a body naming a different trip from
      // the URL is a caller confusing two of their own trips — 400, not a
      // silent write to whichever one the URL happened to say.
      if (input.context.tripId !== params["tripId"]) {
        throw new PublicApiError(400, "This page's context names a different trip from the URL.");
      }
      // Through the command pipeline, for the reason the PATCH beside it
      // gives: the public API is not allowed to be the one door that writes a
      // page without writing the event that says so.
      const result = await executePageCommand(
        {
          type: "CreatePage",
          tripId: params["tripId"]!,
          pageId: randomUUID(),
          title: input.title,
          context: input.context,
          // The wire form, not the parse output — see the BFF route.
          content: serializePageDoc(input.content),
        },
        actor.userId,
      );
      if (!result.ok) {
        if (result.error.code === "concurrency-conflict") {
          throw new PublicApiError(409, result.error.message, "invalid-request");
        }
        throw new PublicApiError(400, result.error.message, "invalid-request");
      }
      if (result.page === null) throw new PublicApiError(404, "No such page on this trip.");
      return result.page;
    },
  },
});

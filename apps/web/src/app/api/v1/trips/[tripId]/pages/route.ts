import { z } from "zod";
import { CreatePageInput, Page, PageSummary } from "@tc/contracts";
import { createPage, listPages } from "@/server/pages";
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
    response: Page,
    handle: async ({ actor, params, body }) => {
      const input = body as z.infer<typeof CreatePageInput>;
      // The body names its own trip, and a body naming a different trip from
      // the URL is a caller confusing two of their own trips — 400, not a
      // silent write to whichever one the URL happened to say.
      if (input.context.tripId !== params["tripId"]) {
        throw new PublicApiError(400, "This page's context names a different trip from the URL.");
      }
      return createPage(params["tripId"]!, input, actor.userId);
    },
  },
});

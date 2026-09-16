import { z } from "zod";
import { CreatePageInput, Page, PageSummary } from "@tc/contracts";
import { createPage, listPages } from "@/server/pages";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **Textbook single-resource CRUD already**, which is why the Notebook was the
// easiest thing in the inventory to publish: the read is a projection and the
// write is a row.
//
// **A viewer may read the Notebook; only an editor may add to it** — the same
// split the BFF makes, expressed here as two `role:` fields rather than two
// guard calls.
export const { GET, POST } = route({
  GET: {
    scope: "notebook:read",
    trip: "path",
    role: "viewer",
    collection: { item: PageSummary, cursorOf: (page: z.infer<typeof PageSummary>) => page.updatedAt },
    handle: async ({ params, page }) => {
      const all = await listPages(params["tripId"]!);
      // `listPages` answers with the whole notebook — a trip's pages are tens,
      // not thousands — so the page is taken here rather than pushed into a
      // query nobody else needs.
      const after = page.after;
      const from = after === null ? all : all.filter((p) => p.updatedAt < after);
      return from.slice(0, page.limit);
    },
  },
  POST: {
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

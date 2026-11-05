import { PageShare } from "@tc/contracts";
import { createPageShare, listPageShares } from "@/server/access/pageShares";
import { PublicApiError } from "@/server/public-api/commands";
import { decodeKeyedCursor, keyedCursor, route } from "@/server/public-api/route";

// Public notebook links (M58, ADR-088). Reading is `trips:read`, creating is
// `sharing:write`, as a pinned share (Decision 4): handing someone a link is
// Access & Membership. The role is `editor`, not the pinned share's `owner`:
// the app route has always let an editor publish, and ADR-088 §1 says editors.
export const { GET, POST } = route({
  GET: {
    summary: "List a Notebook page's public links, newest first, revoked ones included",
    scope: "trips:read",
    trip: "path",
    role: "editor",
    collection: { item: PageShare, cursorOf: (share: PageShare) => keyedCursor(share.createdAt, share.shareId) },
    handle: async ({ params, page }) => {
      const all = await listPageShares(params["tripId"]!, params["pageId"]!);
      // Newest first with the id as tie-break, so rows sharing a millisecond are neither skipped nor repeated.
      const after = decodeKeyedCursor(page.after);
      const rest =
        after === null
          ? all
          : all.filter((s) => s.createdAt < after.sortKey || (s.createdAt === after.sortKey && s.shareId < after.id));
      return rest.slice(0, page.limit);
    },
  },
  POST: {
    summary: "Make a Notebook page public: a link anyone can read, showing the page as it stands",
    description:
      "Answers 422 for the seeded Bookings & confirmations, Money and During-the-trip notebooks, and for a deleted trip. " +
      "A page that is already public is answered with its live link.",
    scope: "sharing:write",
    trip: "path",
    role: "editor",
    response: PageShare,
    handle: async ({ actor, params }) => {
      const created = await createPageShare(params["tripId"]!, params["pageId"]!, actor.userId);
      if (!created.ok) {
        // The seeded Bookings, Money and During-the-trip pages exist but can't be public.
        if (created.error.code === "invalid") throw new PublicApiError(422, created.error.message);
        throw new PublicApiError(404, created.error.message, "not-found");
      }
      return created.value;
    },
  },
});

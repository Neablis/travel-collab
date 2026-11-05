import { PageShare } from "@tc/contracts";
import { revokePageShare } from "@/server/access/pageShares";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

export const { DELETE } = route({
  DELETE: {
    summary: "Make a Notebook page private again by revoking one of its public links",
    scope: "sharing:write",
    trip: "path",
    role: "editor",
    response: PageShare,
    handle: async ({ params }) => {
      const revoked = await revokePageShare(params["tripId"]!, params["pageId"]!, params["shareId"]!);
      // Already-revoked answers ok: `revokePageShare`'s own rule.
      if (!revoked.ok) throw new PublicApiError(404, revoked.error.message, "not-found");
      return revoked.value;
    },
  },
});

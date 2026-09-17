import { z } from "zod";
import { accountPlanView } from "@/server/entitlements/accountPlan";
import { route } from "@/server/public-api/route";

// **"Who am I and what do I hold."**
//
// Deliberately NOT today's `/api/account/preferences`, which has `isAdmin`
// bolted onto it for a menu item and carries display settings a third party has
// no business reading. This is the resource that question deserves.
//
// **No trip dimension**, so a trip-scoped token is refused here by the wrapper —
// answering "who am I" to a credential confined to two trips is a widening.
const AccountView = z.object({
  userId: z.string(),
  planVersionRef: z.string(),
  entitlements: z.array(z.string()),
});

export const { GET } = route({
  GET: {
    scope: "account:read",
    response: AccountView,
    handle: async ({ actor }) => {
      const plan = await accountPlanView(actor.userId);
      return {
        userId: actor.userId,
        // **What the account CONFERS, not what it bought.** They differ after a
        // lapse, and a caller asking what it may do wants the effective answer.
        planVersionRef: plan.conferredVersionRef,
        entitlements: [...plan.entitlements],
      };
    },
  },
});

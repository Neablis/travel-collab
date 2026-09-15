import { auth } from "@/server/auth";
import { billingConfigured, returnOrigin } from "@/server/billing/config";
import { portalUrlFor } from "@/server/billing/checkout";

// **Payment method, invoices and cancellation — all of them Stripe's screens**
// (M21 link 5).
//
// Nothing about a card is built here, which is the same reason checkout is
// hosted: the gate box is *"no card number, CVC or expiry is ever entered into,
// posted to, or logged by this application"*, and the way to keep that true is
// to have no such screen to keep honest.
//
// **Cancelling there lapses through M20's resolver.** The portal sets
// `cancel_at_period_end`, the webhook records it, access runs to the end of the
// paid period, and then the resolver stops finding a conferring subscription.
// There is deliberately no second downgrade path to keep in sync.
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!billingConfigured()) {
    return Response.json({ error: "billing-unavailable" }, { status: 503 });
  }
  return Response.json({ url: await portalUrlFor({ userId, returnOrigin: returnOrigin(request) }) });
}

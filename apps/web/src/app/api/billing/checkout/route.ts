import { z } from "zod";
import { PlanId } from "@tc/contracts";
import { auth } from "@/server/auth";
import { billingConfigured, returnOrigin } from "@/server/billing/config";
import { CheckoutRefusedError, startCheckout } from "@/server/billing/checkout";
import { PriceMismatchError } from "@/server/billing/prices";

// **Start a hosted checkout** (M21 link 3).
//
// **The client names a plan and nothing else.** No price, no version, no
// customer, no Stripe Price id — every one of those is resolved server-side
// from the committed plan file, so there is no number on the wire for a client
// to have been wrong about, and *"none of it is computed from a price string in
// the UI"* (SPEC §29) is a property of the API rather than a rule the UI keeps.
//
// **It returns a URL; it grants nothing.** The redirect back is a hint, never a
// grant (M21 link 4) — what an account holds changes when the webhook says so.
const Body = z.object({ planId: PlanId });

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });

  if (!billingConfigured()) {
    // A deployment with no Stripe keys is a legitimate state — every local run
    // and every CI run is one. 503 rather than 500: nothing is broken, the
    // capability is absent, and the design's rule is that a surface asks first
    // and does not offer a CTA that opens a checkout which cannot succeed.
    return Response.json({ error: "billing-unavailable" }, { status: 503 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });

  try {
    const started = await startCheckout({
      userId,
      planId: parsed.data.planId,
      returnOrigin: returnOrigin(request),
    });
    return Response.json(started);
  } catch (error) {
    if (error instanceof CheckoutRefusedError) {
      return Response.json({ error: error.reason, message: error.message }, { status: 409 });
    }
    if (error instanceof PriceMismatchError) {
      // **The pricing page and the card statement disagree** (M21 link 2). The
      // one failure mode where charging anyone would be worse than refusing
      // everyone, so it refuses — and it is a 500 because it is ours, not the
      // buyer's.
      return Response.json({ error: "price-mismatch" }, { status: 500 });
    }
    throw error;
  }
}

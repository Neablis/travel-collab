import { z } from "zod";
import { PlanId } from "@tc/contracts";
import { auth } from "@/server/auth";
import { billingConfigured, returnOrigin } from "@/server/billing/config";
import { CheckoutRefusedError } from "@/server/billing/checkout";
import { applyPlanChange, previewPlanChange, StalePlanVersionError } from "@/server/billing/planChange";
import { PriceMismatchError } from "@/server/billing/prices";

// **The confirm step's two calls** (SPEC §29, M21 link 5).
//
// `GET` previews — what Stripe would charge for this change, without making it.
// `POST` applies it. Neither writes a subscription row: a change goes to Stripe
// and comes back through the webhook, so what `POST` returns is *what is
// happening*, never *what this account now holds*.
//
// **No price crosses this boundary inwards.** The client names a plan and, on
// apply, the version it was shown — so the numbers it displayed can be checked
// against what is live rather than trusted.
export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!billingConfigured()) return Response.json({ error: "billing-unavailable" }, { status: 503 });

  const planId = PlanId.safeParse(new URL(request.url).searchParams.get("planId"));
  if (!planId.success) return Response.json({ error: "bad-request" }, { status: 400 });

  try {
    return Response.json({ preview: await previewPlanChange({ userId, planId: planId.data }) });
  } catch (error) {
    if (error instanceof CheckoutRefusedError) {
      return Response.json({ error: error.reason, message: error.message }, { status: 409 });
    }
    if (error instanceof PriceMismatchError) {
      return Response.json({ error: "price-mismatch" }, { status: 500 });
    }
    throw error;
  }
}

const Body = z.object({ planId: PlanId, shownVersionRef: z.string().min(1) });

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId === undefined) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!billingConfigured()) return Response.json({ error: "billing-unavailable" }, { status: 503 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad-request" }, { status: 400 });

  try {
    return Response.json(
      await applyPlanChange({
        userId,
        planId: parsed.data.planId,
        shownVersionRef: parsed.data.shownVersionRef,
        returnOrigin: returnOrigin(request),
      }),
    );
  } catch (error) {
    if (error instanceof StalePlanVersionError) {
      // **A conflict, not an error** (§29). An admin published while this
      // person sat on the confirm step; the screen re-renders with the new
      // numbers and says so. 409 rather than 400 because nothing about the
      // request was malformed — the world moved.
      return Response.json(
        { error: "stale-version", shown: error.shown, live: error.live },
        { status: 409 },
      );
    }
    if (error instanceof CheckoutRefusedError) {
      return Response.json({ error: error.reason, message: error.message }, { status: 409 });
    }
    if (error instanceof PriceMismatchError) {
      return Response.json({ error: "price-mismatch" }, { status: 500 });
    }
    throw error;
  }
}

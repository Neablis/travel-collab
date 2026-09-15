import { Suspense } from "react";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { PlansScreen } from "@/components/plans/PlansScreen";

// **Plans is a route** (SPEC §29, superseding §17.4's last bullet).
//
// **Not a second view of the same information.** The account sheet keeps plan,
// version, state, the two meters, past-due and referral; this route holds what
// the sheet never had — what each plan grants, side by side, and the order.
// Nothing appears twice, which is §29 satisfying rule 4 rather than breaking it.
//
// **The Suspense boundary is Next's requirement, not a loading state**, and it
// is the same one `(app)/layout.tsx` explains for `PhoneTabBar`: `PlansScreen`
// reads `useSearchParams()` — the `?checkout=` half of "did this person just
// come back from Stripe" — and an unwrapped `useSearchParams` fails the
// PRODUCTION BUILD outright, not just static optimisation. Caught by
// `test:e2e:ci-like`, which is exactly the difference between that lane and
// `test:e2e`: the dev server compiles a route on first hit and never
// prerenders it, so this route worked perfectly in dev and could not be built.
//
// The fallback is the page's own frame rather than `null`, because Next renders
// it on the server and the component on the client: `null` would leave the
// route's heading out of first-paint HTML, which is a blank page on a slow
// connection where a title costs nothing.
//
// **The assistant is not here, and in this build it is not hidden either.** §29
// asks for `visibility: hidden; pointer-events: none` on the floating dock so
// that coming back from Plans does not reset its thread, its open state or its
// dragged position. That instruction is written against the design's
// architecture, where the dock is global. In this build the dock is mounted by
// `TripBoardScreen` and is trip-scoped, so on an account-scope route there is
// no dock in the tree to hide — and nothing to lose by its absence, which is
// the end state §29 is protecting. Recorded here rather than acted on, because
// mounting a global dock in order to hide it would be building the design's
// architecture to satisfy a rule about the design's architecture.
export default function PlansPage() {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <Heading level={1}>Plans</Heading>
        </PageContainer>
      }
    >
      <PlansScreen />
    </Suspense>
  );
}

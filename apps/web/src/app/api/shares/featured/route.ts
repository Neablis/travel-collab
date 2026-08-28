import { SharedTripView } from "@tc/contracts";
import { demoSharedTripView } from "@/server/demoTrip";

// A static segment, so Next.js routes `/api/shares/featured` here and every
// other `/api/shares/:token` to the sibling dynamic route. `featured` is
// therefore a reserved token — harmless, since real tokens are 43-character
// base64url and can never collide with it — and it means `/s/featured` is
// served by the same page component as any other share, fetching the same
// `SharedTripView` from a different path.
//
// What it serves is the built-in demo trip: the canonical Japan fixture folded
// through the real domain in memory (ADR-031). No session — this is a page for
// people who do not have one — and no database, which is the point. It used to
// resolve `DEMO_SHARE_TOKEN` to a real share row and replay that trip's whole
// event stream on every view; that made the front door's second CTA depend on
// a deploy step no test could enforce (KI-61) and put an unbounded number of
// stream reads on a public, unauthenticated path.

// Prerendered and revalidated hourly rather than computed per request. The
// response depends on nothing but the calendar — the trip is dated relative to
// today (ADR-030) — so an hour-old copy is only ever wrong in the window either
// side of midnight, and only by a day in the demo's own future dates. The fold
// is also memoised per instance; this is the CDN half of the same argument.
export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  // Parsed on the way out like any other share read: the demo is served
  // through the contract, not around it, so a fixture that drifted out of
  // `SharedTripView`'s shape fails here rather than in someone's browser.
  return Response.json({ trip: SharedTripView.parse(demoSharedTripView()) });
}

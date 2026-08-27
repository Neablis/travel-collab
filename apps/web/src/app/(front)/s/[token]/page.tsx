import { SharedTripScreen } from "@/components/access/SharedTripScreen";

export const metadata = { title: "A shared trip — Caesura" };

// Under `(front)`, not `(app)`: this is the one page in the product a person
// with no account is meant to reach, so it draws the front door's chrome
// rather than the signed-in shell. It is also deliberately absent from
// `middleware.ts`'s matcher — matching it would bounce every recipient of a
// share link to /signin, which is precisely the thing the link exists to
// avoid.
//
// `/s/featured` reaches this same component: `featured` is a reserved token
// the API maps to the deployment's configured demo share (ADR-027), so the
// landing page's "Look around a real trip" is an ordinary link to an ordinary
// share rather than a bespoke public-read path.
export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedTripScreen token={token} />;
}

import { SharedTripScreen } from "@/components/access/SharedTripScreen";

export const metadata = { title: "A shared trip — Caesura" };

// Under `(front)`, not `(app)`: this is the one page in the product a person
// with no account is meant to reach, so it draws the front door's chrome
// rather than the signed-in shell. It is also deliberately absent from
// `proxy.ts`'s matcher — matching it would bounce every recipient of a
// share link to /signin, which is precisely the thing the link exists to
// avoid.
//
// Every token here is a real share someone created. There is no longer a
// reserved `featured` token: the landing page's "look around a real trip" goes
// to `/demo`, which renders the actual board read-only against a trip folded in
// memory (ADR-031), rather than this narrowed one-page view of a pinned share.
export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharedTripScreen token={token} />;
}

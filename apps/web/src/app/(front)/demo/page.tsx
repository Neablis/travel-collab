import { DemoTripScreen } from "@/components/demo/DemoTripScreen";

export const metadata = { title: "An example trip — Caesura" };

// Under `(front)`, not `(app)`: this is a page for people who have no account,
// so it draws the front door's chrome rather than the signed-in shell. It is
// also deliberately absent from `middleware.ts`'s matcher — matching it would
// bounce every visitor to /signin, which is precisely what this page exists to
// avoid — and it is NOT under `/trips/:id`, which that matcher does guard.
//
// What renders below is the real trip board (ADR-031): the real `TripProvider`
// reading the real `/api/trips/:id`, `/history` and `/access` endpoints, and
// the real Day-columns, Timeline, Calendar and Map lenses. The trip it asks for
// is folded from the Japan fixture in memory and granted to every visitor as a
// **viewer**, so the board is read-only by the same rule that makes an invited
// viewer read-only — not by a second, parallel read-only implementation.
export default function DemoPage() {
  return <DemoTripScreen />;
}

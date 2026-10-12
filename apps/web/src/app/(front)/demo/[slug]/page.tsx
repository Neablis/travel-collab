import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoTripScreen } from "@/components/demo/DemoTripScreen";
import { DEMO_TRIPS, demoPath, demoTripBySlug } from "@/lib/demoTrip";
import { demoTripCard } from "@/lib/demoTripCards";
import { pageMetadata } from "@/lib/siteMetadata";

type Params = { params: Promise<{ slug: string }> };

// One page per demo, prerendered; any other slug is a 404.
export const dynamicParams = false;

/** Every demo's slug, so each page is built ahead of its first visitor. */
export function generateStaticParams(): { slug: string }[] {
  return DEMO_TRIPS.map(({ slug }) => ({ slug }));
}

/** The demo's title, description and canonical `/demo/<slug>`, from its committed card. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const card = demoTripCard((await params).slug);
  if (card === undefined) return {};
  return pageMetadata({
    title: card.name,
    description: `Look around a real trip on Caesura, ${card.name}: every day, stop, cost and map, read-only and with no account.`,
    canonical: demoPath(card.slug),
  });
}

// What renders below is the real trip board (ADR-031): the real `TripProvider`
// reading the real `/api/trips/:id`, `/history` and `/access` endpoints, and
// the real lenses. The trip it asks for is folded in memory and granted to
// every visitor as a **viewer**, so the board is read-only by the same rule
// that makes an invited viewer read-only — not by a second, parallel
// read-only implementation. `../page.tsx` says why this is under `(front)`.
/** `/demo/<slug>`: that demo's board, read-only, or a 404 for a slug that is no demo. */
export default async function DemoTripPage({ params }: Params) {
  const demo = demoTripBySlug((await params).slug);
  if (demo === undefined) notFound();
  return <DemoTripScreen demo={demo} />;
}

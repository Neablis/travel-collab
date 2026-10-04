import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { placeListing, placeMetadata, type PlaceRouteProps } from "@/server/placePage";

/** Metadata for `/playbooks/city/<slug>`: the city's title and count, self-canonical per page. */
export async function generateMetadata(props: PlaceRouteProps) {
  return placeMetadata("city", props);
}

// One city's published days (SEO pass, D6), server-rendered. The slug gathers
// every stored spelling that slugs alike; the country page is this page over
// the other kind, in `server/placePage.ts`.
/** `/playbooks/city/<slug>`: that city's published days, paged by `?page=N`, or a 404. */
export default async function CityPage(props: PlaceRouteProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <PlaceDaysList {...await placeListing("city", props)} />
    </main>
  );
}

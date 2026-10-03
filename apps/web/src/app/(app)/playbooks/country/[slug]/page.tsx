import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { placeListing, placeMetadata, type PlaceRouteProps } from "@/server/placePage";

/** Metadata for `/playbooks/country/<slug>`: the country's title and count, self-canonical per page. */
export async function generateMetadata(props: PlaceRouteProps) {
  return placeMetadata("country", props);
}

// One country's published days (SEO pass, D6): the city page over the other
// kind, in `server/placePage.ts`. The slug is the English name of the ISO code.
/** `/playbooks/country/<slug>`: that country's published days, paged by `?page=N`, or a 404. */
export default async function CountryPage(props: PlaceRouteProps) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <PlaceDaysList {...await placeListing("country", props)} />
    </main>
  );
}

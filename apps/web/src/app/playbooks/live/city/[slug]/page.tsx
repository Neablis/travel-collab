import { JsonLd } from "@/components/JsonLd";
import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { placeItemListJsonLd } from "@/lib/jsonLd";
import { placeIndexable } from "@/lib/playbookUrls";
import { placeListing, placeMetadata, type PlaceRouteProps } from "@/server/placePage";
import { libraryProps, type LibraryRoute } from "@/lib/playbooksPageReader";

/** Metadata for `/playbooks/city/<slug>`: the city's title and count, self-canonical per page. */
export async function generateMetadata(route: LibraryRoute<PlaceRouteProps>) {
  return placeMetadata("city", await libraryProps(route));
}

// One city's published days (SEO pass, D6), server-rendered. The slug gathers
// every stored spelling that slugs alike; the country page is this page over
// the other kind, in `server/placePage.ts`.
/** `/playbooks/city/<slug>`: that city's published days, paged by `?page=N`, or a 404. */
export default async function CityPage(route: LibraryRoute<PlaceRouteProps>) {
  const props = await libraryProps(route);
  const [listing, { slug }] = await Promise.all([placeListing("city", props), props.params]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* A thin page is noindex, and like a hidden day it says nothing to a crawler. */}
      {placeIndexable({ days: listing.total }) && <JsonLd data={placeItemListJsonLd(listing.days, deploymentOrigin())} />}
      {/* Its assistant reads this city's list, at this page (M45 D9). */}
      <PlaceDaysList {...listing} assistant={{ kind: "city", slug, page: listing.page }} />
    </main>
  );
}

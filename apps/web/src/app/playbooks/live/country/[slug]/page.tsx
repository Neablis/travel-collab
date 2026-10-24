import { JsonLd } from "@/components/JsonLd";
import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { breadcrumbJsonLd, placeItemListJsonLd } from "@/lib/jsonLd";
import { placeIndexable } from "@/lib/playbookUrls";
import { placeListing, placeMetadata, type PlaceRouteProps } from "@/server/placePage";
import { libraryProps, type LibraryRoute } from "@/lib/playbooksPageReader";

/** Metadata for `/playbooks/country/<slug>`: the country's title and description, self-canonical per page. */
export async function generateMetadata(route: LibraryRoute<PlaceRouteProps>) {
  return placeMetadata("country", await libraryProps(route));
}

// One country's published days (SEO pass, D6): the city page over the other
// kind, in `server/placePage.ts`. The slug is the English name of the ISO code.
/** `/playbooks/country/<slug>`: that country's published days, paged by `?page=N`, or a 404. */
export default async function CountryPage(route: LibraryRoute<PlaceRouteProps>) {
  const listing = await placeListing("country", await libraryProps(route));
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* As on the city page: only an indexable page lists its days to a crawler. */}
      {placeIndexable({ days: listing.total }) && <JsonLd data={placeItemListJsonLd(listing.days, deploymentOrigin())} />}
      {/* The trail above the list, as structured data too: ungated, since the visible trail renders on a thin page as well. */}
      <JsonLd data={breadcrumbJsonLd(listing.crumbs, deploymentOrigin())} />
      <PlaceDaysList {...listing} />
    </main>
  );
}

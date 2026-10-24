import { JsonLd } from "@/components/JsonLd";
import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { breadcrumbJsonLd, placeItemListJsonLd } from "@/lib/jsonLd";
import { placeIndexable } from "@/lib/playbookUrls";
import { countryCityListing, countryCityMetadata, type CountryCityRouteProps } from "@/server/placePage";
import { libraryProps, type LibraryRoute } from "@/lib/playbooksPageReader";

/** Metadata for `/playbooks/country/<slug>/city/<city>`: the pair's title and description, self-canonical per page. */
export async function generateMetadata(route: LibraryRoute<CountryCityRouteProps>) {
  return countryCityMetadata(await libraryProps(route));
}

// One city's days inside one country — the city page over the country's days,
// so a city name that exists in two countries is two pages, not one.
/** `/playbooks/country/<slug>/city/<city>`: that city's days in that country, paged by `?page=N`, or a 404. */
export default async function CountryCityPage(route: LibraryRoute<CountryCityRouteProps>) {
  const props = await libraryProps(route);
  const listing = await countryCityListing(props);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* A thin page is noindex, and like a hidden day it says nothing to a crawler. */}
      {placeIndexable({ days: listing.total }) && <JsonLd data={placeItemListJsonLd(listing.days, deploymentOrigin())} />}
      {/* The trail above the list, as structured data too: ungated, since the visible trail renders on a thin page as well. */}
      <JsonLd data={breadcrumbJsonLd(listing.crumbs, deploymentOrigin())} />
      <PlaceDaysList {...listing} />
    </main>
  );
}

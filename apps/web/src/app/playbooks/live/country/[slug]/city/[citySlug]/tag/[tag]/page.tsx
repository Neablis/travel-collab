import { JsonLd } from "@/components/JsonLd";
import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { breadcrumbJsonLd, placeItemListJsonLd } from "@/lib/jsonLd";
import { placeIndexable } from "@/lib/playbookUrls";
import { countryTagListing, countryTagMetadata, type CountryTagRouteProps } from "@/server/tagPage";
import { libraryProps, type LibraryRoute } from "@/lib/playbooksPageReader";

/** Metadata for `/playbooks/country/<slug>/city/<city>/tag/<tag>`: the pair and tag's title and description, self-canonical per page. */
export async function generateMetadata(route: LibraryRoute<CountryTagRouteProps>) {
  return countryTagMetadata(await libraryProps(route));
}

// One tag in one city's page inside its country: the pair's days whose description names the tag.
/** `/playbooks/country/<slug>/city/<city>/tag/<tag>`: that city's days in that country the tag describes, paged by `?page=N`, or a 404. */
export default async function CountryCityTagPage(route: LibraryRoute<CountryTagRouteProps>) {
  const props = await libraryProps(route);
  const listing = await countryTagListing(props);
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

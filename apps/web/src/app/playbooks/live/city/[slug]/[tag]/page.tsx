import { JsonLd } from "@/components/JsonLd";
import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { breadcrumbJsonLd, placeItemListJsonLd } from "@/lib/jsonLd";
import { placeIndexable } from "@/lib/playbookUrls";
import { tagListing, tagMetadata, type TagRouteProps } from "@/server/tagPage";
import { libraryProps, type LibraryRoute } from "@/lib/playbooksPageReader";

/** Metadata for `/playbooks/city/<slug>/<tag>`: the city and tag's title and description, self-canonical per page. */
export async function generateMetadata(route: LibraryRoute<TagRouteProps>) {
  return tagMetadata(await libraryProps(route));
}

// One tag in one city's page (M42 D10): the city page's days whose
// description names the tag.
/** `/playbooks/city/<slug>/<tag>`: that city's days the tag describes, paged by `?page=N`, or a 404. */
export default async function CityTagPage(route: LibraryRoute<TagRouteProps>) {
  const props = await libraryProps(route);
  const [listing, { tag, slug }] = await Promise.all([tagListing(props), props.params]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* As on the city page: only an indexable page lists its days to a crawler. */}
      {placeIndexable({ days: listing.total }) && <JsonLd data={placeItemListJsonLd(listing.days, deploymentOrigin())} />}
      {/* The trail above the list, as structured data too: ungated, since the visible trail renders on a thin page as well. */}
      <JsonLd data={breadcrumbJsonLd(listing.crumbs, deploymentOrigin())} />
      {/* Its assistant reads this tag's list, at this page (M45 D9). */}
      <PlaceDaysList {...listing} assistant={{ kind: "tag", tag, city: slug ?? null, page: listing.page }} />
    </main>
  );
}

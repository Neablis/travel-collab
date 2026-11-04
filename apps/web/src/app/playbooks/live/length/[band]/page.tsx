import { JsonLd } from "@/components/JsonLd";
import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { breadcrumbJsonLd, placeItemListJsonLd } from "@/lib/jsonLd";
import { placeIndexable } from "@/lib/playbookUrls";
import { lengthListing, lengthMetadata, type LengthRouteProps } from "@/server/lengthPage";
import { libraryProps, type LibraryRoute } from "@/lib/playbooksPageReader";

/** Metadata for `/playbooks/length/<band>`: the band's title and description, self-canonical per page. */
export async function generateMetadata(route: LibraryRoute<LengthRouteProps>) {
  return lengthMetadata("library", await libraryProps(route));
}

/** `/playbooks/length/<band>`: that band's days across the library, paged by `?page=N`, or a 404. */
export default async function LengthPage(route: LibraryRoute<LengthRouteProps>) {
  const listing = await lengthListing("library", await libraryProps(route));
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

import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { countryTagListing, countryTagMetadata, type CountryTagRouteProps } from "@/server/tagPage";
import { libraryProps, type LibraryRoute } from "@/lib/playbooksPageReader";

/** Metadata for `/playbooks/country/<slug>/<tag>`: the country and tag's title and count, self-canonical per page. */
export async function generateMetadata(route: LibraryRoute<CountryTagRouteProps>) {
  return countryTagMetadata(await libraryProps(route));
}

// One tag in one country's page: the country page's days whose description names the tag.
/** `/playbooks/country/<slug>/<tag>`: that country's days the tag describes, paged by `?page=N`, or a 404. */
export default async function CountryTagPage(route: LibraryRoute<CountryTagRouteProps>) {
  const props = await libraryProps(route);
  const listing = await countryTagListing(props);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <PlaceDaysList {...listing} />
    </main>
  );
}

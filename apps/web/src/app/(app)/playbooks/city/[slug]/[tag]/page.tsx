import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { tagListing, tagMetadata, type TagRouteProps } from "@/server/tagPage";

/** Metadata for `/playbooks/city/<slug>/<tag>`: the city and tag's title and count, self-canonical per page. */
export async function generateMetadata(props: TagRouteProps) {
  return tagMetadata(props);
}

// One tag in one city's page (M42 D10): the city page's days whose
// description names the tag.
/** `/playbooks/city/<slug>/<tag>`: that city's days the tag describes, paged by `?page=N`, or a 404. */
export default async function CityTagPage(props: TagRouteProps) {
  const [listing, { tag, slug }] = await Promise.all([tagListing(props), props.params]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* Its assistant reads this tag's list, at this page (M45 D9). */}
      <PlaceDaysList {...listing} assistant={{ kind: "tag", tag, city: slug ?? null, page: listing.page }} />
    </main>
  );
}

import { PlaceDaysList } from "@/components/playbooks/PlaceDaysList";
import { tagListing, tagMetadata, type TagRouteProps } from "@/server/tagPage";

/** Metadata for `/playbooks/tag/<tag>`: the tag's title and count, self-canonical per page. */
export async function generateMetadata(props: TagRouteProps) {
  return tagMetadata(props);
}

// One tag's published days across the library (M42 D10): the days whose
// description names it, so one bar on a day of meals is not a nightlife day.
/** `/playbooks/tag/<tag>`: the days that tag describes, paged by `?page=N`, or a 404. */
export default async function TagPage(props: TagRouteProps) {
  const [listing, { tag, slug }] = await Promise.all([tagListing(props), props.params]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* Its assistant reads this tag's list (M45 D9). */}
      <PlaceDaysList {...listing} assistant={{ kind: "tag", tag, city: slug ?? null }} />
    </main>
  );
}

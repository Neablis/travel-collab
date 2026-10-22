// The cached copy of `/playbooks/country/<slug>/city/<city>` (`lib/playbooksReader.ts`): the live page,
// which reads no session and no query when its params carry `copy`.
export { default, generateMetadata } from "../../../../../live/country/[slug]/city/[citySlug]/page";

/** None built ahead: each is rendered on its first visit and kept (the `[copy]` layout says why). */
export function generateStaticParams(): { slug: string; citySlug: string }[] {
  return [];
}

// The cached copy of `/playbooks/country/<slug>/city/<city>/tag/<tag>` (`lib/playbooksReader.ts`): the live page,
// which reads no session and no query when its params carry `copy`.
export { default, generateMetadata } from "../../../../../../../live/country/[slug]/city/[citySlug]/tag/[tag]/page";

/** None built ahead: each is rendered on its first visit and kept (the `[copy]` layout says why). */
export function generateStaticParams(): { slug: string; citySlug: string; tag: string }[] {
  return [];
}

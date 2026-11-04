// The cached copy of `/playbooks/country/<slug>/length/<band>` (`lib/playbooksReader.ts`): the live page,
// which reads no session and no query when its params carry `copy`.
export { default, generateMetadata } from "../../../../../live/country/[slug]/length/[band]/page";

/** None built ahead: each is rendered on its first visit and kept (the `[copy]` layout says why). */
export function generateStaticParams(): { slug: string; band: string }[] {
  return [];
}

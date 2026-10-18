// The cached copy of `/playbooks/day/<slug>-<id>` (`lib/playbooksReader.ts`): the live page,
// which reads no session and no query when its params carry `copy`.
export { default, generateMetadata } from "../../../live/day/[savedDayId]/page";

/** None built ahead: each is rendered on its first visit and kept (the `[copy]` layout says why). */
export function generateStaticParams(): { savedDayId: string }[] {
  return [];
}

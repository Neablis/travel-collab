import Link from "next/link";
import { useId } from "react";
import { Heading } from "@/components/ui/heading";
import type { DiscoverDay } from "@/lib/playbooks";
import { dayPath } from "@/lib/playbookUrls";

/** How many days each list shows. The page asks for one more, so the day being read can be dropped. */
export const RELATED_DAYS = 4;

type Related = Pick<DiscoverDay, "savedDayId" | "name">;

/** One titled list of links to other days. Renders nothing when empty. */
function DayLinks({ title, days }: { title: string; days: Related[] }) {
  const headingId = useId();
  if (days.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      {/* One string, not `More in {name}`: two text nodes reach the HTML split
          by a comment, and the heading is what a crawler reads. */}
      <Heading level={2} id={headingId}>
        {title}
      </Heading>
      <ul className="flex flex-col gap-1">
        {days.map((day) => (
          <li key={day.savedDayId}>
            <Link href={dayPath(day)} className="text-sm underline">
              {day.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Server-rendered and plain links (SEO pass, D8), so a crawler that lands on
// one day finds the next without running anything.
/**
 * Other days worth opening from this one: a few from the same city and a few
 * by the same author, never the day being read. Renders nothing when neither
 * list has another day in it.
 */
export function RelatedDays({
  savedDayId,
  cityName,
  authorName,
  sameCity,
  sameAuthor,
}: {
  /** The day being read, which either list may hold. */
  savedDayId: string;
  /** The day's first city, or null for a day that names none. */
  cityName: string | null;
  authorName: string;
  sameCity: Related[];
  sameAuthor: Related[];
}) {
  const others = (days: Related[]) => days.filter((day) => day.savedDayId !== savedDayId).slice(0, RELATED_DAYS);
  const city = cityName === null ? [] : others(sameCity);
  const author = others(sameAuthor);
  if (city.length === 0 && author.length === 0) return null;
  return (
    <aside className="mt-8 grid gap-6 border-t border-hairline pt-6 sm:grid-cols-2">
      <DayLinks title={`More in ${cityName}`} days={city} />
      <DayLinks title={`More by ${authorName}`} days={author} />
    </aside>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/components/lenses/formatMoney";
import { displayNameFor } from "@/lib/displayName";
import type { DiscoverDay } from "@/lib/playbooks";
import { toClockRange } from "@/lib/time";
import { cn } from "@/lib/cn";

// One day in the public library, as Discover and a public profile both render
// it. The same component in both places on purpose: the exit gate asks that a
// profile's numbers agree with Discover's, and two card components would make
// that a thing to check rather than a thing that is true.

/**
 * The per-card line the milestone names: *"Kyoto matched · also Uji"*.
 *
 * Exported and pure so the wording is asserted directly rather than through a
 * render, and so the "matched" half cannot drift from the filled/outlined chips
 * beside it — both read `matchedCities`.
 *
 * Null on an unfiltered browse: nothing was asked for, so nothing matched, and
 * a line saying so on every card would be noise.
 */
export function matchLine(day: Pick<DiscoverDay, "cities" | "matchedCities">): string | null {
  if (day.matchedCities.length === 0) return null;
  const others = day.cities.filter((city) => !day.matchedCities.includes(city));
  const matched = `${day.matchedCities.join(", ")} matched`;
  return others.length === 0 ? matched : `${matched} · also ${others.join(", ")}`;
}

export function DiscoverCard({ day }: { day: DiscoverDay }) {
  const line = matchLine(day);
  return (
    <Card
      raised
      as="li"
      data-testid="discover-card"
      data-saved-day-id={day.savedDayId}
      className="flex flex-col gap-3 rounded-lg p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading level={4} className="leading-snug">
          <Link href={`/playbooks/day/${day.savedDayId}`} className="hover:underline">
            {day.name}
          </Link>
        </Heading>
        {day.isMine && <Badge variant="brand">Yours</Badge>}
        {day.visibility === "private" && <Badge variant="neutral">Private</Badge>}
      </div>

      {/* Filled = matched, outlined = the rest. The distinction is the whole
          point of "a day matches on ANY city it contains": the card has to show
          that the Kyoto you asked for is one of three cities this day covers,
          or the extra cities look like a mistake rather than the offer. */}
      <ul className="flex flex-wrap gap-1.5" data-testid="city-chips">
        {day.cities.map((city) => {
          const matched = day.matchedCities.includes(city);
          return (
            <li
              key={city}
              data-city={city}
              data-matched={matched}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                matched
                  ? "bg-brand-tint text-brand-pressed"
                  : "border border-hairline bg-surface text-slate",
              )}
            >
              {city}
            </li>
          );
        })}
      </ul>

      {line !== null && (
        <Text variant="secondary" data-testid="match-line">
          {line}
        </Text>
      )}

      <DataText size="xs" className="block">
        {day.stopCount} stop{day.stopCount === 1 ? "" : "s"}
        {day.window !== null && ` · ${toClockRange(day.window.start, day.window.end)}`}
        {day.budgetPerPerson !== null &&
          ` · ${formatMoney(day.budgetPerPerson.amountMinor, day.budgetPerPerson.currency)} each`}
      </DataText>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        {/* The M17 seam, and the only place this card names a person. */}
        <Link
          href={`/playbooks/profile/${encodeURIComponent(day.ownerId)}?from=playbooks`}
          className="text-xs text-slate hover:underline"
        >
          {displayNameFor({ userId: day.ownerId })}
        </Link>
        <Text as="span" variant="muted" className="text-xs">
          Added to {day.adds} trip{day.adds === 1 ? "" : "s"}
        </Text>
      </div>
    </Card>
  );
}

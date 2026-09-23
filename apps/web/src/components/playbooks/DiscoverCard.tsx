import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { AuthorKindBadge } from "./AuthorKindBadge";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/lib/formatMoney";
import { displayNameFor } from "@/lib/displayName";
import type { DiscoverDay } from "@/lib/playbooks";
import { toClockLabel, toClockRange } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PHONE_TOUCH } from "@/components/ui/button";
import { backQuery, type BackOrigin } from "./backLink";

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

/**
 * The card's rating line: `4.6 · 12 reviews`, or null for a day nobody has
 * reviewed.
 *
 * Keyed on `reviewCount`, not on `rating` being non-null, because the count is
 * the claim a reader checks: an average with nothing behind it would print as
 * `0.0` — the lowest score there is, for a day nobody has judged at all.
 */
export function ratingLine(day: Pick<DiscoverDay, "rating" | "reviewCount">): string | null {
  if (day.reviewCount === 0 || day.rating === null) return null;
  return `${day.rating.toFixed(1)} · ${day.reviewCount} review${day.reviewCount === 1 ? "" : "s"}`;
}

/**
 * `origin` is where this card is being rendered, and it rides both links out of
 * it so the page they open knows the way back. A profile renders these cards
 * too, so "the day came from Discover" is not something the card may assume.
 */
export function DiscoverCard({ day, origin }: { day: DiscoverDay; origin: BackOrigin }) {
  const line = matchLine(day);
  const rated = ratingLine(day);
  const back = backQuery(origin);
  return (
    <Card
      raised
      as="li"
      data-testid="discover-card"
      data-saved-day-id={day.savedDayId}
      className="flex flex-col gap-3 rounded-lg p-4"
    >
      {/* `dc.html:2610-2626`: the cities lead, with the card's own marks at the
          far end of the same row; then the title, with the facts line directly
          under it. The title used to lead and the chips sat below the badges,
          which put the thing a reader scans a grid for — where — mid-card.

          Filled = matched, outlined = the rest. The distinction is the whole
          point of "a day matches on ANY city it contains": the card has to show
          that the Kyoto you asked for is one of three cities this day covers,
          or the extra cities look like a mistake rather than the offer. */}
      <div className="flex flex-wrap items-start gap-2">
        <ul className="flex flex-wrap gap-1.5" data-testid="city-chips">
          {day.cities.map((city) => {
            const matched = day.matchedCities.includes(city);
            return (
              <li
                key={city}
                data-city={city}
                data-matched={matched}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-2xs font-semibold tracking-wide uppercase",
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
        <span className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
          {day.isMine && <Badge variant="brand">Yours</Badge>}
          {day.visibility === "private" && <Badge variant="neutral">Private</Badge>}
          <AuthorKindBadge authorKind={day.authorKind} />
        </span>
      </div>

      {line !== null && (
        <Text variant="secondary" data-testid="match-line">
          {line}
        </Text>
      )}

      <div>
        <Heading level={4} className="leading-snug">
          {/* §13.1's phone floor on the card's ROW ACTION — this title link is
              the only way into the day, so it is the target (M26 link 14's
              sweep, found by the census in the full e2e lane where seeded
              Playbooks render and an isolated run had none). `inline-flex
              items-center` so the floor makes the link taller rather than
              leaving the text at the top of an empty 44px. */}
          <Link
            href={`/playbooks/day/${day.savedDayId}${back}`}
            className={cn("inline-flex items-center hover:underline", PHONE_TOUCH)}
          >
            {day.name}
          </Link>
        </Heading>
        <DataText size="xs" className="mt-1 block">
          {/* **The day count leads** (M23 link 4's gate box). It is the number
              that changes whether somebody opens this at all, and it is the
              number "Add to trip" is about to act on — the rule being that a
              surface states the count it is acting on BEFORE it acts.
              Suppressed at one day, which is still the ordinary case: "1 day ·
              4 stops" on every card would be noise that teaches a reader to
              stop reading the line. */}
          {day.dayCount > 1 && `${day.dayCount} days · `}
          {day.stopCount} stop{day.stopCount === 1 ? "" : "s"}
          {/* Null above one day, and that is `savedDayFacts` refusing to state
              a clock range across three midnights as if it were one day's
              (ADR-048 decision 4) — so nothing renders here rather than
              something false. */}
          {day.window !== null && ` · ${toClockRange(day.window.start, day.window.end)}`}
          {/* No trailing "each": this is the day's TOTAL. The card read
              "$27.00 each" for a number `savedDayFacts` produces by adding up
              stop costs and dividing by nothing — Mitchell, 2026-09-01: *"why
              are we calculating per person in a notebook? just show total cost
              there, any per person logic and math should go into the future
              milestone around cost."* A real per-head figure needs a person
              count that does not exist yet; that is M19's
              (`docs/milestones/M19-cost-model.md`), not this line's. */}
          {day.totalCost !== null &&
            ` · ${formatMoney(day.totalCost.amountMinor, day.totalCost.currency)}`}
        </DataText>
      </div>

      {/* `dc.html:2630-2642`: the rating sits between the facts line and the
          stop preview, and an unrated day says so in words rather than drawing
          empty stars or a zero. One star glyph and the number, not the
          artboard's five partially-filled stars — the number is the claim, and
          five glyphs restate it at a precision nobody reads off a card. */}
      <Text as="span" variant="muted" className="text-xs" data-testid="card-rating">
        {rated === null ? (
          "No reviews yet"
        ) : (
          <>
            <span aria-hidden className="text-warning">
              ★
            </span>{" "}
            <span className="font-semibold text-ink">{rated}</span>
          </>
        )}
      </Text>

      {/* `dc.html:2644-2651`: day one's first stops, time then title — the
          same rows on a multi-day Playbook, which says "3 days" on the line
          above instead (M27 link 10). The time column is the shared-day
          list's 62px, so a card and the page it opens line up. */}
      {day.preview.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-testid="discover-preview">
          {day.preview.map((stop, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <DataText size="xs" className="w-15.5 shrink-0 pt-0.5 text-2xs" data-testid="preview-time">
                {stop.start !== null ? toClockLabel(stop.start) : ""}
              </DataText>
              <span className="text-ink" data-testid="preview-title">
                {stop.title}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        {/* The M17 seam, and the only place this card names a person. */}
        <Link
          href={`/playbooks/profile/${encodeURIComponent(day.ownerId)}${back}`}
          className={cn("inline-flex items-center text-xs text-slate hover:underline", PHONE_TOUCH)}
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

import Link from "next/link";
import { useId } from "react";
import { StopTagChips } from "@/components/board/StopTagChips";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CoverCredit } from "@/components/cover/CoverCredit";
import { CoverImage } from "@/components/cover/CoverImage";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { formatMoney } from "@/lib/formatMoney";
import type { DiscoverDay } from "@/lib/playbooks";
import { toClockLabel, toClockRange } from "@/lib/time";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { cn } from "@/lib/cn";
import { PHONE_TOUCH } from "@/components/ui/button";
import { cityPath, dayPath, namedTagPath } from "@/lib/playbookUrls";
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

/** At most this many city chips on a card; the rest become one "+N more". */
export const MAX_CITY_CHIPS = 3;
/** On a compact card, a one-column cell of the landing's sea: as many as one row holds beside the count. */
export const COMPACT_CITY_CHIPS = 2;

/**
 * **Which cities a card draws as chips, and how many it only counts**
 * (Mitchell, PR #269 preview: "Have a max amount of 3 of these for a trip, if
 * more then 3 make a 4th thats just a number").
 *
 * A long multi-city Playbook wrapped its chips across two or three lines and
 * pushed the title down the card. Three chips, then one that says how many
 * more. The matched cities go first, so the city a search asked for is never
 * the one folded into the count — a matched chip is the card's answer to the
 * search. Otherwise the day's own order is kept.
 */
export function cityChips(
  day: Pick<DiscoverDay, "cities" | "matchedCities">,
  max = MAX_CITY_CHIPS,
): { shown: string[]; hidden: string[] } {
  const matched = day.cities.filter((city) => day.matchedCities.includes(city));
  const rest = day.cities.filter((city) => !day.matchedCities.includes(city));
  const ordered = [...matched, ...rest];
  return { shown: ordered.slice(0, max), hidden: ordered.slice(max) };
}

/** How much of the grid a card takes: two columns, or one. */
export type CardSize = "wide" | "standard";

/**
 * **The size of the card at `index` on a Discover page** (M50 part 6): wide
 * for the first and every fifth after it. Five is the one rhythm that leaves
 * no hole in either grid: on three columns a wide card and one beside it, then
 * a row of three; on two, a wide row, then two pairs.
 */
export function editorialSize(index: number): CardSize {
  return index % 5 === 0 ? "wide" : "standard";
}

/**
 * **A card on the front door's sea** (M51). Its one link is `href`, the day's
 * canonical page, with no query and no prefetch: ADR-063's cache serves a
 * signed-out day page only to a query-less URL, and a sea prefetching every
 * card would read the library once per card. `null` is a day this deployment
 * does not hold, which opens nothing (decision 10). The chips and the author
 * are words, not links, so a cell is one door and one tab stop; a
 * `background` cell is no tab stop and hidden from assistive tech, so the
 * keyboard and a screen reader reach the moments without walking the whole
 * library. The mouse still opens it.
 */
export type SeaOrigin = { from: "sea"; href: string | null; background?: boolean };

/**
 * `origin` is where this card is being rendered, and it rides both links out of
 * it so the page they open knows the way back. A profile renders these cards
 * too, so "the day came from Discover" is not something the card may assume.
 */
export function DiscoverCard({
  day,
  origin,
  size = "standard",
  headingLevel = 2,
  compact = false,
  className,
}: {
  /** Without the dates, which the card never draws and the landing's snapshot leaves out. */
  day: Omit<DiscoverDay, "createdAt" | "publishedAt" | "sourceTripName">;
  origin: BackOrigin | SeaOrigin;
  size?: CardSize;
  /** 3 under a page that heads its list of cards, as Discover's results are. */
  headingLevel?: 2 | 3;
  /**
   * A one-column cell of the landing's sea (Mitchell's walk of PR 510): two
   * city chips and the count, so the row they share does not wrap.
   */
  compact?: boolean;
  className?: string;
}) {
  const wide = size === "wide";
  const clock = useTimeFormat();
  const descriptionId = useId();
  const line = matchLine(day);
  const rated = ratingLine(day);
  const sea = origin.from === "sea" ? origin : null;
  const back = origin.from === "sea" ? "" : backQuery(origin);
  const chips = cityChips(day, compact ? COMPACT_CITY_CHIPS : MAX_CITY_CHIPS);
  const { cover } = day;
  // `dc.html:2610-2626`: the cities lead, with the card's own marks at the far
  // end of the same row; then the title, with the facts line directly under
  // it. The title used to lead and the chips sat below the badges, which put
  // the thing a reader scans a grid for — where — mid-card.
  //
  // Filled = matched, outlined = the rest. The distinction is the whole point
  // of "a day matches on ANY city it contains": the card has to show that the
  // Kyoto you asked for is one of three cities this day covers, or the extra
  // cities look like a mistake rather than the offer.
  const chipRow = (
    <div className="flex flex-wrap items-start gap-2">
      {/* On the sea a card is the size of its cell, so its chips keep to the
          one row there is room for; anywhere else they wrap. */}
      <ul
        className={cn("flex flex-wrap gap-x-1.5", sea === null ? "gap-y-6 md:gap-y-1.5" : "landing-one-row")}
        data-testid="city-chips"
      >
        {chips.shown.map((city) => {
          const matched = day.matchedCities.includes(city);
          const href = cityPath(city);
          const chip = (
            <span
              data-city={city}
              data-matched={matched}
              className={cn(
                "relative rounded-full px-2.5 py-0.5 text-2xs font-semibold tracking-wide uppercase group-hover/chip:underline",
                matched
                  ? "bg-brand-tint text-brand-pressed"
                  : "border border-hairline bg-surface text-slate",
                // On the sea a name longer than its cell is wide keeps to one
                // line and ends in an ellipsis, rather than wrapping inside
                // the chip under its one-row clamp.
                sea !== null && "truncate",
              )}
            >
              {city}
            </span>
          );
          // The chip opens its city's page (SEO pass, D6); a city whose name
          // has no slug has no page and stays a label. A 44px target and a
          // 20px chip on a phone, as `StopTagChips` draws its tags
          // (KI-2026-09-24-m): the link is the hit area, `-my-3` hands back
          // the 24px `min-h-11` adds, and `md:` releases it. A named group,
          // because the hover belongs to the chip, not to the card.
          return (
            <li key={city} className={cn("flex", sea !== null && "min-w-0 max-w-full")}>
              {href === null || sea !== null ? (
                chip
              ) : (
                <Link
                  href={href}
                  className="group/chip inline-flex min-h-11 -my-3 items-center fine:my-0 fine:min-h-0"
                >
                  {chip}
                </Link>
              )}
            </li>
          );
        })}
        {chips.hidden.length > 0 && (
          <li
            title={chips.hidden.join(", ")}
            data-testid="city-chips-more"
            className="rounded-full border border-hairline bg-surface px-2.5 py-0.5 text-2xs font-semibold tracking-wide text-slate uppercase"
          >
            +{chips.hidden.length} more
          </li>
        )}
      </ul>
      <span className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
        {day.isMine && <Badge variant="brand">Yours</Badge>}
        {day.visibility === "private" && <Badge variant="neutral">Private</Badge>}
      </span>
    </div>
  );
  // **One level under what heads the list, styled as the h4 it used to be.**
  // A place's playbooks and a profile put these cards straight under their
  // h1, so an h4 skipped two levels and axe failed `/playbooks` on
  // heading-order; Discover heads its results with an h2 (M50 part 6) and
  // passes 3. The level is structure; `text-md font-medium` keeps the card
  // title the size it was, and a wide card's takes the card-title step up
  // from `sm`, where it is wide. On the sea, three lines and an ellipsis at a
  // word, so a long title never runs off a cell's foot.
  const title = (
    <Heading
      level={headingLevel}
      className={cn("text-md font-medium leading-snug", wide && "sm:text-lg", sea !== null && "line-clamp-3")}
    >
      {/* §13.1's phone floor on the card's ROW ACTION — this title link is
          the only way into the day, so it is the target (M26 link 14's
          sweep, found by the census in the full e2e lane where seeded
          Playbooks render and an isolated run had none). `inline-flex
          items-center` so the floor makes the link taller rather than
          leaving the text at the top of an empty 44px. */}
      {sea?.href === null ? (
        day.name
      ) : (
        <Link
          href={sea === null ? `${dayPath(day)}${back}` : sea.href}
          prefetch={sea === null ? undefined : false}
          tabIndex={sea?.background ? -1 : undefined}
          // Inline on the sea, where the heading clamps its lines: an
          // inline-flex box is one atom, which no clamp can break. The sea
          // is desktop-only, so it needs no phone floor.
          className={cn("hover:underline", sea === null ? cn("inline-flex items-center", PHONE_TOUCH) : "landing-sea-door")}
          // On the link, where focus lands, so the kind of day is heard with its name.
          aria-describedby={day.description === null ? undefined : descriptionId}
        >
          {day.name}
        </Link>
      )}
    </Heading>
  );
  // On the sea the title and the chips share one part of the card, which
  // `.landing-sea-head` lays bottom-up with the title first: a card too short
  // for both drops the chips and keeps the title (PR 510 r4). The chips still
  // draw above it. With a cover the chips stand on the photo, as elsewhere.
  const seaHead = sea !== null && cover === null;
  const body = (
    <>
      {line !== null && (
        <Text variant="secondary" data-testid="match-line">
          {line}
        </Text>
      )}

      {/* On the sea the title, its facts and the tags are each a part of the
          card's wrapping column, so a small cell keeps the title and drops
          the facts rather than losing both. */}
      <div className={cn(sea !== null && "contents")}>
        {!seaHead && title}
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
          {day.window !== null && ` · ${toClockRange(day.window.start, day.window.end, clock)}`}
          {/* "each", as the design draws it: a saved stop's price is per
              person and a saved day carries no people, so the sum
              `savedDayFacts` produces is what the day costs one person
              (ADR-060 decision 7). The word came off on 2026-09-01, when
              nothing yet said what a price meant, and M19 settled that. */}
          {day.totalCost !== null &&
            ` · ${formatMoney(day.totalCost.amountMinor, day.totalCost.currency)} each`}
        </DataText>
        {/* The photo's credit, under the facts it heads (Unsplash's
            guidelines: wherever the photo is). */}
        {cover !== null && <CoverCredit photo={cover} className="mt-1.5" />}
      </div>

      {/* What kind of day it is, and the tags that say so (M42 D9), both
          worked out by the server from the stops. Each chip is the way to its
          tag's page (M42 D10). */}
      {(day.description !== null || day.tags.length > 0) && (
        <div className={cn("flex flex-col gap-1.5", sea !== null && "contents")}>
          {day.description !== null && (
            <Text variant="secondary" id={descriptionId}>
              {day.description}
            </Text>
          )}
          {sea === null ? (
            <StopTagChips activityId={day.savedDayId} tags={day.tags} focusedTag={null} hrefOf={namedTagPath(day.namedTags)} />
          ) : (
            <div className="landing-one-row flex">
              <StopTagChips activityId={day.savedDayId} tags={day.tags} focusedTag={null} />
            </div>
          )}
        </div>
      )}

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
                {stop.start !== null ? toClockLabel(stop.start, clock) : ""}
              </DataText>
              <span className="text-ink" data-testid="preview-title">
                {stop.title}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        {/* The only place this card names a person, and the name is the
            server's (`publicNameFor`, Mitchell 2026-10-02) — never derived
            from `ownerId` here. */}
        {sea === null ? (
          <Link
            href={`/playbooks/profile/${encodeURIComponent(day.ownerId)}${back}`}
            className={cn("inline-flex items-center text-xs text-slate hover:underline", PHONE_TOUCH)}
          >
            {day.ownerDisplayName}
          </Link>
        ) : (
          <Text as="span" className="text-xs text-slate">
            {day.ownerDisplayName}
          </Text>
        )}
        <Text as="span" variant="muted" className="text-xs">
          Added to {day.adds} trip{day.adds === 1 ? "" : "s"}
        </Text>
      </div>
    </>
  );
  return (
    <Card
      raised
      // On the sea a card is its cell's content, not an item of a list.
      as={sea === null ? "li" : "div"}
      data-testid="discover-card"
      aria-hidden={sea?.background || undefined}
      data-saved-day-id={day.savedDayId}
      data-size={size}
      className={cn(
        "flex flex-col rounded-lg",
        wide && "sm:col-span-2",
        cover === null ? "gap-3 p-4" : "overflow-hidden p-0",
        sea !== null && "landing-sea-card relative",
        className,
      )}
    >
      {cover === null ? (
        <>
          {seaHead ? (
            <div className="landing-sea-head">
              {title}
              {chipRow}
            </div>
          ) : (
            chipRow
          )}
          {body}
        </>
      ) : (
        // **With a cover the photo leads** (M37 part 5, the approved
        // `DiscoverCards` artboard): 150px, fading into the card's surface,
        // with the city chips standing on the fade where they led before.
        // Lazy: a grid of thirty is mostly below the fold.
        //
        // 150px is a floor, not a height. On a phone each chip row costs 44px
        // (a 20px chip, `gap-y-6` keeping the 44px hit areas apart), so three
        // long names and "+N more" wrap to four rows and need 176px; an
        // overlay pinned to the foot of a fixed 150px box grew up past its
        // top and the photo clipped the first chip (PR #354 review, measured
        // by `m37-playbook-cover.spec.ts`). The row sits in flow at the foot
        // instead, and only a card that needs the room gets a taller photo —
        // the veil is in percentages, so the chips stay on the fade.
        <>
          <CoverImage
            photo={cover}
            veil="strip"
            sizes={
              wide
                ? "(min-width: 1024px) 740px, 100vw"
                : "(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
            }
            className={cn("flex min-h-37.5 shrink-0 flex-col justify-end", wide && "sm:min-h-56")}
          >
            {/* `py-3`: a chip's phone hit area reaches 12px past it either
                way (`-my-3` on `min-h-11`), and the photo clips what passes
                its edge. `relative` paints it over the photo and veil. */}
            <div className="relative px-4 py-3">{chipRow}</div>
          </CoverImage>
          <div className="flex flex-1 flex-col gap-3 px-4 pt-2 pb-4">{body}</div>
        </>
      )}
    </Card>
  );
}

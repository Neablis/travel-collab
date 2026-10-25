import { describeByTags, describedTags } from "@tc/domain";
import { TripCover, type ActivityTagDescribed } from "@tc/contracts";
import { DISCOVER_PREVIEW_STOPS, type DiscoverDay } from "@/lib/playbooks";
import { savedDayFacts } from "@/lib/savedDayFacts";
import { publicNameFor } from "@/lib/displayName";
import { parseSavedDayColumns } from "./savedDayRow";

// A stored library row becomes a Discover card: the read boundary
// `playbooks.ts`' queries share, out of that file so it can be used without
// opening a database. `scripts/landing-demo.ts` makes the landing's Playbooks
// card (M42 part 9) from a bundled playbook through it, so the landing draws
// exactly the card Discover would, and the landing's verify step runs it with
// no database to reach (`strip-only-entry-points.test.mjs`).

/** A `saved_days` row as the library's raw-SQL reads select it (`playbooks.ts`). */
export type DiscoverRow = {
  id: string;
  /** `count(*) over ()` — present on `discoverDays`' read only. */
  total_count?: number;
  owner_id: string;
  name: string;
  stops: unknown;
  cities: string[];
  visibility: string;
  author_kind: string;
  day_count: number;
  adds: number;
  rating: number | null;
  review_count: number;
  source_trip_name: string;
  created_at: unknown;
  published_at: unknown;
  /** `SAVED_DAY_COVER_JSON`: the jsonb `TripCover`, or null for none. */
  cover: unknown;
  matched_count: number;
} & OwnerNames;

/** The owner's two name columns, as `ownerNames` selects them. Never the email. */
export type OwnerNames = { owner_display_name: string | null; owner_name: string | null };

/**
 * A timestamp column, as an ISO-8601 string.
 *
 * `db.execute` hands back whatever the DRIVER produced — unlike a Drizzle
 * `select()`, which applies the schema's `mode: "date"` and yields a `Date`.
 * The type parameter on `db.execute` is an assertion, not a check (the same
 * hole `cities.ts` names one column smaller), and the two shapes are not
 * interchangeable: `row.created_at.toISOString()` throws on a string. Both are
 * accepted here rather than one being assumed.
 */
export function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * A stored row becomes a Discover card, or it becomes nothing.
 *
 * The same read boundary `savedDays.ts`'s `fromRow` draws, for the same reason
 * (KI-71): `stops` is `jsonb` with a compile-time `$type` cast that says what
 * the write path intends and nothing about what the bytes are. A row this
 * server can no longer read is dropped and logged, never allowed to fail the
 * whole page — one unreadable fragment must not take the other twenty-three
 * with it.
 */
export function toDiscoverDay(
  row: DiscoverRow,
  queryCities: string[],
  readerId: string | null,
  /**
   * The tags with a global tag page, from the published lattice
   * (`playbooks.ts`'s `globalPageTags`, read once per list call, never per
   * card). Empty when the caller has no lattice — the landing's snapshot
   * days, and the public API's page — so their chips stay text.
   */
  pageTags: readonly ActivityTagDescribed[] = [],
): DiscoverDay | null {
  // **The same helper `savedDays.ts`'s `fromRow` calls** (F-F05, and ADR-048
  // makes it a prerequisite of M23). This was a hand-copied duplicate of that
  // function's parses, with identical log strings, until the sequence work gave
  // the boundary three more behaviours to get identical — a `dayIndex` sort, a
  // `dayCount` floor, and the logging for both. A row that reads as a three-day
  // sequence in its owner's library and a two-day one on its Discover card is
  // worse than either answer.
  const parsed = parseSavedDayColumns({
    savedDayId: row.id,
    stops: row.stops,
    visibility: row.visibility,
    authorKind: row.author_kind,
    dayCount: row.day_count,
  });
  if (parsed === null) return null;
  const facts = savedDayFacts(parsed.stops, parsed.dayCount);
  const described = describeByTags(parsed.stops);
  const tags = describedTags(parsed.stops);
  // A chip links only to a page that exists: the day's tags that are in the
  // published lattice's global pages. A tag with no page (today Lodging,
  // Ticketed, Sports) stays text, so no chip leads to a 404 — and a tag the
  // description does not name still links when its page exists, so a day of
  // meals with one bar links its Drinks chip. Public days only, as
  // `namedTags`: a private day's chips stay text.
  // Read as strings: `tags` are `ActivityTag` and the set holds described
  // ones, so a typed set would refuse the membership test.
  const pageTagSet: ReadonlySet<string> = new Set(pageTags);
  const linkedTags =
    parsed.visibility === "public"
      ? tags.filter((tag): tag is ActivityTagDescribed => pageTagSet.has(tag))
      : [];
  const wanted = new Set(queryCities);
  return {
    savedDayId: row.id,
    ownerId: row.owner_id,
    ownerDisplayName: publicNameFor({
      userId: row.owner_id,
      displayName: row.owner_display_name,
      name: row.owner_name,
    }),
    name: row.name,
    cities: row.cities,
    // Derived from the day's OWN cities rather than echoed back from the query
    // string, so a card's chips are always spelled the way the day spells them.
    //
    // Exact, not case-folded, and deliberately the same comparison the SQL
    // does: containment (`cities && ARRAY[...]`) is what the GIN index serves
    // and it is exact, so a case-folded `matchedCities` would claim a match the
    // row filter did not make. Every city the UI sends came from
    // `GET /api/cities`, which returns the stored spelling — the two ends agree
    // because the names travel from the index, not from a keyboard.
    matchedCities: row.cities.filter((c) => wanted.has(c)),
    stopCount: facts.stopCount,
    // What the card states before a reader decides to open it (M23 link 4's
    // gate box). A sequence that does not say how many days it is is the same
    // surprise "add to trip" would spring later.
    dayCount: parsed.dayCount,
    window: facts.window,
    // Day one's first stops, in stored order — `dayIndex` 0 exactly, so a
    // Playbook whose first day was kept as a rest day previews nothing rather
    // than passing day two off as day one (a gap is an empty day, ADR-048).
    preview: parsed.stops
      .filter((stop) => stop.dayIndex === 0)
      .slice(0, DISCOVER_PREVIEW_STOPS)
      .map((stop) => ({ title: stop.title, start: stop.timeWindow?.start ?? null })),
    totalCost: facts.totalCost,
    adds: row.adds,
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: Number(row.review_count),
    visibility: parsed.visibility,
    // Falls back rather than dropping the card, for the reason `fromRow` in
    // `savedDays.ts` gives at length: this decides a label, not what the reader
    // is allowed to see, and only "ai" is ever rendered — so an unreadable
    // value says nothing about the author, which is the truth.
    authorKind: parsed.authorKind,
    sourceTripName: row.source_trip_name,
    // `createdAt` is `notNull` in the schema, so a null here means the row
    // shape is not what this query selected — not a day without a date.
    createdAt: isoOf(row.created_at) ?? new Date(0).toISOString(),
    publishedAt: isoOf(row.published_at),
    isMine: row.owner_id === readerId,
    cover: coverOfRow(row),
    description: described?.text ?? null,
    tags,
    // Tag pages list published days only, so a private day's chip would lead
    // to a page without it, or to a 404.
    namedTags: parsed.visibility === "public" ? [...(described?.named ?? [])] : [],
    linkedTags,
  };
}

/**
 * The card's cover, or null. A cover that no longer parses costs the card its
 * photo, never the card — `toDiscoverDay`'s rule for the rest of the row.
 */
function coverOfRow(row: Pick<DiscoverRow, "id" | "cover">): TripCover | null {
  if (row.cover === null || row.cover === undefined) return null;
  const parsed = TripCover.safeParse(row.cover);
  if (parsed.success) return parsed.data;
  console.error("saved_day_covers row failed TripCover parse; card shown without it", {
    savedDayId: row.id,
    issues: parsed.error.issues,
  });
  return null;
}

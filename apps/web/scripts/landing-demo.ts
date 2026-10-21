// Writes one snapshot per demo trip — the slice of `/demo/<slug>` the front
// door draws with real components — and the `/demo` picker's cards, or, with
// `--check`, fails if any committed file differs from a fresh generation.
// Japan's slice is `src/lib/landingDemo.generated.json`, the one the hero reads
// today; every other demo's is `src/lib/landingDemo.<slug>.generated.json`
// (M42 D2); the cards are `src/lib/demoTripCards.generated.json` (D1); the
// landing's Playbooks card and Notebook page are
// `src/lib/landingFeatures.generated.json` (M42 part 9); the sea of every
// public library day is `src/lib/landingSea.generated.json` (M51).
//
//   pnpm --filter web landing:generate   # rewrite the snapshots
//   pnpm landing:verify                  # the drift check CI runs (also inside `pnpm test`)
//
// **Why a script and not an import.** The landing may not fetch (SPEC §14), and
// it and the picker sit behind the lint wall, so neither can reach
// `@/server/demoTrip` or `@tc/domain`. Scripts are outside the wall, as `db-seed.ts` is. This one
// reimplements nothing: the trip is `demoTripDetailFor`, the fold `/demo/<slug>`
// serves; cities are `buildTripGlobals`; colours are `cityAccents`; the
// notebook payloads are `@tc/pages`' own resolvers through `renderMacro`.
//
// **Dates are removed before anything is resolved** (spec §3.2). `/demo` moves
// its dates to stay upcoming, so any date frozen here would go stale. Every
// resolver already has an undated form ("Day 5 · Tokyo · 5 stops"), so
// resolving against the undated trip is the whole of it. The fold still needs
// a start date, and it gets a fixed one so the output is reproducible.
//
// **So are prices** (M42 part 9). The front door sells the day, not what it
// cost — Mitchell, 2026-10-11: *"nostalgic, not pricing"* — and a stop's
// price reaches the river's accessible names and the notebook's day card as
// text. Every stop is resolved with no cost, which is the form a stop nobody
// priced already has.
//
// Run with `node --import ./scripts/lib/ts-resolve-register.mjs`, which lets
// Node follow `src/**`'s extensionless imports and the `@/` alias.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DISCOVER_PREVIEW_STOPS, type DiscoverDay } from "@/lib/playbooks";
import {
  SavedStop,
  TripCover,
  travellerIds,
  type AvatarKey,
  type ActivityTagDescribed,
  type PageParagraphNode,
  type PersonColor,
  type TripCommand,
  type TripDetail,
  type TripMemberProfile,
} from "@tc/contracts";
import { decideCreateTrip, decideTripCommand, describeByTags, evolveTripEnvelope, tripDetailFromState, type TripState } from "@tc/domain";
import { z } from "zod";
import {
  bundleTripCommandGroups,
  JAPAN_SAVED_DAYS,
  JAPAN_SOURCE_TRIP,
  parseBundle,
  REFERENCE_START_DATE,
  resolvePlaybook,
  type ContentBundleV1,
  type ResolvedPlaybook,
} from "@tc/fixtures";
import { getMacro, renderMacro, type BlockPayload, type Seg, type WidgetContext } from "@tc/pages";
import { cityAccents } from "@/components/pages/cityAccents";
import { TAG_LABEL } from "@/lib/activityTags";
import { dayLabel } from "@/lib/dates";
import { DEMO_TRIPS, demoTripBySlug } from "@/lib/demoTrip";
import { displayNameFor } from "@/lib/displayName";
import type { LandingCrew, LandingDemo, LandingFeatures } from "@/lib/landingDemo";
import type { LandingSea, SeaAccent, SeaCell, SeaCellSize, SeaDay, SeaDayCell } from "@/lib/landingSea";
import { countryName } from "@/lib/place";
import { cityPath, countrySlug, dayPath, placeIndexable, placePath, tagPath } from "@/lib/playbookUrls";
import { overlayMembers } from "@/server/access/overlay";
import { withTripColors } from "@/server/access/personaColors";
import { serverConflictContext } from "@/server/conflictContext";
import { demoTripCards, demoTripDetailFor, demoTripMembers } from "@/server/demoTrip";
import { toDiscoverDay, type DiscoverRow } from "@/server/discoverDay";
import { savedDayCities } from "@/server/savedDayCities";
import { savedDayCountries } from "@/server/savedDayCountries";
import { buildTripGlobals } from "@/server/tripGlobals";

/** Where demo `slug`'s snapshot is committed. Japan's keeps the name it had before there were others. */
export function snapshotPath(slug: string): string {
  const file = slug === "japan" ? "landingDemo.generated.json" : `landingDemo.${slug}.generated.json`;
  return fileURLToPath(new URL(`../src/lib/${file}`, import.meta.url));
}

/**
 * Japan's days, chosen by hand. The Timeline panel's is fixture Day 7, the
 * arrival in Kyoto: the hero's pill for that panel already reads "Day 7", and
 * the day carries every way a block can look on the river — a train leg,
 * planned stops, a check-in and a dinner still marked Maybe. The Notebook
 * panel's day card is fixture Day 5, which its pill already names.
 */
const JAPAN_DAYS = { river: 6, notebook: 4 };

/**
 * Any other demo's days, by a rule so a new bundle needs no entry here: the
 * river is the fullest day after the first that has a city and no conflict
 * (the first is usually an arrival), and the notebook card is the earliest
 * other such day.
 */
function chooseDays(trip: TripDetail, globals: ReturnType<typeof buildTripGlobals>): { river: number; notebook: number } {
  const usable = trip.days
    .map((day, index) => ({ index, stops: day.activityIds.length }))
    .filter(({ index }) => index > 0 && globals.days[index]!.cities.length > 0 && conflictsOn(trip, index).length === 0);
  const river = usable.reduce<(typeof usable)[number] | undefined>((best, day) => (best === undefined || day.stops > best.stops ? day : best), undefined);
  const notebook = usable.find(({ index }) => index !== river?.index);
  if (river === undefined || notebook === undefined) throw new Error(`landing demo: ${trip.name} has no two days the hero can draw`);
  return { river: river.index, notebook: notebook.index };
}

function conflictsOn(trip: TripDetail, dayIndex: number) {
  const day = trip.days[dayIndex]!;
  return trip.conflicts.filter((c) => c.subjects.some((id) => day.activityIds.includes(id)));
}

function resolveBlock<K extends BlockPayload["kind"]>(
  ctx: WidgetContext,
  name: string,
  params: unknown,
  kind: K,
): Extract<BlockPayload, { kind: K }> {
  const outcome = renderMacro(ctx, name, params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== kind) {
    throw new Error(`landing demo: ${name} did not resolve to a ${kind} block (${JSON.stringify(outcome)})`);
  }
  return outcome.rendered.block as Extract<BlockPayload, { kind: K }>;
}

/** Demo `slug` as `/demo/<slug>` folds it, with its dates and prices removed, and the context a widget resolves in. */
function undatedDemo(slug: string) {
  const demo = demoTripBySlug(slug);
  if (demo === undefined) throw new Error(`landing demo: ${slug} is not a demo`);
  const folded = demoTripDetailFor(demo.tripId, REFERENCE_START_DATE);
  const trip: TripDetail = {
    ...folded,
    days: folded.days.map((day) => ({ ...day, date: null })),
    activities: Object.fromEntries(Object.entries(folded.activities).map(([id, activity]) => [id, { ...activity, cost: null }])),
  };
  const globals = buildTripGlobals(trip);
  const ctx: WidgetContext = { trip, page: { tripId: demo.tripId }, user: null, globals, today: null, personas: demoPersonasOf(demo.tripId) };
  // The sun is arithmetic on a place and a DATE, so it alone resolves against
  // the fold's fixed dates. What it prints carries none (a clock time, a length
  // of day), so nothing in the snapshot names a day that will pass.
  const dated: WidgetContext = { ...ctx, trip: { ...trip, days: folded.days }, globals: buildTripGlobals({ ...trip, days: folded.days }) };
  return { trip, globals, ctx, dated };
}

/**
 * The demo's people as `trip.people` draws them, by the rule `personasOf`
 * (`components/pages/people.tsx`) gives the board: `displayNameFor` with no
 * email, the member's own avatar and colour, and `travellerIds` for who is
 * going. That module is a client one this script cannot load, so the rule is
 * restated here rather than imported, and `landing-demo.test.ts` holds the
 * copy to the original.
 */
export function demoPersonasOf(tripId: string): NonNullable<WidgetContext["personas"]> {
  return personasOfMembers(demoTripMembers(tripId));
}

function personasOfMembers(members: readonly TripMemberProfile[]): NonNullable<WidgetContext["personas"]> {
  const going = new Set(travellerIds(members));
  return Object.fromEntries(
    members.map((m) => [
      m.userId,
      {
        name: displayNameFor({ userId: m.userId, displayName: m.displayName, name: m.name, email: null }),
        avatar: m.avatar,
        color: m.color,
        travelling: going.has(m.userId),
      },
    ]),
  );
}

/**
 * The people the river's blocks name (M51 decision 8a), as the board's
 * `PeopleProvider` would hand them down: the widget personas above, plus the
 * clash shift the board's own carry. The landing may not fetch them.
 */
function riverPeopleOf(tripId: string): LandingDemo["river"]["people"] {
  const personas = demoPersonasOf(tripId);
  return Object.fromEntries(demoTripMembers(tripId).map((m) => [m.userId, { ...personas[m.userId]!, colorShifted: m.colorShifted }]));
}

/** Demo `slug`'s slice, folded and resolved exactly as `/demo/<slug>` and a notebook would, with no calendar dates. */
export function buildLandingDemo(slug: string): LandingDemo {
  const { trip, globals, ctx } = undatedDemo(slug);
  const accents = cityAccents(trip);
  const { river: riverIndex, notebook: notebookIndex } = slug === "japan" ? JAPAN_DAYS : chooseDays(trip, globals);

  const day = trip.days[riverIndex]!;
  // The hero draws no conflict marks. If this day ever gains one, the panel
  // would be hiding something the board shows, so stop here and make whoever
  // changed the fixture decide what the landing should say.
  const conflicted = conflictsOn(trip, riverIndex);
  if (conflicted.length > 0) {
    throw new Error(`landing demo: Day ${riverIndex + 1} has conflicts the hero does not draw: ${conflicted.map((c) => c.id).join(", ")}`);
  }
  // The city the day ends in: a travel day's cities are in time order, and the
  // panel is about where the group is for the rest of it.
  const city = globals.days[riverIndex]!.cities.at(-1);
  if (city === undefined) throw new Error(`landing demo: Day ${riverIndex + 1} names no city`);

  return {
    currency: trip.currency,
    accents: Object.fromEntries(trip.days.map((d) => [d.dayId, accents.ofDayId(d.dayId)])),
    river: {
      dayId: day.dayId,
      ordinal: riverIndex + 1,
      city,
      activityIds: day.activityIds,
      activities: Object.fromEntries(day.activityIds.map((id) => [id, trip.activities[id]!])),
      people: riverPeopleOf(ctx.page.tripId),
    },
    notebook: {
      strip: resolveBlock(ctx, "trip.strip", {}, "trip-strip"),
      day: resolveBlock(ctx, "day.detail", { day: { kind: "index", index: notebookIndex } }, "itinerary-day"),
    },
  };
}

/**
 * The Playbooks block's day: Mitchell's own published Hanoi playbook, featured
 * with his approval, read once from its public endpoint and committed trimmed
 * (`landing-day.json`: its stops without prices, its cover, its author's
 * public name). Nothing here reaches production or Unsplash; the cover is a
 * stored `TripCover`, whose images are Unsplash's CDN and cost no API call.
 */
const LANDING_DAY_PATH = new URL("./landing-day.json", import.meta.url);

const LandingDay = z.object({
  savedDayId: z.string().uuid(),
  ownerId: z.string().min(1),
  ownerDisplayName: z.string().min(1),
  name: z.string().min(1),
  dayCount: z.number().int().min(1),
  cities: z.array(z.string()),
  visibility: z.literal("public"),
  authorKind: z.string(),
  sourceTripName: z.string().min(1),
  createdAt: z.string(),
  publishedAt: z.string(),
  description: z.string(),
  cover: TripCover,
  stops: z.array(SavedStop),
});

/**
 * What the landing seeds onto the card, for the landing only (Mitchell,
 * 2026-10-11): a rating and an adds count, where the day's own are new-day
 * zeros, so the front door's example does not read "No reviews yet". Fixed
 * numbers, so the snapshot stays reproducible; nothing writes them to the
 * database, and Discover still shows the day's real numbers.
 */
const LANDING_SEED = { rating: 4.7, reviewCount: 23, adds: 12 };

/** Where the Playbooks and Notebook blocks' slice is committed. */
export const FEATURES_PATH = fileURLToPath(new URL("../src/lib/landingFeatures.generated.json", import.meta.url));

/**
 * The committed day as Discover draws it, through Discover's own
 * `toDiscoverDay`, read signed out so it is nobody's own. Its cities and
 * description are worked out again from its stops and held to what
 * production said, so a rule change that would redraw the card fails here.
 */
function landingPlaybook(): DiscoverDay {
  const day = LandingDay.parse(JSON.parse(readFileSync(LANDING_DAY_PATH, "utf8")));
  const card = landingCard(
    {
      id: day.savedDayId,
      owner_id: day.ownerId,
      owner_display_name: day.ownerDisplayName,
      owner_name: null,
      name: day.name,
      stops: day.stops,
      cities: savedDayCities(day.stops),
      visibility: day.visibility,
      author_kind: day.authorKind,
      day_count: day.dayCount,
      adds: LANDING_SEED.adds,
      rating: LANDING_SEED.rating,
      review_count: LANDING_SEED.reviewCount,
      source_trip_name: day.sourceTripName,
      created_at: day.createdAt,
      published_at: day.publishedAt,
      cover: day.cover,
      matched_count: 0,
    },
  );
  if (JSON.stringify(card.cities) !== JSON.stringify(day.cities) || card.description !== day.description) {
    throw new Error(`landing demo: ${day.name} now reads as ${card.description} in ${card.cities.join(", ")}, not as production drew it`);
  }
  return card;
}

/** A library row as the landing's cards draw it: Discover's own card, read signed out. */
function landingCard(row: DiscoverRow): DiscoverDay {
  const card = toDiscoverDay(row, [], null);
  if (card === null) throw new Error(`landing demo: ${row.name} does not read as a Discover card`);
  // No price on the landing outside its plans (Mitchell, 2026-10-11): the
  // blocks sell the day, not what it cost. And no tag that links: a
  // front-door card sends nobody into tag pages, which may not be indexed, so
  // its chips stay text, as a private day's do.
  return { ...card, totalCost: null, namedTags: [] };
}

/**
 * The find moment's banner: a day named by its key, not ranked by a rule
 * (Mitchell's fourth walk of PR 510: *"Let the rule go, i never said to make
 * it a rule, use the italy days i suggested"*): his Rome playbook. His own
 * row is in production only; this is the bundle copy of his export, whose id
 * the content import derives, so its card links to a day previews and
 * production both hold once imported. Drawn as its cell in the sea is but for
 * its rows (`SHELF_DAY`), so the two agree on its name and its rating.
 *
 * The card is a frozen copy of a row the content import owns, re-derived from
 * the bundle file only, so `landing:verify` cannot see the production row
 * change: hidden by a moderator, renamed or pruned away, or given a cover by
 * its author. Check the row on production's Discover when regenerating.
 */
const SHELF_BUNDLE = "3-days-in-rome-emperors-gladiators-the-layers-beneath";

/**
 * The day of it the banner's rows are (Mitchell, 2026-10-21: *"use day 2 for
 * the banner"*): the Pantheon to Trastevere, six stops to day one's four, so
 * the wide card is full. Discover previews day one; the banner alone says
 * another, and still links to the whole playbook, the only page it has.
 */
const SHELF_DAY = 2;

function shelfPlaybook(): DiscoverDay {
  const bundle = libraryBundles().find((b) => b.bundle.id === SHELF_BUNDLE);
  const playbook = bundle?.playbooks.find((p) => p.key === SHELF_BUNDLE);
  if (bundle === undefined || playbook === undefined) throw new Error(`landing demo: content/playbooks no longer holds ${SHELF_BUNDLE}`);
  const { stops } = resolvePlaybook(bundle.bundle.id, playbook, bundle.bundle.origin);
  const preview = stops
    .filter((stop) => stop.dayIndex === SHELF_DAY - 1)
    .slice(0, DISCOVER_PREVIEW_STOPS)
    .map((stop) => ({ title: stop.title, start: stop.timeWindow?.start ?? null }));
  if (preview.length === 0) throw new Error(`landing demo: ${SHELF_BUNDLE} has no day ${SHELF_DAY}`);
  return { ...seaCard(bundle, playbook), preview };
}

const THAILAND_BUNDLE_PATH = new URL("../../../content/playbooks/thailand-beaches.json", import.meta.url);

/** The bundle's public days as the sea's cards, each stamped with its `keptOn`, the only reproducible date the import gives a day. */
function thailandCards(): { key: string; day: DiscoverDay; resolved: ResolvedPlaybook }[] {
  const bundle = parseBundle(JSON.parse(readFileSync(THAILAND_BUNDLE_PATH, "utf8")));
  return bundle.playbooks
    .filter((playbook) => playbook.visibility === "public")
    .map((playbook) => {
      const resolved = resolvePlaybook(bundle.bundle.id, playbook, bundle.bundle.origin);
      if (resolved.keptOn === undefined) throw new Error(`landing demo: ${playbook.key} has no keptOn date to stamp it with`);
      return { key: playbook.key, day: libraryCard(resolved, sampleRating(resolved.savedDayId), resolved.keptOn), resolved };
    });
}

/**
 * The make-it-your-trip moment's worked example (Mitchell's third walk of PR
 * 510: *"it should have an example thats relevent to this feature"*): the
 * Railay day, and the Thailand demo trip as the trip a reader already has,
 * its days as "Add to a trip" lists them. Canned: the landing fetches nothing.
 */
const MAKE_KEY = "railay-limestone-and-sunset";

function makeExample(): LandingFeatures["make"] {
  const railay = thailandCards().find(({ key }) => key === MAKE_KEY);
  if (railay === undefined) throw new Error(`landing demo: thailand-beaches no longer holds ${MAKE_KEY}`);
  const demo = demoTripBySlug("thailand-andaman")!;
  const trip = demoTripDetailFor(demo.tripId, REFERENCE_START_DATE);
  return {
    day: { name: railay.resolved.name, dayCount: railay.resolved.dayCount },
    trip: { tripId: demo.tripId, name: trip.name },
    // Undated, as the landing is: a date would be a claim about a trip on a day that has passed.
    days: trip.days.map((day, index) => ({ dayId: day.dayId, label: dayLabel(null, index) })),
  };
}

/**
 * A resolved library day as Discover's card, read signed out, with the rating
 * the caller gives it. The import owns the row, so its cover is none and its
 * adds are the bundle's own ledger.
 */
function libraryCard(day: ResolvedPlaybook, rated: { rating: number; reviewCount: number } | null, stampedOn: string): DiscoverDay {
  return landingCard({
    id: day.savedDayId,
    owner_id: day.ownerId,
    owner_display_name: null,
    owner_name: null,
    name: day.name,
    stops: day.stops,
    cities: savedDayCities(day.stops),
    visibility: day.visibility,
    author_kind: day.authorKind,
    day_count: day.dayCount,
    adds: day.addedBy.length,
    rating: rated?.rating ?? null,
    review_count: rated?.reviewCount ?? 0,
    source_trip_name: day.sourceTripName,
    created_at: stampedOn,
    published_at: stampedOn,
    cover: null,
    matched_count: 0,
  });
}

// ---------------------------------------------------------------------------
// The sea (M51)
// ---------------------------------------------------------------------------

/** Every bundle the production import reads for the library. */
const PLAYBOOKS_DIR = new URL("../../../content/playbooks/", import.meta.url);

function libraryBundles(): ContentBundleV1[] {
  return readdirSync(PLAYBOOKS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => parseBundle(JSON.parse(readFileSync(new URL(file, PLAYBOOKS_DIR), "utf8"))));
}

/**
 * FNV-1a over `text`: the sea's one source of variety. A day's size, rating
 * and place come from its own id, so regenerating moves nothing, and a day
 * added to a bundle does not reshuffle the others.
 */
function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Half the cells single, most of the rest wide or square, the long thin shapes rarest. */
const SIZE_WHEEL: readonly SeaCellSize[] = [
  ...Array<SeaCellSize>(25).fill("1x1"),
  ...Array<SeaCellSize>(10).fill("2x1"),
  ...Array<SeaCellSize>(9).fill("2x2"),
  ...Array<SeaCellSize>(4).fill("1x2"),
  ...Array<SeaCellSize>(2).fill("3x1"),
];
/**
 * A column three tall for one card in sixty, chosen by count rather than by
 * a slot on the wheel, which a few dozen hashes fill unevenly (Mitchell's
 * third walk of PR 510: *"use 1x3 very sparringly, they look a bit ugly"*).
 */
const TALL_SHARE = 60;

/**
 * The sample rating a sea card shows (decision 9, Mitchell 2026-10-20: *"just
 * add the sample ratings, and we will re-address as reviews come in"*): 4.0
 * to 4.9 over 3 to 60 reviews, and one card in nine with none, as a library
 * really reads. For the landing only; nothing writes it anywhere.
 */
function sampleRating(savedDayId: string): { rating: number; reviewCount: number } | null {
  const h = hashOf(`rating:${savedDayId}`);
  if (h % 9 === 0) return null;
  return { rating: 4 + (Math.floor(h / 9) % 10) / 10, reviewCount: 3 + (Math.floor(h / 90) % 58) };
}

/**
 * A public library playbook as its sea card, with its sample rating. Its
 * `keptOn` goes in as the stamp only because the card needs one (an export
 * carries none, and takes the reference date); `seaCell` takes the dates off.
 */
function seaCard(bundle: ContentBundleV1, playbook: ContentBundleV1["playbooks"][number]): DiscoverDay {
  const day = resolvePlaybook(bundle.bundle.id, playbook, bundle.bundle.origin);
  return libraryCard(day, sampleRating(day.savedDayId), day.keptOn ?? REFERENCE_START_DATE);
}

/** The card without what `SeaDay` leaves out. */
const seaDayOf = ({ createdAt: _created, publishedAt: _published, sourceTripName: _source, ...drawn }: DiscoverDay): SeaDay => drawn;

function seaCell(day: DiscoverDay, group: string): SeaCell {
  return { day: seaDayOf(day), size: SIZE_WHEEL[hashOf(`size:${day.savedDayId}`) % SIZE_WHEEL.length]!, group };
}

/**
 * Every public library day as a sea cell, in an order shuffled by id so no
 * country runs in a block, each linked to its day page. The id derives from
 * (bundle, key), so the link holds wherever `content/` is imported: `db:reseed`
 * locally, `import-content-production.yml` in production. A preview build
 * imports no content yet, so there these links 404 until M51 part 7 seeds it.
 */
function librarySea(): SeaDayCell[] {
  const cells = libraryBundles()
    .flatMap((bundle) =>
      bundle.playbooks
        .filter((playbook) => playbook.visibility === "public")
        .map((playbook) => {
          const card = seaCard(bundle, playbook);
          return { ...seaCell(card, bundle.bundle.id), href: dayPath(card) };
        }),
    );
  const tallOrder = (cell: SeaDayCell) => hashOf(`tall:${cell.day.savedDayId}`);
  const tall = new Set(
    [...cells]
      .sort((a, b) => tallOrder(a) - tallOrder(b))
      .slice(0, Math.floor(cells.length / TALL_SHARE))
      .map((cell) => cell.day.savedDayId),
  );
  return cells
    .map((cell): SeaDayCell => (tall.has(cell.day.savedDayId) ? { ...cell, size: "1x3" } : cell))
    .sort((a, b) => hashOf(`order:${a.day.savedDayId}`) - hashOf(`order:${b.day.savedDayId}`));
}

/**
 * The cluster around the notebook (decision 10): the demo seed's public Japan
 * days, since no Japan bundle is in the library. They are seeded by
 * `api/dev/saved-days` alone, which 404s in production, so production has no
 * page for them and their cells carry no link.
 */
function japanCluster(): LandingSea["japan"] {
  return JAPAN_SAVED_DAYS.filter((day) => day.visibility === "public").map((day) => {
    const card = libraryCard(
      {
        ...day,
        dayCount: 1,
        authorKind: "human",
        sourceTripId: JAPAN_SOURCE_TRIP.id,
        sourceTripName: JAPAN_SOURCE_TRIP.name,
      },
      sampleRating(day.savedDayId),
      REFERENCE_START_DATE,
    );
    return { ...seaCell(card, "japan"), href: null };
  });
}

/** The value used most, the first in code-point order on a tie, so two builds name a page alike. */
function mostUsed(uses: ReadonlyMap<string, number>): string | undefined {
  return [...uses].sort(([a, aUses], [b, bUses]) => bUses - aUses || (a < b ? -1 : a > b ? 1 : 0))[0]?.[0];
}

/**
 * The sea's accents (Mitchell's third walk of PR 510: *"this nice accent full
 * color cards with Country - city"*): every country, city and activity-tag
 * page that the library's public days fill with `MIN_INDEXED_PLACE_DAYS` or
 * more, so each opens on days and is indexed. Counted as `publishedPlaces`
 * and `publishedTagPages` count them, from the rows the content import writes:
 * a place by its slug over the day's own cities and countries, a tag by the
 * days whose description names it (ADR-070 §4). Shuffled by path, as the days
 * are by id.
 */
function libraryAccents(): SeaAccent[] {
  const pages = new Map<
    string,
    { kind: SeaAccent["kind"]; days: Set<string>; spellings: Map<string, number>; bundles: Map<string, number>; countries: Map<string, number> }
  >();
  const count = (uses: Map<string, number>, value: string) => uses.set(value, (uses.get(value) ?? 0) + 1);
  for (const bundle of libraryBundles()) {
    for (const playbook of bundle.playbooks.filter((p) => p.visibility === "public")) {
      const day = resolvePlaybook(bundle.bundle.id, playbook, bundle.bundle.origin);
      const countries = [...new Set(savedDayCountries(day.stops))];
      const touch = (kind: SeaAccent["kind"], href: string | null, spelling: string) => {
        if (href === null) return;
        let page = pages.get(href);
        if (page === undefined) pages.set(href, (page = { kind, days: new Set(), spellings: new Map(), bundles: new Map(), countries: new Map() }));
        if (page.days.has(day.savedDayId)) return;
        page.days.add(day.savedDayId);
        count(page.spellings, spelling);
        count(page.bundles, bundle.bundle.id);
        // A city's country, from the days that stop in one country only.
        if (countries.length === 1) count(page.countries, countries[0]!);
      };
      for (const city of savedDayCities(day.stops)) touch("city", cityPath(city), city);
      for (const code of countries) {
        const slug = countrySlug(code);
        touch("country", slug === null ? null : placePath({ kind: "country", slug }), code);
      }
      for (const tag of describeByTags(day.stops)?.named ?? []) touch("tag", tagPath(tag), tag);
    }
  }
  return [...pages]
    .filter(([, page]) => placeIndexable({ days: page.days.size }))
    .map(([href, page]): SeaAccent => {
      const spelling = mostUsed(page.spellings)!;
      const country = mostUsed(page.countries);
      return {
        kind: page.kind,
        label: page.kind === "country" ? "Country" : page.kind === "tag" ? "Activity" : ((country && countryName(country)) ?? "City"),
        name: page.kind === "country" ? countryName(spelling)! : page.kind === "tag" ? TAG_LABEL[spelling as ActivityTagDescribed] : spelling,
        // Mostly single, one in four wide (the prototype stamps single cells only).
        size: hashOf(`accent:${href}`) % 4 === 0 ? "2x1" : "1x1",
        group: mostUsed(page.bundles)!,
        href,
      };
    })
    .sort((a, b) => hashOf(`order:${a.href}`) - hashOf(`order:${b.href}`));
}

/** Where the sea is committed. */
export const SEA_PATH = fileURLToPath(new URL("../src/lib/landingSea.generated.json", import.meta.url));

/** The sea: every public library day, then the accents, and the Japan cluster. */
export function buildLandingSea(): LandingSea {
  return { cells: [...librarySea(), ...libraryAccents()], japan: japanCluster() };
}

// ---------------------------------------------------------------------------
// The crew moment's trip (M51 decision 10)
// ---------------------------------------------------------------------------

/**
 * The crew who plan the Greek trip, ids as their names as `/demo`'s are
 * (`server/demoTrip.ts`, `membersOf`): four library authors, so the names are
 * people the sea already credits. Four colours, so no clash shifts one.
 */
export const CREW = ["Maeve", "Tomas", "Ruth", "Kenji"] as const;
const CREW_LOOKS: Record<(typeof CREW)[number], { avatar: AvatarKey | null; color: PersonColor }> = {
  Maeve: { avatar: "sailboat", color: "sky" },
  Tomas: { avatar: "bike", color: "ochre" },
  Ruth: { avatar: "camera", color: "rose" },
  Kenji: { avatar: null, color: "teal" },
};

/**
 * Paros to Santorini in three days, every one a Greek library day: Paros,
 * Elena's Naxos day as Day 2, and the caldera walk (Mitchell, 2026-10-20: three
 * days, Naxos as Day 2). The library has no Athens day to start from. The trip
 * is what the crew built by borrowing; Day 2 is the one the moment draws.
 */
const CREW_BUNDLE_PATH = new URL("../../../content/playbooks/greek-islands.json", import.meta.url);
const CREW_DAYS = ["paros-antiparos-cave-and-soros", "naxos-zas-marble-villages-and-plaka", "santorini-caldera-walk-and-skaros-sunset"] as const;
const CREW_RIVER_INDEX = 1;
const CREW_TRIP_NAME = "Paros to Santorini";
const CREW_TRIP_ID = "00000000-0000-4000-80c0-000000000000";

/** What somebody books ahead: a table, a ticket or a tour, never a drive or a spring. */
const BOOKED_TAGS: ReadonlySet<string> = new Set(["meal", "ticketed", "tour"]);

/**
 * Who booked a stop and who is on it, so the crew's names reach the river. A
 * pending stop is not booked yet, and neither is a transit leg or anything
 * nobody books; the crew take turns booking the rest down the day, `bookings`
 * being how many they have booked so far. Every third stop leaves one of them
 * out, so a stop with fewer than all four is something the river shows too.
 */
function crewOnStop(command: Extract<TripCommand, { type: "AddActivity" }>, turn: number, bookings: number): TripCommand {
  const booked = command.kind !== "transit" && (command.tags ?? []).some((tag) => BOOKED_TAGS.has(tag));
  const participants = turn % 3 === 2 ? CREW.filter((_, i) => i !== (turn + 1) % CREW.length) : [];
  return { ...command, bookedBy: booked ? CREW[bookings % CREW.length]! : null, participants };
}

/** The crew's trip folded by the real decider, as `/demo` folds its trips, undated and unpriced. */
function crewTrip(): { trip: TripDetail; members: TripMemberProfile[]; borrowed: ResolvedPlaybook } {
  const bundle = parseBundle(JSON.parse(readFileSync(CREW_BUNDLE_PATH, "utf8")));
  const playbooks = CREW_DAYS.map((key) => {
    const found = bundle.playbooks.find((p) => p.key === key);
    if (found === undefined) throw new Error(`landing demo: ${bundle.bundle.id} no longer holds ${key}`);
    return found;
  });
  let n = 0;
  const groups = bundleTripCommandGroups(
    bundle.bundle.id,
    {
      key: "paros-to-santorini",
      name: CREW_TRIP_NAME,
      // No price: the front door sells the day (Mitchell, 2026-10-11).
      days: playbooks.map((p) => ({ stops: (p.stops ?? p.days!.flatMap((d) => d.stops)).map(({ cost: _cost, ...stop }) => stop) })),
      backlog: [],
    },
    { tripId: CREW_TRIP_ID, today: REFERENCE_START_DATE, mintId: () => `00000000-0000-4000-80c0-${String(++n).padStart(12, "0")}` },
  );
  // Maeve owns the trip; the crew take turns adding its stops, so each stop
  // names one of them. Folded with the envelope's actor, as `/demo` folds
  // (`server/demoTrip.ts`), because only that fold writes a stop's `addedBy`.
  const owner = { actorId: CREW[0] as string };
  const genesis = decideCreateTrip(null, { type: "CreateTrip", tripId: CREW_TRIP_ID, name: CREW_TRIP_NAME, forkedFrom: null }, owner);
  if (!genesis.ok) throw new Error(`landing demo: CreateTrip rejected — ${genesis.rejection.message}`);
  let state: TripState | null = null;
  for (const event of genesis.events) state = evolveTripEnvelope(state, event, owner);
  let adds = 0;
  for (const group of groups) {
    let turn = 0;
    let bookings = 0;
    for (const command of group) {
      const crewed = command.type === "AddActivity" && command.kind !== "pending" ? crewOnStop(command, turn++, bookings) : command;
      if (crewed.type === "AddActivity" && crewed.bookedBy) bookings++;
      const ctx = crewed.type === "AddActivity" ? { actorId: CREW[adds++ % CREW.length] as string } : owner;
      const decision = decideTripCommand(state, crewed, ctx);
      if (!decision.ok) throw new Error(`landing demo: ${command.type} rejected — ${decision.rejection.message}`);
      for (const event of decision.events) state = evolveTripEnvelope(state, event, ctx);
    }
  }
  if (state === null) throw new Error("landing demo: the crew trip folded to nothing");
  const members = withTripColors(
    CREW.map((name, i) => ({
      userId: name,
      role: i === 0 ? ("owner" as const) : ("editor" as const),
      travelling: true,
      name,
      email: null,
      image: null,
      displayName: null,
      ...CREW_LOOKS[name],
    })),
  );
  const trip = overlayMembers(
    tripDetailFromState(state, `${REFERENCE_START_DATE}T00:00:00.000Z`, serverConflictContext()),
    members.map(({ userId, role, travelling }) => ({ userId, role, travelling })),
  );
  return { trip, members, borrowed: resolvePlaybook(bundle.bundle.id, playbooks[CREW_RIVER_INDEX]!, bundle.bundle.origin) };
}

/** The crew moment's slice: Day 2 on the river, who is on it, and the day it was borrowed from. */
function buildLandingCrew(): LandingCrew {
  const { trip, members, borrowed } = crewTrip();
  const globals = buildTripGlobals(trip);
  const personas = personasOfMembers(members);
  const ctx: WidgetContext = { trip, page: { tripId: trip.tripId }, user: null, globals, today: null, personas };
  // The board's persona carries the clash shift a widget's does not.
  const shifted = new Map(members.map((m) => [m.userId, m.colorShifted]));
  const accents = cityAccents(trip);
  const day = trip.days[CREW_RIVER_INDEX]!;
  if (conflictsOn(trip, CREW_RIVER_INDEX).length > 0) throw new Error("landing demo: the crew's Day 2 has conflicts the moment does not draw");
  const city = globals.days[CREW_RIVER_INDEX]!.cities.at(-1);
  if (city === undefined) throw new Error("landing demo: the crew's Day 2 names no city");
  return {
    name: trip.name,
    currency: trip.currency,
    accents: Object.fromEntries(trip.days.map((d) => [d.dayId, accents.ofDayId(d.dayId)])),
    river: {
      dayId: day.dayId,
      ordinal: CREW_RIVER_INDEX + 1,
      city,
      activityIds: day.activityIds,
      activities: Object.fromEntries(day.activityIds.map((id) => [id, trip.activities[id]!])),
    },
    personas: Object.fromEntries(Object.entries(personas).map(([id, persona]) => [id, { ...persona, colorShifted: shifted.get(id) ?? false }])),
    people: resolveBlock(ctx, "trip.people", {}, "trip-people"),
    borrowed: { savedDayId: borrowed.savedDayId, href: dayPath(borrowed) },
  };
}

const MEMORY_DAY = { kind: "index", index: 5 };
const text = (value: string): PageParagraphNode["content"][number] => ({ type: "text", text: value });
const widget = (name: string, params: Record<string, unknown>): PageParagraphNode["content"][number] => ({
  type: "macro",
  attrs: { name, params },
});

/**
 * The Notebook block's page: what somebody wrote after Japan's Day 6 in
 * Hakone, with the plan's own facts in it as widgets. A memory, not a cost
 * table (Mitchell, 2026-10-11: *"it should be more nostalgic than how much you
 * spent on dinner"*), so no widget here reads money.
 */
const MEMORY_PAGE: PageParagraphNode[] = [
  {
    type: "paragraph",
    content: [
      text("Day six, "),
      widget("city", { day: MEMORY_DAY }),
      text(": "),
      widget("count", { day: MEMORY_DAY }),
      text(", and the one we still talk about is "),
      widget("field", { field: "stop.title", day: MEMORY_DAY, tag: "wellness" }),
      text(". We stayed in the onsen until our fingers wrinkled, then ate far too much kaiseki."),
    ],
  },
  {
    type: "paragraph",
    content: [text("Nobody was in a hurry. Priya says it was the best night of the trip, and nobody argued.")],
  },
];

/**
 * The rest of that page, as the desktop's notebook moment draws it (Mitchell's
 * third walk of PR 510: *"looks too fake, not lived in enough, also dont be
 * afraid to make it too long"*): what they would tell the next people to go,
 * and what they would change, under the headings a notebook page holds. Longer
 * than its cell on purpose; the moment fades it out at the cell's foot. The
 * phone's page and the closing quote read `MEMORY_PAGE` alone.
 */
const JOURNAL: { heading: string; paragraphs: string[] }[] = [
  {
    heading: "What we would tell the next lot",
    paragraphs: [
      "The Romancecar fills up from Shinjuku. Book the front seats the day before, not on the platform: Jonah got the last two, and we sat in them in shifts.",
      "Give the Open-Air Museum the whole morning. Take your shoes off for the foot bath halfway round, and leave the Picasso pavilion for last, when the groups have gone to lunch.",
      "At Bakery & Table, go up to the counter over the lake, not the tables inside. Mei went back for a second curry bread and nobody blamed her.",
      "At Gora Kadan ask for the late bath. The outdoor one is quiet after nine, and the steam comes up off the trees.",
    ],
  },
  {
    heading: "Next time",
    paragraphs: [
      "Two nights, not one. The ropeway and Owakudani were on the list, and we never left the ryokan.",
      "Sam wants to walk the old Tokaido path down to Hatajuku. Priya wants the same room again. Both can be true.",
    ],
  },
];

/** One paragraph's text and widgets as the segments a notebook draws, each widget resolved against Japan. */
function resolveParagraph(ctx: WidgetContext, paragraph: PageParagraphNode): Seg[] {
  return paragraph.content.flatMap((node): Seg[] => {
    if (node.type === "text") return [{ kind: "text", text: node.text }];
    if (node.type !== "macro") throw new Error(`landing demo: the memory page holds a ${node.type} node it cannot draw`);
    const outcome = renderMacro(ctx, node.attrs.name, node.attrs.params);
    if (outcome.status !== "ok" || outcome.rendered.kind !== "inline") {
      throw new Error(`landing demo: ${node.attrs.name} did not resolve to a value (${JSON.stringify(outcome)})`);
    }
    return [...outcome.rendered.segs];
  });
}

/** The Playbooks block's cards and the Notebook block's page, all from content the product ships. */
export function buildLandingFeatures(): LandingFeatures {
  const { ctx, dated } = undatedDemo("japan");
  return {
    playbook: landingPlaybook(),
    shelf: shelfPlaybook(),
    make: makeExample(),
    crew: buildLandingCrew(),
    memory: MEMORY_PAGE.map((paragraph) => resolveParagraph(ctx, paragraph)),
    // The page's widgets beside its words (M50 part 9): the day it is about
    // and that day's daylight; then the rest of what was written.
    page: {
      day: resolveBlock(ctx, "day.detail", { day: MEMORY_DAY }, "itinerary-day"),
      sun: resolveBlock(dated, "day.sun", { day: MEMORY_DAY }, "sun"),
      // The widget's own title, as the notebook's widget picker names it.
      sunTitle: getMacro("day.sun")!.title,
      journal: JOURNAL.map(({ heading, paragraphs }) => ({
        heading,
        paragraphs: paragraphs.map((words) => resolveParagraph(ctx, { type: "paragraph", content: [text(words)] })),
      })),
    },
  };
}

/** A snapshot file's exact bytes: what the generator writes and what the verify step compares. */
export function serializeLandingDemo(demo: unknown): string {
  return `${JSON.stringify(demo, null, 2)}\n`;
}

/** Where the `/demo` picker's cards are committed. */
export const CARDS_PATH = fileURLToPath(new URL("../src/lib/demoTripCards.generated.json", import.meta.url));

/** Every file this script owns, with the bytes a fresh generation gives it. */
export function generatedFiles(): { path: string; fresh: string }[] {
  return [
    ...DEMO_TRIPS.map(({ slug }) => ({ path: snapshotPath(slug), fresh: serializeLandingDemo(buildLandingDemo(slug)) })),
    { path: CARDS_PATH, fresh: serializeLandingDemo(demoTripCards()) },
    { path: FEATURES_PATH, fresh: serializeLandingDemo(buildLandingFeatures()) },
    { path: SEA_PATH, fresh: serializeLandingDemo(buildLandingSea()) },
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = false;
  for (const { path, fresh } of generatedFiles()) {
    if (!check) {
      writeFileSync(path, fresh);
      console.log(`wrote ${path} (${Buffer.byteLength(fresh)} bytes)`);
    } else if (!existsSync(path) || readFileSync(path, "utf8") !== fresh) {
      console.error(`landing:verify — ${path} is missing or stale: a demo trip or a resolver changed what it holds.`);
      stale = true;
    } else {
      console.log(`landing:verify OK ${path} (${Buffer.byteLength(fresh)} bytes)`);
    }
  }
  if (stale) {
    console.error("Regenerate with `pnpm --filter web landing:generate` and commit the result.");
    process.exit(1);
  }
}

// M53 part D (duplicates): the guard that refuses a new indexable duplicate.
//
// The four duplicate pairs the M53 audit found (Bologna, Florence, Rome, the
// Amalfi Coast, all 2026-10-21) were content-identical under Mitchell's
// decision 1: a copy is the SAME TITLE and the SAME DESCRIPTION, and a
// borrowed day with an edited title or description is a fork, not a copy.
// The second copy of each pair arrived through the content importer, which
// writes public rows directly — so the guard lives on the import path, not on
// a publish transition the importer never takes: `importPlaybooks` in
// `scripts/import-content-production.ts` (production) and
// `POST /api/dev/content/playbooks` (dev/preview) both refuse before writing.
//
// What is compared is the day page's own pair, built the way the page builds
// it (`playbooks/live/day/[savedDayId]/page.tsx`): the title is the name plus
// the first city, and the description is the author's summary when there is
// one, else the arc sentence over the stops. Title + city alone is NOT the
// guard — Mitchell rejected it, because it would block legitimate borrows —
// and neither is the name alone: the same name in another city is another
// page, and the same name with an edited summary is a fork.
//
// One deliberate blind spot, documented rather than papered over: a day with
// no summary and no stops to arc from describes itself on the page with the
// facts line, which names its author and its rating — values the importer
// cannot reproduce faithfully. Such a day is not guardable here (`null`),
// which fails open: it is never refused for matching, rather than refused
// for a description the page would not actually print.

import { and, eq, isNull, notInArray } from "drizzle-orm";
import { citiesOfSequence } from "@tc/domain";
import { dayArcHighlights, dayDescription } from "@/lib/playbooksPreview";
import { db, type Queryable } from "./db/client";
import { savedDays } from "./db/schema";

/** A stop cut to what the guard reads: its title, its start, its city, its day. */
export type GuardStop = {
  title: string;
  timeWindow: { start: string } | null;
  kind: string;
  location: { city?: string | undefined } | null;
  dayIndex?: number | undefined;
};

/** A day cut to what its page prints: its name, its cities, its summary, its stops. */
export type PageDay = {
  savedDayId: string;
  name: string;
  cities: readonly string[];
  summary: string | null | undefined;
  stops: readonly GuardStop[];
};

/** One refused pair: the incoming day, and the already-published day it copies. */
export type DuplicateCollision = {
  incomingId: string;
  incomingName: string;
  existingId: string;
  title: string;
  description: string;
};

/**
 * Two descriptions are the same words when they differ only in case, in
 * surrounding whitespace, or in runs of whitespace inside — the differences
 * a re-import or a re-type leaves behind, not an edit.
 */
export function normalizeDuplicateText(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The day page's tab title, exactly as `generateMetadata` builds it: the
 * name, plus the first city when the day touches one.
 */
export function dayPageTitle(name: string, cities: readonly string[]): string {
  const first = cities[0];
  return first === undefined ? name : `${name} · ${first}`;
}

/**
 * The day page's meta description, exactly as the page's `describe` builds
 * it — the summary when there is one, else the arc sentence — or `null`
 * when the page would fall through to the facts line, which names the author
 * and the rating and so is not reproducible at import time.
 */
export function dayPageDescription(
  summary: string | null | undefined,
  cities: readonly string[],
  stops: readonly GuardStop[],
): string | null {
  const own = summary?.trim() ?? "";
  if (own !== "") return own;
  if (dayArcHighlights(stops).length === 0) return null;
  // The facts below are only read on the arc branch (the summary branch
  // returns above, the facts branch is the `null` above): the arc sentence
  // names the first city and nothing about the author or the rating.
  return dayDescription(null, { cities, dayCount: 1, stopCount: stops.length, author: "", rating: null, reviewCount: 0 }, stops);
}

/**
 * A day's page pair, or `null` when its description is not guardable (see
 * the module header: no summary, no arc). A `null` day never collides.
 */
export function pageIdentity(day: PageDay): { title: string; description: string } | null {
  const description = dayPageDescription(day.summary, day.cities, day.stops);
  if (description === null) return null;
  return { title: dayPageTitle(day.name, day.cities), description };
}

/**
 * The collisions between incoming days and already-published days: same
 * normalized title AND same normalized description, under a different id.
 * Same-id rows are the re-import of the same day updating in place, not a
 * duplicate, and are exempt. A fork — an edited title or an edited
 * description — matches on at most one side and passes.
 */
export function findDuplicateDays(incoming: readonly PageDay[], published: readonly PageDay[]): DuplicateCollision[] {
  const collisions: DuplicateCollision[] = [];
  const indexed = published
    .map((day) => ({ day, identity: pageIdentity(day) }))
    .filter((entry): entry is { day: PageDay; identity: { title: string; description: string } } => entry.identity !== null);
  for (const day of incoming) {
    const identity = pageIdentity(day);
    if (identity === null) continue;
    const title = normalizeDuplicateText(identity.title);
    const description = normalizeDuplicateText(identity.description);
    for (const { day: existing, identity: other } of indexed) {
      if (existing.savedDayId === day.savedDayId) continue;
      if (normalizeDuplicateText(other.title) !== title) continue;
      if (normalizeDuplicateText(other.description) !== description) continue;
      collisions.push({
        incomingId: day.savedDayId,
        incomingName: day.name,
        existingId: existing.savedDayId,
        title: identity.title,
        description: identity.description,
      });
    }
  }
  return collisions;
}

/**
 * An importer's resolved day as a page day: its cities are derived by the
 * same rule `newSavedDayRow` derives the stored snapshot with, so the title
 * the guard compares is the title the row will actually print.
 */
export function toPageDay(day: {
  savedDayId: string;
  name: string;
  summary?: string | null | undefined;
  stops: readonly GuardStop[];
}): PageDay {
  return { savedDayId: day.savedDayId, name: day.name, cities: citiesOfSequence(day.stops), summary: day.summary, stops: day.stops };
}

/**
 * The collisions between incoming days and the days already indexable in
 * this database: public, not deleted, not moderated — the same predicate the
 * sitemap's index uses (`dayIndexable` plus the row's own liveness). Private
 * days are not in the index and cannot be copied into it; rows the import
 * itself is about to rewrite are exempt by id.
 */
export async function findPublishedDuplicates(
  q: Queryable = db,
  incoming: readonly PageDay[],
): Promise<DuplicateCollision[]> {
  const guardable = incoming.filter((day) => pageIdentity(day) !== null);
  if (guardable.length === 0) return [];
  const ids = guardable.map((day) => day.savedDayId);
  const rows = await q
    .select({ id: savedDays.id, name: savedDays.name, cities: savedDays.cities, summary: savedDays.summary, stops: savedDays.stops })
    .from(savedDays)
    .where(
      and(
        eq(savedDays.visibility, "public"),
        isNull(savedDays.deletedAt),
        isNull(savedDays.moderatedAt),
        notInArray(savedDays.id, ids),
      ),
    );
  const published: PageDay[] = rows.map((row) => ({
    savedDayId: row.id,
    name: row.name,
    cities: row.cities,
    summary: row.summary,
    stops: row.stops,
  }));
  return findDuplicateDays(guardable, published);
}

/**
 * The guard's refusal, worded for the run log or the route's 409: every
 * colliding pair, incoming and existing, so one failed run surfaces them
 * all instead of one at a time.
 */
export function duplicateDaysMessage(collisions: readonly DuplicateCollision[]): string {
  return collisions
    .map(
      (collision) =>
        `duplicate day: "${collision.incomingName}" (${collision.incomingId}) has the same title and description as already-published ${collision.existingId} — title "${collision.title}", description "${collision.description}". A borrowed day must change its title or its description; refusing the import.`,
    )
    .join("\n");
}

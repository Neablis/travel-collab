// Server-only: never import from UI code. The day-chunk text builder for the
// plan-retrieval RAG stack (Part 2 of 5).
//
// One module owns the corpus's TEXT — what a day becomes before it is
// embedded — so the embed-on-write hooks, the cron sweep and the backfill can
// never disagree about what a chunk says. The builder is pure and
// deterministic: same input, byte-identical output, no clock, no random, no
// I/O. That determinism is what makes re-embedding after an edit converge
// rather than drift.
import type { SavedStop, TripDetail } from "@tc/contracts";

/** The stop fields that reach a day chunk: title, notes, tags, and where it is. */
export interface ChunkStop {
  title: string;
  notes: string | null;
  tags: readonly string[];
  /** From `location.city`, when the stop carries one. */
  city: string | null;
  /** From `location.countryCode`, when the stop carries one. */
  countryCode: string | null;
}

/** One built day chunk: the text to embed, plus the row metadata the sweep stores beside it. */
export interface BuiltDayChunk {
  /** 0-based, ADR-048: the playbook stop's `dayIndex`, or the trip day's position in `detail.days`. */
  dayIndex: number;
  /** The deterministic chunk text — what the model sees when this day is retrieved. */
  text: string;
  /** The day's primary city: the first stop (in day order) carrying one, else null. */
  city: string | null;
  /** That stop's country code, which may itself be null. */
  countryCode: string | null;
  /** The day's stop tags, de-duplicated, in first-occurrence order. */
  tags: string[];
}

/**
 * The embeddable text of one day.
 *
 * The format is fixed and documented because it is a contract with the
 * embedding: a re-embed of unchanged content must produce the same vector
 * neighbourhood, and a reviewer diffing two chunks must be able to read it.
 *
 * ```
 * <name>
 * Summary: <summary>              — only when the caller passes a non-blank one
 * Cities: <city1>, <city2>        — only when non-empty; first-occurrence order
 * Stops:
 * - <title> [tags: meal, drinks]  — the tags clause only when the stop has tags
 *   Notes: <notes>                — only when non-blank; kept verbatim, newlines included
 *   <city>[, <countryCode>]       — only when the stop carries either
 * - …
 * ```
 *
 * A day with no stops reads `Stops:` followed by `(no stops planned)` — an
 * empty day is a real day (ADR-048 decision 2: a gap in `dayIndex` is a rest
 * day), and its chunk says so rather than embedding a bare title that would
 * match everything.
 *
 * Nothing here is sanitised or truncated: titles and notes go in verbatim, so
 * the text the model retrieves is exactly what the author wrote.
 */
export function buildDayChunkText({
  name,
  summary,
  stops,
  cities,
}: {
  /** The day's label, composed by the caller (e.g. "Tokyo Food Crawl - Day 2"). */
  name: string;
  /** The playbook's summary; trips have none. */
  summary: string | null;
  /** The day's stops, in the order they run. */
  stops: readonly ChunkStop[];
  /** The day's cities, first-occurrence order; the caller derives them from the stops. */
  cities: readonly string[];
}): string {
  const lines = [name];
  if (summary !== null && summary.trim() !== "") lines.push(`Summary: ${summary.trim()}`);
  if (cities.length > 0) lines.push(`Cities: ${cities.join(", ")}`);
  lines.push("Stops:");
  if (stops.length === 0) {
    lines.push("(no stops planned)");
  }
  for (const stop of stops) {
    const tags = stop.tags.length > 0 ? ` [tags: ${stop.tags.join(", ")}]` : "";
    lines.push(`- ${stop.title}${tags}`);
    if (stop.notes !== null && stop.notes.trim() !== "") lines.push(`  Notes: ${stop.notes}`);
    if (stop.city !== null || stop.countryCode !== null) {
      lines.push(`  ${[stop.city, stop.countryCode].filter((part) => part !== null).join(", ")}`);
    }
  }
  return lines.join("\n");
}

/**
 * A playbook's stops as one chunk per day.
 *
 * Stops are grouped by `dayIndex` (0-based, ADR-048); `dayCount` fixes how
 * many days the sequence spans, so a gap in the index — a deliberately empty
 * day — still gets its chunk rather than vanishing from the corpus. The day
 * label is the playbook's name plus the 1-based day number, matching how the
 * library renders it.
 */
export function buildPlaybookDayChunks(playbook: {
  name: string;
  summary: string | null;
  stops: readonly SavedStop[];
  dayCount: number;
}): BuiltDayChunk[] {
  const byDay = new Map<number, SavedStop[]>();
  for (const stop of playbook.stops) {
    const group = byDay.get(stop.dayIndex) ?? [];
    group.push(stop);
    byDay.set(stop.dayIndex, group);
  }
  const chunks: BuiltDayChunk[] = [];
  for (let dayIndex = 0; dayIndex < playbook.dayCount; dayIndex++) {
    const dayStops = (byDay.get(dayIndex) ?? []).map(toChunkStop);
    chunks.push({
      dayIndex,
      text: buildDayChunkText({
        name: `${playbook.name} - Day ${dayIndex + 1}`,
        summary: playbook.summary,
        stops: dayStops,
        cities: uniqueCities(dayStops),
      }),
      ...dayMetadata(dayStops),
    });
  }
  return chunks;
}

/**
 * A trip's days as one chunk per day.
 *
 * The day's position in `detail.days` IS its 0-based index (the array is the
 * trip's day order), and its stops are `day.activityIds` resolved through
 * `detail.activities`. A day with no activities still gets a chunk — same
 * reasoning as the playbook's empty day above. The date rides in the label
 * when the day has one, because "Day 3" of a dated trip is more retrievable
 * with its date attached.
 */
export function buildTripDayChunks(detail: TripDetail): BuiltDayChunk[] {
  return detail.days.map((day, dayIndex) => {
    const dayStops = day.activityIds
      .map((activityId) => detail.activities[activityId])
      .filter((activity) => activity !== undefined)
      .map(toChunkStop);
    const date = day.date !== null ? ` (${day.date})` : "";
    return {
      dayIndex,
      text: buildDayChunkText({
        name: `${detail.name} - Day ${dayIndex + 1}${date}`,
        summary: null,
        stops: dayStops,
        cities: uniqueCities(dayStops),
      }),
      ...dayMetadata(dayStops),
    };
  });
}

/** A `SavedStop` or `ActivityView` narrowed to the fields a chunk carries. */
function toChunkStop(stop: {
  title: string;
  notes: string | null;
  tags: readonly string[];
  location: { city?: string; countryCode?: string } | null;
}): ChunkStop {
  return {
    title: stop.title,
    notes: stop.notes,
    tags: stop.tags,
    city: stop.location?.city ?? null,
    countryCode: stop.location?.countryCode ?? null,
  };
}

/** The day's cities in first-occurrence order, for the chunk's `Cities:` line. */
function uniqueCities(stops: readonly ChunkStop[]): string[] {
  const seen = new Set<string>();
  for (const stop of stops) {
    if (stop.city !== null) seen.add(stop.city);
  }
  return [...seen];
}

/** The per-day row metadata: tags, primary city, and its country code. */
function dayMetadata(stops: readonly ChunkStop[]): Pick<BuiltDayChunk, "city" | "countryCode" | "tags"> {
  const tags: string[] = [];
  for (const stop of stops) {
    for (const tag of stop.tags) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  const primary = stops.find((stop) => stop.city !== null);
  return {
    city: primary?.city ?? null,
    countryCode: primary?.countryCode ?? null,
    tags,
  };
}

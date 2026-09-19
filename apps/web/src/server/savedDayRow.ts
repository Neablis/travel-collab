import { SavedDayAuthorKind, SavedDayVisibility, SavedStop } from "@tc/contracts";

/**
 * **The one read boundary for a `saved_days` row's parsed columns** — F-F05's
 * `parseSavedDayColumns`, and ADR-048 makes it a prerequisite of M23 rather
 * than a tidy-up to do afterwards.
 *
 * Until now this logic existed TWICE, with identical log strings, in
 * `savedDays.ts`'s `fromRow` and `playbooks.ts`'s `toDiscoverDay` — a library
 * read and a Discover read of the same bytes. That was survivable while it was
 * two `safeParse` calls. M23 adds three behaviours to it (a `dayIndex` sort, a
 * `dayCount` floor, and the logging for both), and **every one of them has to
 * be true at both sites or it is not true**: a row that reads as a three-day
 * sequence in your library and a two-day one on its Discover card is worse than
 * either answer.
 *
 * The two rows are shaped differently — `savedDays.ts` selects through Drizzle
 * and gets camelCase, `playbooks.ts` runs raw SQL and gets `author_kind` — so
 * this takes the four values explicitly rather than a row type. That is the
 * point of the seam, not a wart on it.
 */
export type SavedDayColumns = {
  /** For the log lines only: which row could not be read. */
  savedDayId: string;
  stops: unknown;
  visibility: unknown;
  authorKind: unknown;
  dayCount: unknown;
};

export type ParsedSavedDayColumns = {
  /** Parsed, and in sequence order — see `parseSavedDayColumns`. */
  stops: SavedStop[];
  visibility: SavedDayVisibility;
  authorKind: SavedDayAuthorKind;
  /** `>= max(stops[].dayIndex) + 1`, repaired upward if the stored value was lower. */
  dayCount: number;
};

/**
 * A stored row's columns become typed values, or the row becomes nothing.
 *
 * **Why a parse at all** (KI-71): `stops` is `jsonb("stops").$type<SavedStop[]>()`
 * and `$type` is a compile-time cast on Drizzle's side, never a runtime check —
 * it says what the write path intends and nothing about what the bytes are.
 *
 * **Three different consequences, on purpose**, and the differences are the
 * whole design:
 *
 *   * **`stops` and `visibility` DROP the row.** An unreadable fragment cannot
 *     be rendered, and an unknown visibility is a value no access check has a
 *     branch for — both fail closed on a question that decides what a reader is
 *     allowed to see. Dropping rather than throwing, because a library is a
 *     list and one bad fragment must not take the other twenty-nine with it.
 *     The failure is LOGGED with the row id, which is the half KI-71 complained
 *     was missing.
 *   * **`authorKind` FALLS BACK to "human".** It decides a label, not what the
 *     reader may see, and only "ai" is ever rendered — so a row whose label we
 *     cannot read says nothing about its author, which is exactly the truth.
 *     Losing a day out of somebody's library over a provenance string would be
 *     wildly out of proportion. If a future value ever renders its own badge,
 *     this fallback has to be revisited with it.
 *   * **`dayIndex` order and `dayCount` are REPAIRED.** See below. This is the
 *     new one, and it is deliberately the gentlest of the three.
 *
 * **The sort is a tolerance, and it must never become enforcement**
 * (ADR-048 decision 3). `dayIndex` monotonicity is a WRITE-path invariant —
 * enforced by `SavedDaySequence` at `saveDay`, before bytes exist. Here, a row
 * that violates it is stably sorted and kept. Enforcing it here instead would
 * drop rows whose stops are individually every one of them valid, which is
 * `KI-20260905-l`'s hazard re-created on purpose, and it would pass every test
 * written against freshly-written rows.
 *
 * **`.sort` is stable** (ES2019 and later require it), and that is load-bearing
 * rather than incidental: within a day, stops are stored in the order the day
 * RAN — `stopsForDay` walks `day.activityIds` — not in clock order. An unstable
 * sort, or one that widened the key to include a time, would silently reorder a
 * day's stops while appearing to fix their days.
 *
 * **`dayCount` is repaired UPWARD only.** The stops impose a floor
 * (`max(dayIndex) + 1`); a stored value below it is a contradiction, and
 * growing the count to fit is the repair that cannot lose anything. Clamping
 * DOWN would strand stops in a day the count says does not exist, and refusing
 * the row would empty a library over arithmetic. A missing or unreadable value
 * reads as the floor, which for a pre-M23 row is 1 — exactly what it has always
 * meant.
 */
export function parseSavedDayColumns(row: SavedDayColumns): ParsedSavedDayColumns | null {
  const stops = SavedStop.array().safeParse(row.stops);
  if (!stops.success) {
    console.error("saved_days.stops failed SavedStop[] parse", {
      savedDayId: row.savedDayId,
      issues: stops.error.issues,
    });
    return null;
  }

  const visibility = SavedDayVisibility.safeParse(row.visibility);
  if (!visibility.success) {
    console.error("saved_days.visibility is not a SavedDayVisibility", {
      savedDayId: row.savedDayId,
      value: row.visibility,
    });
    return null;
  }

  const authorKind = SavedDayAuthorKind.safeParse(row.authorKind);
  if (!authorKind.success) {
    console.error("saved_days.author_kind is not a SavedDayAuthorKind", {
      savedDayId: row.savedDayId,
      value: row.authorKind,
    });
  }

  // Checked before sorting rather than by comparing arrays afterwards: the
  // question is whether the STORED order violated the write-path invariant, and
  // that is exactly this predicate. A silent repair here is a write-path
  // regression nobody would ever see.
  const ordered = stops.data.every((s, i) => i === 0 || stops.data[i - 1]!.dayIndex <= s.dayIndex);
  if (!ordered) {
    console.error("saved_days.stops were not in dayIndex order; sorted on read", {
      savedDayId: row.savedDayId,
      dayIndexes: stops.data.map((s) => s.dayIndex),
    });
  }
  const sorted = ordered ? stops.data : [...stops.data].sort((a, b) => a.dayIndex - b.dayIndex);

  const floor = sorted.reduce((max, s) => (s.dayIndex + 1 > max ? s.dayIndex + 1 : max), 1);
  const stored = typeof row.dayCount === "number" && Number.isInteger(row.dayCount) ? row.dayCount : null;
  if (stored === null) {
    console.error("saved_days.day_count is not an integer; using the stops' own floor", {
      savedDayId: row.savedDayId,
      value: row.dayCount,
      floor,
    });
  } else if (stored < floor) {
    console.error("saved_days.day_count is below its stops' floor; repaired upward", {
      savedDayId: row.savedDayId,
      stored,
      floor,
    });
  }

  return {
    stops: sorted,
    visibility: visibility.data,
    authorKind: authorKind.success ? authorKind.data : SavedDayAuthorKind.enum.human,
    dayCount: stored === null ? floor : Math.max(stored, floor),
  };
}

// A bundle playbook becomes the authored half of a `saved_days` row.
//
// The DERIVED half is deliberately not produced here. `cities` is
// `citiesOfStops` in `@tc/domain`, and `adds` is the ledger's count — the two
// fields the demo library's own header says must never be authored beside the
// stops, because a second copy agrees only until somebody edits a stop. The
// importer runs both derivations through `newSavedDayRow` and `recordAdd`, the
// same functions a real save and a real add go through.

import type { SavedDayAuthorKind, SavedDayVisibility, SavedStop } from "@tc/contracts";
import type { BundlePlaybook, BundleStop } from "./schema.ts";
import { bundleId } from "./ids.ts";
import type { SeededSavedDay } from "../library/starterDays.ts";

/**
 * A playbook resolved into row-shaped values: ids minted, the source trip
 * snapshotted, `authorKind` settled.
 *
 * `SeededSavedDay` plus the three fields the older seed sets read from lookup
 * tables beside it (`STARTER_SOURCE_TRIP`) or did not have at all (`authorKind`).
 * Carrying them on the row is what lets one writer take the Japan set, the
 * starter set and any imported bundle without a per-set special case.
 */
export type ResolvedPlaybook = SeededSavedDay & {
  /**
   * How many days the playbook spans — `days.length` when it was authored as a
   * sequence, 1 for the one-day `stops:` form (M23, ADR-048).
   *
   * Carried on the resolved row rather than left to the stops, because an
   * authored trailing day with no stops leaves no `dayIndex` behind and only
   * the declaration knows it was there.
   */
  dayCount: number;
  authorKind: SavedDayAuthorKind;
  sourceTripId: string;
  sourceTripName: string;
};

/**
 * `BundleStop` (every field optional, absent = unset) → `SavedStop` (every
 * field present, `null` = unset).
 *
 * The two spell "no cost" differently on purpose: a bundle is hand-written, so
 * absence is the cheap default, and a stored jsonb value is read back by a
 * parser that must be able to tell "no cost" from "field not written yet".
 */
export function toSavedStop(stop: BundleStop, dayIndex = 0): SavedStop {
  return {
    title: stop.title,
    timeWindow: stop.timeWindow ?? null,
    location: stop.location ?? null,
    notes: stop.notes ?? null,
    anchors: stop.anchors ?? [],
    kind: stop.kind ?? "planned",
    tags: stop.tags ?? [],
    cost: stop.cost ?? null,
    // Which day of the sequence this stop lands on. Defaulted to 0 so the
    // one-day `stops:` form needs no argument at all — a one-day playbook is a
    // sequence of length one, not a special case.
    dayIndex,
  };
}

/**
 * A playbook's authored shape — one day's `stops` or a sequence's `days` —
 * flattened into the stored form: one indexed array, plus the day count.
 *
 * **The count comes from `days.length`, not from the stops.** A trailing rest
 * day contributes no stop and so leaves no index behind; only the authored list
 * knows it was there (ADR-048 decision 2). An interior rest day leaves a GAP,
 * which is preserved here by stamping from the day's position rather than from
 * a running counter over non-empty days.
 */
export function toSavedSequence(playbook: BundlePlaybook): { stops: SavedStop[]; dayCount: number } {
  if (playbook.days === undefined) {
    return { stops: (playbook.stops ?? []).map((s) => toSavedStop(s)), dayCount: 1 };
  }
  return {
    stops: playbook.days.flatMap((day, dayIndex) => day.stops.map((s) => toSavedStop(s, dayIndex))),
    dayCount: playbook.days.length,
  };
}

/** The saved day's id, derived from the bundle it came in and its own key. */
export function playbookIdFor(bundleKey: string, playbookKey: string): string {
  return bundleId(`playbook:${bundleKey}`, playbookKey);
}

export function resolvePlaybook(
  bundleKey: string,
  playbook: BundlePlaybook,
  fallbackAuthorKind: SavedDayAuthorKind,
): ResolvedPlaybook {
  const savedDayId = playbookIdFor(bundleKey, playbook.key);
  return {
    savedDayId,
    ownerId: playbook.ownerId,
    name: playbook.name,
    ...toSavedSequence(playbook),
    visibility: playbook.visibility as SavedDayVisibility,
    authorKind: playbook.origin ?? fallbackAuthorKind,
    ...(playbook.keptOn ? { keptOn: playbook.keptOn } : {}),
    // A snapshot of a trip that is deliberately NOT a row (ADR-028/ADR-029):
    // the credit has to survive the source being renamed, deleted or becoming
    // unreadable, so a content author names the trip and never points at one.
    sourceTripId: playbook.sourceTrip.id ?? bundleId(`sourcetrip:${bundleKey}`, playbook.key),
    sourceTripName: playbook.sourceTrip.name,
    // The ledger's trips are declared history. An author who did not supply an
    // id gets one derived from the day's key and the row's position, which is
    // distinct per add — the composite primary key is (saved_day_id, trip_id),
    // so two adds sharing a trip id would collapse into one row and the day's
    // count would silently drop.
    addedBy: playbook.addedBy.map((add, i) => ({
      tripId: add.tripId ?? bundleId(`addedtrip:${bundleKey}:${playbook.key}`, String(i)),
      addedBy: add.addedBy,
    })),
  };
}

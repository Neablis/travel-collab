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
export function toSavedStop(stop: BundleStop): SavedStop {
  return {
    title: stop.title,
    timeWindow: stop.timeWindow ?? null,
    location: stop.location ?? null,
    notes: stop.notes ?? null,
    anchors: stop.anchors ?? [],
    kind: stop.kind ?? "planned",
    tags: stop.tags ?? [],
    cost: stop.cost ?? null,
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
    stops: playbook.stops.map(toSavedStop),
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

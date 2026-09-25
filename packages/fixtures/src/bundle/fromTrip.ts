// A trip becomes a `content-bundle/v1` document — the writer the format never
// had (M25 link 1).
//
// --- Why here, and not in the route ---
// `toCommands.ts` next door turns a bundle into commands; this turns a trip
// into a bundle, and the two are the two ends of the round trip M25's gate is
// built around. Keeping them in one package is what lets a single test import
// both and assert they compose, and it keeps the route a declaration — which is
// M22's claim, re-measured here on an endpoint with a body to build.
//
// Pure, like everything else in this package (invariant 4): `generatedAt` is
// passed in rather than read off the clock, and nothing here touches a
// database.
//
// --- What it carries, and why that is a scope line rather than a gap ---
// **Days and activities. Nothing else.** Mitchell, 2026-09-18: *"just the days
// and activities, nothing else, no budget, invites or notebooks."* So a trip's
// budget, currency, members, invites, share links, notebook pages, lineage,
// status and dismissed conflicts are all absent BY DECISION, and a later reader
// finding them missing has found the decision. Two readings of that sentence
// were put back to Mitchell and confirmed:
//
//   - **A stop's `cost` stays.** It is a field of an *activity*, and `Money`
//     carries its own currency, so a stop's cost is self-describing and
//     survives the trip-level currency going with the budget. One consequence
//     to accept rather than discover: an imported trip falls to the domain's
//     default currency (USD) even where its stop costs are all in JPY.
//   - **The backlog stays.** Parked ideas are activities that have no day yet,
//     not a separate kind of thing, and dropping them would silently lose real
//     work on export.
//
// Derived totals (`tripCostTotal`, `budgetRemaining`, `costSubtotal`) are not
// here and never could be: they are computed from what IS carried.
//
// --- Why an export is not a backup ---
// It is a snapshot of the plan, not the event log (M25 decision 2). The log is
// `tripId`-bound and re-importing it would violate ADR-028's id-remap rule. So
// a re-imported trip starts a fresh stream and loses undo, redo, revert and its
// History popover — stated here because "export" invites the opposite
// assumption.

import { z } from "zod";
import type { ActivityView, TripDetail } from "@tc/contracts";
import { BundleTrip, ContentBundleV1, type BundleDay, type BundleStop } from "./schema.ts";

/**
 * What an export actually is: a `content-bundle/v1` document carrying **one
 * trip and nothing else**.
 *
 * **Not a third format** (M25 decision 1). It is `ContentBundleV1` with three
 * sections pinned empty — same `$schema` string, same `BundleTrip`, read back
 * by `parseBundle` with no special case. A narrowing of one schema is not a
 * second vocabulary.
 *
 * **It exists because the published reference has to be true.** The export
 * endpoint declares its response, and `route()` both validates against that
 * declaration and generates the OpenAPI entry from it. Declared as the full
 * `ContentBundleV1`, that entry was **2,267 lines** — almost all of it the
 * recursive `PageDoc` AST under `notebooks`, a section this endpoint never
 * writes. An integrator reading it would have concluded that an export can
 * return notebook documents. It cannot, and now the document says so.
 *
 * **And it makes M25's "no export of anything but a trip" a runtime
 * assertion rather than a promise.** If a later change makes the export emit a
 * playbook, `route()`'s outbound validation fails in that diff.
 */
export const TripExportBundle = ContentBundleV1.extend({
  trips: z.array(BundleTrip).length(1),
  playbooks: z.tuple([]).default([]),
  notebooks: z.tuple([]).default([]),
  activities: z.tuple([]).default([]),
});
export type TripExportBundle = z.infer<typeof TripExportBundle>;

export type TripToBundleOptions = {
  /**
   * `bundle.generatedAt`, ISO 8601. Passed in, never read off the clock — this
   * package is imported by a bundled route and is pure for the same reason
   * every other module here is (invariant 4).
   */
  generatedAt?: string;
};

/** What `toBundleStop` reads: the stop fields an activity and a `SavedStop` share. */
export type StopFields = Pick<
  ActivityView,
  "title" | "timeWindow" | "location" | "notes" | "anchors" | "kind" | "tags" | "cost" | "mode" | "endLocation"
>;

/**
 * A slug for `bundle.id` and `trips[].key`, both `^[a-z0-9-]+$`.
 *
 * **Falls back to the trip's uuid, which always matches that regex** — a trip
 * named `京都` slugifies to nothing, and a format-invalid export would be a
 * 500 on a trip whose only crime is a non-latin name.
 *
 * It does not matter to correctness *which* of the two comes out. A key's job
 * in this format is to DERIVE ids so that re-importing authored content updates
 * rows rather than duplicating them (`tripIdFor`); an upload mints fresh ids
 * instead, deliberately (M25 link 3), so on this path the key is documentation.
 * Readable-when-possible is then strictly better than uuid-always.
 */
export function bundleKeyFor(trip: Pick<TripDetail, "tripId" | "name">): string {
  const slug = trip.name
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining marks, so "Kyōto" slugs as "kyoto" rather than losing the ō.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    // A trailing hyphen can survive the slice above.
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : trip.tripId;
}

/**
 * One stop, `ActivityView` → `BundleStop`.
 *
 * The two shapes were derived from one contract rather than reconciled, so this
 * is a null-to-omitted translation and nothing more. **That is the property M25
 * rests on**: a field added to an activity and not to this function fails the
 * round-trip test in the same diff that added it.
 *
 * `kind` is always written, even when it is `"planned"`. The format documents
 * "omitted = planned" and omitting it would be lossless — but a round trip that
 * is field-for-field identical is worth more than three saved characters, and
 * the cleverness would be the thing a later reader has to re-derive.
 *
 * Empty `anchors` and `tags` ARE omitted, matching what `toCommands.ts` does in
 * the other direction: the importer writes no `tags` key for an empty array, so
 * writing one here would make the two ends disagree on a file neither of them
 * is wrong about.
 *
 * **Typed over the ten fields it reads, not over `ActivityView`**, so a
 * Playbook's `SavedStop` — the same fields, minus an id — goes through this
 * same translation on export (`fromPlaybook.ts`) rather than a second copy.
 */
export function toBundleStop(activity: StopFields): BundleStop {
  return {
    title: activity.title,
    ...(activity.timeWindow ? { timeWindow: activity.timeWindow } : {}),
    ...(activity.location ? { location: activity.location } : {}),
    ...(activity.notes !== null ? { notes: activity.notes } : {}),
    ...(activity.anchors.length > 0 ? { anchors: activity.anchors } : {}),
    kind: activity.kind,
    ...(activity.tags.length > 0 ? { tags: activity.tags } : {}),
    ...(activity.cost ? { cost: activity.cost } : {}),
    ...(activity.mode ? { mode: activity.mode } : {}),
    ...(activity.endLocation ? { endLocation: activity.endLocation } : {}),
  };
}

/**
 * A trip as a one-trip `content-bundle/v1` document.
 *
 * **Dates.** A dated trip emits its real `startDate`; a dateless one emits
 * NEITHER anchor and its days are addressed by position — day 1, day 2 —
 * exactly as a playbook's have been since ADR-041. It never emits
 * `startsInDays`: that form is how *authored library content* keeps itself
 * upcoming, and an export is a copy of YOUR trip rather than a shape to re-use.
 * A stale export therefore imports as a PAST trip, which is the correct answer
 * and not a defect to design around (Mitchell, 2026-09-18).
 *
 * `BundleDay` carries no date field of any kind, so the trip's anchor is the
 * only date-bearing thing in the document and dropping it leaves a structure
 * that is already complete.
 *
 * **An activity id that a day lists but `activities` does not hold is skipped.**
 * `TripDetail` is a stored jsonb projection and this is a read of somebody's
 * live data; a dangling id is a corrupt row, and answering a download with a
 * 500 would deny a person the export of the 99 stops that are fine. The
 * round-trip test asserts the honest consequence — what comes back is what was
 * readable.
 */
export function tripToBundle(trip: TripDetail, options: TripToBundleOptions = {}): TripExportBundle {
  const key = bundleKeyFor(trip);
  const stopsOf = (ids: string[]): BundleStop[] =>
    ids.flatMap((id) => {
      const activity = trip.activities[id];
      return activity === undefined ? [] : [toBundleStop(activity)];
    });

  const days: BundleDay[] = trip.days.map((day) => ({ stops: stopsOf(day.activityIds) }));

  return {
    $schema: "travel-collab/content-bundle/v1",
    bundle: {
      id: key,
      name: trip.name,
      // **`human`, and it is about the FILE rather than about the trip.**
      // `origin` exists so a library can say which of its days a person kept
      // and which a model wrote, and it reaches rows only through
      // `playbooks[].origin`. This document carries no playbooks, so nothing
      // reads it; a person exported their own plan, so "human" is the honest
      // word for who assembled the file.
      origin: "human",
      sources: [],
      ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    },
    trips: [
      {
        key,
        name: trip.name,
        ...(trip.startDate !== null ? { startDate: trip.startDate } : {}),
        days,
        backlog: stopsOf(trip.backlog),
      },
    ],
    playbooks: [],
    notebooks: [],
    activities: [],
  };
}

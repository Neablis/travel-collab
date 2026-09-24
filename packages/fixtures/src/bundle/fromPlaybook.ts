// A Playbook becomes a `content-bundle/v1` document — the other end of
// `toPlaybooks.ts`, as `fromTrip.ts` is the other end of `toCommands.ts`
// (ADR-050, Pass C).
//
// Pure, like everything else in this package (invariant 4): `generatedAt` is
// passed in.
//
// --- What it carries ---
// The CONTENT: name, summary, every day in order (rest days included, so
// `dayCount` survives), every stop field `BundleStop` can say — which is every
// field `SavedStop` has; `dayIndex` is the position of the day the stop is
// written in — plus `visibility`, `version` and who wrote it (`origin`).
//
// --- What it leaves out, by decision ---
//   - **The adds ledger** (`addedBy`): who took this Playbook into which trip is
//     other people's activity, not the Playbook's content.
//   - **Reviews and ratings**: other people's words about it.
//   - **The source trip's id.** It names a row in somebody's trip history —
//     possibly a private trip of somebody who is not the reader. The NAME is
//     the credit the Playbook already shows everyone, so `sourceTrip` carries
//     that alone.
//   - **`keptOn`** (`createdAt`): it is a seeding knob for the content
//     importer. An upload's row is created when it is uploaded.
// `ownerId` IS written, because the format requires it and every reader of the
// Playbook can already see it (`GET /v1/playbooks/{id}`, Discover). An import
// never trusts it.

import { z } from "zod";
import type { SavedDay } from "@tc/contracts";
import { BundlePlaybook, ContentBundleV1, type BundleDay } from "./schema.ts";
import { bundleKeyFor, toBundleStop } from "./fromTrip.ts";

/**
 * What a Playbook export is: a `content-bundle/v1` document carrying **one
 * playbook and nothing else**.
 *
 * `TripExportBundle`'s twin, for its reason: the endpoint's response is
 * validated against this and its OpenAPI entry generated from it, so "an export
 * carries exactly one playbook" is a runtime assertion. The bundle schema never
 * required a trip — `trips` defaults to `[]` — so no variant of the format was
 * needed; this only pins the sections empty.
 */
export const PlaybookExportBundle = ContentBundleV1.extend({
  trips: z.tuple([]).default([]),
  playbooks: z.array(BundlePlaybook).length(1),
  notebooks: z.tuple([]).default([]),
  activities: z.tuple([]).default([]),
});
export type PlaybookExportBundle = z.infer<typeof PlaybookExportBundle>;

/**
 * A stored sequence as authored days: day `d` holds the stops whose `dayIndex`
 * is `d`, in stored order, for every `d` below `dayCount`.
 *
 * The inverse of `toSavedSequence`. **Built from `dayCount`, not from the
 * stops**: an interior gap in `dayIndex` and a trailing day with no stops are
 * both empty days the author kept (ADR-048 decision 2), and only the count
 * knows the trailing one is there.
 */
export function toBundleDays(playbook: Pick<SavedDay, "stops" | "dayCount">): BundleDay[] {
  // The read boundary repairs `dayCount` up to the stops' floor, but this is a
  // pure function and may be handed a DTO that never crossed it.
  const count = playbook.stops.reduce((n, s) => Math.max(n, s.dayIndex + 1), playbook.dayCount);
  const days: BundleDay[] = Array.from({ length: count }, () => ({ stops: [] }));
  for (const stop of playbook.stops) days[stop.dayIndex]!.stops.push(toBundleStop(stop));
  return days;
}

export type PlaybookToBundleOptions = {
  /** `bundle.generatedAt`, ISO 8601. Passed in, never read off the clock. */
  generatedAt?: string;
};

/**
 * A Playbook as a one-playbook `content-bundle/v1` document.
 *
 * Always the `days` form, even for one day: it is the one that can say "day 2
 * is a rest day", and one shape out is simpler to read back than two.
 *
 * **Not guaranteed to validate.** `SavedStop.title` and `notes` are unbounded
 * strings; `BundleStop`'s are `AddActivity`'s bounds (1..200, <=2000). A
 * Playbook written inline over `/v1/playbooks` can hold a stop outside them —
 * and could not be applied to a trip either. The caller parses the result
 * against `PlaybookExportBundle` and refuses, naming the stop, rather than
 * trimming it here.
 */
export function playbookToBundle(
  playbook: SavedDay,
  options: PlaybookToBundleOptions = {},
): PlaybookExportBundle {
  const key = bundleKeyFor({ tripId: playbook.savedDayId, name: playbook.name });
  return {
    $schema: "travel-collab/content-bundle/v1",
    bundle: {
      id: key,
      name: playbook.name,
      // Who wrote the content, inherited by the playbook below — the same
      // claim the row makes, not a claim about who exported it.
      origin: playbook.authorKind,
      sources: [],
      ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    },
    trips: [],
    playbooks: [
      {
        key,
        name: playbook.name,
        ...(playbook.summary !== null ? { summary: playbook.summary } : {}),
        ownerId: playbook.ownerId,
        visibility: playbook.visibility,
        origin: playbook.authorKind,
        version: playbook.version,
        sourceTrip: { name: playbook.sourceTripName },
        addedBy: [],
        days: toBundleDays(playbook),
      },
    ],
    notebooks: [],
    activities: [],
  };
}

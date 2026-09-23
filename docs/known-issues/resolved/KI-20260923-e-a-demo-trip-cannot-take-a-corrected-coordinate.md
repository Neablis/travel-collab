### KI-2026-09-23-e — A demo trip in production cannot take a corrected coordinate; re-import skips it — RESOLVED

- **Severity:** correctness. Two stops on one public demo trip draw pins in the
  wrong place, and the documented publish path cannot fix them.
- **Area:** `apps/web/scripts/import-content-production.ts` (`importTrips`,
  create-if-absent); `content/trips/thailand-andaman.json` (trip key
  `thailand-andaman`).

- **What is wrong in production.** The 2026-09-23 geocode audit corrected two
  stops in `content/trips/thailand-andaman.json` by hand:

  | Stop | Production has | File now has |
  |---|---|---|
  | Yaowarat Road and Soi Texas (Chinatown) | 13.881591, 100.644533 — "Bangkok, Sai Mai", ~21 km north | 13.741152, 100.508311 — Yaowarat Road, Samphanthawong |
  | Ao Nang longtail pier | 7.88998, 99.028075 — Laem Kruat pier, ~25 km off | 8.031092, 98.821883 — Ao Nang beach |

  The same audit's fourteen playbook-day corrections ship on an ordinary
  `import-content-production` run, because days are deleted and rewritten by
  derived id. These two do not.

- **Why re-import does not fix it.** `importTrips` issues `CreateTrip` against
  `tripIdFor(bundle.id, key)`, and treats the domain's `trip-already-exists` as
  "done" (it only resumes a trip with no days). That is deliberate — a trip is
  an event stream, and rewriting one would discard its history — but it means
  **no edit to a trip bundle's content ever reaches a trip already imported**.
  The guideline's workaround, changing the trip's `key`, creates a second trip
  and leaves the first: `--prune` only considers `saved_days`, so the stale trip
  stays, owned by `service-ai-library`, which nobody can sign in as to delete it.

- **The fix.** For a trip that already exists, compare each bundle stop's
  location with the trip's current state and issue `UpdateActivity` (which
  already exists in `packages/contracts/src/activity.ts`) through
  `executeTripCommand` for any that differ. That is real events on the existing
  stream — invariant 1 holds, and history is added to rather than replaced.

- **Workaround until then.** None needed for correctness of new environments:
  the file is right, and a fresh import writes the right pins.
- **First noted:** 2026-09-23.
- **Resolved:** 2026-09-23. Applied the fix as recorded. For a trip that
  already exists and has days, `importTrips` now calls `reconcileLocations`,
  which plans with `planBundleLocationReconcile`
  (`apps/web/src/server/bundleLocationReconcile.ts`: fold the stream, pair each
  stop with its activity, compare) and sends one location-only
  `UpdateActivity` per stop that differs, through `executeTripCommand`.
  Nothing else about the trip is reconciled. **Pairing is by title within the
  stop's own day (or the backlog)**, and the k-th stop with a title takes the
  k-th activity with it. There was no derived id to use:
  `bundleTripCommandGroups` mints activity ids with `randomUUID`. A stop or
  activity that pairs with nothing is printed as `unmatched` and left alone.
  "Differs" is the domain's own `activityStatesEqual`, which is the same
  comparison `UpdateActivity` uses to refuse a no-op. So an unchanged file
  sends zero commands. `--dry-run` now reads the target and prints each move,
  old → new, while writing nothing. `--skip-trips` skips all of it. A
  soft-deleted trip is left alone.
  Reproduced first, by the integration test below, run against the
  unfixed importer: re-import left the stop at `13.881591, 100.644533` where
  the file said `13.741152, 100.508311`. Proven with
  `apps/web/src/server/importContentProduction.int.test.ts` (3 tests). The
  first imports a bundle, corrects one coordinate and re-imports: the activity
  takes the new location, exactly one `ActivityUpdated` is appended, and a
  third run appends nothing. The other two cover the dry run and an unpairable
  stop. Seen red twice. With the send disabled, the test fails on the old
  coordinate. With the no-op guard removed, the third run throws `no-op — This
  change would have no effect.` Also run once, as a scratch test, over
  `main`'s `thailand-andaman.json` followed by this branch's. It moved exactly
  the two stops in the table (day 1 Yaowarat, day 3 Ao Nang longtail), reported
  0 unmatched, and a repeat run appended 0 events.
- **Production still has the wrong pins until `import-content-production` is
  dispatched from `main`**, and that dispatch cannot succeed yet for a
  different reason, reported separately rather than fixed here. Loaded under
  Node's strip-only TypeScript, the importer dies before `main()` runs:
  `src/server/entitlements/planVersions.ts:358`'s `constructor(readonly ref:
  string)` throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (reached through
  `commands.ts` → `access/members.ts` → `entitlements/resolver`). The workflow's
  last success was 2026-09-07. The parameter property arrived on 2026-09-14.

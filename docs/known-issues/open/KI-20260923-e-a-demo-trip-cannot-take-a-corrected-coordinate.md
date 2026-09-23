### KI-2026-09-23-e — A demo trip in production cannot take a corrected coordinate; re-import skips it

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

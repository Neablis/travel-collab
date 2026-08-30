### KI-54 — `activitiesEqual` ignored `city` and `countryCode`, so a change to either was invisible to diff/revert/undo — RESOLVED
- **Severity:** correctness (silent loss of a user's edit on revert/undo — same family as KI-5 and KI-42, on a different trigger)
- **Area:** `packages/domain/src/trip/equality.ts`
- **Symptom:** `activitiesEqual` compares `Location` **field by field**, and the list was hand-maintained: `name`, `lat`, `lng` (and, from KI-35, `area`). `city` and `countryCode` were never in it. `diffTripStates` is built on this predicate, so an activity whose *only* change was its city or country code compared EQUAL — the diff emitted no `ActivityUpdated`, and a revert or undo through that path silently kept the old value while the UI had already shown the new one.
- **Not hypothetical:** `city` is written by the geocoder on every place pick and is what `cityFor()` uses to name a day and pick its accent. The `accept-language=en` change (`9c3fe15`) re-renders a Japanese location's `city` and nothing else — precisely the edit this predicate could not see.
- **How it surfaced:** found while adding `area` to the same comparison for KI-35 (2026-08-28). `area` was added because omitting it would have had exactly this consequence; the two fields one line over already had it. Filed first, then **CodeRabbit independently flagged the same omission on PR #72 and rated it Major** — which is what changed the call from "file it" to "fix it here".
- **Fix (2026-08-28, PR #72):** `city` and `countryCode` added to the comparison, which is now every persisted field of `Location`. The comment above it says so and tells the next person to extend it in the same commit as any contract change.
- **Proof:** one test **per field** in `packages/domain/test/ki35-location-area.test.ts` (a single combined case would pass with only one of the two comparisons present — the very shape of this bug), each asserting both `tripStatesEqual` is false and that `diffTripStates` emits an `ActivityUpdated`; plus a replay test that a city-only diff, applied through `evolveTrip`, lands on the target state. Mutation-proved by removing each comparison in turn: dropping `city` fails 2 tests, `countryCode` 1, `area` 3.
- **Root cause, still standing:** the hand-enumeration itself, which has now bitten twice. A structural compare would make it unrepeatable. Not done here — it is a change to how equality is *defined*, with a blast radius across undo/revert/diff, and it wants its own diff.
- **First noted:** 2026-08-28 (KI-35 implementation). **Resolved:** 2026-08-28 (PR #72).


Closed issues, kept for the reasoning rather than the status. Nothing here
needs action — skip this section when triaging.

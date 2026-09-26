# M28 — Three kinds

**Status:** Minted, placed and built 2026-09-25, **Mitchell's call, in chat** — after
M24's gate closed, while M14's remaining boxes wait on him. Decision record:
**ADR-054**.

## Why this exists

M18 gave every stop one of five kinds: `planned`, `idea`, `hold`, `booked` and
`transit`. Mitchell, 2026-09-25, after reading back what each one means:

> *"I think we can simplify the types a bit. Planned = Default, Pending = Combo
> Idea / Hold, Transit = Travel. The rest feel too small to be worth complicating
> ui."*

Asked about `booked`, the one kind the list left out: **drop it too**. Asked
whether old values keep working: *"Idea and hold just aren't supported anymore,
simplify."* Under invariants 1 and 2 that cannot mean old trips stop loading, so
it means nothing writes, offers or names them again, and stored data reads them
as their replacement.

## Scope

1. **The contract.** `ActivityKind` is `planned | pending | transit` for every
   writer. `StoredActivityKind` reads `idea`/`hold` as `pending` and `booked` as
   `planned` wherever a stored shape is parsed: event payloads, `trip_details`,
   `saved_days`, content bundles. A page's kind filter is rewritten by a page-document
   migration step (v3 → v4). `trip.bookedCount` is removed through `FIELD_CHANGES`.
2. **The rule.** `needsBooking` is `pending`. The `planned` + `ticketed` exception
   goes with `booked`.
3. **The board.** Badges `Pending` (amber) and `Travel`; the picker offers three; a
   new stop, from the editor or the assistant, starts `pending`.
4. **The notebook.** Labels, presets and templates built on `booked`/`hold`/`idea`
   reworked around "still to book"; the built-in notebooks regenerated.
5. **Data.** The Japan fixture, starter days and every `content/**` file rewritten to
   the three kinds.

## Exit gate

- [x] **A retired kind in every stored shape reads as its replacement** — an event
      payload, a `trip_details` row, a saved stop, a bundle stop and a page's kind
      filter — each with a test **seen to fail** without the translation.
- [x] **A command carrying a retired kind is refused**, with a test.
- [x] **ADR-054 accepted** and `docs/contracts/CHANGELOG.md` carries the entry, with
      every consumer moved in the same change (invariant 5).
- [x] **`needsBooking` is `pending` and nothing else**, enumerated over the enum, and
      the Calendar, the home hero and the notebook's "Still to book" agree.
- [x] **No surface offers or prints a retired kind**: the picker, the badges, the
      notebook's kind select and labels, the presets, the templates, the OpenAPI
      document.
- [x] **The manifest still publishes `stop.kind` with its values** through the
      preprocess wrapper, with a test seen to fail without it.
- [x] `pnpm check` green, `pnpm --filter web test:int` green,
      `pnpm --filter web test:e2e:ci-like` green (**never plain `test:e2e`**), and
      `pnpm seed:verify` green.
- [x] **Walked on the preview**: the kind picker, a Pending badge, the Overview's
      "Still to book", and an existing trip created before M28 opening with its old
      kinds shown as Pending/Planned.
- [x] A retro is appended at gate close. *(2026-09-26, after #239 merged; below.)*

### Gate evidence, 2026-09-25

- **Stored shapes:** `packages/contracts/test/m28-three-kinds.test.ts` covers the
  event payload, `ActivityView`, `SavedStop`, the command refusal, the manifest, and
  the v3 → v4 page step. Each was seen red by making `readActivityKind` pass values
  through, removing `unwrapSchema`'s preprocess case, and making the page step a
  no-op. The bundle stop is `packages/fixtures/src/bundle/schema.test.ts`, "turns
  loose activities into backlog AddActivity commands". **Against the database**
  (#239): `apps/web/src/server/projections.int.test.ts` rewrites a stored doc to
  `booked` and a stored `ActivityAdded` payload to `hold`, then reads the trip and
  replays the log. Both were seen red with the translation off:
  `Invalid enum value … received 'booked'` / `… 'hold'`.
- **`needsBooking`:** `packages/pages/src/needsBooking.test.ts`, seen red at
  `kind !== "planned"` (`transit: expected true to be false`). The Calendar, hero
  and notebook tests were updated to the one rule.
- **DoD:** run on #238's branch before merge.
  - `pnpm check`: lint, typecheck and unit green. Its integration lane failed only
    the known `KI-2026-09-25-p` test.
  - `test:int` on its own: 1082/1082.
  - `seed:verify`: 108.
  - `test:e2e:ci-like`: 182 + 1. The one failure was a test that had been passing
    vacuously; it was corrected and seen red.
  - CI on #238's final head `0d95397`: 8/8 green, including CI's own e2e.
- **Walk:** a verifier session walked #238's preview in Chromium. It checked the
  picker (Planned / Pending / Travel, Pending on create), the Pending (amber) and
  Travel (blue) badges, no badge for Planned, and "Still to book" listing only the
  Pending stop. The Calendar's "1 to book" and the hero's "1 not booked yet"
  agreed. /demo loaded with no Booked / Holding / Idea anywhere. **Bounded
  claim:** the browser could not prove /demo's stored events still carried the old
  words (the preview may have been reseeded). The old-trip half is proven by the
  two integration tests above, not by the walk.
- **Open for Mitchell** (not gating): the `Pending` badge and the `Meal` tag use
  the same amber, differing only in shape.

## Deliberately not here

- **Rewriting stored data.** No event is rewritten and no row is migrated; the
  translation on read is the migration (ADR-054).
- **A "settled" or "confirmed" marker.** `booked` is gone, not moved: nothing replaces
  it as a tag or a field. If the difference turns out to matter, that is a new
  decision.
- **The design export's vocabulary.** `.design-sync/handoff` still speaks five kinds;
  the fixture's drift test reads it through `readActivityKind` rather than editing it.

## Retro — 2026-09-26

**Placed, built and closed within a day.** Two PRs, split only because
CodeRabbit refuses a diff over 100 files:
- #238: the contract, every consumer, the Japan fixture and the tests;
- #239: the 591 kind values in `content/**`, the landing and settings copy, and
  two integration tests against the database.

Both merged, 2026-09-25 and 2026-09-26. The gate is 9 of 9. No migration: the
translation on read is the migration (ADR-054).

**The Definition of Done.** #238's full run is in the evidence block above. For
#239, CI on its final head `82ce98c` was 8 of 8 green, including
`static-and-unit` and `integration-e2e`. That head's tree is exactly `main` at
`f650554` (a squash), so it is a run on `main`.

**What went well.**
- **Reading the decision against the invariants before building.** *"Not
  supported anymore"* read literally would have made every existing trip
  unloadable. It became "never written, always read back", which was confirmed
  once in chat and then built. That one call shaped everything else.
- **One translation, one place.** `StoredActivityKind` sits at the four stored
  parses, and nothing after a parse sees a retired kind. The design export's
  drift test uses the same function instead of a copy.

**What it cost.**
- **A vacuous e2e assertion surfaced.** The multi-filter walk had been passing
  on a "Ramen" that came from a different widget. It was rewritten to prove the
  kind binding and seen red. It predates M28; M28 only exposed it.
- **Main moved under the PR twice, from outside it.** `f77d4b1` ("Added
  handoff") replaced `.design-sync/handoff/SPEC.md` and `README.md` wholesale,
  dropping both generated indexes. That turned `static-and-unit` red on `main`
  and on #239, one index at a time. #239 carries both fixes
  (`spec-section-index.mjs --write`, `route-artboard-index.mjs --write`). **Any
  handoff that replaces those files must rerun both scripts.**
- **Squash merges, again.** Both parts were squash-merged rather than
  merge-committed, so part 2 needed a normal merge from `main` to recover.

**Left open, not gating.**
- **The Pending badge shares the Meal tag's amber.** Mitchell has a design
  handoff queued that addresses Pending and Travel, and it decides this.
- **`booked` has no replacement.** If "settled" turns out to matter, that is a
  new decision, not a revival of the kind (ADR-054, Rejected).

**M14 is current again**, by this gate closing.

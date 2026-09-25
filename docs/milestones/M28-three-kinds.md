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

- [ ] **A retired kind in every stored shape reads as its replacement** — an event
      payload, a `trip_details` row, a saved stop, a bundle stop and a page's kind
      filter — each with a test **seen to fail** without the translation.
- [ ] **A command carrying a retired kind is refused**, with a test.
- [ ] **ADR-054 accepted** and `docs/contracts/CHANGELOG.md` carries the entry, with
      every consumer moved in the same change (invariant 5).
- [ ] **`needsBooking` is `pending` and nothing else**, enumerated over the enum, and
      the Calendar, the home hero and the notebook's "Still to book" agree.
- [ ] **No surface offers or prints a retired kind**: the picker, the badges, the
      notebook's kind select and labels, the presets, the templates, the OpenAPI
      document.
- [ ] **The manifest still publishes `stop.kind` with its values** through the
      preprocess wrapper, with a test seen to fail without it.
- [ ] `pnpm check` green, `pnpm --filter web test:int` green,
      `pnpm --filter web test:e2e:ci-like` green (**never plain `test:e2e`**), and
      `pnpm seed:verify` green.
- [ ] **Walked on the preview**: the kind picker, a Pending badge, the Overview's
      "Still to book", and an existing trip created before M28 opening with its old
      kinds shown as Pending/Planned.
- [ ] A retro is appended at gate close.

## Deliberately not here

- **Rewriting stored data.** No event is rewritten and no row is migrated; the
  translation on read is the migration (ADR-054).
- **A "settled" or "confirmed" marker.** `booked` is gone, not moved: nothing replaces
  it as a tag or a field. If the difference turns out to matter, that is a new
  decision.
- **The design export's vocabulary.** `.design-sync/handoff` still speaks five kinds;
  the fixture's drift test reads it through `readActivityKind` rather than editing it.

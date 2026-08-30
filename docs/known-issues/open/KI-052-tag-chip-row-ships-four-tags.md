### KI-52 — The tag chip row ships four tags where the handoff designs six

- **Severity:** cleanup (a recorded design delta, not a defect)
- **Area:** `packages/contracts/src/activity.ts` (`ActivityTag`),
  `.design-sync/handoff/design/Trip Planner Redesign.dc.html` (its `TAGS` array)
- **What differs:** the handoff defines six tags — `considering`, `meal`,
  `lodging`, `travel`, `ticketed`, `outdoors` — each with a "power" (a
  behaviour the tag unlocks). M18 shipped `ActivityTag` with **four**:
  `meal | lodging | ticketed | outdoors`.
- **Why:** `considering` and `travel` restate `ActivityKind`'s `idea` and
  `transit`. Making both settable and independent lets a stop be
  `kind: "booked"` **and** tagged `considering`, which the design says should
  render dashed with its cost outside the committed total — under a "Booked"
  badge. No surface owns that contradiction, and nothing in the build wants it.
  The handoff's own prototype never stores those two either: it *derives* them
  (`if (a[6] === 'idea') out.push('considering')`), which is the same
  observation arriving from the other direction. Mitchell's call, 2026-08-27.
- **What this costs:** the designed chip row and the Add/Edit tag picker show
  six chips; the build will show four. Any surface that wants "is this a maybe?"
  or "is this travel?" reads `kind`, not `tags`. Recorded here so the next
  design sync scores it as a settled delta rather than re-raising it as drift.
- **Not scheduled:** reopening it would mean either accepting the contradiction
  or deriving two read-only pseudo-tags in the projection. Neither is worth
  doing before the tag surfaces exist.
- **Cross-reference:** KI-47 (resolved — the `tags` field itself);
  the 2026-08-27 contracts changelog entry.
- **First noted:** 2026-08-27 (M18 contract PR).

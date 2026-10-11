### KI-52 — The tag chip row ships four tags where the handoff designs six — RESOLVED

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
- **Re-verified 2026-09-25 (overnight sweep):** still true. `packages/contracts/src/activity.ts:195` is `z.enum(["meal", "lodging", "ticketed", "outdoors"])`, and the handoff's `TAGS` (`Trip Planner Redesign.dc.html:8896-8903`) still lists six, `considering` and `travel` included. One thing above is stale: "before the tag surfaces exist". They exist now: `ActivityEditor.tsx`, `ActivityCard.tsx`, `lib/activityTags.ts`, the board's filter and the notebook's `widgetBind.tsx` all read `ActivityTag`. The delta is still settled by decision, not scheduled.
- **Resolved 2026-10-11 (M42 part 1), superseded by ADR-070.** The question changed under it:
  the delta was never really "four, not six" but "four tags cannot describe a trip". ADR-070
  keeps `considering` and `travel` out for the reason above (they restate a kind) and widens
  `ActivityTag` to thirteen instead: twelve categories (`meal`, labelled *Food*, `lodging`,
  `outdoors`, and nine appended: `drinks`, `nightlife`, `museum`, `sight`, `beach`, `shopping`,
  `show`, `tour`, `wellness`) and one modifier (`ticketed`), picked in two groups, *What it is*
  and *Needs*. No delta against the handoff's six is left to record. **Proof:**
  `apps/web/src/lib/activityTags.test.ts` enumerates `ActivityTag.options` and fails when a tag
  has no label, no chip colour, or not exactly one picker group (seen red with `wellness` dropped
  from the picker: *"picker groups holding wellness: expected [] to have a length of 1 but got
  +0"*), and `packages/contracts/test/m18-kind-tags.test.ts` pins the thirteen values in contract
  order. Checks: `pnpm typecheck`, and those test files run by name.

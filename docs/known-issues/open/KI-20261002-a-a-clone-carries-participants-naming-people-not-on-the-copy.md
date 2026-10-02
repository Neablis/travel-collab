### KI-2026-10-02-a — a clone carries `participants` and `bookedBy` naming the source trip's members, who are not on the copy, so its stops are priced for them

- **Severity:** correctness. Since ADR-060 a stop's price is multiplied by its
  headcount, and the headcount is whoever `participants` names. A copy's stops
  keep naming people who are not on the copy, so the copy's totals are priced
  for them, and from M19 part 2 its "Who owes what" would list them too.
- **Area:** `apps/web/src/server/cloneTrip.ts` — `remapIds`, which remaps day and
  activity ids and copies every activity's fields as they are, and `cloneFrom`,
  which all three copies share (`duplicateTrip`, `cloneSharedTrip`,
  `cloneDemoTrip`). The demo's stops get their `participants` from
  `packages/fixtures/src/japan/participants.ts`.
- **Symptom / What happens:** the copy's membership is the cloner alone (the
  comment in `cloneFrom` notes that `members` is never diffed). Its activities still
  hold `participants: ["Priya", "Mei"]`, `bookedBy: "dev-bob"`, and so on. Those
  ids name nobody on the trip, so *Who is in* shows no toggle for them, and
  each such stop is priced for 2 rather than for the one person on the trip.
  The plainest case is `/demo`'s **"Make this trip mine"**: the visitor's copy
  of the Japan trip totals **$11,275** where one person going everywhere would
  be **$9,085**. Nine stops pick two travellers, and each is priced twice.
  Duplicating or cloning any shared trip whose stops have picks does the same.
  It has done so since M13 link 5 gave stops `participants` and `bookedBy`. It
  only started to cost money with ADR-060, and became easy to see when the
  demo's stops gained picks (M19 part 1).
- **Why not fixed here:** found while giving the demo its participants, which
  was a fixture change, not a change to cloning. The fix is a product decision,
  not a mechanical one. Clearing `participants` and `bookedBy` on every copy
  matches SPEC §27's "travellers cleared — a copy is a starting point". But a
  Duplicate inside the same group could reasonably keep the picks for members
  who are still on it. Filtering both fields to the copy's members (the cloner)
  is the likely answer. Either way it belongs in `remapIds`, the one place a
  copy's activities are rewritten.
- **Cross-reference:** ADR-060 (decisions 2 and 6), ADR-028 (cloning), ADR-031
  (the demo trip), M19 part 2 (balances would list the strangers), SPEC §27.
- **First noted:** 2026-10-02, M19 part 1 follow-ups on
  `claude/m19-p1-per-person`.

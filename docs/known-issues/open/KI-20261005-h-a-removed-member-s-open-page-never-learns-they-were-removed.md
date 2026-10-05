### KI-2026-10-05-h — a removed member's open page never learns they were removed

- **Severity:** cosmetic and confusing, low reach. Nothing leaks after removal: every read and
  write the removed person makes is refused by the server. Their open page just goes on showing the
  trip as if nothing happened.
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` (`onAccessRevision` /
  `reloadAccess`) and the trip page's refused-read state.
- **Symptom / What happens:** the PR #335 preview walk on 2026-10-05, at `edaad30`:
  1. A member keeps the trip page open with Trip settings showing People.
  2. The owner removes them.
  3. Twenty seconds later the member still sees the full trip, and themselves listed in People.
     The console shows one `Failed to load resource: 403`, and nothing on the page changes.
  4. On reload, the page reads a bare `forbidden` with only "← Your trips" below it.
- **Why:** removing a member bumps `accessRev` (travellers spec D11, W5), but the removed member's
  events poll is now refused, so they never see the bump. The failed access re-read is silent by
  design (W19). The bare `forbidden` page predates this work: the trip page route is not in PR
  #335's diff.
- **Likely fix:** treat a 403 on the events poll or the access re-read as "you no longer have
  access", and show the same "you are not on this trip any more" state the reload should show,
  with a link home. Give the reload a designed state as well, not a bare `forbidden`.
- **Cross-reference:** M35 (`docs/milestones/M35-travellers-and-people.md`), spec D11, W19.
- **First noted:** 2026-10-05, M35 preview walk. `grep -rli forbidden docs/known-issues/open/`
  found no existing entry.

# M44 — A stop knows what was booked, and what it sits inside

**Status:** **Scoped 2026-11-02 by Mitchell; current.** All four decisions answered as
recommended, plus a fifth (where the booked list lives), below. Mechanisms in ADR-086; the plan is
`docs/plans/2026-11-02-M44-booking-and-containment.md` (deleted at gate close). Part 0 is
`claude/next-milestone-5o3kip`.

*2026-10-22:* `booking` was moved to M52 for flight details, then **handed back on 2026-10-23**
(M52 decision 5, as amended: M52 built only `flightNumber`). M44 owns `booking` and containment.

## Why this exists

Two entries ask the activity contract to say something it cannot say today. Both are changes to
`packages/domain` and to event payloads that are replayed forever (invariants 1 and 2). Doing them
in one milestone means one contracts review, one public API minor version and one migration
window.

- **Booking details.** An external API consumer keeps confirmation numbers in `notes`. Mitchell
  chose, on 2026-09-30, not to adopt a notes convention, because parsing free text is fragile and
  gives API callers nothing typed. The shape if it comes: `booking: { confirmation?, provider?,
  url? }`.
- **Containment.** A lunch inside a day-long museum visit raises `time-overlap`, and every day of
  the Rochester run did (2026-08-02). *"three warns on a three-day trip is the AI teaching users to
  ignore the conflict UI"*.

Candidates absorbed (each deleted by this gate):
- *Structured booking fields on a stop: confirmation number, provider, link* (2026-09-30)
- *Contained activities: a meal inside a day-long activity is not a conflict* (2026-08-02)

## Decisions (answered 2026-11-02 by Mitchell, each as recommended)

1. **`booking` is an optional object on any stop**: `booking: { confirmation?, provider?, url? }`,
   set and cleared through the existing `UpdateActivity` command (clearing all three clears it,
   stored as `null`). Additive: old events carry no `booking` and replay as `null`; no migration
   (activities live in event payloads and the `trip_details` projection). The public API takes a
   minor version. **Interaction:** the stop editor has a collapsed *Booking* section with
   Confirmation, Provider and Link fields; the river card shows a *Booked · Provider* chip, and an
   editor's tap on it copies the code or opens the link.
2. **A confirmation code and link are for editors and owners.** Viewers and suggesters see that a
   stop is booked and its provider, not the code or link. The code is stripped from share links
   (`/s/**`), saved and published playbook days, and trip export unless the caller is at least an
   editor. The assistant sees only *booked: yes/no* and the provider. This is the first field-level
   role rule on a trip read (ADR-086).
3. **Check-in and check-out times stay in the time window**, not in `booking`.
4. **Containment is rule (c)**: in `conflicts.ts`, `time-overlap` is suppressed when one window
   fully contains the other and the inner stop is at most 2 hours long or tagged `meal`. A partial
   overlap still warns. Nested activities stay out.
5. **The booked list is a new `stop.rows` filter, `only: "booked"`**, a *Booked* list under
   *Still to book* in the notebook templates that already carry it. Each row shows the provider,
   and the code for editors and owners. **No back-fill**: new trips get the
   Booked list from the template (the Bookings and Dinner tracker templates); an existing notebook
   gets it only through "Reset to default" (which replaces the notebook with its seed, with Undo)
   or by adding the list by hand. M43 built no template sync: "Add missing default notebooks"
   skips an existing Bookings notebook. (Amended on part 0, "no back-fill": Mitchell, 2026-11-02.
   Scope named "the Money notebook's booked list", which never existed; Mitchell, 2026-11-02.)

## Scope

- `booking` across the contract, the domain, the editor, the card, the Money notebook's booked
  list, the public API and trip export (M25).
- The containment rule and its property test.

## Out of scope

- Parsing confirmation emails.
- Nested activities.
- A Booked chip and provider on the share page (`/s/**`). The share API already returns
  `booking: { provider }`, but the page renders none. Deferred by Mitchell on the PR 684 preview
  pre-walk, 2026-11-02 ("share chip later"); recorded in `docs/candidates.md` as "The share page
  shows a stop is booked".

## Exit gate

- [x] **Decisions 1–5 are answered and recorded here**, with the contracts changelog entry.
      Evidence: D1–D5 above, D5 amended in 7317ffe; contracts changelog entries for M44 at `docs/contracts/CHANGELOG.md:16` (part 3) and :40 (part 2) on `claude/m44-part5-booked-list`.
- [x] **A trip replayed from a log written before the change equals its stored projection**, which
      a test shows, because old events carry no `booking`.
      Evidence: `packages/domain/test/m44-booking.test.ts:37-49` (parses the pre-change doc, key deleted, and `toEqual`s the replay) at 66d216c; unit green in CI run 41437935254 (https://github.com/Neablis/travel-collab/actions/runs/41437935254) at 66d216c, `ci-ok` green.
- [x] **A confirmation number never reaches a share link or a published day**: an integration test
      reads both.
      Evidence: `apps/web/src/server/access/shares.int.test.ts:317-338` (share link, via `readShare` and the public route) and `apps/web/src/server/savedDays.stops.int.test.ts:239-285`, published day read by a stranger at :276, at 66d216c; integration green in CI run 41437935254 (https://github.com/Neablis/travel-collab/actions/runs/41437935254) at 66d216c, `ci-ok` green.
- [x] **A short stop inside a long one raises no overlap**, and a partial overlap still does.
      Shown by a `fast-check` property, seen red with the rule removed.
      Evidence: `packages/domain/test/conflicts.test.ts:530` (short or meal never warns), :548 (long non-meal still warns), :584 (partial overlap always warns) at 66d216c; unit green in CI run 41437935254 (https://github.com/Neablis/travel-collab/actions/runs/41437935254) at 66d216c, `ci-ok` green. Seen red with the rule absent: PR 680 body, `Property failed after 1 tests ... Counterexample: [{"os":0,"oe":2,"is":0,"ie":1},false]`.
- [x] **The Rochester-shaped fixture produces no `time-overlap` warnings.**
      Evidence: `packages/domain/test/m44-rochester-containment.test.ts:20-26` (folds `support/rochester.ts` commands, asserts three days and no `time-overlap`; PR 680 body records it red before the rule) at 66d216c; unit green in CI run 41437935254 (https://github.com/Neablis/travel-collab/actions/runs/41437935254) at 66d216c, `ci-ok` green.
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: add a booking, see it on the
      card, open the share link, and see no code.
      Evidence: `apps/web/e2e/m44-booking.spec.ts:11-80` (adds a booking, chip at :45, share link at :64-77 with no code in text or HTML) at 66d216c; e2e 1/2 and 2/2 green in CI run 41561850267 (https://github.com/Neablis/travel-collab/actions/runs/41561850267) at 2696b5a, the head PR 684 merged with (`ci-ok` green, checked 2026-11-03); the earlier evidence was CI run 41437935254 at 66d216c.
- [x] A retro is appended at gate close.
      Evidence: the `## Retro` section below, written 2026-11-03 on part 0.

## Retro — written 2026-11-03 (7 of 7 boxes ticked)

All five code parts and part 0's stack are on `main`: PRs 680 to 683 in `1540f9e`, PR 684 in `4f75af0`. No migration (none between `6a6d446` and `4f75af0`), so no `migrate-production`.

### What went well

- **The whole stack went green on the one full CI run.** PR 684's final head `2696b5a` has `ci` run 41561850267 with `ci-ok`, unit, integration, e2e 1/2 and 2/2 all green; boxes 2 to 6 were ticked on run 41437935254 at `66d216c`, and the e2e box now cites the later run, since `2696b5a` is what merged.
- **The rule that mattered was proven red, then green.** The containment property failed with the rule absent (PR 680 body, counterexample recorded) and the Rochester fixture was red before it.
- **The pre-walk caught a real defect before Mitchell did.** The phone Booked chip covered the card's edit target; fixed in 5dc2bd1 (drop the chip's 44px phone floor) and reviewed. It also found the share page shows no Booked chip, which Mitchell deferred (`docs/candidates.md`).
- **No coordinator re-writes and no guard misfires beyond two denied dispatches** in build session 2 (`implementer-brief-check`, both correct).

### What could be better

- **The preview was skipped until the `preview` label was added.** The top PR had no preview link at the first walk attempt; previews are on demand. The walk should start by adding the label.
- **Marking lower parts ready mid-close ran CI on them and showed two reds.** Part 2's API version bump had been deferred to part 3, so part 2 alone failed its fingerprint test (fixed on part 2, merged up); and `TripProvider.suggest.test.tsx:161` flaked on PR 683 (KI-2026-11-02-a, from main via PR 575). Lower parts stay drafts until the top's CI is read (`close-a-milestone` step 1); a deferred piece should not fail the part that defers it.
- **The orchestrator converted PRs 680 to 683 back to draft against Mitchell's intent**, and he reversed it. It cost a round trip; a PR Mitchell has marked ready is his to leave.
- **The orchestrator's share of the spend missed its target in all three sessions** (28.4%, 34.2%, 62.4%); see the spend block.
- **The shipped Booked chip is below the 44px phone touch floor**, an accepted exception that the 390px e2e cannot detect (it clicks beside the chip). Filed as KI-2026-11-03-a with a fix.

### Leftovers

- **KI-2026-11-03-a** — the chip's touch floor; fix is a non-interactive label on phones plus a Copy code button in the editor's Booking section.
- **KI-2026-11-02-a** — the flaky `TripProvider.suggest` unit test, test-only fix on main.
- **The share page shows no Booked chip** — `docs/candidates.md`, "The share page shows a stop is booked".
- **Back-fill of existing notebooks' Booked list** — not built (D5 amended: "Reset to default" or by hand); Mitchell's call if it hurts.

## Spend

Three sessions worked this milestone: build session 1, build session 2 and the close. Combined: 43 agents, 1,091 API calls, 15.04M units; the orchestrator was 5.58M of it (37.1%). Dollars were recorded for the close session only ($12.65, $5.04 per 1,000 lines added on 2,510 lines outside `docs/`, generated JSON and the lockfile); build sessions 1 and 2 were measured in units, so no combined dollar figure is given.

**Build session 1:** 24 agents, 789 calls, 9.91M units. `phase-implementer` 11 agents 4.33M (43.6%); orchestrator 2.80M (28.2%, peak 268k); `part-reviewer` 11 agents 2.50M (25.3%). Orchestrator target missed (28.4%).

**Build session 2:** 10 agents, 130 calls, 1.56M units. Orchestrator 545k (34.9%, peak 153k); `general-purpose` (ci triage) 2 agents 487k (31.2%); `phase-implementer` 3 agents 266k (17.1%, worst peak 52k); `part-reviewer` 4 agents 263k (16.9%). Targets: orchestrator < 15% missed (34.2%); implementer > 250k avg met (worst 44k); coordinator re-writes met (0). `implementer-brief-check` denied 2 dispatches.

**Close session (generated):**

<!-- session-metrics:milestone v1 -->

9 agents, 172 API calls, 3.57M units, $12.65 recorded. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | ≈ $ | Share |
|---|---|---|---|---|---|---|---|
| `orchestrator` | 1 | 71 | 161k | 217k | 2.23M | $7.89 | 62.4% |
| `general-purpose` | 5 | 54 | 82k | 104k | 952k | $3.37 | 26.7% |
| `phase-verifier` | 1 | 30 | 52k | 72k | 240k | $0.85 | 6.7% |
| `phase-implementer` | 1 | 12 | 40k | 47k | 101k | $0.36 | 2.8% |
| `part-reviewer` | 1 | 5 | 27k | 31k | 49k | $0.18 | 1.4% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units | ≈ $ |
|---|---|---|---|---|---|---|
| Triage unit reds on 681/683 | `general-purpose` | 21 | 87k | 103k | 301k | $1.07 |
| Pre-walk M44 preview | `phase-verifier` | 30 | 52k | 72k | 240k | $0.85 |
| Tick M44 gate boxes 2-6 | `general-purpose` | 11 | 92k | 104k | 221k | $0.78 |
| Close M44 gate on part 0 | `general-purpose` | 9 | 77k | 82k | 164k | $0.58 |
| Amend D5 on part 0 | `general-purpose` | 8 | 71k | 76k | 145k | $0.51 |
| Record candidate and flaky KI | `general-purpose` | 5 | 71k | 75k | 122k | $0.43 |
| Fix phone Booked chip overlap | `phase-implementer` | 12 | 40k | 47k | 101k | $0.36 |
| Review phone-chip fix | `part-reviewer` | 5 | 27k | 31k | 49k | $0.18 |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | ≈ $ | Share of orchestrator | Idle |
|---|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | $0.00 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 7 | 183k | $0.65 | 8.2% | – |
| Subagent finished | 14 | 1.60M | $5.67 | 71.8% | – |
| Harness | 3 | 0 | $0.00 | 0.0% | – |
| Human | 7 | 445k | $1.58 | 20.0% | – |
| Other (unrecognised frame) | 0 | 0 | $0.00 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 0 | 0 |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

None recorded.

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 62.4% |
| No phase-implementer averaging > 250k context | met | worst 40k |
| GitHub wakes per merged part < 5 | met | 0 / 5 = 0.0 |
| Dollars per 1k lines added < 20 | met | $5.04 |
| Coordinator-message re-writes <= 2 | met | 0 |

### Spend against the last milestone

- **Dollars per 1,000 lines added (under 20):** met for the close session alone ($5.04); not computable for the milestone, as build sessions 1 and 2 recorded no dollars here.
- **Orchestrator's share (under 15%):** missed in every session (28.4%, 34.2%, 62.4% in the close, which was almost all orchestration of triage, a pre-walk and the closing edits; 37.1% combined). The close is mostly the orchestrator by design, so the build sessions' 28 to 34% are the figures to act on.
- **A builder's average context (none over 250k):** met (worst 44k in build session 2, 40k in the close).
- **GitHub wakes per merged part (under 5):** met in the close (0 of 5); not recorded for the build sessions.
- **Cache re-writes after a coordinator message (2 or fewer):** met (0 in build session 2 and the close).

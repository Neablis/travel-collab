# M43 — A trip's notebooks keep up with their templates

**Status:** **Built 2026-11-01; gate 4 of 6, waiting on Mitchell's production walk.** All four
code parts are on `main` in `e3629e2` (PRs 661, 662, 660, 663), `0070` is applied, and the retro
draft is below. **Scoped 2026-10-31 with Mitchell**: decisions 2 to 5 are answered below, each as
recommended; the ADR-037 amendment of that date records decision 4. Plan:
`docs/plans/2026-10-31-M43-notebooks-keep-up.md` (four parts). Proposed 2026-10-06; moved last
2026-10-12, after M49, by Mitchell (nothing it fixes is hurting today). Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).
**Shrunk 2026-10-17, by Mitchell, to what is not built.** Seed back-fill and reset were built
before this milestone was scoped (see *Already built* below), so they leave the scope and the gate.

## Already built (not this milestone's work)

The reset / add-missing PR of 2026-09-27 (ADR-036's two amendments of that date) shipped both
halves of Mitchell's *"reset a trips default notebooks back to there seed and add any new seeds"*:

- **Add missing default notebooks**: an owner-only button (`NotebookScreen.tsx`), the
  `pages/defaults` route and `addMissingDefaultPages` (`pageCommands.ts`). Seed identity is
  `pages.seed_key` with the partial unique index `pages_seed_key_unique` (migration `0032`).
- **Reset to default**, with Undo: `ResetToDefault.tsx` behind the notebook's menu, the
  `reset` and `restore` routes, `resetPageToDefault` (one `EditPage`, the page id kept).
- Covered by `defaultNotebooks.int.test.ts`, both routes' int tests, `ResetToDefault.test.tsx`
  and `e2e/notebook-reset.spec.ts`.

The back-fill is a button, not automatic on the next notebook list. **That is the decision**
(Mitchell, 2026-10-17: the UI way works): a read still appends no events (`pages.ts`).

## Why this exists

The open notebook entries date from #170's preview (2026-09-13):

- **The Overview is identified by a string inside a JSON document** (`PageContext.kind`), and the
  delete refusal reads it in application code. *"let's make sure the overview notebook is special
  cased in db"*. Today `seed_key = 'overview'` sits beside it, so there are two sources of truth,
  and a second Overview is refused only as a side effect of `pages_seed_key_unique`.
- **The `open` widget is a two-column table, and the design is not a table**. *"it looks nothing
  like the designs"*. Mitchell also asked for a type filter and a date filter on it.

Candidates absorbed (each deleted by this gate):
- *The Overview notebook's identity moves from `context.kind` into the database* (2026-09-13)
- *The seeded Overview is titled `Overview — <trip name>`* (2026-09-13)
- *`open` ("What needs you") is built as a two-column table and the design is not a table*
  (2026-09-13)
- *`open` takes filters: which kind of open item, and over which days* (2026-09-13)

## Decisions (answered 2026-10-31 by Mitchell, each as recommended)

1. ~~*Add missing seeds* is automatic; *Reset to template* is a confirmed action.~~ **Answered
   by what was built** (2026-10-17): add-missing is an owner's button, and reset is a confirmed,
   undoable action in the notebook's menu.
2. **`pages.kind` is a column, and the context field leaves.** (Or `seed_key = 'overview'` is the
   identity, and only `PageContext.kind` leaves: one fewer migration.) *Recommended:* a column with a
   partial unique index on `(trip_id) WHERE kind = 'overview'`. The guard becomes a predicate, and
   `PageContext.kind` is retired in the contracts changelog. Keeping it as a mirror would mean two
   sources of truth.
3. **The Overview's title is derived at read time**, as `Overview — <trip name>`, so a rename
   follows the trip. Existing rows keep their stored title as an override only if the user has
   renamed them.
4. **`open` gets its own row shape.** It stops being a `repeat`. ADR-037 decision 3 (no HTML
   crosses the seam) stands, so `act` is a declared navigation target the renderer turns into a
   link, not a control the widget emits. This is an ADR-037 amendment.
5. **The type filter offers the three row classes** (conflict, empty day, parked), not the six
   labels. `Conflict.kind` is an open string, so a closed six-value control would make any kind the
   domain adds later unreachable by the filter. The date filter is the existing `dates` dimension.

**Answers, 2026-10-31 (Mitchell):**

- **2: a `pages.kind` column.** Migration `0070` adds it, backfilled from `context->>'kind'`
  (one winner per trip, the way `0032` chose its `seed_key`), with a partial unique index on
  `(trip_id) WHERE kind = 'overview'`. `PageContext.kind` is retired in
  `docs/contracts/CHANGELOG.md`. The survey found a hole this closes: both page-create routes
  (`/api/trips/:id/pages`, `/api/v1/trips/:id/pages`) accept `context.kind = 'overview'` from an
  editor and would create a second, undeletable Overview. After part 1 a person can never set a
  page's kind; only seeding does.
- **3: derive when the stored title is a default.** At read time an Overview whose stored title
  is `Overview` (or a legacy seed title) is shown as `Overview — <trip name>`; any other stored
  title is the user's rename and is shown as stored. Reset writes `Overview` back, so it derives
  again. No migration and no flag: the event log cannot tell a reset from a rename.
- **4: follow the design.** `open` renders its own row shape `{ label, sub, right, tone, act }`
  where `act` is a declared target (a `LinkTarget`, or the widget-only `rack`) the renderer turns into a link (ADR-037 amendment,
  2026-10-31). Parked ideas are **one** grouped row (`N ideas are parked`, the first two titles,
  *Place them*), as the design draws it, not a row per idea.
  Conflicts fold the same way: one row per day and kind, counted (`3 overlaps on Day 1`;
  Mitchell, 2026-11-01).
- **5: three classes, and `open` follows the notebook's date scope.** The class filter offers
  conflict, empty day and parked. The Days filter is the existing `dates` dimension; an explicit
  Days filter wins, otherwise the notebook's date scope applies (`followsDateScope`). Parked
  ideas carry no date, so only the class filter hides them. **On a Today notebook that follows the
  clock, the notebook's scope wins** (the 2026-10-24 rule, kept by part 4's review): its Days
  control is hidden there, so no stored Days filter is silently ignored.

## Scope

- The Overview's identity in the database, and the contracts change retiring `PageContext.kind`.
- The derived Overview title.
- The `open` widget redesigned to `{ label, sub, right, tone, act }` with both filters, in the
  desktop panel and the phone sheet.

## Out of scope

- Public notebook templates (an SEO leftover, and a contract change of its own).
- Seed back-fill and reset: built, above. Making the back-fill automatic: decided against.

## Exit gate

Amended 2026-10-17 (shrunk to the leftovers): the back-fill box and the reset box are removed,
since both were built before this milestone was scoped; the [walk] loses its seeds half.

- [x] **Decisions 2–5 are answered and recorded here**, and the ADR-037 amendment is written.
      *Evidence:* *Decisions*, above: Mitchell's answers of 2026-10-31 (commit `5e1f857`), the
      Today-page precedence from part 4's review (`4f80521`), `act` as an `ActTarget` with the
      widget-only `rack` (`143257e`), and conflicts one row per day and kind (Mitchell, 2026-11-01,
      `d52072c`). ADR-037's *Amendment 2026-10-31 (M43, decision 4)* is written in `5e1f857` and
      extended in `143257e` and `d52072c`. All four commits are on part 0's branch (PR 659), so they
      reach `main` when it merges.
- [x] **Two Overviews on one trip is a constraint violation** whatever their `seed_key`, and an
      integration test sees the insert refused, and no application code reads `context.kind`.
      *Evidence:* migration `apps/web/drizzle/0070_pages_kind.sql` creates `pages_overview_unique`
      on `("trip_id") WHERE kind = 'overview'` (PR 661, merged `86beb38`; `migrate-production` run
      41272194596 on `86beb38`, success). `pages.int.test.ts` › *refuses a second Overview on one
      trip at the database* inserts a second `kind = 'overview'` row with no `seed_key` beside the
      seeded one (`seed_key = 'overview'`) and expects constraint `pages_overview_unique` (added in
      `4237f6a`); *an editor's create naming the Overview's old marker makes an ordinary page*
      covers the hole decision 2 closed. Both ran in `test / integration` of run 41256318374 (PR 661
      head `e218f2a`, green on the first attempt). On `main` at `e3629e2`,
      `grep -rn "context.kind" apps packages` outside tests finds one reader: `seedKeyOf` in
      `packages/contracts/src/pageEvents.ts:225`, which reads a pre-M43 `PageCreated` event's
      logged context (`LoggedPageContext`) to derive a legacy seed key. That is the legacy event
      reader the plan exempted (an event is never rewritten); the row's context no longer carries
      the field (`pageContextOf`, and 0070 strips it), and nothing reads it for identity or the
      delete guard. The only other hit is a comment in `apps/web/src/server/pages.ts:283`.
- [x] **`open` renders the design's rows**, with a sentence label, a sub-line, an action and a
      tone, and it filters by class and by dates. Its tests were seen red against the table.
      *Evidence:* rows `{ label, sub, right, tone, act }` in PR 660 (merged `1da27ac`), with
      conflicts folded per day and kind (`open.test.ts` › *folds same-kind conflicts on one day into
      ONE row that counts them*); class and Days filters in PR 663 (merged `e3629e2`), desktop and
      phone. Red-first tables in each PR body: PR 660's `open.test.ts` failed against the old
      `repeat-rows` (`expected undefined to deeply equal [ …(5) ]`, 7 of 9) and `MacroView.test.tsx`
      against the table (`Unable to find an accessible element with the role "list" and name "What
      needs you"`); PR 663's filter tests failed before the change (`+ "1 idea is parked"`,
      `+ "Overlap on Day 1"`) and the phone e2e with `open` ignoring `params.class`
      (`Expected: 1  Received: 2`). Final CI green: run 41269405719 (PR 660 head `39fe517`) and run
      41273111611 (PR 663 head `3cce6a6`).
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`.**
      *Evidence:* CI, which runs the e2e lane the way ci-like does: run 41273111611 on PR 663's head
      `3cce6a6`, both shards (`test / e2e (1/2)`, `(2/2)`) green on attempt 1. That run was created
      at 04:26Z, after PRs 661, 662 and 660 had merged, and `git diff 3cce6a6 e3629e2` is empty, so
      it tested all four parts together on the tree `main` now holds. Each part's final head was also
      green on both shards: runs 41256318374 (661), 41258109890 (662), 41269405719 (660). The
      milestone's walks are in `e2e/m14-notebook-widgets.spec.ts` and
      `e2e/m14-mobile-notebook.spec.ts` (*What needs you*).
- [ ] **[walk]** On the PR preview, *What needs you* is walked against the design, with both
      filters, and a renamed trip's Overview title follows it. *Open:* Mitchell is walking it on
      production himself (every part is merged); ticked from his report.
- [ ] A retro is appended at gate close.

## Retro — written 2026-11-01 (4 of 6 boxes ticked)

A draft, written on part 0 (PR 659) in the continuation session after every code part had merged
in `e3629e2`. Two boxes are open: the **[walk]**, which Mitchell is doing on production, and this
retro's own box, ticked at the close. If the walk sends work back, this retro gains that round.

### What went well

- **Four parts in two stacks, merged in 25 minutes, each final head green on its first CI run.**
  PR 661 merged at 04:09Z, PRs 662 and 660 at 04:18Z and 04:19Z, PR 663 at 04:35Z. `ci-ok` and
  both e2e shards passed on runs 41256318374, 41258109890, 41269405719 and 41273111611, attempt 1
  each. From the scoping commit (`5e1f857`, 2026-10-31 23:29Z) to the last merge took about five
  hours.
- **The migration went in between merges, as planned.** `migrate-production` run 41272194596
  applied `0070_pages_kind` on `86beb38` three minutes after PR 661 merged, and Mitchell ran the
  cleanup UPDATE from its PR body.
- **The last part's CI tested the whole milestone.** Run 41273111611 was created after the other
  three parts had merged, and `git diff 3cce6a6 e3629e2` is empty, so the e2e evidence is for the
  tree `main` holds, not for four trees that were never combined.
- **Review found a real bug before the walk.** PR 660's review at `7184498` (finding 2): a second
  tap on *Place them* left the rack shut, because `setView` kept `rack` in the URL. The fix
  (`d2c9470`) came with an e2e step seen red at `m14-notebook-widgets.spec.ts:1610`
  (`Expected: "true" Received: "false"`) before it went green.
- **Two review findings were left on purpose and filed**, not lost: KI-2026-11-01-s and
  KI-2026-11-01-t, from PR 662's review at `db8b246`.
- **The continuation session met four of five spend targets** (block below): no GitHub wakes,
  no coordinator follow-ups, no builder above a 62k average context, $3.24 per 1,000 lines.

### What could be better

- **Part 4 merged part 3 six times.** Commits `0f99567`, `a1b7d35`, `ce1df31`, `7231172`,
  `cdf26dc` and `0f90364` each brought part 3's latest fix round into part 4, and most were
  followed by a part 4 re-review. Two implementer agents spent 438k units on those merges, and the
  continuation session's two costliest agents were a part 3 re-review (536k) and a part 4
  re-review after a merge (514k). Stacking was right for two parts that share `open.ts`, but part
  4 went through its own fix rounds while part 3 was still in review. Would have prevented it:
  hold the stacked part's fix rounds until its base's review settles, then merge the base once.
- **A review file was lost across a container restart.** PR 660's first review lived only in
  `.git/tc-reviews/` of the container that went away at about 00:55Z, so the next reviewer was
  given its three findings as text in the brief and re-read the whole diff. Would have prevented
  it: one line per open finding in part 0's tracker, which lives on GitHub.
- **A CI e2e run was cancelled by a runner hang, and no known issue described it.** Both e2e
  shards of run 41256118744 (PR 660 at `7184498`) sat in `playwright install-deps chromium` for
  20 minutes and hit the job cap; no spec ran. The next push passed. Filed as KI-2026-11-01-u,
  so the grep CLAUDE.md rule 2 asks for finds it next time.
- **A tool description change turned `contextBudget.test.ts` red in CI.** Part 4's `7f4cb5c`
  grew the assistant's widget instructions without updating
  `apps/web/src/server/ai/contextBudget.baseline.json`. CI's `test / unit` failed (run
  41260501389), and a new implementer accepted the growth in `60b9954` (run 41262220794, green).
  Would have prevented it: the scoped recipe for a change under `server/assistant/tools/` or
  `server/ai/` includes `contextBudget.test.ts`.
- **A stale `apps/web/tsconfig.tsbuildinfo` reported a false TS2305** (`no exported member
  'OpenClass'`) to part 4's builder after the merge at `ce1df31`; `--incremental false` passed.
  It cost a diagnosis, not a wrong verdict. Filed as KI-2026-11-01-v.
- **Agents changed the main checkout.** A part-reviewer checked out PR 660's head in
  `/home/user/travel-collab` during the `d2c9470` review (restored at once, tree clean), and the
  `60b9954` review found a staged change there that no agent owned and that would have reverted
  the context-budget baseline. The briefs already said not to check anything out there. Would
  have prevented it: every builder and reviewer in its own worktree, as this close ran.
- **The orchestrator's share missed its target again**: 30.0% in the continuation session,
  against under 15%. Subagent reports were 45.8% of the orchestrator's units and Mitchell's turns
  35.1%, on a milestone of four parts.
- **The production walk could not be delegated.** A `phase-verifier` (153k units) was blocked at
  sign-in and walked none of its five checks, so the **[walk]** waits on Mitchell.

### Leftovers

- **The [walk] box**: Mitchell's production walk; ticked from his report.
- **KI-2026-11-01-s** (trip history names the Overview by its stored title) and
  **KI-2026-11-01-t** (v1 refuses an Overview edit whose shown title is over 200 characters):
  open, filed during M43.
- **KI-2026-11-01-u** (CI e2e hangs in `install-deps`) and **KI-2026-11-01-v** (stale
  tsbuildinfo): filed at this close.
- **PR 660's last review minor** (at `39fe517`): *has a plural for every kind it has a label for*
  lists its four kinds by hand, so a fifth kind given a label and no plural stays green. Not fixed
  before merge. Mitchell's call.
- **The plan**, `docs/plans/2026-10-31-M43-notebooks-keep-up.md`, is deleted in the close commit,
  after the walk, in case the walk sends a part back.

## Spend
<!-- session-metrics:milestone v1 -->

19 agents, 525 API calls, 5.31M units, $19.13 recorded. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | ≈ $ | Share |
|---|---|---|---|---|---|---|---|
| `part-reviewer` | 7 | 187 | 62k | 114k | 1.70M | $6.10 | 31.9% |
| `orchestrator` | 1 | 81 | 160k | 219k | 1.59M | $5.74 | 30.0% |
| `phase-implementer` | 9 | 205 | 48k | 80k | 1.50M | $5.40 | 28.2% |
| `general-purpose` | 1 | 30 | 85k | 102k | 372k | $1.34 | 7.0% |
| `phase-verifier` | 1 | 22 | 42k | 53k | 153k | $0.55 | 2.9% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units | ≈ $ |
|---|---|---|---|---|---|---|
| Re-review PR 660 at d2c9470 | `part-reviewer` | 53 | 76k | 114k | 536k | $1.93 |
| Re-review PR 663 at ce1df31 | `part-reviewer` | 53 | 76k | 105k | 514k | $1.85 |
| Prepare M43 gate close on part 0 | `general-purpose` | 30 | 85k | 102k | 372k | $1.34 |
| Fix PR 660 review findings | `phase-implementer` | 43 | 62k | 80k | 349k | $1.26 |
| PR 663 merge part 3 + instruction fix | `phase-implementer` | 32 | 51k | 60k | 223k | $0.80 |
| PR 663 fix minor and merge part 3 | `phase-implementer` | 33 | 47k | 57k | 215k | $0.77 |
| PR 660 fold overlap rows | `phase-implementer` | 21 | 53k | 62k | 183k | $0.66 |
| Re-review PR 660 at 90a8af1 | `part-reviewer` | 23 | 48k | 64k | 177k | $0.64 |
| Walk M43 on production | `phase-verifier` | 22 | 42k | 53k | 153k | $0.55 |
| Re-review PR 663 at 60b9954 | `part-reviewer` | 17 | 41k | 54k | 132k | $0.48 |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | ≈ $ | Share of orchestrator | Idle |
|---|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | $0.00 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 16 | 730k | $2.63 | 45.8% | – |
| Subagent finished | 1 | 26k | $0.09 | 1.6% | – |
| Harness | 11 | 278k | $1.00 | 17.4% | – |
| Human | 10 | 560k | $2.02 | 35.1% | – |
| Other (unrecognised frame) | 0 | 0 | $0.00 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 0 | 0 |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

| Hook | deny | note |
|---|---|---|
| `implementer-brief-check` | 1 | 0 |

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 30.0% |
| No phase-implementer averaging > 250k context | met | worst 62k |
| GitHub wakes per merged part < 5 | met | 0 / 5 = 0.0 |
| Dollars per 1k lines added < 20 | met | $3.24 |
| Coordinator-message re-writes <= 2 | met | 0 |

### Both sessions

The block above is the continuation session only (`2d249f0e`, from 00:55Z through this draft).
The first build session's transcript went with its container; its totals were carried in the
hand-off, and its cost is the one recorded on that session (`external_metadata.usage.cost_usd`).

| Session | Agents | Calls | Units | Recorded $ |
|---|---|---|---|---|
| First build session (scoping, every part's first build and review) | 27 | 1,328 | 16.81M | $56.85 |
| Continuation (fix rounds, merges, this draft) | 19 | 525 | 5.31M | $19.13 |
| **Total** | **46** | **1,853** | **22.12M** | **$75.98** |

**Lines added: 5,909** by the rule: `git diff --shortstat 86beb38^1 e3629e2`, without `docs/`,
`*.generated.json` and `pnpm-lock.yaml`, gives 63 files, 5,909 insertions and 463 deletions.
4,216 of them are the generated drizzle snapshot `apps/web/drizzle/meta/0070_snapshot.json`;
without it, **1,693**.

### Spend against the last milestone

M56 is the last closed milestone. It carried no dollar cost, and its units left out a session.

- **Dollars per 1,000 lines added (under 20):** met by the rule at **$12.86** ($75.98 over
  5,909 lines); **missed at $44.88** without the snapshot, as M46, M50 and M55 also read theirs.
  Small scope is the cause: four parts carried the fixed costs of a plan, two stacks and a review
  per fix round over 1,693 hand-written lines. M56: not measurable.
- **Units per 1,000 lines:** 3.74M (13.07M without the snapshot), against M56's 2.70M.
- **Orchestrator's share (under 15%):** missed at 30.0% in the continuation session; the first
  session's share was not carried. M56: 22.8% and 25.9%.
- **A builder's average context (none over 250k):** met in the continuation session (worst 62k);
  not carried for the first. M56: not measurable.
- **GitHub wakes per merged part (under 5):** met, 0 in the continuation session. M56: not
  measurable.
- **Cache re-writes after a coordinator message (2 or fewer):** met, 0. M56: not measurable.

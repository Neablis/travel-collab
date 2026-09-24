# TODO — high-level roadmap for agents

**How to use this file.** **The unticked milestone rows, top down, are the
execution order** (Mitchell, 2026-09-24): a reorder MOVES THE ROWS, and the
first unticked row is the current work, which also carries
`← current milestone`. A row marked **PAUSED** keeps its place but is skipped —
it is neither current nor next until the word comes off. Ticked rows can sit
anywhere. `pnpm milestone close` and `pnpm state` both read this order, so a
reorder that moves only the marker shows up as DRIFT. *(Until 2026-09-24 this
said "read the marker, not the position", and closing M26 the script proposed
the wrong successor from the rows — KI-2026-09-21-a.)* Read that milestone's
file in `docs/milestones/` before planning anything. Check items off only when the milestone's exit gate passes
(not when code merges), via the gate-close checklist — `pnpm milestone close`
runs it. Never start an item while an earlier one is unchecked without
Mitchell's explicit say-so.

**Faster than reading this file:** `pnpm state` prints the current milestone,
its gate tally, the first unchecked item and any drift between the four places
that record it, each with a `file:line` citation. `pnpm milestones` prints the
whole table. Neither is a summary — both are extracted, so neither can be
stale in the way this paragraph can.

**Scope lives elsewhere, on purpose.** The milestone table is
`docs/milestones/README.md`; the detail and exit gate are in each milestone's
own file; where the work actually stands is `docs/STATUS.md`; unscheduled
ideas are `docs/candidates.md` (`pnpm candidates`). This file is the checklist
only — deliberately not a second copy of any of them, because two copies
drift.

**Why there is no order history here any more.** This header used to carry the
argument for the current order — every reorder from 2026-08-29 onward, inline.
On 2026-09-21 it still opened *"**M21 is the current work** as of
**2026-09-14**"*, four milestones after M21's gate closed, in the file
`CLAUDE.md` tells every session to read for what to do next. That is the
defect `docs/STATUS.md` records about itself — *"the stale section was the
defect, length only the symptom"* — and history in a first-read file is how it
happens. **The argument is not lost: it is in `docs/milestones/README.md`,
under the date each decision was made**, which is the one place that records a
reorder and the one place a reorder updates.

## Phase 1 — Full single-player product

*Phase gate: Mitchell plans a real trip end-to-end and needs no other tool.*

- [x] **M0 Walking skeleton** → `docs/milestones/M0-walking-skeleton.md`
- [x] **M1 Planning core** → `docs/milestones/M1-planning-core.md`
- [x] **M2 History & time travel** → `docs/milestones/M2-history-time-travel.md`
- [x] **M3 Place & time** → `docs/milestones/M3-place-and-time.md`
- [x] **M4 Money & lenses** → `docs/milestones/M4-money-and-lenses.md`
- [x] **M5 Design foundations** → `docs/milestones/M5-design-foundations.md`
- [x] **M6 Atomic changes** → `docs/milestones/M6-atomic-changes.md`
- [x] **M7 Solo delight** → `docs/milestones/M7-solo-delight.md`
      *(Trip templates moved to M11 during this milestone.)*
- [x] **M8 Make it real** → `docs/milestones/M8-make-it-real.md`
      *(Gate closed 2026-08-08. Wave A merged 2026-08-07 via PR #21; Wave B
      (anchors/timezone/macro subtraction) merged the same day; Wave C's
      ergonomics tasks and Wave D's first-run/empty-state tasks trimmed from
      scope 2026-08-07 — see Candidate ideas below; C4 (KI-5 sync indicator)
      and D3 (e2e gate script) closed the gate.)*
- [x] **Phase 1 gate review with Mitchell** — done 2026-08-08. The 2026-07-28
      review had deferred this behind M8 (a trip could not be renamed or
      deleted); M8 closed that floor and the dogfood review passed.

## Phase 2 — A product worth using

- [x] **M10 Visual craft pass** → `docs/milestones/M10-visual-craft.md`
      *(Brought forward ahead of M9, 2026-08-08 — see ADR-018. Wave 1's gate
      closed 2026-08-10 on PR #23, then **reopened 2026-08-14** by an external
      design review: the handoff had moved two generations since Wave 1 was
      built, and Wave 1's own assistant rail introduced three blocking defects.
      Wave 2 closed the delta, findings at
      `docs/design-feedback/2026-08-14-M10-redesign-external-review.md`.
      **Gate widened on 2026-08-23** by the design sync, recorded in the
      milestone file: **Phase 8b** (Caesura rename, working sign out,
      three-state save indicator, sync-failure banner, calendar month blocks,
      and the trip start picked with the end derived) and **Phase 1b** (the
      header adopts the focus-scope model, an explicit revisit of the merged
      Phase 1). **Phase 1b was CANCELLED 2026-08-26, unbuilt** — `SPEC.md` §1's
      focus-scope model is rejected; the global bar carries nothing trip-scoped.
      Phase order to the gate was: 5, 6, 7, 8, 8b, 9.
      **Wave-2 gate closed 2026-08-27** — full DoD green, e2e 31/31 twice
      against a production build, every surface walked at 1280/1100/820px with
      the assistant rail shown and hidden. The walk found and fixed one real
      defect the automated suites are structurally blind to (the assistant
      launcher never cleared the unscheduled rack — it overlapped without ever
      blocking a click). Retro, evidence and the promoted rules are in the
      milestone file; the phase plans were deleted in the gate-close commit per
      `docs/plans/README.md`.)*
- [x] **M18 A stop knows what kind of thing it is** — **gate closed 2026-08-29**
      → `docs/milestones/M18-stop-kind.md`
      *(Two PRs. **PR 1, the contract change, landed 2026-08-27 via PR #63** —
      `ActivityKind` and `ActivityTag` real on both commands, both V1 event
      payloads and `ActivityView`, with no migration. **PR 2+ landed the
      surfaces 2026-08-29**: `act.badge`, tag chips, a kind picker and a tag
      picker in the stop editor, the home hero's "not booked" tile, `N to book`,
      and the Calendar's city grouping. Gate closed the same day — eight of
      eight boxes, e2e 46/46 against a production build, and both fields set on
      a trip created from scratch and read back off the API.
      **The Calendar rule changed at the gate.** SPEC §12's travel-day transit
      split was built, walked, and removed the same day: it fired on one of
      seven travel days and got that one wrong, because its output depended on
      how the fixture tagged cities — *"I don't think the shape of the fixture
      should drive functionality, that's how we get drift."* Grouping is by city
      alone now, equal cards plus an untitled bucket, and the day-to-day
      transition moved to the day label. **Tag focus was carved out as M18b.**
      Retro and evidence in the milestone file.)*
- [x] **M18b Tag focus** — **gate closed 2026-08-30**
      The piece carved out of M18's gate.
      *(All six boxes ticked. Built and proven on
      `pnpm --filter web test:e2e:ci-like`, then **closed on Mitchell's walk of
      the PR #91 preview** — the same shape as M16's close after PR #88, and
      for the same reason: an unattended session cannot reach a protected
      preview, so the deployed half of the gate is a human's. Two defects the
      automated evidence missed are recorded in the milestone file: a hover
      hint reused as the Clear control's accessible name, colliding 34 ways,
      and a tag focus re-centring the map.)*
      → `docs/milestones/M18b-tag-focus.md`
      *(Carved out 2026-08-29 when M18's gate was amended: M18 lands both
      fields, every surface that reads `kind`, and tag chips that render and
      can be set — but not the behaviour the chips drive. SPEC §11's tag focus
      dims off-tag stops to 32% across Timeline, Day columns, Calendar and Map,
      with Calendar showing `N of M match` instead. It is the only piece of
      M18 needing shared state above the lens switch, its Calendar rule is a
      second design, and no M18 exit-gate box measured it — the same three
      arguments that carved Playbooks out of M11 the day before. Note for
      whoever opens it: the **filter row it replaced is gone**, and our own
      KI-47 cited it for four days after SPEC §11 deleted it.)*
- [x] **M16 The assistant answers questions** — **gate closed 2026-08-29**
      → `docs/milestones/M16-assistant-read-agent.md`
      *(Ten of eleven boxes ticked and the eleventh moved, not waived:
      **"recorded transcripts replay in CI" went to M9's gate**, by Mitchell's
      explicit decision — it was PR #88's Task 7, dropped rather than
      half-landed, M9's gate already carried the identical criterion, and M9
      is where the write agent it measures lives. **KI-11 stays open and is
      now M9's to close.** Implementation landed in PR #88, which correctly
      flipped no status flag because everything in it ran simulated; the gate
      closed afterwards on Mitchell's live confirmation. One caveat recorded
      in the milestone file rather than smoothed over: Vercel holds exactly
      one real-model `ai.ask` record, and the four acceptance assertions were
      confirmed locally, so Wave 3's box rests on one record plus a human
      pass. Approved 2026-08-25, **ADR-022**. Placed right after M10's Wave-2 gate
      and ahead of M15 — but M15 in fact closed its own gate first (2026-08-26),
      M18 was then scheduled ahead of M16 (2026-08-26), and **M11 was scheduled
      ahead of both on 2026-08-27**. So M16 now runs after M11 and M18.
      Three waves: the sidebar styled to `SPEC.md` §9's docked
      presentation with both `<Preview>` blocks deleted; a **read-only
      tool-using agent** on a new `/ask` endpoint — one question, one answer,
      scoped to the selected day or the whole trip; then analytics on which
      tools get called and how many calls an answer costs. The existing command
      path is untouched. It exists because `/ai` derives its reply from
      committed commands and the envelope carries no time windows, so a question
      like "where is the most free time" is unanswerable twice over.)*
- [x] **M9 Phase 0 — the assistant kernel** — **complete 2026-09-11**, in two PRs:
      P0-P5 as `bbc5bdb` (#162) and P6 as `845fc48` (#163). **Ticked on completion,
      not on a gate** — this is the one entry in this file that may be, because it
      closes no gate box by design; every other box waits for its milestone's exit
      gate, per the rule at the top. **Interposed 2026-09-10 on Mitchell's call**,
      nominally ahead of M17's three open gate boxes — which had in fact been
      satisfiable since 2026-09-02, so it displaced a marker and not any work;
      M17's gate closed 2026-09-11 regardless. Closed KI-2026-09-05-t
      (`handleAskRequest()` was one 455-line function — now 105 non-comment lines,
      while the comment record grew 634 -> 996) and KI-22, and gave the ~15 open AI
      known issues that share their shape a place to be fixed.
      **The phase table said six PRs; it ran as seven phases in two** — P0 the spec
      and ADR-043, then P1 `defineTool` with a required output schema and declared
      dependencies, P2 scopes as (domain, effect) grants so a tool set is a filter
      and not a hand-written switch, P3 one staged admission pipeline with one audit
      record, P4 a prompt boundary that taints tool-returned user content, P5
      task-class model routing and a `TurnLedger`; P6 took KI-22's contracts move as
      its own PR, as `AGENTS.md` requires. Entitlement policy and the `ai_usage`
      ledger stayed M20's, as planned. Decision: ADR-043.
      → `docs/specs/2026-09-10-assistant-kernel-design.md`
      → what landed, phase by phase: `docs/milestones/M9-ai-planning-partner.md`
- [x] **M17 Account preferences** — **gate closed 2026-09-11**: three of three
      live boxes, one amended out 2026-09-01. Built in PRs #111 and #112 and in
      production since 2026-09-02 (migration 0015 dispatched sixteen minutes
      after merge); **the gate itself went nine days unconvened**, which is the
      subject of the retro in the milestone file. Evidence re-derived at close:
      `e2e/m17-account-preferences.spec.ts` green on `test:e2e:ci-like`, the
      integration suite green (41 files, 493 tests), and the production
      `migrate-production` run confirmed from workflow history. Two things
      carry forward and are named in the retro — `TripMemberProfile` still has
      no `displayName` (a one-field contract change, invariant 5), and **no
      deployed browser walk was ever done for this milestone**.
      **Re-scoped and placed 2026-08-29, after
      M18b**, whose gate closed 2026-08-30, and then **jumped on 2026-08-30**:
      Mitchell asked for "the rest of M11" first, so M11a and M11b run ahead of
      it and M17 follows M11b. The reorder note is in
      `docs/milestones/README.md`; the one consequence it carries is recorded
      against M11b's prerequisites, because M17 was to resolve `who` to a
      display name and M11b's author strip and profile both show one.
      **It needs one migration, and merging does not apply it** — dispatch with
      `gh workflow run migrate-production.yml -f confirm=migrate` from `main`,
      and say so in the PR body.
      → `docs/milestones/M17-account-customization.md`
      *(Approved 2026-08-26 out of SPEC §12 and **never scheduled**. It was
      absent from this file entirely until 2026-08-28, which in a file whose
      rule is "first unchecked item = current work" meant an approved milestone
      nobody could see. It is listed here so it is visible, **not** to claim a
      slot: placing it is Mitchell's call. Two facts that call needs — its
      central deliverable, *"a `users` table, and the decision of what it keys
      on"*, was **already decided and shipped by M11 link 1** (ADR-025), leaving
      only the preferences half (name, home airport, account-scope distance
      units via one `kmLabel`, home-time-on-hover, and resolving `who` to a
      display name); and nothing downstream is blocked on it, so it can go
      anywhere. Re-scope it before scheduling it.)*

## Phase 3 — Outward

- [x] **M11 Sharing, invites, and a trip you can hand to someone** — gate closed 2026-08-28 → `docs/milestones/M11-sharing-and-invites.md`
- [x] **M11a An invite gate on the front door** — gate closed 2026-08-31 → `docs/milestones/M11a-invite-gate.md`
- [x] **M11b Playbooks becomes a public library** — gate closed 2026-08-31 → `docs/milestones/M11b-playbooks-public-library.md`
- [x] **M27 The simplify pass** (2026-09-23, **placed by Mitchell** ahead
      of M12: *"Big new Design pass in the handoff … just go ahead and make all
      the changes"*). SPEC §35, plus link 10 (every Playbook has its map).
      → `docs/milestones/M27-simplify-pass.md`
- [x] **M12 Reviews and moderation** (again from 2026-09-23, by M27's gate closing; was current from
      2026-09-22, **by M13's gate closing**, until M27 was placed ahead of it). All trust & safety scope
      lives here, nowhere earlier.
      → `docs/milestones/M12-reviews-and-moderation.md`
      *(**Retitled and scoped 2026-09-01** — was "Community", with no file and
      no exit gate. The public gallery and discovery that name promised
      **shipped in M11b**; what M12 keeps from `SPEC.md` §15 is reviews,
      ratings everywhere they surface, and moderation. It exists to delete one
      line from §15: **"Until the reviews table exists, every rating here is
      fixture data"** — still true in `main`. Needs a migration.
      **Seven links and thirteen gate boxes as of 2026-09-09**, when Mitchell
      asked for **country search alongside city search** in Discover's box and
      it was added as link 7 — the one piece of M12 that is not trust and
      safety, and an amendment to the milestone's own "nothing that changes what
      M11b ships". It needs a **second migration** (`saved_days.countries`) and
      had a data prerequisite: the content library carried `countryCode` on
      **none** of its 1,375 locations — all 1,375 since 2026-09-23, and
      production's 149/149 `saved_days` carry a country. Both are in the milestone file.
      This entry said "six links, nine gate boxes"; the file in fact had ten
      boxes before link 7 was added, so the count here was already one out.)*
- [x] **M13 Collaboration** — **gate closed 2026-09-22 at 10 of 10**, merged as
      `#201`. Placed 2026-09-21 by M26's gate closing, which was the first time
      in five moves this marker had moved by a gate rather than by Mitchell; it
      held the line for a few hours on 2026-09-19 too, between M23's gate
      closing and M26 being placed. Its scope was unchanged — realtime
      transport ADR and concurrent-edit conflicts — and it also carried an
      unplanned sixth piece, **notebooks joining the event log**, after a
      two-device report. The two-actor walk box is ticked on **Mitchell's
      attestation**; an agent cannot reach it (the preview answers 402 without
      the owner's `trip.collaborators` entitlement). Retro in the milestone
      file. → `docs/milestones/M13-collaboration.md`
      *(**The preflight is DONE — 2026-09-21.** The activity-field descriptor
      refactor `KI-20260905-o` ran ONCE, BEFORE this milestone, as its own
      piece of work at Mitchell's request; the entry is in `resolved/` and
      M13's gate box for it is ticked. It was never M13's deliverable and never
      M24's — it is shared by M13 link 5 (`who`) and M19 link 1 (cost kind),
      and it had been scheduled once before, on 2026-08-29, without happening.
      **One thing link 5 must know:** the read model `ActivityView` is
      deliberately NOT derived from the new `ActivitySnapshot`, so `who` has to
      be added to it by hand — the build will fail until you do, but it forces
      the KEY, not the TYPE. The resolved entry says why.)*
      *(**Narrowed 2026-08-27**: invites, roles and revocation moved into M11,
      because they are the same `AccessPolicy` change as share links and opening
      that boundary twice costs twice. **Scoped 2026-09-01** — five links, and
      the transport ADR is a prerequisite rather than a deliverable. Link 3 is
      the *"adopt this outcome, re-predict what is queued"* reducer **KI-90
      already names as the fix** for KI-90 and KI-5's `applyOutcome` precondition
      at once — **two, not three**: the "KI-77" this line used to carry was
      KI-90's own pre-renumbering number, and the real KI-77 is a resolved
      geocoder bug (corrected 2026-09-22). It also owns
      per-stop attribution, which **M19's link 3 depends on** — if M13 ships
      without it, that link returns to M19.)*
- [ ] **M24 A leg knows where it goes and by what** → ← **current milestone**
      `docs/milestones/M24-travel-legs.md`
      *(**Minted and placed 2026-09-18 by Mitchell**, running after M12 and
      before M14. A travel stop gets a **transport mode** and a **second
      location**, and the map draws a real leg instead of inferring one.
      **Mode carries its own field and does not inherit from `kind`**: `kind:
      "transit"` says THAT a stop is travel, `mode` says by what, and they
      cannot disagree because a mode is legal only on a transit stop, enforced
      by the schema rather than by convention. That **answers the question the
      candidate entry below has carried since 2026-09-01** (*"inherit, or carry
      its own"*), which that entry says is *"worth deciding once for both"*
      alongside M19 link 1's identical question about costs.
      **`location` keeps meaning the origin** and an optional `endLocation` is
      added beside it — no existing reader changes meaning. The rejected
      alternative was modelling travel as an **edge between** two stops rather
      than as a stop: rejected because the whole app is "a day is an ordered
      list of activities", and an edge is not in that list.
      **It has a prerequisite that is not its own deliverable**: the activity-field
      descriptor refactor, `KI-20260905-o` — 21 non-test files hand-enumerate
      activity fields and nothing goes red when one is missed. **It runs once,
      before M13**, and is shared with M13 link 5 (`who`) and M19 link 1 (cost
      kind). It was already scheduled once, on 2026-08-29, as *"one overnight
      batch"* and did not happen; M13's gate now carries a box for it so it is
      enforced rather than remembered.)*
- [ ] **M14 Rich layer** — the macro vocabulary deferred out of M8 returns here.
      → `docs/milestones/M14-rich-layer.md`
      *(**Code merged 2026-09-24, built ahead of M24** on Mitchell's call, as
      #222, #223, #226 and #221. The gate is 17 of 22. The five open boxes
      need a person, not code; `docs/STATUS.md` lists them.)*
      *(**Scoped 2026-09-01** — six links, and the **repeaters ADR is a
      prerequisite**, not a mid-build deliverable. Checked against the tree:
      `MacroKind` is `"inline" | "block"` with no repeat kind, and every macro
      is `NoParams` — the registry's `params` seam exists and has never been
      used, which is exactly what that ADR is for. **Two items on this row need
      a call before it opens**: the M8 macro vocabulary, and **external calendar
      sync**, which has no design, no ADR and no relationship to the Notebook,
      and may deserve its own milestone.)*
      *(**Decided 2026-09-24 by Mitchell**: external calendar sync is
      **dropped**, not split out; ghosts render in Editing only and Reading
      keeps today's placeholder label; the `days` and `trip` input types are
      retired. The M8 macro vocabulary is superseded by the widget framework
      (ADR-035/037/039). The milestone file's gate is behind the tree and is
      re-baselined first when M14 opens — see its *Decided 2026-09-24*.)*
      *(**Pulled forward 2026-09-24 by Mitchell — being built now on PR #221**,
      ahead of M24, which stays current. The route map block waits for M24.)*
      *(**Widened 2026-09-24 by link 11**: the widget brainstorm's first wave,
      `docs/specs/2026-09-24-widget-brainstorm.md` §6, including MET Norway
      weather and shadcn/ui charts (Recharts). An external-data ADR is its
      prerequisite.)*
      *(Also owns the whole Notebook redesign from the 2026-08-23 design sync —
      `.design-sync/handoff/SPEC.md` §7. Opens with a **repeaters ADR**: a loop
      macro with an author-supplied row template is the one genuinely new
      engineering decision that sync created, and every macro today is
      `NoParams`.)*
      *(**§7 has two halves and only one is blocked — noted 2026-09-02.**
      `DRIFT.md` §4's *"nobody should build to §7 until that is settled"* is
      about **macro authoring in prose**, and has been read as covering the
      whole feature. The **navigation and index half needs no ADR, no contract
      change and no macro decision**: the **Notebooks menu** (§11's pill at the
      far right of the view row — the build has a plain text link at
      `TripHeader.tsx:137`, and **no link in this milestone owns the menu**),
      and the **Notebook index page** — standfirst, per-page scope badge,
      provenance and
      edited time, and the **"Start from a template"** trio over the existing
      `templates.ts` seeds. The build has `+ New page` over a flat list, and
      says *page* where §11 says *notebook* in all three places. **Separable
      from the blocked half, so pulling it forward is a decision available to
      be taken** — it is presentation over data that already exists.)*
      *(**BUILT 2026-09-03**, pulled forward on Mitchell's instruction, out of
      order and with M17's gate still open. Both surfaces landed; the repeaters
      ADR is **written and PROPOSED** (ADR-035), so links 4 and 5 stay gated
      until it is accepted. **Two claims in the paragraph above were wrong about
      the code and are corrected in `M14-rich-layer.md`**: the scope string was
      called `describeBinding`, not `scopeLabel`, and it **was** rendered — as
      secondary text rather than a badge; and this half **did** need a contract
      change, `PageSummary.actorId`, without which the provenance line cannot
      tell a seeded notebook from an authored one.)*
      *(**RESCOPED and UNBLOCKED 2026-09-03.** SPEC **§18** replaced §7's model:
      a page has no scope, and **a widget is a function of its own declared
      inputs**, so two widgets on one page can read two different days. That
      makes the six links nine, and it **dissolves the `templates.ts` blocker**
      the paragraphs above are built around — the question stops being "does
      macro authoring come back" and becomes "what does a seeded template
      instantiate". **ADR-035 and ADR-036 were both accepted the same day**, so
      nothing above about a PROPOSED prerequisite still holds. Links 2–8 are open
      for work; **link 9 (notebook history) is not** — accepting ADR-036 left one
      question open that a build cannot answer for itself, named in that ADR's
      last Consequence and in the milestone's gate. Note §18 reached `main`
      **after** #126 merged, so part of that PR — the Trip-wide / Day 6 badge —
      is un-shipped on purpose by link 2 rather than regressed.)*
- [ ] **M19 A cost knows who and what it is for** →
      `docs/milestones/M19-cost-model.md`
      *(**Added to this file 2026-09-01. It was missing entirely** — minted and
      placed last on 2026-08-31, recorded in `docs/milestones/README.md` and in
      its own file, and in neither this file nor `docs/STATUS.md`. In a file
      whose rule is "first unchecked item = current work", a milestone that is
      not here cannot be found — **the same defect this file already records
      against M17**, repeated three days later.
      **Placed but not scoped**: the exit gate is deliberately unwritten,
      because link 1 needs a design decision first (does a cost inherit its
      category from `ActivityKind` or carry its own?). Five links: a cost's
      kind, a cost's settled-vs-estimate state, who an activity is for, splits
      derived from that, and the shared-day presentation. **Last is a real
      position** — link 3 overlaps M13's `add-stop-who`, so running after M13
      lets M13 land the field and M19 build on it rather than both adding one.
      Its anchor finding is live in shipped code: `savedDayFacts.budgetPerPerson`
      is a plain sum of stop costs with nothing to divide by.)*
- [x] **M15 Front door** — gate closed → `docs/milestones/M15-front-door.md`
- [ ] **M9 The assistant cites what it plans** — **PAUSED 2026-09-13**, not cancelled: Phase 0 complete, the three real pieces of work untouched, and it keeps its place immediately after M21 (Mitchell's reorder — `docs/milestones/README.md`, 2026-09-13) →
      `docs/milestones/M9-ai-planning-partner.md`
      *(**Retitled 2026-09-01** — was "AI as a planning partner". An audit
      against `main` found **four of its seven scope items already shipped**
      (streaming, propose→review→approve, refinement within a session, honest
      unknowns) and **three of its six gate boxes already satisfied**. The
      remaining milestone is three things: **grounding** (`SearchPlaces` →
      `placeRef` — KI-81/KI-15), **conversation durability** (no conversation
      table exists, so a reload loses the thread), and **an eval/replay
      harness** (KI-11, inherited from M16's gate).
      **Moved to last, after M14 — ADR-022, 2026-08-25**, on two grounds — the
      data layer should exist first, and UI polish and sharing come before it —
      **both of which have since been met**; the placement has not been
      re-examined. `ai-live` defaults off and grounding is what would let it be
      turned on, so the biggest built feature in the product is dark while this
      waits. **Reordered 2026-09-01 on Mitchell's call: M9 now runs SECOND,
      immediately after M17**, superseding ADR-022's placement of it last —
      both grounds ADR-022 named have since happened. **All twelve open AI
      known issues are assigned here the same day**, three of them promoted to
      gate boxes (KI-12, KI-93, KI-94+97) and nine carried; the rationale for
      the split is in the milestone file:
      `docs/reviews/2026-09-01-milestone-audit.md`.)*

- [x] **M20 An account knows what it may do** — gate closed 2026-09-14 → `docs/milestones/M20-account-tiers-and-entitlements.md`
- [x] **M21 An account can pay for itself** — gate closed 2026-09-19 → `docs/milestones/M21-subscriptions-and-billing.md`
- [x] **M22 An account can build on the API** — gate closed 2026-09-19 → `docs/milestones/M22-public-api-and-tokens.md`
- [x] **M25 A trip is a file you can take with you** — gate closed 2026-09-19 → `docs/milestones/M25-a-trip-is-a-file.md`
- [x] **M23 A playbook can be more than one day** — gate closed 2026-09-19 → `docs/milestones/M23-multi-day-playbooks.md`

- [x] **M26 The build looks like the design again**
      (2026-09-19, by Mitchell placing it — *"start the big design milestone we
      just created"*). Scoped and placed the same day, **ahead of M13**: M13
      adds a second actor to the surfaces this rebuilds, so the other order
      rebuilds them twice. **Link 0 (the preflight) is done; Wave 1 link 1 is
      next.** → `docs/milestones/M26-design-parity.md`
      *(**Opened by Mitchell**, asking that the build be brought back to the
      design and naming four things: Playbooks' shared trips looking nothing
      like the designs, account settings becoming its own page, filters and tabs
      re-imagined to improve search, and a hover state on the Map view's days —
      plus the broader instruction to *"really try to match the designs,
      especially supporting both the desktop and mobile version"*. Scoped from
      **five read-only surveys** of the whole handoff against the working tree.
      **The first design-parity milestone since M10's Wave-2 gate closed
      2026-08-27**, which was honest that it closed a delta against the handoff
      generation available then. The handoff has moved **fourteen commits**
      since, seven of them in the eight days to 2026-09-19, while the build ran
      M20/M21/M22/M25/M23 — **three of the four that closed had no design
      surface at all** until the design drew them on 2026-09-19.
      **Two waves, two gates, because no one sitting can walk both.**
      *Wave 1* is desktop and shared: Account becomes a route with three tabs
      (**closes D14, D12 and `KI-2026-09-17-a`**); Discover is re-sorted by kind
      of decision — **a place is a tab, a question is a chip, a property of the
      list rides the sentence about the list**, which is a rule for any list
      surface and not just this one; a Playbook's days become a scope over the
      row M23 shipped the same week; the shared day gets the map §16 designed on
      2026-09-01 and **nobody has ever owned**; the Map rail gets its
      hover-to-detail card; trip lifecycle stops having two homes (**closes
      D13**); §3b's region-by-region loading gets built, of which **literally
      none exists** — `Skeleton`, `animate-pulse` and `data-sk` return nothing
      across the app; and two guards learn to see a class of defect they
      currently pass.
      *Wave 2* is **the phone as a surface**. Three places in this repo have
      been waiting for it to be minted: `docs/guidelines/design-system.md` has
      said layout below 1024px is best-effort *"until the mobile milestone"*
      since M5, `KI-046` says *"building that is a milestone, not a fix"*, and
      this file says at line 1030 that *"placing the phone is a milestone-sized
      decision"*. Four phone surfaces are genuinely built to spec — the
      route-derived tab bar, the Ask pill, the Map day strip and the Notebook's
      push/bind/insert sheets — and **everything else a phone can reach is the
      desktop layout reflowed**, against KI-046's measured 191 of 211 controls
      under 44px.
      **It opened with a preflight and the preflight was not optional — it is
      DONE, 2026-09-19.** `KI-2026-09-14-c` measured that building ONE screen
      from this handoff cost four review rounds and three wrong builds, and
      already named the five aids it needs; this milestone builds around twenty
      screens from the same handoff. All five landed, plus the colour-wall
      extension the survey added: a generated **route→artboard table** in
      `.design-sync/handoff/README.md`, a generated **section index** at the top
      of `SPEC.md`, `docs/guidelines/building-from-the-design.md`, and a token
      wall that fails on an undefined `--color-*`/utility name. Each has a test.
      `KI-2026-09-14-c` and `KI-2026-09-19-g` are both in `resolved/`;
      `KI-2026-09-19-f` is **still open** and is link 8a's work, not link 0's.
      **The token wall found two already-shipped defects on its first run** —
      `bg-canvas` on the shared-trip screen and `ring-primary` on the
      selected-widget ring — so the hole was wider than the KI had estimated.
      **No contract change and no re-skin.** Every link is UI over data that
      already exists, or a named, sized exception. Reviews, per-stop attribution
      and cost classification are routed to **M12, M13 and M19** and are out of
      scope on purpose; the Notebook's ghost, `NotebookBlock`'s columns and
      `WidgetSettings`' missing controls are routed to **M14**; the new-trip
      fork's paid half and `Ask` in read-only (`KI-079`) to **M9**. Each of
      those five milestone files carries a dated note listing what it inherits.
      **`DRIFT.md` is stale in the build's favour in six places** and the
      milestone resyncs them: eleven shelled surfaces are actually **six**, D11's
      two *"honestly orphaned"* wizard shells were both built on 2026-09-16,
      `w-open` is shipped, and the widget catalogue is 13 primitives and 20
      presets rather than 7. **Fifteen places in total where the build is right
      and the handoff is behind**, and the milestone amends the handoff in the
      same PR rather than regressing the code.
      **`DRIFT` D12 is not blocked and never has been** — the field, the
      wrapper, the per-call check and the widening refusal are all shipped and
      enforced; the entire gap is one hardcoded `null` in a POST body.
      **Nine open questions were recorded in the file and deliberately not
      answered there; Mitchell answered the two that gated work the same day.**
      The Map rail **gets its hover card** — *"if you want more info you can
      move your mouse over and hover or move your mouse out to see the ui witout
      the hover"* — detail on demand, not a second way to select a day; and on
      that reading the build's no-hover-tint rule and the design's card turn out
      to be **compatible** (the design tints the row on focus only and raises
      the card beside it), so the test defending the rule stays green and the
      milestone's one apparent reversal is not one. And **where the phone edits
      is sequenced rather than blocked** — *"Phone edit is right after."* — so
      link 13 runs **last in Wave 2** and **no link is blocked on a pending
      decision**. What that does not yet settle is the substance: a phone
      treatment of Plan, or an amendment to §10 saying a phone can render day
      columns after all.
      **Two KIs were filed by the scoping**, both scoped as link 8:
      `KI-2026-09-19-f` (an accent reaches MapLibre through `getComputedStyle`,
      the documented non-fix — correct today only because the tokens happen to
      be hex) and `KI-2026-09-19-g` (the colour wall passes an undefined token
      NAME, which is how M23 shipped a transparent chip).)*

## Candidate ideas (unscheduled)

**Moved to `docs/candidates.md` on 2026-09-21** — 27 entries, and they were 39KB
of this file. `pnpm candidates` lists them; that file carries the placement
lifecycle and the rule that a gate close deletes what it absorbed.

## Deferred work with a resume condition that has already fired

Not a milestone, and not a candidate idea — work that was consciously paused
behind a named trigger, where the trigger has since happened. Listed here
because the only thing that recorded it was a paragraph in `docs/STATUS.md`
marked "history", so nothing live surfaced it and nobody resumed.

- **Test-suite overhaul, Phases 5-7 — CLOSED OUT 2026-08-31.** Phases 0-4
  landed 2026-08-23; 5-7 were gated on M10 Wave 2's gate, which closed
  2026-08-27 with nothing resuming. The required Phase 0 re-inventory was run
  (`docs/plans/test-overhaul/phase-5-inventory-2026-08-30.md`) and the verdict
  is per phase, not wholesale:
  **Phase 5 superseded** — the suite is 138 files / 1,908 tests against the
  overhaul's 95/569 baseline, but reading the candidates rather than ranking
  them, category (c) is empty, (a) is 7 assertions, (b) is 60, and (d), the big
  lever at a claimed 152 tests, is nine false positives. The suite tripled
  because the product tripled; volume is real, waste is not.
  **Phase 6 absorbed** — 6.4 is `check-sleep-wall.mjs`, 6.5 is AGENTS.md's
  property-test rule plus `witness.ts`, whose last gap (three `fast-check`
  files with no floor) was closed 2026-08-30 with measured, non-vacuity-proven
  floors.
  **Phase 7 is NOT closed** — see the two live items below.

- **The activity-field descriptor refactor — unattached since 2026-08-31.**
  Project review §6.1. Scheduled 2026-08-29 "alongside" M11a and M11b; both
  gates closed 2026-08-31 and it did not happen, so it belongs to no milestone
  and nothing surfaced it. **Recorded here 2026-09-11** because the only thing
  carrying it was `docs/STATUS.md`'s "Next action" — the precise failure this
  section exists for, repeated. It is **not blocked**: its stated prerequisite
  is already met (§1.6 / KI-54 resolved, `equality.ts:55-56` compares `city`
  and `countryCode`). `AGENTS.md` reserves the contracts step as **its own
  reviewed PR**, which Mitchell scheduled it knowing — so keep it separate from
  any milestone PR.
- **The 19 Dependabot alerts.** Per-advisory triage against actual usage, not a
  bulk bump. Deferred deliberately; recorded here 2026-09-11 for the same
  reason as the item above.

## Live, and previously hidden inside a closed-out plan

- ~~**Seed content is code, so there is not much of it**~~ — **done 2026-09-06**,
  branch `claude/serialize-and-seed-data-66f8tb`, **ADR-041**. Mitchell asked for
  a JSON serialization for notebooks, activities and trips, an importer, and *"a
  lot of believable playbooks"*. `travel-collab/content-bundle/v1` +
  `pnpm --filter web content:import` + **148 playbook days over twenty regions**
  and four demo trips, all in `content/` — including San Francisco, Napa,
  Capitola/Monterey and the Finger Lakes, which Mitchell named on the night. `saved_days.author_kind` (migration `0017`)
  is the human-vs-AI flag he asked for, surfaced as an "AI starter" badge.
  **It closed a real gap**: Discover's budget filter had no occupant in three of
  its four bands anywhere in the seed — the thing `starterDays.ts`' own header
  flagged and said it was too small to fix. All four are populated now.
  What it left open, on purpose: **`KI-2026-09-06-c`** — imported stops carry no
  coordinates (a wrong pin is worse than none; KI-39 measured that once already),
  so the four demo trips read "N stops have no place yet" on the Map lens until
  somebody runs an offline geocoding pass on the model of
  `scripts/geocode-japan-seed.mts`. The playbook days are unaffected — Discover
  matches on `location.city` and all 1,375 stops carry one. And
  **`KI-2026-09-06-d`** — the later bundles were written without live web access,
  so their prices and opening hours need a verification pass; each says so in its
  own `bundle.sources`.

- ~~`docs/guidelines/testing.md` does not exist~~ (7.2) — **done 2026-09-02.**
- ~~No `write-a-test` skill~~ (7.4) — **done 2026-09-02.**
- ~~Task 7.1's lint rules~~ — **done 2026-09-02**, and the reason it was still
  live is worth keeping: 7.1's header had said *landed* since 2026-08-31 on the
  strength of four unrelated walls in `scripts/`. Five of its six rows had
  shipped as nothing. **A task marked done by substitution is worse than one
  marked open** — nothing was looking for it. Two of the six rows are now
  rejected in writing rather than left implied (`randomUUID` breaks the
  integration lane's row isolation; the `TripDetail` row needs type information
  ESLint does not have).
- **Task 7.5 — close out the plan.** The last live item in the test overhaul.
  `ADR-021-testing-strategy.md` does not exist, and it is the thing that stops
  a future session re-proposing the three levers already evaluated and
  rejected: `isolate: false` (248 failures), a coverage-percentage gate, and a
  permanent mutation-testing CI job. Then `docs/plans/2026-08-23-test-suite-overhaul.md`
  and `docs/plans/test-overhaul/` are removed in the same commit, per
  `docs/plans/README.md`. Own PR. **Do not delete the directory without writing
  the ADR first** — the rejected levers are the durable half.
- **Convert `ci.yml`'s `paths-ignore` to a skip-job pattern BEFORE enabling
  branch protection.** The repo went public 2026-08-31, so branch protection is
  now available (`gh api .../branches/main/protection` returns "Branch not
  protected", not the old "Upgrade to GitHub Pro"). The moment a path-filtered
  job is made a *required* status check, every prose-only PR is unmergeable
  forever — a required check that never runs never reports. A job that runs and
  skips does report, which is the fix. `docs/guidelines/ci-cost-and-capacity.md`
  carries the detail. **Do this before flipping required checks on, not after.**

## Standing tasks (every milestone)

- **Preflight (kickoff):** before the milestone's first task, reconcile the
  *previous* milestone's gate-close checklist (`docs/milestones/README.md`) — if
  any flag is unflipped, flip it first. This is the forcing function that catches
  a missed gate-close. Also check for sibling `claude/*` branches on the
  *current* milestone (`git branch -a`, `git ls-remote --heads origin`) that
  might be finished-but-unmerged before starting more independent work on top —
  see `AGENTS.md`'s Workstreams section for why this matters and what it cost
  once already (M10 Wave 2 Phase 3 sat unmerged and diverged while Phase 4 was
  built and merged independently, 2026-08-22).
- Write the milestone file (scope + exit gate) before its first commit.
- Keep every prior milestone's e2e script green.
- **At gate time, run the gate-close checklist** in `docs/milestones/README.md`
  (tick here, check the milestone file's exit-gate boxes, append the retro, bump
  Current milestone, update `docs/STATUS.md`, and remove the milestone's plan
  from `docs/plans/` after promoting anything durable out of it) — all in one
  commit, never a trailing manual step.
- Record any irreversible decision as an ADR before acting on it.

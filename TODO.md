# TODO — high-level roadmap for agents

How to use this file: find the first unchecked item — that is the current
work. Read its milestone file in `docs/milestones/` before planning anything.
Check items off only when the milestone's exit gate passes (not when code
merges). Never start an item while an earlier one is unchecked without
Mitchell's explicit say-so. Full process: `docs/guidelines/`.

**Right now that say-so has been given and the list is out of order on
purpose**, so read the marker, not the position: **M17 is the current work**,
per the order set on 2026-08-29 when Mitchell placed two of the three
approved-but-unplaced milestones, of which M18b's gate closed 2026-08-30.
**M11b Playbooks was scoped and placed on 2026-08-30** — the last of the three —
and **M11a, an invite gate, was scoped the same day and placed in front of it**.
The order was `M18b ✓ → M17 → M11a → M11b → M12 → M13 → M14 → M9`, and on
**2026-08-30 Mitchell jumped M17** — asking for "the rest of M11" first. **Both
M11a's and M11b's gates closed 2026-08-31**, and **M19 was minted and placed
last the same day**, so the order is now
`M18b ✓ → M11a ✓ → M11b ✓ → M17 → M12 → M13 → M14 → M9 → M19`. The reorder
note, and the one consequence it carries for M11b, are in
`docs/milestones/README.md`.

**Reordered again 2026-09-01 — M9 moves from last to second.** Mitchell's call
on the audit (`docs/reviews/2026-09-01-milestone-audit.md`): M9 turned out to be
four-sevenths built, and both of ADR-022's grounds for placing it last — polish
first, sharing first — have since happened. **The order is now
`M17 → M9 → M20 → M21 → M12 → M13 → M14 → M19`** — **M20 and M21 were
minted and placed 2026-09-01**, after M9, by Mitchell's call. M19 stays last regardless: its link 3
overlaps M13's `add-stop-who`. Note the list below is in file order, not
execution order — read the `← current milestone` marker, per the rule above.

**M12, M13 and M14 were scoped the same day**, each getting the file and exit
checklist `docs/milestones/README.md` requires "before work on it begins" and
none of them had. Every milestone in the order now has a written gate except
M19, which is deliberately *placed but not scoped*.
Whichever item carries `← current milestone` is the current work; when that marker and the first
unchecked item disagree, the marker names a recorded Mitchell decision and the
milestone file it cites is the evidence.

**Nothing is approved-but-unplaced any more.** M11b was the last one, and it was
unplaced for a specific reason — it had no scope and no exit gate, and writing
those was a product decision. The **2026-08-30 design handoff** (`SPEC.md` §15,
`DRIFT.md` §2b — Playbooks becomes a public library) is that decision arriving,
and Mitchell scoped and placed it the same day. **It sits immediately before
M12 on purpose**: M11b publishes days and M12 adds reviews and moderation on
top of them, and the scope line between the two was drawn deliberately — see
the milestone file.

**M11a was created out of that same review and runs in front of M11b.** M11b's
scope split defers moderation on the grounds that the population is invited;
M11a is the gate that makes that true. It is small — the `users` table and a
fail-closed `signIn` callback already exist — and it is placed first because
publishing must not go live on an open signup.

**Scope for each milestone lives in `docs/milestones/README.md`** (the table),
and the detail plus exit gate in that milestone's own file. This file is the
checklist only — deliberately not a second copy of the scope, because two
copies drift.

Where the work actually stands right now: `docs/STATUS.md`.

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
- [ ] **M17 Account preferences** ← **current milestone** — **re-scoped and placed 2026-08-29, after
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

- [x] **M11 Sharing, invites, and a trip you can hand to someone** —
      **gate closed 2026-08-28**
      → `docs/milestones/M11-sharing-and-invites.md`
      *(**Scheduled 2026-08-27 ahead of M18's remaining surfaces and ahead of
      M16**, by Mitchell's call — the explicit say-so this file's ordering rule
      requires. It **absorbed M13's invites/roles/revocation scope** in the same
      decision; M13 keeps only near-real-time sync and its transport ADR.
      Links 1-6 landed 2026-08-28 via PR #71 with remediation in PR #78
      (users/identity, roles and access, invites, pinned shares,
      clone-with-lineage, saved days); migrations 0006-0010 are dispatched to
      production. **Playbooks/templates — inherited from M7 — was carved out of
      this gate by Mitchell on 2026-08-28 and is its own follow-on**, so the
      four Playbooks `<Preview>` shells stay M11-tagged in
      `preview-registry.ts` with nothing else left in the milestone. Gate
      evidence and retro are in the milestone file.)*
- [x] **M11a An invite gate on the front door** — **gate closed 2026-08-31**,
      nine of nine boxes; the three admission paths walked on **production**
      (KI-50 blocks the OAuth round trip on a preview). Gate evidence and retro
      are in the milestone file. →
      `docs/milestones/M11a-invite-gate.md` — **scoped and placed 2026-08-30**,
      then **moved ahead of M17 the same day** on Mitchell's call, so it runs
      first and **before M11b**. **It needs one migration (`invite_codes`), and
      merging does not apply it** — dispatch with
      `gh workflow run migrate-production.yml -f confirm=migrate` from `main`,
      and say so in the PR body.
      *(Created out of M11b's scoping review the same day. M11b publishes
      user-authored text and leaves reporting to M12, which rests on Mitchell's
      call that the platform is invite-gated — and it is not: any Google account
      that reaches `/signin` gets one. Three ways through the gate, all
      evaluated only when there is no `users` row: a pending M11 trip-invite
      token, a reusable **super code**, and **single-use codes** in a new
      `invite_codes` table. Small, because `users` (ADR-025) already records who
      has been here and `recordSignIn` is already a fail-closed boolean — the
      one real problem is that OAuth leaves the site, so the code rides a
      short-lived cookie across the round trip. Needs a migration, and the
      migration needs a dispatch.)*
- [x] **M11b Playbooks becomes a public library** — **gate closed 2026-08-31**,
      eleven of eleven; publish → discover → add walked as two actors and the
      `cities` backfill run against production. Gate evidence and retro are in
      the milestone file. →
      `docs/milestones/M11b-playbooks-public-library.md` — **scoped and placed
      2026-08-30**, running after M17 and immediately before M12.
      *(Carved out 2026-08-28 when M11's gate closed: the milestone's file
      said its Playbooks scope stayed, none of its eight exit-gate boxes tested
      it, and none of the six links touched it. It then sat unplaced for two
      days because it had no scope — a product decision. The **2026-08-30
      design handoff** supplied it: `SPEC.md` §15 turns Playbooks into a
      discovery surface over other people's days across four routes —
      `playbooks` (Discover), `day`, `board`, `profile`, three of them new.
      **Mitchell drew the scope line short of reviews**: M11b takes all of §15
      except reviews and ratings, M12 keeps those plus moderation. Eight links,
      from `cities: string[]` and a city search endpoint through publishing, an
      adds ledger keyed by (day, trip), and the four routes. Closes DRIFT's D9
      and deletes the last four M11-tagged `<Preview>` shells. Saved days
      (M11 link 6, ADR-029) is the data model it builds on.)*
- [ ] **M12 Reviews and moderation** — all trust & safety scope
      lives here, nowhere earlier.
      → `docs/milestones/M12-reviews-and-moderation.md`
      *(**Retitled and scoped 2026-09-01** — was "Community", with no file and
      no exit gate. The public gallery and discovery that name promised
      **shipped in M11b**; what M12 keeps from `SPEC.md` §15 is reviews,
      ratings everywhere they surface, and moderation. Six links, nine gate
      boxes. It exists to delete one line from §15: **"Until the reviews table
      exists, every rating here is fixture data"** — still true in `main`.
      Needs a migration.)*
- [ ] **M13 Collaboration** — realtime transport ADR and concurrent-edit
      conflicts. → `docs/milestones/M13-collaboration.md`
      *(**Narrowed 2026-08-27**: invites, roles and revocation moved into M11,
      because they are the same `AccessPolicy` change as share links and opening
      that boundary twice costs twice. **Scoped 2026-09-01** — five links, and
      the transport ADR is a prerequisite rather than a deliverable. Link 3 is
      the *"adopt this outcome, re-predict what is queued"* reducer **KI-90
      already names as the fix** for KI-90, KI-5 and KI-77 at once. It also owns
      per-stop attribution, which **M19's link 3 depends on** — if M13 ships
      without it, that link returns to M19.)*
- [ ] **M14 Rich layer** — the macro vocabulary deferred out of M8 returns here.
      → `docs/milestones/M14-rich-layer.md`
      *(**Scoped 2026-09-01** — six links, and the **repeaters ADR is a
      prerequisite**, not a mid-build deliverable. Checked against the tree:
      `MacroKind` is `"inline" | "block"` with no repeat kind, and every macro
      is `NoParams` — the registry's `params` seam exists and has never been
      used, which is exactly what that ADR is for. **Two items on this row need
      a call before it opens**: the M8 macro vocabulary, and **external calendar
      sync**, which has no design, no ADR and no relationship to the Notebook,
      and may deserve its own milestone.)*
      *(Also owns the whole Notebook redesign from the 2026-08-23 design sync —
      `.design-sync/handoff/SPEC.md` §7. Opens with a **repeaters ADR**: a loop
      macro with an author-supplied row template is the one genuinely new
      engineering decision that sync created, and every macro today is
      `NoParams`.)*
- [x] **M15 Front door** → `docs/milestones/M15-front-door.md`
      *(Gate closed 2026-08-26, PR #56. **Ran ahead of M10's Phase 9 gate and
      M16**, superseding ADR-021/ADR-022's stated ordering — decision 1 in the
      milestone file, reconciled into `docs/milestones/README.md`'s roadmap
      table and Current milestone in this same gate-close commit. Landing
      page, custom sign-in/sign-up (Google + dev-login), Home's empty-state
      first-run moment via the existing `NewTripWizard`'s "Create empty" (the
      designed one-field first-run screen was dropped, decision 3), and the
      header account menu (already shipped in M10 Phase 8b). Both open
      questions resolved: no separate first-run screen, and the landing copy
      ships verbatim selling M11/M12. M10's Phase 9 gate closed after this, on
      2026-08-27; **M18** is the next work.)*
- [ ] **M9 The assistant cites what it plans** →
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

- [ ] **M20 An account knows what it may do** →
      `docs/milestones/M20-account-tiers-and-entitlements.md`
      *(**Minted, scoped and placed 2026-09-01** — the **first commercial
      milestone**: nothing in the repo had ever described a paid tier, a plan,
      a price or a payment. Placed after M9 because `ai-live` defaults off and
      M9's grounding is what would let it be turned on — selling a dark
      feature was the reason not to place it sooner. Mostly wiring a seam
      built for it and stubbed since M16: `modelSelection.ts:88` declares
      `AiEntitlementCheck`, `:89` stubs it `EVERYONE_IS_ENTITLED`, and `:47`
      says *"the day a pro-tier check exists it lands inside `isEntitled`
      below, not as a signature change"*. Nine links, the ninth added 2026-09-01 for the
      financial metrics: an **`ai_usage` cost ledger** storing tokens and
      models, never dollars (prices move, and `Money`'s integer minor units
      round a $0.0011 request to zero cents), moved out of M21 because both
      milestones' pricing decisions are guesses without it. **Plan contents are versioned data, not
      code** (2026-09-01) — `plan_versions` is immutable and append-only, a
      purchase pins a version, and changing a price publishes a new one rather
      than rewriting what anyone was sold; prices become tweakable without a
      deploy. **A plan is a set, not
      a rank** — Mitchell's requirement is that tiers are "not necessarily
      subsets", so copying `accessPolicy.ts:11`'s `RANK` is the obvious move
      and the wrong one. Trials, referral rewards and admin boosts collapse
      into **one time-bounded grant with three `source` values**. Free keeps
      trip planning entire; AI and inviting collaborators are paid. **Takes no
      money** — the admin grant UI is what proves it without Stripe. Two
      decisions by Mitchell the day it was scoped: plans are
      `free | plus | premium` and **defined by enumeration, never by
      extension** (the ladder is presentation only — nothing in code may know
      the three nest); on lapse granted memberships **cap at `viewer` on
      read**, never written to `trip_memberships`; existing accounts get a
      permanent `founder` grant; the **trial grants `plus` at signup**; and a
      **referral earns one month of the tier the referrer already holds**, so
      a free account earns nothing. **Link 5 carries the cost
      arithmetic**, against the models actually configured
      (`deepseek/deepseek-v4-flash-0731`, `zai/glm-4.7-flash`) rather than
      `config.ts`'s compiled Haiku default, which is not what runs: one live
      request cost ~$0.001 and a fully-maxed account lands at ~$3-25/month,
      so the ceilings are an abuse bound rather than a margin problem. Needs a migration, and an **ADR is a prerequisite** — it adds an
      Entitlements module to `AGENTS.md`'s structural-law map.)*

- [ ] **M21 An account can pay for itself** →
      `docs/milestones/M21-subscriptions-and-billing.md`
      *(**Minted, scoped and placed 2026-09-01**, immediately after M20.
      Stripe checkout, the webhook that is the **sole writer** of subscription
      state, the customer portal, failed payments. **Adds no entitlement and
      no gate** — if its diff touches `modelSelection.ts`, `quota.ts` or
      `members.ts`, the split has failed. Split from M20 because M20 is
      provable with no external service and this is not, because a hand-grant
      path is permanent infrastructure rather than scaffolding, and because
      the blast radius here is money. **One decision is Mitchell's before it
      opens: the plans and their prices** — M20 names plans without pricing
      them. Also carries the `/ask` step-metering fix
      (`handleAskRequest.ts:306` charges `aiQuotas()` but never
      `aiStepQuotas()` or `settleAiSteps`), without which AI cannot be
      priced.)*

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

## Candidate ideas (unscheduled)

Captured so they aren't lost; not committed to a milestone yet.

- **Drop Travelers from the trip header bar (2026-08-30, Mitchell, on PR #89's
  preview — "Drop Travelers from this bar, its not needed, it can live just in
  the trip settings").** It is a delete, not a move, and smaller than it sounds
  — checked before filing:
  - The control is the avatar stack plus "N travellers" in
    `components/trip/TripMetaPill.tsx:39-58`, beside days / stops / cities.
  - **Its `onClick` is already `onOpenSettings`** — it opens the same
    `SettingsSheet` the trip title does. So the routing Mitchell describes is
    not something to build; the control is a link there already.
  - **Settings already lists members.** `SettingsSheet.tsx:327` has a "Who is
    invited" section whose `TravelersPanel` shows the effective members and, for
    an owner, creates, copies and revokes invite links (M11 link 3). Nothing is
    lost by removing the header display.
  So the work is deleting the `<Button>` and its avatar stack from
  `TripMetaPill`, and its assertions from `TripMetaPill.test.tsx`. Watch the
  divider: each meta item is preceded by a `bg-hairline` spacer, so the one
  before it goes too or the pill ends on a stray rule.
  The one judgement left is what it costs on a **shared** trip: after M11 the
  avatar stack is the only at-a-glance sign that a trip has other people on it.
  On a solo trip it reads "1 travellers" and earns nothing, which is the case
  Mitchell was looking at. Removing it unconditionally is the literal ask;
  hiding it below two members is the smaller-blast-radius alternative.
  Deliberately not done in PR #89 — that PR closed M18's gate, and removing a
  control from a different surface would have made the gate evidence harder to
  read.

- **Transport mode per leg — the map legend's modes (2026-09-01, out of the
  milestone audit).** `map-legend-modes` in `preview-registry.ts` was tagged
  **M9** and is not M9's work: M9's scope has no transport-mode link, no
  contract change and no migration. It was **retagged `unplaced`** rather than
  moved to a milestone that merely sounds adjacent — the registry's own rule is
  that a tag is a claim the milestone will wire the shell up, and a false claim
  costs a future gate, which is how M11b's *"no M11-tagged entry remains"* box
  got stuck.
  What it would need: a field modelling how you get from one stop to the next.
  **`ActivityKind` already carries `transit`** (M18), so the stop knows it *is*
  travel — what nothing records is *by what*. `activity.ts` warns explicitly
  against a second field that could disagree with `kind`, so this is the same
  design question M19's link 1 has to answer about costs: inherit, or carry its
  own. Worth deciding once for both.
  Not scoped, not placed, and deliberately not attached to a milestone until
  someone wants it.

- **Timeline: scrolling should move the day chips, the way the map rail
  already does (2026-08-28, Mitchell, walking PR #71's preview — "Add this to
  the future tasks").** The timeline's focus binding is one-way today. A chip
  click scrolls the timeline (`TimelineLens`'s `scrollIntoView` effect on
  `focusedDay`), but nothing reads scroll position back out, so scrolling never
  moves the chips. `MapRail.tsx:186` is the only scroll listener in the app and
  there are no IntersectionObservers at all.
  It reads as a regression because **the behaviour already exists on another
  lens**: the map rail focuses whichever day its focus line is over, through
  the same `onFocus` callback a click uses, and `m10-map-rail.spec.ts`
  ("scrolling tracks focus through every day") pins it. Having it in one place
  and not the other is what makes its absence feel like breakage rather than
  an unbuilt feature.
  Build it by reusing the rail's approach rather than inventing a second one —
  measure the day headers, cache the offsets, refresh with a `ResizeObserver`,
  and pick whichever header is nearest a focus line on each scroll. The rail's
  own comment argues against an IntersectionObserver for two reasons that
  apply here unchanged: a header sitting at ratio 1.0 never re-reports while
  its real position keeps moving, and IO delivers nothing in a backgrounded
  tab — both leave focus on stale data.
  The one thing to get right is the feedback loop: focus-on-scroll must not
  re-trigger the `scrollIntoView` effect, or the view fights the user. The rail
  avoids it by calling `onFocus` only when the resolved day actually changes;
  the timeline additionally needs that effect to skip scrolling when the change
  came *from* scrolling.
  **Raised a second time on 2026-08-30**, on PR #89's preview — "As i scroll
  through the timeline, it should select the day you are passing, and show the
  selection at the top bar to". Same request as the 2026-08-28 one above, now
  with the top-bar half stated explicitly: the day chips should show the
  selection, not just the timeline. Two asks for the same thing in two days is
  the strongest signal on this list that it is worth scheduling.

- **Save light: move Retry out of the mark and into a popover on it
  (2026-08-26, Mitchell, PR #55 — "nice to have, to do later").** SPEC's "The
  logo is the save light" justifies putting trip-scoped save state in an
  account-scope bar on the grounds that it is *status, not an action* — which
  is exactly the exemption `RULES.md` 1 needs. What shipped makes the mark
  itself a Retry **button** while a send has failed, because the design gives
  the failure a colour and no way out of it and this queue only retries when
  asked (KI-36); that keeps `RULES.md` 6's "recover from the worst" but spends
  the very justification SPEC used.
  The better shape, deferred rather than rejected: the mark stays status-only
  and **clicking it opens a small popover** carrying the failure detail and the
  Retry control. The top bar then holds status, the action sits one level in,
  and rule 1 is clean again. It also gives the failure message and
  `failure.at` timestamp somewhere to live — today nothing renders either, and
  `SaveLight.tsx` documents why it will not fake a relative "(since …)" without
  a ticking clock.
  Not free: a popover on the logo is a new interaction on the one element
  present on every route, so it needs its own dismiss/focus behaviour and a
  decision about whether it opens at rest (probably not — there is nothing to
  say when everything is saved).

- **Design-sync items with no milestone yet (2026-08-23).** From
  `docs/design-feedback/2026-08-23-design-sync-review.md`, which writes each one
  up in full. Decided items are struck through with where they went:
  - **`TripSummary.startDate`** — one field, so home's "next trip" is real
    rather than `visibleTrips[0]`. The data already exists on
    `TripDetail.startDate`; only the summaries read model lacks it. Per
    `AGENTS.md` a contract change is its own reviewed step, so it goes **before**
    M10 Phase 8's home-hero task, not inside it. **This subsumes the "Trip list
    row: richer, human-readable metadata" idea below** — that item wants exactly
    this field.
  - ~~**Start-only trip dates**~~ — **DECIDED 2026-08-23, landed 2026-08-24.**
    The end is always start + day count; there is no end-date input anywhere.
    Shipped as **Task 8b.6** of M10 Wave 2 — its plan file was deleted at the
    gate close per `docs/plans/README.md`; the durable record is
    `docs/milestones/M10-visual-craft.md`'s Wave-2 retro. Phase 7's wizard
    already matched (its length chips predate this task). It turned out to be UI-only: `endDate` is stored nowhere — not on
    `TripState`, not on `TripDetail` — and `TripHeader.tsx:228` already
    derives it from the plan's last day, so no contract, command or domain
    change was involved. **This also closed the "trip end-date picker may
    drift from the day count" item that used to sit below** (removed from
    Candidate ideas by this task): not stored-field drift, but a derived
    value presented in an editable field.
  - **Design coverage the build is still owed** — History beyond the popover,
    `MapRail`, trip lifecycle (delete → undo → restore, duplicate), and
    error/empty states for the new landing, auth and first-run screens. Design
    work, not build work. (The three undesigned extra lenses this used to name
    alongside them — Itinerary, Daily overview, Full trip — are gone: **KI-20**
    was closed by retiring them, not by designing a home for them.)

- **M8 Wave C/D trim: quick-add, search-to-add button, move-via-menu,
  first-run state, empty states (Mitchell, 2026-08-07).** Deferred out of M8
  rather than done reflexively, once Wave A merged. None of these close a
  capability gap: an activity — including one with a real geocoded place —
  can already be added via the existing `+ Add activity` editor
  (`ActivityEditor.tsx`/`LocationInput.tsx`), and reordering already works by
  dragging. What's deferred is speed (a faster input, a dedicated search
  button, a menu instead of a drag) and presentation (first-run/empty-state
  copy and layout) — genuine ergonomics and polish, but not blockers against
  the Phase 1 gate, and exactly the surface a separate, already-underway
  design-tool brainstorm for the product's future look and feel is likely to
  reshape. Building it now risks the "redone twice" cost M5's own Wave 1
  re-skin already paid once when the layout moved underneath it — the same
  argument M10's own scope doc makes about not polishing a structure that is
  still moving, applied here to interaction/ergonomics work instead of visual
  polish. **Kept, not deferred:** the KI-5 visible-sync-state indicator
  (correctness/trust, not ergonomics — doesn't depend on quick-add existing)
  and the M8 e2e gate script, resized to exercise the existing
  add-activity/drag-and-drop flow. Full reasoning in
  `docs/milestones/M8-make-it-real.md`'s "Scope trim" section — the original
  step-by-step plan (`docs/plans/2026-07-28-M8-make-it-real.md`, including
  the deferred C1–C3/D1–D2 task write-ups) was deleted at M8's gate close
  per `docs/plans/README.md`'s staging-area rule. Revisit once M10's
  direction is set — these are exactly the kind of task that direction
  should inform, not the reverse.

- **Trip list row: richer, human-readable metadata (Mitchell, 2026-08-01, from
  M8 dogfooding).** The "Your trips" list currently shows each row's
  `createdAt` as a raw ISO timestamp (`2026-08-01 23:52:35.026+00`) — should be
  human-readable, and more useful than the creation date anyway: start date,
  trip length (day count), and cost are all already on `TripSummary`/derivable
  from `TripDetail` and would tell the user more at a glance than when the row
  was created.

- **Duplicate and the undo-toast's Restore: no optimistic update yet (Mitchell,
  2026-08-01, from M8 dogfooding).** Delete's optimism (page.tsx's
  `deletingIds` filter-set, M8/A15 follow-up) and the rename/date/budget
  optimism fix (TripHeader reading `activeTrip` instead of `trip`) both landed
  as small, well-scoped fixes. Duplicate (network round-trip before the
  redirect fires) and Undo (`page.tsx`'s `undoDelete` does a full `load()`
  refetch rather than re-inserting the row locally) are lower-value/more work
  for now — deferred rather than done reflexively.

- **Expose geocoding as a model tool — now scoped into M9 as "Grounding"
  (`SearchPlaces` + `placeRef`).** Filed 2026-08-01 (Mitchell, M8 dogfooding)
  as the deferred half of the geocoding work: server-side auto-geocode was
  landing as the fix for the model guessing `Location.lat/lng` (observed:
  `lat: 0, lng: 0`), and giving the model a tool to *disambiguate candidates
  itself* was held back as more steps/tokens for cases "auto-geocode's 'take
  the top match' can't — e.g. two same-named places in different cities the
  model needs to pick between using trip context."
  **The 2026-08-02 dogfood run hit that exact case and the deferral proved
  wrong.** "The Red Coach Inn" top-matched to a coaching inn in Shropshire,
  England and overwrote coordinates the model had gotten right; seven more
  lookups were silently dropped by a rate limit (KI-15). Auto-geocode is not
  a weaker version of the tool — it is strictly worse than doing nothing when
  it is confidently wrong, because it launders a guess into a stored fact.
  Kept here only as the record of why it was deferred and what killed the
  deferral; the live scope is M9.

- **Contained activities: a meal inside a day-long activity is not a conflict
  (Mitchell, 2026-08-02, from M8 dogfooding).** Every day of the Rochester run
  raised a `time-overlap` warn, all three the same shape: a long anchor
  activity (Niagara Falls 09:00–16:00, the Strong Museum 10:00–16:00) and a
  lunch sitting *inside* it. The AI was not wrong — you *do* eat lunch during
  a museum day — and the user's reading was "we might want a feature for when
  the lunch is at the event." So this is not a prompt fix: telling the model
  the conflict rules would only teach it to stop scheduling lunch, which is
  worse. **The domain models overlap but has no notion of containment.**
  Directions to weigh in a brainstorm, not yet decided: (a) real nested/child
  activities in `packages/domain`; (b) a span/kind distinction so a long
  activity is a *container* rather than a peer; (c) leave the model alone and
  refine the rule in `conflicts.ts` — suppress `time-overlap` when one window
  fully contains the other and the inner one is short; (d) do nothing and let
  dismissal absorb it (status quo — but three warns on a three-day trip is
  the AI teaching users to ignore the conflict UI, which is the real cost).
  Note (c) is the cheapest and (a) is the most honest; the choice depends on
  whether containment ever needs to mean anything beyond silencing a warn.
  Deliberately kept out of M9 — it is a `packages/domain` contract question
  with conflict-detector consequences and deserves its own design pass.

- **AI "Preview" before apply — now scoped into M9.** Kept here only for the
  two implementation directions it records, which M9's design spec has to choose
  between (Mitchell, 2026-07-25): (a) lean on the event-sourcing/history
  substrate — a single pending "future" branch the user reviews and approves (or
  discards) to fast-forward into the real log; or (b) an intermediate, validated
  model of the proposed batch surfaced to the frontend for approval before it is
  applied. Becomes more valuable again at M13, where multiple actors make
  "propose then approve" a collaboration primitive rather than just an undo
  affordance.

- **AI cost/quality tuning — "best model for my buck" (Mitchell, 2026-07-25).**
  **Thread (1), prompt trimming, was measured on 2026-07-27 and is NOT worth
  doing.** The per-round-trip payload is small: context envelope ~623 tokens for
  a 7-day/21-activity trip (board surface; 858 for `combined`), derived planning
  tool schemas ~816 tokens, system rules ~450 — about **1,900 tokens per model
  round-trip**. The live run that recorded ~33.5k input tokens was therefore
  ~18 round-trips, not a fat prompt: the cost was **step count**, which the
  2026-07-26 step-budget fix already addressed (system prompt now tells the
  model to emit every call in one message; typical runs should be 1–3 steps).
  Trimming `context.ts` would save tens of tokens per step and cost legibility.
  **Watch `meta.steps` instead — that is the cost driver, and it is already
  instrumented.**
  **Thread (2), the model harness, still stands and is the valuable half:**
  build a small harness that runs a fixed set of representative prompts (e.g.
  "plan a N-day trip", "move X to day 2", "add lunch on day 3") against several
  gateway models and records, per model, the `meta` we already emit
  (input/output tokens, steps, durationMs) alongside a quality score (did the
  batch apply? correct day placement? no dropped/duplicate commands?). Goal:
  pick the cheapest model that clears a quality bar. Weak models loop and
  over-generate; the harness makes that measurable instead of anecdotal. This
  doubles as the fix for KI-11 (no test ever calls a real model).

- **Unscheduled rack: drag support is Board-view-only (2026-08-23, manual QA
  on PR #26's preview deploy).** **The drawer now follows this, not the other
  way round (2026-08-26, Mitchell, PR #55):** it renders only where a stop can
  actually be dropped, so closing any of the four gaps below brings the drawer
  back to that lens. The gate is `board/lensAcceptsDrops.ts` — one function,
  deliberately not a lens list, so "the drawer is here" and "you can drop here"
  cannot drift apart. Phase 3 wired `dropTargetForElements` for the
  rack's own drop zone, `Column.tsx`'s day columns, and each `ActivityCard` —
  all inside the Board (day-columns) lens. Nothing under
  `apps/web/src/components/lenses/` registers a drop target, so dragging a
  stop out of the rack does nothing in Calendar or Timeline view even though
  the rack itself is visible there too (it's mounted once, outside the lens
  switch, on purpose — see `TripBoardScreen.tsx`'s own comment). Four related
  gaps, captured together since they're all this same rack/lens boundary:
  1. Drag-from-rack onto a day in Calendar view — no drop target exists.
  2. Drag-from-rack onto Timeline view — no drop target exists.
  3. Whether the drawer should stay mounted across every lens (current,
     deliberate behavior) or collapse/hide itself on a view change is worth
     revisiting now that dragging into it only actually works from Board —
     showing it everywhere reads as "this works here" in views where it
     doesn't. **Decided (Mitchell, preview review, 2026-08-25):** hide it on
     Map only — Map is the one lens where the rack is a `position: fixed`
     overlay over a full-bleed canvas with nothing under it. Timeline and
     Calendar keep it mounted, because unlike Map they have a working
     non-drag path (the day-assign `NativeSelect` → real `MoveActivity`/
     `UpdateActivity`), so hiding it there would remove a capability, not
     just a misleading affordance.
  4. The drawer is `position: fixed; bottom: 0` (`globals.css`) with no
     clearance reserved in any lens's own content — unlike the assistant
     rail, which gets `.trip-board-content`'s right-padding reservation, no
     lens pads its bottom for the drawer. In Timeline (day list) and Calendar
     (month grid), real content can end up sitting underneath it near the
     bottom of the viewport instead of alongside it.
  5. (2026-08-24, Phase 8b cell rebuild) `CalendarLens.tsx`'s day cards and
     stop chips are now built to the design's drag affordance (dc.html:670-
     672's 6-dot grip, `cursor: grab` on both the grip and each chip) but
     are not draggable — `cursor: grab` was deliberately withheld so the UI
     never promises a drag it can't perform (the same failure mode gap 1-2
     already describe). Wiring them needs a drop target registered in the
     calendar lens itself (nothing under `apps/web/src/components/lenses/`
     does today, per the gap above) and reuses `MoveActivity`, the same
     command Board's `ActivityCard` drag already dispatches.

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

## Live, and previously hidden inside a closed-out plan

- **`docs/guidelines/testing.md` does not exist** (test-overhaul Task 7.2).
  Every other "how we work" area has a guideline file; testing does not, and
  `AGENTS.md`'s "Testing model" section is a summary, not the procedure. This
  does not depend on the prune that Phase 5 was closed for. Own PR.
- **No `write-a-test` skill** (test-overhaul Task 7.4). The repo has
  `minimal-check-subset`, `ci-triage`, `worktree-hygiene` and `ai-usage`;
  the one that would shape *new* tests is the one missing, which is part of why
  the suite grew unattended. Own PR, and worth doing after 7.2 so it has a
  document to point at.
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

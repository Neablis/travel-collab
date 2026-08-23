# Design sync review — 2026-08-23

Reviewer: agent session on `claude/design-sync-review-anwh9a`.
Subject: the design bundle now committed at `.design-sync/handoff/` —
`design/Trip Planner Redesign.dc.html` (3,524 lines), `SPEC.md`, `DRIFT.md`,
`data/japan-trip-seed.json`.

Read with `docs/STATUS.md` (where the work is), `docs/milestones/README.md`
(gate discipline and the routing table this review adds), and
`docs/plans/2026-08-14-M10-redesign-delta.md` (M10 Wave 2's plan).

**Method.** Every claim in `DRIFT.md` and `SPEC.md` was checked against the
actual tree at `fcb22b5` rather than taken on trust. Where the design is right
about the code, this file says so briefly. Where it is wrong, or where it
reverses something we decided on purpose, it says that at length — that is the
part worth your time.

---

## 1. What arrived, and what is genuinely new

| Commit | Date | What |
|---|---|---|
| `8c2d11e` | 2026-08-22 | The handoff bundle: a 3,135-line DC file, `SPEC.md`, `DRIFT.md`, a Japan seed export |
| `4804609` / `94790bb` | 2026-08-23 | Added at the wrong path, reverted |
| `e0964bc` | 2026-08-23 | +401 lines to the DC and +57 to `SPEC.md` — **the Notebook design** (`SPEC.md` §7) |

Two things changed about how design reaches us, and both matter more than any
single screen:

1. **The design is in the repo for the first time.** Wave 1 built from a
   1,412-line file; Wave 2's plan was written against a 2,623-line file living
   at `~/Downloads/design_handoff_update/current/`. That path is unreachable
   from any session — I checked; it does not exist in this container and never
   will in another. `.design-sync/handoff/design/Trip Planner Redesign.dc.html`
   is now the only readable source of truth, and the plan index and
   `docs/STATUS.md` both still name the `~/Downloads` path. **Fixed in this
   commit.**
2. **Generation diffing is no longer possible, and should stop being the
   method.** Generations 1–3 (1,412 / 2,048 / 2,623) exist nowhere we can read.
   `DRIFT.md` already does the right thing instead — reconcile design against
   *code*, using `preview-registry.ts` as the spine for "not built yet". That is
   the durable method; adopt it and stop counting generations.

**Net-new surfaces this sync introduces** (nothing in the tree corresponds to
any of them):

- A **landing page** — hero, product claim, two CTAs, a live-looking itinerary card.
- **Sign-in and sign-up screens** — custom, Google-only, replacing NextAuth's default page.
- A **first-run screen** — "What are you planning, Sam?", one field, plus a Preview-shelled "Roughly when?" row.
- An **account menu** on a header avatar — "Your account" + "Sign out".
- A **Notebook redesign** — reading/editing modes, values as chips, a scope × shape insert picker, and **repeaters**, a macro primitive the registry cannot express today.
- The product is renamed **Caesura**.

---

## 2. `DRIFT.md`'s claims, checked against `fcb22b5`

| # | Claim | Verdict |
|---|---|---|
| D1 | `AppHeader` says "Trip Planner"; `metadata.title` is `travel-collab` | **Correct.** `AppHeader.tsx:19`, `app/layout.tsx:13` |
| D2 | Unauthenticated home is a bare heading + a link to NextAuth's default page | **Correct.** `app/page.tsx:205-217` |
| D3 | No account control anywhere; you cannot sign out | **Correct.** `server/auth.ts` exports `signOut`; nothing in `apps/web/src` calls it |
| D4 | The when-chips have no `CreateTrip` field | **Correct**, and the design already flags it as its own error. `CreateTrip` is `{type, tripId, name}` (`contracts/src/trip.ts:22-26`) |
| D5 | Trip header has six things the DC lacked | **Correct**, and the DC now carries all six |
| D6 | `TripSummary` has no start date, so "next trip" is `visibleTrips[0]` | **Correct** — but see §4.6; this is smaller than it looks |
| D7 | Sync failure should reuse `ConflictBanner`'s vocabulary | **Correct and welcome** — one banner pattern |

`SPEC.md` §7's read of the Notebook code is accurate in detail:
`templates.ts` really does seed `trip-overview` / `day-sheet` (lines 20, 37);
`MacroResult` really does carry `unbound("day")` (`result.ts:4,8`);
`PageScreen` really does have `handleBindDay` / `focusDayBinding` (lines 83, 89).
The design team read the code. That is why the few places it is wrong are worth
naming precisely rather than waving through.

---

## 3. Where the design is wrong about us

**3.1 `--color-success` exists.** `SPEC.md` §2 states flatly that
"`--color-success` **does not exist** in the design system. Use
`--color-success-ink`." It does exist — `apps/web/src/app/globals.css:31`
(`#2e7d43`) — and `.design-sync/conventions.md` lists it in the token table
alongside `-tint` and `-ink`. The design's *choice* of `--color-success-ink` for
the saved dot is fine and we should follow it; the **claim** is wrong, and read
as a rule about the token set it will push the next implementer off a valid
token. Worth correcting at the source so it does not propagate.

**3.2 The day-of-month calendar bug is the design's, not ours.**
`SPEC.md` §4 warns that matching days by day-of-month "scattered a Nov 27 → Dec
10 trip's December days onto November's 1st–10th". `calendarData.ts:63-67`
already keys a `Map` on the full ISO `day.date`. We never had that bug.

**3.3 …but §4's other half is real drift, and no phase covers it.** Today
`calendarCells` emits **one continuous padded grid** from the first month's start
to the last month's end, with **no month headers**. The design wants one stacked
block per month, each headed (`November 2026`) and annotated with the days it
holds (`Day 8 – Day 14`), trimmed to the weeks that actually matter. For a
Nov 27 → Dec 10 trip we currently render about nine weeks, most of them empty.

Two smaller things fall out of reading the same code side by side, neither of
which any phase file mentions:

- **The week starts on a different day.** `calendarData.ts:33` and
  `CalendarLens.tsx:13` are **Monday**-start; the design's `dowHeads` is
  `['Sun', 'Mon', … 'Sat']` (`…dc.html:3408`). One of them has to move.
- **Phase 8 Task 8.6's `+N more` line is superseded.** The current design's
  per-day line reads `3 stops · 9:00 AM – 5:30 PM`, or `Nothing planned yet` for
  an empty in-trip day (`…dc.html:3054`). 8.6 was written against an older
  generation. Whoever runs 8.6 should take the newer copy.

Phase 8 Task 8.6 only restyles the cell. Routed below.

---

## 4. Drift I am questioning — design vs. decisions we made on purpose

These are the ones where "design wins" is not obviously right, because the code's
behaviour is a recorded decision rather than an oversight.

### 4.1 The scope-aware global header reverses a Phase 1 decision

`SPEC.md` §1 formalises a focus-scope model in which the global header shows
**Share + Quick add** inside a trip and **New trip** on the trips list.
`AppHeader.tsx:3-7` carries the opposite decision, in a comment written when
Phase 1 shipped: *"Deliberately a server component with no trip context — it must
not force `layout.tsx` client-side. The prototype's 'Quick add' is omitted: it
needs a trip to add to, so it belongs on the trip surface, not here."*

`DRIFT.md` D3 says "Code is right to omit Quick add" — but the DC and `SPEC.md`
§1 both still put it there, so the bundle disagrees with itself. Adopting §1 as
written means making the global header trip-aware, which means a client boundary
in `layout.tsx` — a structural change to a phase that is already merged, on the
grounds of a model the design added afterwards.

**My call:** keep the code. Quick add belongs on the trip surface (M8's own trim
already deferred it), and Share is an M11 `share-button` Preview. If you want
§1's model adopted, that is a deliberate Phase 1 revisit and should be its own
decision, not a line item inside a polish phase. **Needs your call.**

### 4.2 The first-run screen contradicts the new-trip wizard — inside the same design

The DC contains both:

- `isFirstRun`: one field ("Trip name"), one button ("Start planning"), and a
  Preview-shelled "Roughly when?" row.
- The `New trip` Sheet: **four steps** — Where / When / Who / Shape — with
  destination chips, date inputs, an invite list, budget, currency, pace.

Phase 7 Task 7.2 is written to build the four-step wizard, with a recorded
decision from you on 2026-08-14 ("build all four steps, wire every field the data
model already supports and mark the rest"). So a first-time user would get a
one-field screen, and the same user's second trip would get a four-step wizard.
Either that is intentional (first run is deliberately frictionless) or the design
has two answers to one question. **Needs your call** — my read is that it *is*
intentional and good, but it should be stated, because an implementer meeting
both screens will otherwise reconcile them by guessing.

### 4.3 Start-only trip dates — the code went the *other* way, deliberately

**Corrected 2026-08-23** after Mitchell recalled having already made the picker
start-only. He hasn't — the tree says the opposite, and the direction of travel
matters more than the current state. Traced through `git log --follow` on
`apps/web/src/components/lenses/TripDateControl.tsx`:

| when | what the control was |
|---|---|
| M5, `df3a37f` | **Start-only.** One `input[type=date]`, dispatching `SetTripStartDate` per keystroke |
| **M8 Wave A, `6502a95` (PR #21, 2026-08-06)** | **Grew to start + end.** Its own commit message: *"TripDateControl grows from a start-date-only control into a full date-range control."* Both fields staged locally, an explicit **Set dates** commit, `SetTripDates`, and a confirm dialog when the range shrinks below the day count |
| M10 Wave 2, `4238d88` | Layout only — the action row was overflowing the Dates popover |
| M10 Wave 2 Phase 4 (PR #25) | Restored the **mount point** — the Dates row became a real clickable control opening this in a popover (that is what closed D-2). It did not touch the fields |

Current `main` is both-ends, and the blob is byte-identical on `main`,
`claude/next-work-z7pr1d` and this branch — **no start-only version exists on
any branch**. So `SPEC.md` §3 is not ratifying a fix that already happened; it is
asking us to return to what M5 had and M8 deliberately replaced.

M8's reason is in the code, at `TripDateControl.tsx:40-43`: *"a single
onChange-per-keystroke dispatch (the old start-date-only behavior) can't work
once committing needs to look at BOTH fields together to decide whether the range
grew, shrank, or needs a confirm."* `SetTripDates` exists to reconcile day
**count** to a **range** (`contracts/src/trip.ts:78-89`), and the shrink dialog
exists because that reconcile moves days' activities to the backlog.

**The real substance is the direction of the reconcile, and it is worth having.**
Today it only runs one way: a range change reconciles the day count, but
`AddDay`/`RemoveDay` change the day count without touching `startDate`/`endDate`.
That is exactly the drift `TODO.md` logged from PR #26's QA. `SPEC.md` §3 inverts
it — days are the truth, the end date is derived — which makes the drift
impossible by construction rather than fixable. Copy from the design: *"Pick the
day you leave. The end follows the N days in your plan — add or remove a day and
it moves."*

The cost is real too: removing the end field removes "make this trip run to the
16th" as a single gesture. Under §3 you would set the start and then add or
remove days until the end lands where you want.

**DECIDED 2026-08-23 (Mitchell): adopt it.** *"I do not want us picking an end
date, it makes the UI awful. The end date will always be start date + number of
days in trip = full trip."*

**And on a closer read it is much smaller than either of us framed it — this is
not a behaviour change at the model level at all.** `endDate` **is not stored
anywhere**: it is not on `TripState`, not on `TripDetail`, and exists only as a
parameter of the `SetTripDates` command. `TripHeader.tsx:228` already derives it
from the plan — `activeTrip.days[activeTrip.days.length - 1]?.date` — and
`decide.ts:155` already documents the start-only path (*"A null endDate means
'set the start only' — day count is untouched"*).

So days are **already** the truth and the end **already** follows them. The one
thing that disagrees is the editable end-date input, which puts a derived value
into a field you can type into. Delete the field and the disagreement is gone.

That also corrects the logged bug's diagnosis: `TODO.md`'s "end-date picker may
drift from the trip's day count" is not stored-field drift — there is no stored
field. It is a derived value presented as editable. Task 8b.6 closes it by
removing the field.

No contract change, no domain change, no new command, `packages/` untouched —
which is why it lands **inside** M10 as **Task 8b.6**
(`docs/plans/M10-delta/phase-8b-design-sync.md`), after Phase 6, rather than as
its own post-gate step. Phase 7's wizard step 2 loses its "Leave" input in the
same decision; that file is amended.

### 4.4 "Look around a real trip" cannot ship with the landing page

The landing hero's secondary CTA is `peekTrip` — it drops an unauthenticated
visitor straight into a real trip. That is public read access to trip data. We
have none: `share-button` is a `<Preview>` registered to **M11** ("share links
with read access"), and there is no unauthenticated trip route at all.

**My call:** build the landing page without it, or ship it `<Preview>`-wrapped
against a new registry id pointing at M11. Do not build a bespoke public-read
path to satisfy one button.

### 4.5 The landing copy sells two milestones we have not built

"Save the highlights when you get back, **share them with the world**, and let
other travelers **remix the best parts** into their own adventures" — that is
M11 (fork & remix) and M12 (community), verbatim, on a page shown to strangers.
The rest of the hero is honest about what exists. **Needs your call:** ship the
copy as aspiration, or trim the second clause until M11 lands. A landing page is
the one surface where a Preview badge is not an option.

### 4.6 `TripSummary.startDate` is a read-model widening, not a contract risk

`DRIFT.md` D6 reads as though "next trip" needs new modelling. It does not.
`TripDetail.startDate` already exists (`contracts/src/detail.ts:23`), fed by
`TripStartDateSet` — the data is there, the *summaries* read model just does not
carry it. So this is one field on `TripSummary` plus the projection and its
consumers.

That said, `AGENTS.md` is explicit: *"a contract change (schema + changelog + all
consumers) is its own reviewed step before dependent feature work continues"*,
and the M10 delta plan says *"No new contract fields"*. So it goes **before**
Phase 8's home-hero task, as its own step — not folded into a polish commit. It
also subsumes `TODO.md`'s existing "trip list row: richer metadata" idea, which
wants exactly this field.

### 4.7 "Your account" is designed as a dead menu item

The DC's own handler is
`openAccount: () => this.flash('Account settings aren't built yet')`. So `SPEC.md`
D3's "Your account + Sign out only" is really "Sign out, plus a button that
apologises". **My call:** ship **Sign out** — a real capability gap today — and
either omit "Your account" or register it as a `<Preview>`. Do not ship a toast
that says a feature is missing; that is what the Preview treatment is for.

### 4.8 The seed export should not become a second seed vocabulary

`data/japan-trip-seed.json` (1,626 lines) is useful as design reference. ADR-020
just collapsed four independent test-data vocabularies into `@tc/factories`.
**Do not wire this file into `db-seed` or tests** — if we want the Japan trip as
a fixture, express it through `@tc/factories`.

---

## 5. What the design still owes us

`DRIFT.md` §3 and `SPEC.md` §8 are honest that these are real in code and absent
from the designs. Recording them as a standing design backlog; none of them is
build work:

- **History beyond the popover** — preview-a-past-version and revert-to-state (M2, shipped).
- **The extra lenses** — `ItineraryLens`, `ScheduleLens`, `DailyOverviewLens`, `FullTripOverviewLens` (M4, shipped) and the substantial `MapRail`. This is also **KI-20**: three of them have no navigation entry at all. A design answer here would close a known issue rather than add scope.
- **Trip lifecycle** — delete → undo toast → `RestoreTrip`, and `duplicateTrip`, including the optimistic-delete interaction.
- **Dev login** — the `AUTH_DEV_LOGIN` credentials provider. Almost certainly should stay undesigned; worth saying so once so it stops reappearing.
- **Empty and error states for the new surfaces** — the DC shows landing, auth and first-run in their happy state only. Sign-in failure, a revoked Google grant, and first-run-with-a-network-error have no design.

---

## 6. Milestone routing

The rule this follows: **the design lands in the milestone that owns the
functionality, before that functionality is built** — so M14 is built to the
Notebook design rather than redesigned after. Nothing here is built ahead of
its gate.

| Design change | Milestone | Why |
|---|---|---|
| Rename to **Caesura** (D1) | M10, Phase 8b † | Two strings and their tests. Shipping the redesign under the old name is the worse outcome |
| Save state: 3-state dot (`SPEC` §2) | M10, Phase 8b † | Presentational change to a shipped component — squarely "visual craft" |
| Sync-failure `Banner` (D7) | M10, Phase 8b † | `Banner` exists; reuses `ConflictBanner`'s vocabulary |
| Calendar month blocks + week trimming (`SPEC` §4, §3.3 above) | M10, Phase 8b † | Trip-plan surface; Task 8.6 already opens `CalendarLens` |
| **Sign out** in the header | M10, Phase 8b † | A capability gap, not polish — you cannot sign out anywhere today |
| Stable identity for `Popover` triggers / `Banner` actions (`SPEC` §5) | **Now** — `docs/guidelines/design-system.md` | Guidance, not a feature. It hard-locks the main thread; the design file hit it for real |
| `TripSummary.startDate` (D6) | **Its own contract step**, before Phase 8's home-hero task | `AGENTS.md`: a contract change is its own reviewed step. Subsumes `TODO.md`'s trip-list-metadata idea |
| Start-only trip dates (`SPEC` §3) | **Own step, after M10's gate** — §4.3 | Behaviour change; reverses Phase 4 and rewrites Task 7.2 step 2 |
| **Landing page** (D2) | **M15 Front door** (new, proposed) | Net-new public surface. Not visual polish, and not M10's gate |
| **Sign-in / sign-up screens** (D2) | M15 Front door | Same surface, same milestone |
| **First-run screen** (D4) | M15 Front door | Un-defers M8's trimmed D1 with a design behind it; it is the post-sign-up moment |
| Account menu / "Your account" (D3) | M15 Front door | Needs an account model to be worth more than Sign out |
| "Look around a real trip" (`peekTrip`) | **M11** | Needs unauthenticated read of a real trip. On the M15 landing: omit or Preview |
| Landing "share with the world / remix" copy | M11 / M12 gate the claim | Copy decision — §4.5 |
| Scope-aware header, Share + Quick add (`SPEC` §1) | **Not M10.** Share → M11; Quick add → the M8 trim's revisit | Reverses a recorded Phase 1 decision — §4.1 |
| Notebook: read/edit split, value chips, day-binding banner, page list + templates (`SPEC` §7) | **M14 Rich layer** | Design recorded now, built then. The presentational subset is real work: `PageScreen` has no mode split and `MacroView` renders inline values as a bare `<span>` |
| Notebook insert picker, scope × shape (`SPEC` §7) | M14 | Needs `macroCatalog()` widened with scope; the "needs a field" badge maps onto `preview-registry.ts` |
| **Repeaters** — a loop macro with an author-supplied row template | **M14, and it needs an ADR** | The one genuinely new engineering decision this sync creates — see §7 |
| Account-scope macros (Your name / Your email) | M14, and M15 for anything beyond the session | NextAuth's session has name and email; there is no account model past that |
| Notebook as a **trip journal** ("written during and after") | M14 scope note | A product framing shift away from M7's "plain notes" — worth stating in the milestone, not discovering mid-build |
| `DRIFT` §3 undesigned surfaces (History, extra lenses/KI-20, trip lifecycle, dev login) | Standing design backlog — §5 | Design owes coverage; no build milestone |
| `japan-trip-seed.json` | Reference only | Do not fork a second seed vocabulary past ADR-020 — §4.8 |

† **Phase 8b does not exist until you approve it.** `docs/milestones/README.md`
is explicit that a gate definition changes only by your decision, and `AGENTS.md`
lists "scope creep past the current milestone's gate definition" as a drift
signal to call out rather than absorb. This is that call-out. The five Phase 8b
items are small, presentational, and inside M10's stated theme; the plan file is
written and staged at `docs/plans/M10-delta/phase-8b-design-sync.md`, marked
**not approved**, and Phase 9's gate does not move until you say so.

---

## 7. The one real engineering decision this sync creates

**Repeaters.** "A line for every day/stop/city": one author-written sentence that
repeats per item, with chips filled from each item.

`packages/pages` cannot express this. Every macro today is `NoParams`
(`macros/inline.ts:20,26,36,42`, `macros/block.ts:27,38,47`) and resolves to a
fixed value or a fixed block. A repeater needs (a) a macro whose result is a
*list*, and (b) a param schema carrying an author-supplied row template — a
template inside a template, authored in TipTap, stored in a macro's params, and
re-resolved on every render.

That is an ADR, not a task: it decides how far the macro registry becomes a
language. It belongs to **M14**, whose scope line already says "the macro
vocabulary deferred out of M8 returns here". Flagging it now so M14 opens with
the decision instead of meeting it halfway through.

---

## 8. Decisions — answered 2026-08-23

Mitchell's calls, recorded here and applied across the docs in the follow-up
commit.

| # | Question | Decision |
|---|---|---|
| §4.1 | Scope-aware header (`SPEC` §1) or the code's context-free one? | **Adopt `SPEC` §1**, as an explicit revisit of the merged Phase 1 — not folded into a polish task. Planned at `docs/plans/M10-delta/phase-1b-header-scope.md` |
| §4.2 | Is the one-field first-run screen intentionally different from the four-step wizard? | **Still open** — carried into M15's milestone file as its first open question, since M15 owns first-run and M10 Phase 7 owns the wizard |
| §4.3 | Start-only trip dates? | **Adopted.** The end is always start + day count. Landed as **Task 8b.6**, not a post-gate step: `endDate` is stored nowhere and already derived, so removing the input is UI-only — no contract, command or domain change |
| §4.5 | Landing copy selling M11/M12? | **Still open** — carried into M15's milestone file. It is a copy call that only matters when the landing page is built |
| §6 † | Phase 8b into M10's gate? | **Approved.** All five. Runs after Phase 8, before Phase 9's gate |
| §6 | M15 Front door? | **Approved**, executing **right after M10's gate and before M9** — ADR-021 records the reorder, on ADR-018's precedent |

**What the approvals do to M10's gate.** Phase 8b (six tasks), Phase 1b, and
Task 8b.6's removal of the end-date input are all gate-scope amendments and
are recorded as such in `docs/milestones/M10-visual-craft.md`, per that file's
own rule that a gate definition changes only by an explicit decision from
Mitchell, recorded in the file. Phase 9's exit checklist now also covers Phase 8b
and Phase 1b.

**One interaction worth naming.** Phase 8b Task 8b.2 lands the account menu as a
small client island so `AppHeader` can stay a server component; Phase 1b then
makes the header trip-aware anyway. That ordering is still right — sign out is a
capability gap that should not wait on a structural change — but 1b should
absorb the island rather than leave two client boundaries in one bar. 1b says so.

## 9. What this branch changes

Docs only. No code, no contracts, no test changes.

**First commit — the review and the routing:**

- This review.
- `docs/milestones/README.md` — a design-sync routing section, the M15 entry, and scope notes on M11 and M14 so the Notebook design is owned before it is built.
- `TODO.md` — M15 on the roadmap, and the unrouted items in Candidate ideas.
- `docs/STATUS.md` — the design source of truth is now in-repo; the `~/Downloads` pointer is dead.
- `docs/plans/2026-08-14-M10-redesign-delta.md` — same pointer fix, in the Source-of-truth block a phase implementer actually reads, plus an explicit "this newer generation is not in this plan's scope; do not widen a phase to absorb it".
- `docs/plans/2026-08-14-M10-redesign-delta-KICKOFF.md` — its finding 3 ("the design handoff bundle is not on disk") marked RESOLVED. It had found this independently; the original text is left as written.
- `docs/guidelines/design-system.md` — two conventions from `SPEC` §5: stable element identity for element-valued props (`Popover.trigger`, `Banner.actions`), and "helper text has no `Hint` component and does not need one".
- `docs/plans/M10-delta/phase-8b-design-sync.md` — staged, marked **not approved**.

**Second commit — the decisions:**

- §4.3 rewritten against `git log --follow`, correcting the premise it was first argued under.
- §8 above, replacing the open questions with the answers.
- `docs/plans/M10-delta/phase-8b-design-sync.md` — **approved**; the banner flipped and its place in the phase order stated. Later gained **Task 8b.6** (start picked, end derived) when that decision came back.
- `docs/plans/M10-delta/phase-7-forms.md` — Task 7.2's step 2 loses its "Leave" input, same decision.
- `docs/plans/M10-delta/phase-1b-header-scope.md` — new: the Phase 1 revisit that adopts `SPEC` §1.
- `docs/milestones/M10-visual-craft.md` — both gate-scope amendments recorded.
- `docs/architecture/ADR-021-front-door-milestone-ahead-of-m9.md` — the M15 reorder.
- `docs/milestones/M15-front-door.md` — the milestone, its scope, its exit gate, and the two open questions carried from §4.2 and §4.5.
- `docs/milestones/README.md`, `TODO.md`, `docs/STATUS.md` — all four decisions reflected.

**Coordination.** `claude/next-work-z7pr1d` is one commit ahead of `main`
(`d7a274b`, M10 Wave 2 Phase 5 — inline overlap warnings). That commit touches
fourteen files, all under `apps/web/src`, and **no documentation**. Nothing here
collides with it.

Phase 8b and Phase 1b do touch files Phase 5 opened — `TimelineLens.tsx` is not
among them, but `TripBoardScreen.tsx` is (Phase 1b, if the header actions are
portalled from the trip screen). Whoever picks up 8b or 1b should rebase on
Phase 5 once it merges rather than starting in parallel; `AGENTS.md`'s
PR-promptness rule and the Phase 3 landing gap are the reason to say so here.

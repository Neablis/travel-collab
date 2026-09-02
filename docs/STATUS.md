# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues/`.

**This file is live instruction only, and it is kept short on purpose.** It hit
1,779 lines on 2026-08-28, ~88% of it history, in the one file every session is
told to read first — so a first-read file became a file people skim. The rule
now: **at gate close, a phase's narrative moves to its milestone file or a retro
in the same commit, and this file keeps the pointer.** Everything that was here
before 2026-08-28 is in `docs/retros/2026-08-28-status-archive.md`, verbatim and
in order, with an index mapping each part to its durable home. Nothing was
deleted.

**Local dev recipe:** `AGENTS.md` points here for it; it is not restated here,
because two copies drift. `docs/guidelines/cloud-agent-sessions.md` is the one
to read in a container (native Postgres on :5433, Playwright's browsers, what is
different from a laptop), and `docs/guidelines/building-the-parts.md` is the
general setup.

## Where the work is right now

**Four PRs are open as drafts, 2026-09-02, in two independent stacks.** None is
merged; all four need marking ready, a CodeRabbit trigger, and — for the two
noted below — a browser walk.

| PR | Branch | Base | What |
|---|---|---|---|
| **#109** | `claude/ai-one-door-retire-dead-surfaces` | `main` | ADR-033; `/ai`'s `board` and `combined` surfaces retired (no callers) |
| **#110** | `claude/ai-one-door-page` | #109 | page authoring moves onto `/ask`; `/ai` deleted; `/ask` charges the step quota |
| **#111** | `claude/m17-contracts-preferences` | `main` | M17 PR1 — the `UserPreferences` contract |
| **#112** | `claude/m17-account-preferences` | #111 | M17 PR2 — migration `0015`, settings Sheet, `kmLabel` |

**Two things a fresh session must not miss:**

1. **#112 carries migration `0015` and merging does not apply it** —
   `gh workflow run migrate-production.yml -f confirm=migrate` from `main`.
   That is M17's gate box 4.
2. **#110 and #112 have had no e2e run and no browser walk.** Both are Tier 2.
   #110 rewrote the Notebook compose client from `await fetch → res.json()`
   onto a stream, and `m7-solo-delight.spec.ts` only asserts two strings are
   *visible* — it would pass over a compose that silently produced nothing.

**`github-advanced-security` is red on every PR and it is not ours.** GitHub's
agentic code scanning dies at `session.create` with *"Model `claude-opus-4.6` is
not available"*, before reading any diff. Five failures across #104 (twice, and
it merged anyway), #109, #111 and #113. Stand-down comments are on #109 and
#111; no fix exists to port, because it is not a workflow in
`.github/workflows/` — it is configured outside the repo.

**It fired on #113, which changes nothing but `docs/**`.** That is the part
worth knowing before branch protection goes on: the check does **not** honour
`ci.yml`'s `paths-ignore`, because it is not `ci.yml`. So a prose-only PR — the
tier `AGENTS.md` says to run nothing for — still collects a red check. **Do not
make it a required check** until it recovers, or nothing in the repo will be
mergeable, documentation included. That is now the second item on the
pre-branch-protection list, alongside `ci.yml`'s `paths-ignore` conversion.

**It is only the AGENTIC check that is broken — CodeQL is fine.** On #110,
`CodeQL` completed, `Analyze (actions)` succeeded and
`Analyze (javascript-typescript)` ran, all while `github-advanced-security`
failed. So the caution above is narrower than "no security check can be
required": CodeQL is a safe required check today; `github-advanced-security`
is not, for as long as it dies at `session.create`.

*(Superseded, kept as the record: "Signup and onboarding feedback is on
`claude/signup-onboarding-feedback-lx1qvx` (pull request 104), 2026-09-01."
That merged as `63c7fdb`, and #106 merged after it, but this section was never
updated — so the file every session is told to read first spent a day naming a
merged PR as the live work. The four durable facts that PR established are
still below; only its in-flight status was wrong.)*

Four things a fresh session should know, because they changed a rule rather
than a string:

1. **`savedDayFacts.budgetPerPerson` is `totalCost`.** It was never per person
   — it adds up a day's priced stops and divides by nothing — so the name
   asserted a semantic the computation did not have, and the Discover card
   rendered "$27.00 each" for a total. This is the second half of M19's own
   gate box (*"either divides by a real person count or no longer claims to"*);
   **no gate box was ticked** and the cost model is still entirely M19's.
2. **Discover's `Everyone` is a superset**, including your own unpublished
   days. That silently broke the public profile, which had been getting
   "published only" for free from the old scope meaning — an author saw three
   days where everybody else saw two. The rule is stated on the query
   (`publishedOnly`) now instead of implied.
3. **`displayNameFor` never returns a raw identifier.** `dev-alice` renders as
   "Alice", an opaque `sub` or UUID as `Traveler <6 chars>`. The id still
   travels in every link; only what the link SAYS changed.
4. **One day selection, for every tab that can scroll** — scrolling a day
   container moves it, selecting scrolls every container to it, switching
   lenses jumps. Each container therefore both drives and is driven, which is a
   jitter loop without the per-container jump lock in `FocusProvider`. Sync
   scrolls are **instant, not smooth**, deliberately: smooth's duration is
   browser-defined, so the lock would be a guess that lengthens with the trip.

**Two things were asked for and deliberately not built that way. Both are
Mitchell's to overrule and neither is a gap.** The first-run wizard does **not**
open itself — a self-opening modal covers the page-head "New trip" button and
whether it fired at all would depend on whether the account has a trip yet,
which across the e2e suite is a function of which spec ran first; the empty
state was rebuilt instead (`components/home/FirstTripStart.tsx`). And the
**calendar drives nothing** in the day-selection contract: it scrolls and its
cells select days, but neither axis is the trip-day axis, so a reading line has
no honest answer there. It still follows.

**Two open questions are with Mitchell**, both on Vercel toolbar threads: the
Discover budget bands moved to $200/$500/$1,000 and **three of the four now
have no occupant** (every seeded day is under $200), and whether "Add stop"
should join the header controls hidden on a phone.

**PR #104 carried migration `0014`** (`saved_days.deleted_at`, for the soft
delete). It is merged, and merging does not apply a migration — so unless it was
dispatched by hand, `0014` is outstanding against production. Check before
dispatching `0015` (PR #112), which is the next one in line:
`gh workflow run migrate-production.yml -f confirm=migrate` from `main`. See
`environments-and-deploys.md`.

Verified at `617b3fe` (PR #104, before merge): `pnpm check` (typecheck across 8 packages, lint plus all
four walls, 2,100+ unit, 440 integration), `pnpm seed:verify`, and
`pnpm --filter web test:e2e:ci-like` at **78 passed**. Two red runs along the
way were both identified from their recorded entries rather than guessed:
**KI-83** (the AI hourly quota, exhausted by repeated local suite runs) and
**KI-20260830** (the colour wall reading a `#104` PR reference as a hex
literal).

---

**M11a's and M11b's gates both closed 2026-08-31, and M17 is the current
work** — M11a nine of nine, its three admission paths walked on **production**
(KI-50 blocks the OAuth round trip on a preview); M11b eleven of eleven, with
the two-actor publish → discover → add walk and the `cities` backfill run
against production. Retros and gate evidence are in
`docs/milestones/M11a-invite-gate.md` and
`docs/milestones/M11b-playbooks-public-library.md`.

**Order from here: `M17 → M9 → M12 → M13 → M14 → M19`** — **reordered
2026-09-01 by Mitchell**, moving M9 from last to second. M9 turned out to be
four-sevenths built and both of ADR-022's grounds for placing it last (polish
first, sharing first) have since happened. The reorder note is in
`docs/milestones/README.md`; the working is in
`docs/reviews/2026-09-01-milestone-audit.md`.

**M12, M13 and M14 were scoped the same day** and now have files and exit
gates — `M12-reviews-and-moderation.md`, `M13-collaboration.md`,
`M14-rich-layer.md`. They had none before, against the README's rule that each
milestone gets one before work begins. **Every milestone in the order now has a
written gate except M19**, which is deliberately placed-but-not-scoped.

**Two prerequisites are ADRs, and both are due before their milestone opens**,
not during it: **M13's realtime transport ADR** and **M14's repeaters ADR**.
Neither is a deliverable to write mid-build.

**All twelve open AI known issues are assigned to M9** (2026-09-01) — three
promoted to gate boxes (KI-12, KI-93, KI-94 with KI-97), nine carried. The
split rule, and why it is not all twelve: a gate box is something whose absence
means the milestone is not done. See `M9-ai-planning-partner.md`.

**M19 — a cost knows who and what it is for** was minted and placed last on
2026-08-31 and is the newest milestone: `docs/milestones/M19-cost-model.md`.
It is **placed but not scoped** — the exit gate is deliberately unwritten until
link 1's design question is answered.

> **This section was two gates stale from 2026-08-31 to 2026-09-01**, still
> describing M11a and M11b as open PRs in review. The cause was structural:
> the gate-close checklist in `docs/milestones/README.md` had four steps and
> **this file was not one of them**, so nothing made it anyone's job. It is now
> step 5. If you are reading this file first — as `CLAUDE.md` tells you to —
> and it disagrees with `TODO.md` or the milestone README, that is the failure
> recurring; trust the milestone README's **Current milestone** line and say so.

### The three-PR stack that closed them, 2026-08-30 (historical)

Kept because the composition evidence below is still the record of how #98 and
this stack were proven to merge cleanly. All four PRs have since merged and
both gates have closed.

| PR | What | Base | State |
|---|---|---|---|
| #99 | **M11a** — the invite gate | `main` | `pnpm check` + **two `test:e2e:ci-like` runs**, all exit 0. 3/3 review threads resolved |
| #100 | **M11b PR1** — `cities`, visibility, the adds ledger, migration `0012` | #99 | `pnpm check` exit 0. 2/2 threads resolved |
| #101 | **M11b PR2** — publishing, `GET /cities`, the ledger write path, migration `0013` | #100 | `pnpm check` exit 0, 402 integration tests. 5/5 threads resolved |
| #102 | **M11b PR3** — Discover, shared day, board, profile; the four shells deleted | #101 | `pnpm check` exit 0, **two `test:e2e:ci-like` runs at 66 passed**. 10/10 threads resolved |

**PR #98 (the 2026-08-30 design pass) and this stack compose cleanly — tested
on 2026-08-31, not assumed.** #98 targets `main`, is not a draft, and touches
eight files this stack also touches, including `AuthScreen.tsx` and four e2e
specs whose sign-in M11a rewrote. It also disables the dev-login submit button
until hydration (`disabled={!hydrated}`), which is exactly the kind of change
that survives a clean textual merge and then breaks a Playwright click. So the
two were merged in a scratch worktree and run: **zero conflicts, `pnpm check`
exit 0 (1908 unit, 426 integration), and `test:e2e:ci-like` 70 passed.**
Whichever merges second inherits no known integration work. Re-check if either
side moves.

**All four are open, stacked, green, and carry no open review threads.** They are
drafts by Mitchell's choice; CI is skipped on drafts by design
(`ci.yml`), so `static-and-unit` and `integration-e2e` showing "skipped" is
the cost control working, not a failure.

**Each branch contains its base** — the bases were merged forward deliberately.
Do not skip that when adding to the stack: PR2's implementer read
`playwright.config.ts` from a checkout cut before M11a's Unit C landed and
correctly reported `INVITE_SUPER_CODE` missing, which was true of that
checkout and false of M11a's branch.

**Five things were Mitchell's before any of this could close** — **all
discharged; both gates closed 2026-08-31** (marked 2026-09-01). Kept as the
record of what a gate of this shape costs a human, not as open asks. The first
two blocked the M11a gate outright:

1. **`INVITE_SUPER_CODE` in Vercel Preview *and* Production**, a CSPRNG value.
   Absent means closed — an unset variable refuses every new account — and
   Vercel injects env at build, so **rotation needs a redeploy**.
2. **KI-50.** The gate's three "walked in a browser" boxes need a real Google
   round trip, which no CI lane can drive from an unregistered preview host.
   Either register that branch's callback URI or set `AUTH_REDIRECT_PROXY_URL`
   on Preview once, for every future branch.
3. **Three migrations dispatched after merge** — `0011`, `0012`, `0013` — plus
   `pnpm --filter web db:backfill-cities`. Merging applies none of them.
4. **The colour wall now rejects any PR reference from #100 up** in a comment;
   see the known-issue entry for three ranked fixes. Not fixed unilaterally,
   because a wall that blocks you is a finding to report.
5. **Two `/signup` copy strings await design sign-off**
   (`ADMISSION_FIELD_COPY`), and the handoff's own `sub` line — *"Your account
   takes about four seconds to make"* — is now false with the gate in place.

**A second decision, smaller: sibling chip counts ignore the budget band.**
`siblingCities()` counts the whole SQL matched set while the band is applied in
application code afterwards, so `Osaka · 9` can sit above two cards. Recorded
rather than fixed because all three defensible answers contradict a decision
already written into that function —
`docs/known-issues/open/KI-20260831-sibling-chip-counts-ignore-the-budget-band.md`.

**One gate box could not be satisfied as written — RESOLVED 2026-08-31.**
Mitchell retagged the five leftover shells rather than narrowing the box:
`rack-provenance` → **M13**, `cost-estimate-state` and `budget-breakdown` →
**M19** (minted for them the same day), and the two wizard shells → `unplaced`,
deliberately. `preview-registry.ts` now carries no M11 tag and M11b closed
eleven of eleven. The original finding, kept as the argument: M11b's
*"no M11-tagged entry remains"* in `preview-registry.ts` was written believing
the four Playbooks shells were the only ones. There are **nine**. The other
five (`rack-provenance`, `cost-estimate-state`, `budget-breakdown`,
`wizard-destination-chips`, `wizard-longer-chip`) are each blocked on a
contract field nobody has built, so M11b was never going to wire them and
there is no milestone to retag them to. Narrowing the box to *"no M11-tagged
**Playbooks** entry remains"* is a gate-definition change, which is Mitchell's
alone.

**Review found nineteen issues across the four PRs, and fourteen were the same
defect: a test that passes while proving nothing.** Five were real product bugs
— among them a `truncated` flag that under-reported, so a Discover query
matching 25-199 days showed 24 cards as the complete result with no way to
reach the rest; a filter change that raised the "someone else changed this"
banner; and a dialog taller than the viewport that hid its own top, leaving the
first row unreachable **by mouse, keyboard and Playwright alike** — latent for
every dialog in the app, surfaced only because a leaking e2e spec had grown the
saved-days library past one screen.

**Every one of the nineteen was green locally.** `pnpm check` cannot catch this
class by construction, which is the argument for triggering CodeRabbit at all.
*(**Superseded 2026-09-01 — KI-2026-09-01.** The stated cause was wrong: the
draft rule is real but is not why it skipped — this repo is below CodeRabbit's
**10-star OSS gate**, so auto-review is off on **ready** PRs too, and the
status it posts is **green either way**. **Mitchell's decision the same day:
CodeRabbit is no longer an automated step at all.** The agent gets CI green and
hands off; Mitchell triggers the review before merging, nobody pushes for ~21
minutes, findings are addressed, then he merges. The process is in `AGENTS.md`;
never read the CodeRabbit status as evidence.)* It was also confidently wrong
twice, both times about runtime behaviour it researched rather than ran
(Vitest's `it.each` on a mixed array; `__dirname` under ESM), and both times the
tell was identical: **the suite was green, which the claimed failure could not
be.** Verify before applying.

**Two of the four PRs also found defects this session's own work introduced**, all the same
species — a test that passes while proving nothing — and none visible to a
local run, because all three were green: a smoke spec that filled an invite
code then signed in as a *returning* user, so the code was dead; two saved-day
tests asserting on the in-memory object rather than the stored row; and a
property test witnessing that it ran rather than that it reached its named
path. All three now proven load-bearing by mutation probe. **CodeRabbit found
all three**, which is the argument for triggering it rather than waiting.
*(Same correction as above — **KI-2026-09-01**: the cause is the 10-star gate,
not the draft rule, and a skipped review still reports `success`.)*

**M11a also broke `pnpm db:reseed` and it was fixed in the same PR.**
`db:reset` derives its table list from the schema, so it truncates `users`;
the seed then signs in for real and the gate refuses a brand-new account. It
stayed invisible because with `users` intact the seed succeeds with no code at
all — the returning-user path again.


**M18b's gate closed 2026-08-30**, and the order *at that moment* was
`M17 → M11a → M11b → M12 → M13 → M14 → M9` — **M11b was scoped and placed
2026-08-30** off the new design handoff, and **M11a was created the same day and
placed in front of it**. See the next two paragraphs. *(Twice superseded since:
M11a and M11b jumped M17 on 2026-08-30 and both closed on 2026-08-31, and M9
moved to second on 2026-09-01. The live order is at the top of this file.)*

**M18b shipped tag focus in PR #91** — SPEC §11's behaviour behind the chips M18
made settable. Clicking a tag chip focuses that tag across all four lenses;
off-tag stops dim to 32% and are never hidden; the Calendar counts `N of M
match` per city card instead and dims a no-match card to 0.28; a line beside the
view tabs names the focus and clears it. **The narrative, the evidence and the
retro are in `docs/milestones/M18b-tag-focus.md`** — that is their durable home
and this is the pointer. Three things a future session is most likely to need:

- **The gate closed in two halves, and it will keep doing so.** Six boxes were
  proven on `test:e2e:ci-like` and then left unticked until Mitchell walked the
  preview, because the checklist's trigger is a *deployed* demo. An unattended
  session cannot produce one — see `VERCEL_AUTOMATION_BYPASS_SECRET` below, and
  read the two routes tried before assuming a share link will do. **Same shape
  as M16's close.**
- **The suite passed on every version of this milestone, including the two that
  shipped defects.** Second consecutive gate where that was true. The browser
  walk caught an accessibility defect no unit test could (a hover hint reused as
  the Clear control's accessible name — 34 controls, one name, on the Japan
  fixture), and CodeRabbit caught a real regression both missed: a tag focus
  re-centring the map, next to a comment asserting it never would. **A rationale
  comment is not evidence.**
- **Two test traps, both of which cost time here.** `fitBoundsMock` in
  `MapLens.test.tsx` is file-scoped and never reset, so it enters a test
  carrying nine earlier calls — clear first, then assert
  `toHaveBeenCalledTimes`. And a 150ms CSS transition makes a single style read
  a race (0.77, then 0.45, then 0.37 for the same assertion): poll for the
  settled value rather than deleting the transition.

**Mitchell placed M18b and M17 on 2026-08-29**, out of the three
approved-but-unplaced milestones, to run as one overnight batch together with
the activity-field descriptor refactor (project review §6.1). M17 needed a
re-scope to be placeable and got one in the same decision: its `users` table
and identity-decision scope are **removed**, because M11 link 1 shipped both
under ADR-025, leaving the preferences half (name, home airport, account-scope
distance units through one `kmLabel`, home-time-on-hover, `who` → display
name). It needs one migration — `users` carries no preference columns today.
**M11b Playbooks was the last unplaced milestone, and it was scoped and placed
2026-08-30** — see immediately below.

**A new design handoff merged 2026-08-30 (`a43a9a4`), and M11b is now scoped and
placed because of it.** The substantive addition is `SPEC.md` §15 / `DRIFT.md`
§2b — **Playbooks becomes a public library**: four routes, three of them new
(`day`, `board`, `profile`), server-side city search, publishing, an adds
ledger, reviews and derived public profiles. That was exactly the product
decision M11b had been waiting on. Scope, eight links and the exit gate are in
`docs/milestones/M11b-playbooks-public-library.md`. Four things a session
picking it up will need:

- **The scope line is not §15's line.** §15 spans M11b and M12. Mitchell's call
  on 2026-08-30: **M11b takes everything except reviews; M12 keeps reviews,
  ratings and moderation.** Two deltas follow from that and are recorded rather
  than left to be rediscovered — Discover ships **two sorts, not four**, and
  **no rating floor filter**, because both need data that does not exist until
  M12. Do not "fix" them back to the spec text.
- **Deferring moderation rests on a gate that is not built.** Mitchell:
  *"we will gate on who we invite to platform... we need a community before its
  a issue."* Sound — but **there was no gate on who signs up**: any Google
  account that reaches `/signin` gets one, and the landing page's "Early access"
  line is copy about *trip* invites, not signup. **That is now M11a**, scoped
  the same day and placed in front of M11b — see below.
- **The largest blocker is `cities: string[]`, not the routes.** Checked against
  the tree: `SavedDay` has none of the six things §2b says a build needs. And
  `saved_days.stops` is `jsonb` on purpose (ADR-029 — a saved day is a value,
  never queried into), so `cities` has to be its own derived column, not a query
  into the blob.
- **`DRIFT.md` is stale in four places** — it was read from the build on
  2026-08-26 and only §2b was refreshed. D1 (Caesura rename) is closed
  (`siteMetadata.ts:17`), D2/D8 (landing page) shipped as `(front)/welcome` in
  M15, and KI-47, KI-43, KI-44 and KI-45 are all resolved. §2b's own claim that
  the missing `cities[]` is *"bigger than the missing tags"* rests on KI-47
  still being open; it is not. Feed this back to design rather than editing
  their bundle — the folder is rewritten in place on their side.

**M11a — an invite gate — was scoped 2026-08-30 and placed between M17 and
M11b.** It exists because M11b's scope split defers moderation to M12 on the
grounds that the population is invited, and that gate did not exist. Mitchell
asked for it as placed work rather than an immediate build: *"Dont build it yet,
roll it as work to do before the playbook work from the designs."* Scope and
exit gate: `docs/milestones/M11a-invite-gate.md`. Three things about it:

- **Most of it is already built, which is why it is small.** `users`
  (M11 link 1, ADR-025) already records who has been here, so *"never been to
  the app"* is *"has no `users` row"* — no new concept. And the `signIn`
  callback already exists and is already fail-closed: `server/auth.ts` composes
  it from `server/users.ts`'s `recordSignIn`, which returns a boolean, and
  `false` lands on the designed `/signin?error=` screen with its existing copy
  map. **Do not go looking for this in `lib/authConfig.ts`** — it is composed in
  `server/auth.ts` on purpose, so the Edge instance the proxy builds never
  touches the database (ADR-024).
- **Three ways through, all Mitchell's calls on 2026-08-30.** A pending M11
  trip-invite token admits you with no code (otherwise M11's invite→accept flow
  breaks for exactly the new collaborators it exists to serve); a **reusable
  super code**; and **single-use codes** in a new `invite_codes` table. He asked
  for both code kinds, not one.
- **The one real engineering problem is that OAuth leaves the site.** A code
  cannot be collected inside the callback — the browser has already been to
  Google and back — so it rides a short-lived httpOnly cookie set before the
  redirect. `proxy.ts` fills the same cookie for `/invite/<token>`, storing
  without validating, because it runs in the Edge runtime with no database.

Two gates closed on 2026-08-29, M18 first and M16 second. M18's live warnings
are immediately below because they still bite; M16's close follows them.

M18 gave a stop two real fields and then made the app act on them: `act.badge`
(Booked / Holding / Idea / Travel, and nothing for `planned`), tag chips, a kind
picker and a tag picker in the stop editor, the home hero's "not booked" tile,
`N to book` on the Calendar, and the Calendar's city grouping. **The narrative,
the evidence and the retro are in `docs/milestones/M18-stop-kind.md`** — that is
their durable home and this is the pointer. Four things a future session is most
likely to need:

- **SPEC §12's travel-day transit split was built and removed the same day.**
  It fired on one of seven travel days and got that one wrong, because every
  stop on a travel day carries the DESTINATION city (KI-59) and five travel days
  open with the train. Mitchell: *"I don't think the shape of the fixture should
  drive functionality, that's how we get drift."* The Calendar now groups by
  city alone — equal cards, no strips, plus an untitled bucket for stops with no
  city — and the day-to-day transition is the day label's job, from yesterday's
  and today's **last** placed activity. Do not rebuild the split from SPEC §12
  without reading the milestone file first.
- **`cityFor` now reads a day's LAST city-bearing stop, not its first.** It
  drives day accents, the day chips and the hero sparkline.
- **A hand-enumerated field list dropped the editor's pickers on the floor.**
  `ActivityEditorSheet.handleSave` builds commands by listing fields, so the new
  ones went nowhere and TypeScript could not see it. Third occurrence this
  milestone — §6.1's activity-field descriptor refactor has earned its place,
  and `TripBoardScreen`'s two dead command builders sit in its path.
- **KI-76 is fixed (2026-08-29).** `pnpm check` used to exit 0 having run
  **zero** integration tests wherever `pg_isready` was absent — this laptop,
  with Postgres in Docker on :5433. The guard is now a real `pg` connect against
  `DATABASE_URL` (`apps/web/scripts/db-probe.mjs`), and it tells "no database"
  (skip, still green) from "the probe could not run" (fail loudly).
- **KI-66's CSP finding, from a cloud session the same day** — the CSP blocking
  Vercel's feedback script on every preview page **was a real defect and is
  fixed**, not a behaviour to tolerate: that script is the Vercel Toolbar, and
  the Toolbar is the Flags Explorer. A preview console should be clean now. The
  one preview-only behaviour that remains: a Deployment Protection re-challenge
  of an in-flight XHR reaches the app as a bare "Failed to fetch".

**Tag focus was carved out as M18b, and shipped 2026-08-30** — SPEC §11's
cross-lens dimming, the behaviour behind the chips M18 made settable. See the
top of this file.

**M16 shipped and closed, and the way it happened is the thing to know.** The
implementation landed overnight in **PR #88** (`5a362d3`) — a streaming,
multi-turn, tool-using agent on `POST /ask`, the rail docked per SPEC §9, an
intent classifier that cut step-1 input 73%, per-ask analytics, and **M9's write
tools behind propose → review → approve**, which is M9 scope shipped early on
Mitchell's request. That PR **deliberately flipped no status flag** because
everything in it ran simulated — correct under the gate-close checklist — and
the gate then closed on Mitchell's live confirmation on 2026-08-29.

**Ten of eleven boxes ticked; the eleventh moved rather than being waived.**
*"Recorded transcripts replay in CI without a live call"* is **M9's box now**,
by Mitchell's explicit decision: it was PR #88's Task 7 (the eval set and replay
harness), dropped rather than half-landed, and M9's gate already carried the
identical criterion. **KI-11 stays open and is now M9's to close.**

Two things `M16-assistant-read-agent.md` records rather than smooths over, both
worth reading before trusting the assistant's numbers:

- **The gate's evidence is one log line plus a human pass.** Vercel holds
  exactly **one** real-model `ai.ask` record across seven days, and it is a
  trip-scoped opener, not one of the four acceptance assertions — those were
  confirmed locally, where records go to the console and never reach Vercel.
  That is KI-11's shape one layer up, and the box that just moved to M9 is
  the fix.
- **Open question 1 is deliberately still open.** That one record shows
  `uncalledTools: ["read_day","find_free_time"]`. Deleting a tool on n=1 would
  be the same fixture-shaped reasoning Mitchell rejected at M18's gate. Both
  tools stay until `/ai-usage` has a real spread.

**Done:** M0-M8, the Phase 1 gate review, M10 (2026-08-27), M15 (2026-08-26),
M11 (2026-08-28), M18 and M16 (both 2026-08-29), M18b (2026-08-30).

**Nothing is approved-but-unplaced any more.** M11b Playbooks was the last one
and was scoped and placed 2026-08-30 off the new design handoff; M18b and M17
were placed 2026-08-29.

**`/demo` is the real board, read-only, 2026-08-28 (PR #79) — ADR-031, closes
KI-61.** The demo trip is the Japan fixture folded in memory and served through
the ordinary trip endpoints, rendered by the ordinary `TripBoardScreen`. One
seam does it: `requireTripAccess` answers the demo before `auth()`, as a viewer.
**It needs no database**, which makes it the cheapest way to walk a real trip in
a fresh worktree — M18's gate used it to catch the transit split.

## Blocking / broken right now

**1. The Map lens's tiles have still never been confirmed to paint — KI-49.**
From a cloud session the egress proxy blocks the tile host outright, so the
map's chrome can be walked and its tiles cannot. From a laptop the transport
verifies (M11's gate loaded the style, tilejson, sprites and glyphs from
`tiles.openfreemap.org` on the preview, and WebGL is real) and the **pixels
still do not**: the WebGL canvas captures blank in the screenshot pipeline, and
MapLibre fetches its data tiles from a worker the main thread cannot observe.
So neither environment has produced a picture of a rendered map. Nothing on the
roadmap is blocked by it; it bounds what a browser walk is allowed to claim,
from anywhere. A blank canvas is not a pass.

**Retired from this list at M11's gate, 2026-08-28** — all three were on it and
none of them is live any more:

- **Migrations 0006-0010 are dispatched to production.** The gate's blocker, and
  the preview walk signed in and wrote as two users against the migrated schema,
  which is exactly the `recordSignIn` upsert into `users` this entry warned
  would throw. The standing rule is unchanged: merging does not apply a
  migration — dispatch it (`gh workflow run migrate-production.yml -f
  confirm=migrate`, from `main`) and say so in the PR body.
- **`/s/featured`'s dead end is gone — KI-61.** PR #79 replaced it with `/demo`;
  see the `/demo` paragraph above. Walked on the preview: 14 days, 68 stops,
  read-only, 2 conflicts rather than the pre-KI-60 twelve.
- **The CSP's last unwalked environment, the Vercel preview, is walked —
  KI-66.** The entry's "never executed by a browser" half was already closed
  earlier the same day by a local production-build walk; the preview was the
  named remainder, and M11's gate covered it — as did a cloud session on
  2026-08-29, independently, finding the same violation. One preview-only
  behaviour is still worth knowing before it is mistaken for a defect: a
  Deployment Protection re-challenge of an in-flight XHR reaches the app as a
  bare "Failed to fetch". The other one M11's gate recorded — the CSP blocking
  Vercel's feedback script on every preview page — was **not** "no app impact",
  and is fixed rather than documented; see the next section.

**A preview deployment is walkable from a cloud session, and the CSP defect that
found is fixed.** `pnpm --filter web walk:preview <url> [path ...]` —
`docs/guidelines/cloud-agent-sessions.md` carries the diagnosis, and that file's
old "the preview is NOT reachable from here" paragraph is gone; it was wrong and
it cost several runs. Three obstacles stacked: Deployment Protection, Chromium
not trusting the egress CA, and a TLS 1.3 ClientHello the `*.vercel.app` tunnel
cannot carry.

What the walk found is the point: **the CSP refused the Vercel Toolbar's loader
on every preview page**, which breaks the Flags Explorer — the documented way to
flip `ai-live` for one reviewer's session. M11's gate saw the same refusal and
filed it as harmless preview noise; it was not. The policy now admits the
Toolbar's origins on preview only, gated on `VERCEL_ENV`, with a test asserting
production's policy is untouched.

**One thing is still Mitchell's to do, and nothing unattended can test a preview
until it is done:** generate **Protection Bypass for Automation** (Vercel → the
project → Settings → Deployment Protection) and copy the value into a
`VERCEL_AUTOMATION_BYPASS_SECRET` repo secret.

**The `_vercel_share` fallback was tested on 2026-08-30 and is not a substitute
— tried while looking for M18b's gate evidence.** A freshly minted link gets
*past* Deployment Protection and is then stopped by `429 Vercel Security
Checkpoint` at the redeem step, twice, five minutes apart, before any app
response. That is Vercel's anti-bot interstitial challenging the client —
headless Chromium on a datacenter IP — not rate limiting and not the protection
layer. It suits a person in a browser; it does not reliably suit the automated
walk. The bypass secret is honoured before the checkpoint renders, which is why
it is the only dependable route. `docs/guidelines/cloud-agent-sessions.md`
carries the detail. Treat the secret like `FLAGS_SECRET`:
it unlocks every protected deployment this project has.

**Not blocking:** KI-15 stays downgraded — the silent-corruption half (an
unbiased top match overwriting correct model coordinates; rate-limit failures
swallowed into coordinate-less locations) is fixed. The remaining architectural
half, the model guessing a coordinate rather than citing one, is M9 scope.

## Next action

**The current work is M17 — account preferences**
(`docs/milestones/M17-account-customization.md`), since both M11a's and M11b's
gates closed on 2026-08-31.

Two things to read before opening it, both from the 2026-09-01 audit
(`docs/reviews/2026-09-01-milestone-audit.md`):

- **M17 is smaller than its file's "Why this exists" section claimed.** That
  section asserted the schema had no user row; `users` has existed since
  ADR-025 and already carries `name`. What is missing is **preference columns**
  on it. The claim is corrected in place; the milestone is retitled **Account
  preferences**, since the "real user record" half shipped in M11.
- **M9 follows it, as of the 2026-09-01 reorder** — not M12. M9 is now the
  smallest remaining milestone and the one that unblocks `ai-live`, so the
  handoff out of M17 is into grounding, not into reviews.

*(Superseded, kept as the record: "M17 was jumped on 2026-08-30 and the current
work is M11a — an invite gate, then M11b, then M17." Mitchell's call that day,
asked for as "finishing out the rest of M11". The reorder note is in
`docs/milestones/README.md`.)*

**Jumping M17 is free for M11a and not free for M11b**, and the difference is
worth knowing before either is opened. M11a's file already said M17 was
sequencing rather than a dependency, and it is — nothing in the gate reads a
preference. M11b's prerequisite was real: its author strip and its public
profile both display a person's name, and M17's preferences half is what
resolves `who` to a display name. Both now build against today's identifier
**behind one resolver seam**, so M17 later fills it in one function instead of
two routes. That amendment is recorded against the prerequisite in M11b's own
file.

**All three carry a migration, and a migration is dispatched, not merged** —
`gh workflow run migrate-production.yml -f confirm=migrate` from `main`, said so
in the PR body. M11a's is `invite_codes`; M11b's carries `cities`, visibility
and the adds ledger. This is the thing most likely to be missed, because merging
no longer applies a migration and the PR body is the only place anyone looks.

Per `docs/milestones/README.md` the next milestone's plan re-checks the
gate-close checklist, and **M11b's close (2026-08-31) is the one to re-check**
— not M18b's, which this line named until 2026-09-02 and which two gate closes
have since superseded.

**Still unscheduled and now unattached: the activity-field descriptor
refactor** (project review §6.1). It was scheduled 2026-08-29 "alongside" M11a
and M11b; both closed 2026-08-31 and it did not happen, so it belongs to no
milestone and nothing surfaces it. It is not blocked — Two facts it needs: its stated prerequisite is **already met** —
§1.6 / KI-54 is resolved and `equality.ts:55-56` compares `city` and
`countryCode` — and `AGENTS.md` reserves the contracts step as **its own
reviewed PR**, which Mitchell scheduled it knowing. Keep it a separate PR from
the two milestones.

**Three things from M18's gate that will bite the next session if unread:**

- **KI-76 is fixed, but `test:int` is still exclusive.** `pnpm check` now runs
  the integration suite instead of silently skipping it. The suites also stopped
  truncating whole shared tables, so `test:int` no longer destroys local dev
  data, and `db:reset` clears all ten tables derived from the schema rather than
  a stale list of three. What is **not** fixed is concurrency: two agents
  running `test:int` at once still corrupt each other — KI-89, caught doing
  exactly that on 2026-08-29.
- **Walk the thing in a browser before believing the suite.** M18's headline
  Calendar rule passed nine unit tests and was wrong, because the tests shared
  the implementation's assumption about the fixture. `/demo` needs no database
  and renders the real Japan trip, so this is cheap. **Four gates running, the
  walk has found what no test could** — M18b's was an accessibility defect
  (34 controls sharing one accessible name) that every unit test passed through.
- **Adding a field means grepping for every place fields are enumerated by
  hand.** Not just the contract. M18 hit this three times; the sheet's version
  silently discarded a user's input with a green suite and a clean typecheck.

~~**Approved and unplaced: M11b Playbooks only**~~ — **empty as of 2026-08-30**,
when the design handoff supplied M11b's scope and Mitchell placed it after M17.
`docs/milestones/M11b-playbooks-public-library.md`.

**Deliberately deferred, each recorded where it belongs rather than dropped:**

1. ~~**The activity-field descriptor refactor**~~ — **scheduled 2026-08-29**,
   see "Next action" above. Still its own reviewed PR.
2. **The test-suite overhaul's Phases 5-7.** Their resume condition — M10's
   Wave-2 gate closing — fired on 2026-08-27 and nothing resumed. Now surfaced
   in `TODO.md` under "Deferred work with a resume condition that has already
   fired", because the only thing recording it was a paragraph in this file
   marked "history". Re-run the Phase 0 inventory first; the current one
   predates Wave 2 Phases 5-8.
3. **The 19 Dependabot alerts** — per-advisory triage against actual usage, not
   a bulk bump.
4. **M17's re-scope** — see above.

## Landed in the last week

Compressed on 2026-08-28. Each line names the durable record; the long-form
narrative is in `docs/retros/2026-08-28-status-archive.md`.

- **A binding operating contract for dispatched subagents, 2026-08-28.**
  `.claude/protocol/` — lifecycle, three exit states, a two-strike handback
  rule, a run-scoped board and a mechanically checked report shape, enforced by
  four fail-open hooks. `ADAPTER.md` and `adapter.json` hold every
  travel-collab-specific fact and a test enforces that the other three files
  name nothing about this repo. Start a run with `/dispatch`. Design:
  `docs/specs/2026-08-28-subagent-operating-contract-design.md`. Known defects
  consciously left: KI-62, KI-63.
- **A travel day is no longer a false conflict, 2026-08-28 — KI-60.** The Japan
  demo went from 12 conflicts to 2 with no fixture change: `detectConflicts`
  compared every same-day located pair against a flat 150km and never read
  `kind`, so all ten `impossible-geography` warnings sat on the two days the
  trip relocates, each with the day's own shinkansen scheduled *between* the two
  stops. The rule now excuses a distance a transit stop crosses **in time**, on
  time order rather than stored order, and never excuses an untimed stop. Full
  reasoning, including the weaker rule that was rejected with evidence:
  `docs/known-issues/` KI-60.
- **One canonical Japan fixture, 2026-08-28 — ADR-030 (PR #74).**
  `@tc/fixtures` owns the 14-day/68-stop trip; the seed script, the preview
  branch's demo reset and `@tc/factories` all call the same commands, and
  `src/lib/japanTripImporter.ts` is deleted. The two copies that existed were
  identical by luck, and where they differed was live on preview: the reset
  produced a trip with **zero tags** the day before M18's tag chips shipped, and
  coordinates were 72/72 local against 51/72 preview with six wrong venues.
  `pnpm seed:verify` is the thing that keeps it true. Procedure for new
  features: `docs/guidelines/fixtures-and-seed-data.md`. Filed rather than
  fixed: KI-57, KI-58, KI-59.
- **M18's contract PR, 2026-08-27 (PR #63).** See "Where the work is right now".
  The trap worth remembering: `equality.ts`, `diff.ts`, `hydrate.ts` and
  `detail.ts` each hand-enumerate activity fields, so adding a contract field
  without touching all four compiles cleanly and is wrong at runtime — and
  because `decide.ts` gates `UpdateActivity` on `okUnlessNoOp`, a kind-only
  update was rejected as a no-op until equality learned the field. The shared
  property generator needed both fields too, or the diff property test would
  have kept passing while never generating either. The project review found the
  same class again in `Location.city`/`countryCode` (KI-54, since resolved), and
  §6.1's descriptor refactor is the standing fix.
- **M10's Wave-2 gate closed 2026-08-27, and M15's closed 2026-08-26 (PR #56).**
  Evidence, retros and the rules promoted out of the deleted phase plans:
  `docs/milestones/M10-visual-craft.md`, `docs/milestones/M15-front-door.md`.
- **Two full reviews, 2026-08-28.** `docs/reviews/2026-08-28-project-review.md`
  (seven dimensions, six parallel agents) and
  `docs/reviews/2026-08-28-m11-pr71-review.md`. Both are being worked through on
  the current branch; read the remediation plan for what is in scope and what
  was deferred with a reason.

## Where the history went

| What | Where it is now |
|---|---|
| Everything this file said before 2026-08-28, verbatim and in order | `docs/retros/2026-08-28-status-archive.md` |
| M10 Wave 2, per phase — what each shipped, what it deliberately did not, the landing gaps that cost time | that archive, plus `docs/milestones/M10-visual-craft.md`'s scope, exit gate and Wave-2 retro |
| M15's gate and its two resolved open questions | `docs/milestones/M15-front-door.md` |
| Every roadmap reorder and its reasoning | `docs/milestones/README.md`'s reorder notes, and ADR-018 / ADR-021 / ADR-022 |
| The 2026-08-23 design sync, its routing, and the 2026-08-26 UI audit | `docs/design-feedback/` |
| The feature-flag / AI-kill-switch insert (PR #24) | ADR-019 and `docs/specs/2026-08-19-feature-flags-and-ai-kill-switch-design.md` |
| The test-suite overhaul, Phases 0-4 | `docs/plans/2026-08-23-test-suite-overhaul.md`, `docs/testing-baseline.md`, `docs/testing-inventory.md` |
| Which known issues are open, and which were closed when | `docs/known-issues/` — authoritative, and the only place that list should be kept |

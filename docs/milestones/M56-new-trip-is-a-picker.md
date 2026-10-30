# M56 — New trip is a picker, and the assistant never strands you

**Status (2026-10-30): closed, gate 17 of 17.** Minted and placed **ahead of M43** the same day
by Mitchell: *"I want it to be the next work we do, so go ahead and get the plan ready to be the
next milestone then start work"* (see `docs/milestones/README.md`, *2026-10-30 — minted and placed:
M56*). The design is `docs/specs/2026-10-29-new-trip-picker-and-trip-builder-design.md`; **D1
changed it**: there is no pre-trip builder and no `new-trip` assistant surface. The mechanisms are
**ADR-084**. Six planned parts, ten more from Mitchell's two preview walks (parts 7 to 16), and
part 0 (PR 637), which merges last. Every code part is merged in `3ac8c02`; none has a migration.
The plan was deleted at the close; it is in git history (`docs/plans/README.md`).

### Parts

| Part | Theme | PR | Merge |
|---|---|---|---|
| 1 | Picker widget, one icon per tag | PR 638 | 3798270 |
| 2 | New trip as five pages and Review | PR 642 | 635f3f5 |
| 3 | World results in `/api/places` (signed in, `world=1`) | PR 639 | 3c00bb4 |
| 4 | Pace and tags on the trip (`SetTripStyle`, not batchable) | PR 640 | 7819fbb |
| 5 | `ask_user`, `show_options`, `hand_off`, capability block | PR 641 | b204842 |
| 6 | Plan with AI, Home's hand-off, carried-ask chips | PR 643 | c36383f |
| 7 | Tag tiles are equal squares in a grid | PR 650 | 4462c3d |
| 8 | Choose keeps its size beside a long name | PR 648 | ec3cc42 |
| 9 | At most four option cards; one card asks yes or no | PR 652 | 7f45e28 |
| 10 | A trip from New trip lands on its Plan | PR 651 | 906189c |
| 11 | Title a place by its name; keep its address for the model | PR 649, PR 653 | 969e04b, 754b4e0 |
| 12 | Wizard choices split or stack, tags fit a small phone | PR 654 | 06197b0 |
| 13 | Discover's shell the moment Playbooks is tapped | PR 656 | b376da7 |
| 14 | The phone bar's Ask on first paint, from the route | PR 655 | ba6c9df |
| 15 | `ask_user` options capped at 4 | PR 657 | 3720793 |
| 16 | Ask tests after PR 655 and PR 656 both merged | PR 658 | 3ac8c02 |

## Why this exists

Mitchell typed *"I am not sure, can you help me plan a real foodie adventure? Somewhere i havent
been before, 2 weeks long"* into New trip, and Cass answered *"I am not sure, can you help me plan
… 2 weeks long, good"*. The sheet looks like a chat and is a fixed form (SPEC §30.2): typed text
on Where becomes the trip's name, typed text on every other turn is stored and never read, and
pace and *about* reach nothing. Asked the same thing, Home's assistant refuses in prose and offers
nothing to press.

His asks: pick from a boxed control the whole way through, get the trip, and on a paid plan keep
planning with AI; and *"the worst thing we can do is make the user feel stuck talking to a ai
agent that doesnt have the tools to do the task, but doesnt understand that."*

### What exists (survey of `f328de7`, 2026-10-30)

Paths are under `apps/web/src/` unless they start with `packages/`, `docs/` or `apps/web/`.

| Already here | Where | What M56 does with it |
|---|---|---|
| The scripted New-trip sheet: questions `where, pb, date, start, len, pace, feel`, typed Where committed and echoed | `components/home/newTripScript.ts:34`, `commitAnswer` :344, `acknowledge` :448; `components/home/NewTripWizard.tsx:467` (name), :480 (`dated`), :708 (*"not built in yet"*) | Replaced by five picker pages and Review (part 2) |
| Create path: `createTrip`, then `SetTripDates` / `SetTripBudget` / `SetTripCurrency` | `components/home/newTripSubmit.ts:103` `createTripWithSetup` | Also writes pace and tags (part 4); every entry into a new trip goes through it |
| Activity tags and their tints; the About set already has a type | `lib/activityTags.ts:38` `TAG_CHIP_CLASS`; `ActivityTagDescribed`, `packages/contracts/src/activity.ts:269` | One lucide icon per tag, everywhere a tag shows (part 1, D8) |
| Library place search, public and charged per IP | `app/api/places/route.ts`, `server/places.ts:128` `searchPlaces` | Signed-in callers also get LocationIQ world results (part 3, D3) |
| LocationIQ forward search, session-only, quota-charged | `server/geocoding/locationiq.ts:109`, `app/api/geocode/route.ts:17` | Gains an autocomplete call behind a cache (part 3) |
| Surfaces grant tool domains; `account` may only read | `server/assistant/grants.ts:91-171` (`account` :162) | Each surface gains the `ui` widgets; its instruction gains a generated capability block (part 5) |
| Home's refusal line | `server/ai/handleAskRequest.ts:2268`, in `accountInstructionBlocks` :2264 | Replaced by `hand_off` (part 5) |
| A turn's outcomes: proposal, suggested note, palette offers, one outcome per turn | `AskStreamShape`, `packages/contracts/src/assistant.ts:389`, `OUTCOME_KEYS` :467; `components/assistant/Transcript.tsx:463-480` | Three new outcomes: `ask`, `options`, `handOff` (part 5) |
| Entitlement to AI | `lib/useAiEntitled.ts:87`, `server/assistant/entitlements.ts:32` | Review's buttons split on it, never on a plan name (`planVersions.fourthPlan.test.ts`) |
| Rate limits and an external cache | `QuotaPolicy` / `consumeQuota`, `server/quota.ts:534`; `readThrough`, `server/external/cache.ts:157` | Part 3's per-account limit and cache |
| Carrying intent across a navigation | `lib/pendingPlaybookAdd.ts` (localStorage with a max age) | The pattern for carried asks (part 6) |

**The spec's §1 was wrong in one place**: it said place search knows only the library and the
world is reachable only through the importer and a tool. `/api/places` (public, library) and
`/api/geocode` (session-only, LocationIQ) both exist. ADR-057 is the *notebook* widget search,
not chat widgets; there is no chat-widget catalogue yet.

## Decisions

### Answered (2026-10-30, by Mitchell)

- **D1. Builder before the trip, or create first? → Create first.** *Changed from the
  recommendation.* There is no trip draft the assistant edits, no `new-trip` surface, no
  `update_draft` or `propose_create`. A paid person's **Plan with AI** on Review creates the trip
  and opens the plan page's assistant, which has the full toolset. A trip-level rethink
  (*"actually, two cities"*) is an edit to the real trip.
- **D2. Does the draft persist? → No server draft.** *Changed (follows D1).* The picker's answers
  live in the sheet's own state. Nothing is stored before Create.
- **D3. World place search → yes, as written,** with one detail answered: `/api/places` stays
  public and library-only for anonymous callers; **signed-in callers also get LocationIQ
  autocomplete results**, library cities ranked first and labelled *has Playbooks*, behind a
  per-account rate limit and the external cache. **Amended 2026-10-30 at part 3's review:** world results come
  only when the caller asks (`world=1`), which New trip's Where page does and Discover does not,
  so Discover stays library-only and spends no world quota.
- **D4. Pace and tags on the trip → yes.** A contract change (`docs/contracts/CHANGELOG.md`). The
  plan page's assistant reads them.
- **D5. Carried asks → chips the person presses.** Nothing runs unasked.
- **D6. Day themes in the builder → withdrawn.** There is no builder (D1).
- **D7. Cass → Cass in both.** *Changed from the recommendation.* The picker keeps Cass's voice
  with no AI badge; the assistant keeps its badge.
- **D8. Tag icons → lucide, one per tag, everywhere a tag shows.** Part 1 proposes the twelve and
  Mitchell approves them on its preview.
- **D9. The *start from a published day* question** (today's `pb` turn, which the spec's five
  pages dropped) **→ an optional card on Review**: popular days for the chosen place, each with
  *Start from this*; skipping it changes nothing.

### Answered (2026-10-30, by Mitchell, after the preview walk)

- **Ask in the phone bar → everywhere there is an assistant, the same for every plan.** A free
  person sees Ask too and meets the upgrade gate when they press it (PR 655, PR 658).
- **Importing a trip file → keeps landing on Overview**, because an import arrives with details.
  Only a trip made from New trip lands on its Plan (PR 651).
- **The option cap → 4 everywhere**: `show_options` cards (PR 652) and `ask_user` options (PR 657).
- **KI-20261030-p stays a known issue** (two paths still store a stop's whole address as its
  name); it is not fixed in M56.
- **Same-named places keep the same name for now.**
- **Ask on pages with no assistant → B, leave Ask off them** (2026-10-30). The leaderboard,
  profile, country, `/account` and `/plans` pages have no assistant, so the bar draws no Ask
  there, as it does today.
- **The picker's trade-offs → leave all three as they are** (2026-10-30, the recommendation):
  Choose stays 44px because that is the minimum touch target; the How long page scrolls only at
  375×667; the *Or start from a Playbook…* row wrapping at 375px is cosmetic.
- **The round-2 walk → nothing to change.** Mitchell walked round 2 (PRs 654 to 658) on
  production and reported nothing to change (his word, 2026-10-30). That report is the gate's
  walk evidence. No `phase-verifier` browser walk was run for M56.

### Settled in the plan (not Mitchell's to answer; say so if wrong)

- **Pace and tags are set by the picker, not by a new assistant
  tool.** Adding the command to `BatchableCommand` (`packages/contracts/src/trip.ts:320`)
  generates a planning tool automatically (`server/assistant/tools/planning.ts:4-15`), which costs
  context on every planning step. Part 4 keeps it out; the assistant reads them.
- **How long keeps today's five chips** (`LENGTH_DAYS`, `newTripScript.ts:90`) plus the − / +
  counter.
- **`ai.capability_gap` is a log line, not a table**, written like `ai.grant`
  (`server/ai/admissionPorts.ts:54`), with the model-written `task` through `sanitizeForLog`.
  `ai_usage_tool_calls` does not hold tool inputs, so a table would need a migration for no
  reader the log does not already serve. The `ai-usage` skill learns to read it.

## Scope

1. **The picker widget and the tag icons** (part 1). One boxed control with options, single or
   multi, and a constrained *other* (place, number, date, tags). One lucide icon per activity tag,
   in every tag chip.
2. **New trip rebuilt on it** (part 2). Five pages (Where, Start date, How long, Pace, About), a
   progress bar and *Step N of 5*, Review with *Change* on every answer, and changing Where
   re-walks the later pages prefilled under *Destination changed*. No free text anywhere. Review:
   free plans get **Create trip** and one quiet locked line about AI planning; paid plans get
   **Just create it** and **Plan with AI**. The optional published-day card (D9).
3. **World place search** (part 3, D3).
4. **Pace and tags on the trip** (part 4, D4), written at Create, read by the plan page's
   assistant.
5. **`ask_user`, `show_options`, `hand_off` and a generated capability block** on the existing
   surfaces (part 5). Every *I can't* carries a button; Home's refusal line goes.
6. **Hand-offs into a new trip** (part 6): **Plan with AI** lands on the plan page with the
   assistant open and a kickoff; Home's *"help me plan a trip"* hands off to the picker prefilled;
   what Home was asked that only a trip can do arrives as chips in the new trip's thread (D5).

## Out of scope

- A pre-trip builder, a `TripDraft` the assistant edits, the `new-trip` surface, `update_draft`,
  `propose_create`, the draft strip and day themes (D1, D6).
- A server-side draft (D2).
- Multi-city routes at creation. The picker sets one place; more places are plan-page edits.
- Booking, live prices, visas, payments: `hand_off` says *nowhere* with one sentence.
- Running the live eval. The new cases are written and graded offline; the live run is
  Mitchell's call.

## Exit gate

Ticked at the close (2026-10-30, on part 0, PR 637). CI is the `ci` run on each part's final PR
head (CI on `main` merge commits is not read: only CodeQL runs there); run ids are in PR 637's
tracker. "Seen red" is the part's PR body's red-first table: the source edit and the failure text.

- [x] **Decisions D1–D9 are answered and recorded here**, and ADR-084 is written.
      *Evidence:* *Decisions* above (D1–D9, 2026-10-30, and the two later answers);
      `docs/architecture/ADR-084-the-assistant-asks-shows-and-hands-off.md`.
- [x] **New trip has no free-text input.** A unit test on the flow finds no text input outside the
      place search's own field, and an int or unit test shows Where cannot commit a string that
      did not come from a search result. Seen red.
      *Evidence:* `apps/web/src/components/home/NewTripWizard.test.tsx:220` (*has no text field on
      any page but Where's search*) and `:169` (*commits Where only from a search result*), red in
      PR 642 (`typed words moved Where on`); CI 41016309476 on d9a8659.
- [x] **Every answer reaches the trip.** Creating with a start date, a length, a pace and tags
      produces a trip whose detail holds all four, in an int test through `createTripWithSetup`'s
      commands. Seen red.
      *Evidence:* `apps/web/src/server/newTripSetup.int.test.ts:18`, red in PR 640 without the
      `SetTripStyle` dispatch (`expected null to be 'slow'`); CI 40993254072 on 281e522.
- [x] **Changing Where on Review re-walks the later pages with their answers prefilled**, in a
      component test. Seen red.
      *Evidence:* `NewTripWizard.test.tsx:322` and `newTripScript.test.ts:85`, both red in PR 642
      (`Unable to find an element with the text: /^Step \d of 5$/`); CI 41016309476.
- [x] **Review's buttons split on entitlement, not on a plan name**: free sees *Create trip* and
      the locked line, paid sees *Just create it* and *Plan with AI*. `planVersions.fourthPlan.test.ts`
      still passes.
      *Evidence:* `NewTripWizard.test.tsx:350`, `:361`, `:373` (red in PR 642 with
      `aiEntitled !== true`); `apps/web/src/server/entitlements/planVersions.fourthPlan.test.ts`
      is in the unit job that passed in CI 41016309476 and on every later part's head.
- [x] **One icon per tag**: an exhaustive map typed over the tag union, so a new tag without an
      icon fails typecheck, and the chips render it.
      *Evidence:* `apps/web/src/lib/activityTagIcons.ts:30`
      (`ACTIVITY_TAG_ICON: Record<ActivityTag, LucideIcon>`); `StopTagChips.test.tsx:10`;
      `activityTags.test.ts:35`; PR 638, CI 40992580224 on 5b770d3.
- [x] **World search is signed-in only, limited and cached**: an int test sees an anonymous
      `/api/places` call return library results only, a signed-in one return world results with
      library cities first and labelled, a cache hit spend no quota, and the per-account limit
      refuse. Seen red.
      *Evidence:* `apps/web/src/app/api/places/route.int.test.ts:126`, `:156`, `:178`, `:194`, each
      red in PR 639; CI 40991695545 on 327907f.
- [x] **Pace and tags are on the trip contract** with defaults so old trips still read, and the
      CHANGELOG entry is written. The plan page's assistant reads them (`read_trip` and the
      standing block).
      *Evidence:* `packages/contracts/src/detail.ts:112-113` (`.default(null)`, `.default([])`);
      `docs/contracts/CHANGELOG.md:66`; `read.test.ts` *read_trip says the trip's pace and tags*
      and `ask/route.int.test.ts` *reads the trip's pace and tags*, both red in PR 640; CI
      40993254072.
- [x] **No turn that understood a task ends in prose alone when it cannot do it**: `hand_off` is
      the only decline, it renders a sentence and a button, and it logs `ai.capability_gap`.
      Home's *"changes are made inside a trip"* line is gone.
      *Evidence:* `apps/web/src/app/api/ask/route.int.test.ts:237` (hands off and logs each gap);
      `apps/web/src/server/ai/admissionPorts.ts:78`; `capabilityBlock.test.ts:96` (*replaces Home's
      refusal line*); Transcript's hand-off tests, all red in PR 641; CI 41016110545 on 38ed9ee.
- [x] **The capability block is generated from `SURFACES` and the tool registry**, and a test
      asserts it reaches every surface and that every domain a surface lacks has a hand-off
      target. Seen red.
      *Evidence:* `apps/web/src/server/ai/capabilityBlock.test.ts:31-34` (reaches every surface)
      and `:38` (a target for every change a surface cannot make), red in PR 641; CI 41016110545.
- [x] **An `ask_user` answer comes back as data** (a structured part, not text the model
      re-reads), in an int test on the ask route.
      *Evidence:* `apps/web/src/app/api/ask/route.int.test.ts:261`, red in PR 641 (both halves);
      the cap of four on its options, PR 657 (CI 41089174484 on 766c95f).
- [x] **Eval cases exist for each boundary** (can do, plan-page job, nobody can, off-topic), with
      a grader field for *ended in a widget* and *handed off to*. Graded offline; the live run is
      not run without Mitchell.
      *Evidence:* `apps/web/src/server/ai/eval/cases.ts:115-124` (off-topic), `:163` (nobody
      can), `:315-317` (`endsInWidget`, `handsOffTo` new_trip and plan_page);
      `grade.ts:42-50` (`endedIn`); `grade.test.ts:502`, `:507` (red in PR 641). The live eval was
      not run.
- [x] **Plan with AI lands on the plan page with the assistant open**, and asks carried from Home
      show as chips that run only when pressed.
      *Evidence:* `apps/web/e2e/m56-into-a-new-trip.spec.ts:33` and `:63`; PR 643, ci-like 3
      passed, CI 41016464206 on b204842 (both e2e shards).
- [x] **`createEmptyTripViaWizard` drives the new flow** and every spec that called it is green
      in CI. KI-2026-10-28-e is resolved or re-filed with why.
      *Evidence:* `apps/web/e2e/helpers.ts:535` (picks a place, then *create an empty one*); every
      caller ran green in both e2e shards of CI 41016309476 (PR 642) and every later part's head.
      KI-2026-10-28-e stays open, re-noted with why in `1c59823d`: the hypothesis is now
      unlikely, the click remains, and it waits on its tripwire.
- [x] **The new e2e specs pass on `pnpm --filter web test:e2e:ci-like`** and in CI.
      *Evidence:* ci-like and CI on each spec's PR head: `m56-new-trip.spec.ts` (PR 642, 2
      passed; PR 654, 3 passed; CI 41016309476, 41089734481); `m56-into-a-new-trip.spec.ts`
      (PR 643, 3 passed; CI 41016464206); `m56-shell-first-paint.spec.ts` (PR 655, 3 passed; CI
      41093498742); `m56-playbooks-instant.spec.ts` (PR 656, 5 passed with `--repeat-each 4`; CI
      41091330704). PR 658's final head ran both shards green (CI 41100755426 on a02f936).
- [x] **[walk]** On the previews: New trip end to end on a free and a paid account at 390px and on
      desktop, the tag icons approved by Mitchell, a city with no playbooks found by name, Home's
      *"help me plan a foodie trip somewhere new"* handed off with a button, and Plan with AI
      landing on the plan page.
      *Evidence:* Mitchell's two walks. Round 1 (2026-10-30) produced parts 7 to 11 (PRs 648 to
      653) and the four answers under *after the preview walk*; round 2, on production after PRs
      654 to 658, he reported nothing to change (2026-10-30). His report does not itemise each
      sub-item (free and paid, 390px and desktop); it is taken as covering the box. No
      `phase-verifier` walk was run.
- [x] A retro is appended at gate close. *Evidence:* *Retro*, below.

## Retro — written 2026-10-30 (17 of 17 boxes ticked)

Written on part 0 (PR 637) in the close session, after every code part had merged in `3ac8c02`.
Mitchell answered the last two open decisions and reported his round-2 production walk the same
day (*Decisions*, above).

### What went well

- **Sixteen code parts in a day, none with a migration.** M56 was scoped on 2026-10-30; the six
  planned parts merged 06:46–06:59Z, the five parts from the first walk 07:38Z–15:02Z, and the
  five from the second 17:23Z–19:13Z (PR 637's tracker). Every part's final head had `ci-ok`
  green with both e2e shards (run ids in *Exit gate* and the tracker).
- **Every "seen red" box has the failure on record.** Each part's PR body carries its source edit
  and failure text, and the close read them rather than trusting the boxes: for example PR 642's
  typed-Where test went red with `typed words moved Where on`, and PR 640's int test with
  `expected null to be 'slow'` when `createTripWithSetup` dropped `SetTripStyle`.
- **The walk loop worked twice.** Mitchell's first preview walk became parts 7 to 11 (PRs 648 to
  653) the same morning, and four answers recorded under *after the preview walk*; his second
  became parts 12 to 16 (PRs 654 to 658). After round 2 he reported nothing to change.
- **Part 4 kept a tool out of the model's context.** `SetTripStyle` is a `TripCommand` but not a
  `BatchableCommand`, and a contracts test (red in PR 640 when it was added) holds that line,
  so the planning step pays no context for it (ADR-084 §6).

### What could be better

- **Two parts merged in the wrong order and left `main` red.** PR 655 merged before PR 656, so
  PR 656's loading-frame unit test (*no Ask on a plan without the assistant*) failed on `main`
  at `b376da7` until PR 658 (part 16) fixed it, about two hours later. Each PR was green on its
  own head; neither had been run against the other. The fix that would have prevented it: when
  two ready parts touch the same surface (here the phone bar's Ask), merge one, update the other
  from `main` and wait for its CI before merging it.
- **The orchestrator's share missed its target again**: about 26% in session 3 and 22.8% in
  session 2, against under 15%. The milestone took three hand-offs, and session 3 ran without
  the repo's agent types (they were not registered until the repo was attached mid-session), so
  five `general-purpose` agents did the work at 4.99M units; the one that fixed PR 655 alone
  spent 3.22M and peaked at 274k context, past the 250k builder target.
- **The first build session's spend is lost.** Its transcript went with its container before
  `session-metrics` ran on it, which is the failure `writing-a-retro.md` warns of. Twelve
  `phase-implementer`, eleven `part-reviewer` and one `ki-fixer` agents are not in any figure
  below.
- **One CI wait on PR 658 was runner noise.** Its `test / unit` job was cancelled once at the 10
  minute timeout after every step had passed (the runner never finalised), then passed on one
  re-run (run 41100755426, attempt 2). No known issue matches. It has not been seen again, so
  none is filed; a second occurrence should file one.
- **No `phase-verifier` browser walk was run.** The `[walk]` box rests on Mitchell's report,
  which does not itemise free and paid accounts at 390px and desktop.

### Leftovers

- **Whether LocationIQ's `/v1/search` returns a `name` field** is not verified.
  `server/geocoding/locationiq.ts:113` falls back to the first segment of `display_name` when it
  does not, so a result still has a name either way. Unowned; the next session that touches
  geocoding checks one live response.
- **PR 655's CodeQL review thread** was answered but is not resolved. Mitchell's call (he
  resolves threads).
- **KI-2026-10-30-p** (two paths still store a stop's whole address as its name) stays open, by
  Mitchell's answer. **KI-2026-10-28-e** stays open on its tripwire. KI-2026-10-30-a, -b, -c and
  -m, filed during M56, stay open.
- **The live eval was not run.** The new cases are graded offline; the live run is Mitchell's
  call.
- **Hand tasks for Mitchell:** delete the stray remote branch
  `claude/m56-part5-ask-show-hand-off` (`1449913`); in the old container only, remove the empty
  `/tc-orchestrator` at the filesystem root.

## Spend
<!-- session-metrics:milestone v1 -->

**Not generated here.** Each build session's transcript went with its container, so this close
could not run `pnpm -s session-metrics --milestone`. The figures below are the blocks those
sessions reported in their hand-offs, written in the generated block's shape. No dollar cost was
carried for any session, so the block reports units only (units = input + 1.25 × cache write +
0.1 × cache read; output excluded).

| Session | Block | Agents | Calls | Units |
|---|---|---|---|---|
| Original build session (12 `phase-implementer`, 11 `part-reviewer`, 1 `ki-fixer`) | **none** | – | – | **unknown**: its transcript is gone |
| Session 1 (first hand-off) | carried | 5 | 199 | 2.78M |
| Session 2 | carried | 26 | 959 | 10.60M |
| Session 3 (third hand-off; two transcripts, because the cwd moved) | carried | 15 | 564 | 8.83M |
| Session 4 (this close) | **not yet measured** | – | – | – |
| **Measured total** | | **46** | **1,722** | **22.21M** |

**By agent type, session 2** (shares as carried; units derived from them)

| Who | Share | Units (≈) |
|---|---|---|
| `phase-implementer` | 50.9% | 5.40M |
| `part-reviewer` | 24.9% | 2.64M |
| `orchestrator` (peak 269k) | 22.8% | 2.42M |

**By agent type, session 3**

| Who | Agents | Calls | Peak context | Units | Share |
|---|---|---|---|---|---|
| `general-purpose` | 5 | – | 274k (the PR 655 fixer, 3.22M alone) | 4.99M | 56.5% |
| `orchestrator` | 1 | 124 | – | 2.29M | 25.9% |
| `part-reviewer` | 5 | – | – | 0.93M | 10.5% |
| `phase-implementer` | 3 | – | – | 0.62M | 7.0% |
| **Total** | **15** (the rows as carried account for 14) | **564** | | **8.83M** | |

**Parts:** 17 (part 0 and parts 1 to 16, part 11 as two PRs); every code part merged.

**Lines added: 8,232.** `git diff --shortstat 3798270^1 3ac8c02 -- apps packages` gives 142
files, 8,260 insertions and 3,083 deletions; that range also holds PR 644 (a KI fix, not M56:
28 insertions), so M56's parts add 8,232. PR 647 in the range touches nothing under `apps` or
`packages`, and no `*.generated.json` or `pnpm-lock.yaml` change is in it.

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 22.8% (session 2); 25.9% (session 3) |
| No builder averaging > 250k context | not measurable | no per-builder average carried; session 3's PR 655 fixer peaked at 274k |
| GitHub wakes per merged part < 5 | not measurable | not carried |
| Dollars per 1k lines added < 20 | not measurable | no recorded cost |
| Coordinator-message re-writes <= 2 | not measurable | not carried |

### Spend against the last milestone

M55 is the last closed milestone.

- **Dollars per 1,000 lines added (under 20):** not measurable; no session carried a cost, as in
  M55. In units, the three measured sessions spent 22.21M over 8,232 lines, about 2.70M per 1,000
  lines, against M55's 1.59M. Both leave out a session, so both understate.
- **Orchestrator's share (under 15%):** missed at 22.8% and 25.9%; M55 was 29.9% and 21.2%. The
  cause is in *What could be better*: three hand-offs, and a third session that ran without the
  repo's agent types.
- **A builder's average context (none over 250k):** not measurable, as in M55; one session-3
  agent peaked at 274k.
- **GitHub wakes per merged part (under 5):** not measurable, as in M55.
- **Cache re-writes after a coordinator message (2 or fewer):** not measurable, as in M55.

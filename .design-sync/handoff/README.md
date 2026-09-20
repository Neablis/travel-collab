# Design handoff — the living bundle

This folder is the **only** handoff. Dated snapshot folders are gone: previous states live
in version control, not beside the current one. Re-read this file each time — it is
rewritten in place.

Last substantive pass: **2026-09-19, second half — a feature resync against `main`.** Four
milestones had closed since the design last read the build (M20 ✓, M22 at 18/19, M25 ✓,
M23 ✓) and three of them had no design surface at all: **API tokens**, **downloading a
trip as a file**, and **importing one back**. Designing them exposed two mobile gaps and
one crowded container, both fixed here (§34). Earlier the same day: Playbooks learned to
hold several days, and the Discover header was re-sorted by kind of decision — tabs for
place, chips for questions, sort on the results sentence (§33).

### What changed on 2026-09-19, in build terms — the resync (§34)

| Change | Spec | What a build owes |
|---|---|---|
| API tokens have a designed surface | §34.1 | Mount `TokensSection` in the new Account **route**; time-remaining not created-at; expired ≠ revoked; rotation stated as two acts; `free`/`plus` see it **locked, not hidden** |
| Lifetime is a choice, not a number field | §34.1 | 30 / 90 / 365 chips; the 365 ceiling is stated in copy, not enforced silently |
| Trip-scoped tokens reach the UI | §34.1 · DRIFT **D12** | `TokensSection` posts `tripIds: null` always today. Add **All trips / Chosen trips**; the field and the wrapper check already exist |
| Download a trip | §34.2 | Keep the plain `<a download>` to `/api/v1/trips/{id}/export`; state that history does not travel; no entitlement anywhere on the path |
| Delete and Duplicate leave Trip settings | §34.2 · DRIFT **D13** | The sheet currently holds all three. Lifecycle stays on the trip card's popover (project rule 4); only Download is trip-settings work |
| Import a trip | §34.2 | Home beside New trip, and in the empty state; the refusal is the server's own envelope copy, nothing else on the page changes |
| The phone gets an account screen | §34.3 | Plan, usage, profile, units and tokens on 390px; a task, so the tab bar steps aside. No new endpoint — it calls what the desktop calls |
| The phone gets Plans | §34.3 | Plans was a desktop route, so Change plan / the invite gate / the token gate were dead ends on a phone. Three cards, one column, same confirm step |
| Account settings is a route with tabs | §34.4 · DRIFT **D14** | Replace `AccountSettingsSheet` with `/account` + **Profile · Plan & usage · API tokens**; `PlanSection` and `TokensSection` move unchanged. Plans' back link points at the tab |
| Settings styling rules | §34.5 | 580px measure, filled cards with a moss header strip, a 170px label column, controls sized to their content — and **a list of like things is a table**, not a stack of cards |

**Inviting people is deliberately still trip scope.** It was raised as part of the same
crowding and stays in Trip settings beside the share link (project rule 1). Before that, 2026-09-18: The new-trip transcript was made chat-shaped: two
visibly different sides, the live question inside the thread, and one answer dock at the
foot of the sheet (§31). It builds on 2026-09-15, when new trip became a scripted
conversation and the assistant transcript lost its message bubbles (§30), and 2026-09-14,
which moved the plan chooser into a route with a confirm-and-pay step (§29).

### What changed on 2026-09-19, in build terms (§33)

| Change | Spec | What a build owes |
|---|---|---|
| A Playbook can be several days | §33.1 | `All days · Day 1 · Day 2 …` `TabStrip` on the day view, All by default; everything under the title rescopes; single-day Playbooks show no tabs |
| The day index is a field, not a label | §33.1 | The API must carry `day` per stop — the design parses a `Day N · ` prefix only because the fixture has one |
| "All days" merges, it does not concatenate | §33.1 | Per-day geometry, then union. **No leg across a night.** Map cache key must include the day |
| Tabs are places, filters are questions, sort is a property | §33.2 | Scope becomes underlined page tabs (never an "active filter"); filters are chips + one *More filters* menu; sort moves onto the results sentence and out of the filter count |
| Discover query parameters changed | §33.2 | **Season cut**, **Length added** (buckets over `days`) |
| Plan toolbar | §33.3 | Tag-focus notice moves out of the toolbar, above the content it dims. No API change |

### What changed on 2026-09-18, in build terms — part two (§32)

| Change | Spec | What a build owes |
|---|---|---|
| First run is the conversation, not a name form | §32.1 | Fluid 620px page column; first-run opening line; exits as quiet links; `ntLand()` must put a finished first-run flow into an app, not just close it |
| The phone gets the flow | §32.2 | **New trip** pill on Trips; full-screen conversation (Cancel · Empty header); 44px inputs / 40px chips; tab bar hidden while the flow is open; first run renders in-frame too |
| Dates: one question became two | §32.3 | "Do you have a start date in mind?" → Yes inserts a single day-picker turn; Not yet goes to length chips. No range picker anywhere |
| The question list is derived | §32.3 | `ntQs()` from answers (6 turns, 7 with a date); no hardcoded count in logic **or** copy; revising to *Not yet* drops the picked day |
| Dates are formatted at commit | §32.3 | ISO → the app's date style before it enters transcript/summary/toast |

### What changed on 2026-09-18, in build terms — part one (§31)

| Change | Spec | What a build owes |
|---|---|---|
| New-trip transcript has two visibly different sides | §31.1 | Your turns = right-aligned moss bubbles (notched radius, 13.5px ink); assistant = left prose + 22px brand avatar. The panel and Ask sheet keep §30.5's no-bubble treatment — this divergence is intentional |
| The live question is the last message in the thread | §31.2 | No question heading above the controls; plus one opening assistant line stating the no-generation contract |
| One answer dock at the foot | §31.3 | Full-height column: transcript flexes and is bottom-aligned, dock is fixed at the foot (dates → chips → multi-commit → input+Send). Chips and typing fill the same answer. Dock is absent, not disabled, on the free fork |

**Read §30.2 before estimating M9.** The new-trip flow looks like the assistant but is a
fixed local script on purpose — that is what keeps an abandoned New-trip sheet from being
a series of billed turns. Everything from the 2026-09-12 pass below is unchanged and still
current.

### What changed on 2026-09-15, in build terms

| Change | Spec | What a build owes |
|---|---|---|
| New trip is a five-turn transcript, not a four-step wizard | §30.1 | One transcript + a local question script; chips and the composer both commit; answered turns collapse with a **Change** |
| The five questions cost nothing | §30.2 | Keep them local and deterministic — first model call is the one after the fifth answer; no fake typing delay |
| The end forks on assistant access | §30.3 | With access: live composer, conversation continues in the trip's context. Without: generate once, then a note and a link to plans (§29). Read entitlements, never a plan rank |
| Both exits stay open | §30.4 | **Create empty** always; **Create with this** from the first answer on |
| No bubbles in any transcript | §30.5 | Your turn = ruled quote (2px brand rule, 13px slate); the assistant = full-width 14px ink prose. Themes restyle the rule and inks, not boxes — both inks sit on the panel ground |
| Transcript must follow the conversation | §30.6 | Pin the scroller to the newest turn via `scrollTop` — `scrollIntoView` is banned repo-wide |
| Three undrawn states | §30.6 | Generation failure (the five answers must survive), offline at the fork, ceiling-reached-with-access |

### What changed on 2026-09-14, in build terms

| Change | Spec | What a build owes |
|---|---|---|
| Plan chooser is a route, not an inline region in the account sheet | §29 | A `plans` route with three states (chooser / confirm / result); the sheet loses its expanding chooser |
| Paying has a confirm step before Stripe | §29 | Order lines + proration from **Stripe's preview**, never computed in the UI; the success state needs the webhook, not the redirect |
| Two states the design does not draw | §29 | Return-from-Stripe-before-webhook (pending), and stale plan version at pay time |
| The assistant is hidden on `plans`, not unmounted | §29 | `visibility: hidden; pointer-events: none` — unmounting loses thread, state and dragged position |

### What changed on 2026-09-12, in build terms

| Change | Spec | What a build owes |
|---|---|---|
| Tabs are Overview · Plan · Calendar · Map; Timeline deleted | §24 | Rename the two lenses; swap Calendar/Map scope; `dayScope = columns \|\| map`; keep `focus` across tabs |
| Overview renders the trip's undeletable notebook page | §25 | Seed one locked page per trip; add `w-open` to the widget registry; refuse its delete with a reason |
| No widget control in the document flow | §26 | Move binds/filters/wording/remove into the desktop right column and the phone sheet |
| Trip lifecycle designed | §27 | Wire `RestoreTrip` / `duplicateTrip` to an optimistic delete + undo toast |
| Read-only is one mode, two entrances | §27 | One `readOnly` presentation for the demo and invited readers; gate `propose` and the Keep handlers |
| New mark, Ledger default, phone landing | §28 | Replace ◎ with ‖; `look` defaults to ledger; build the pinned phone front door |

Previous pass: 2026-09-05 (the assistant reaches the phone; the phone tab bar is
scoped; the notebook widget framework
and its three components; Save this day as a Playbook; the phone Notebook)

**Building notebook widgets? Read these four, in this order:**
0. **`SPEC.md` §26 — where the controls live.** Read this first: it supersedes the chrome row
   in §18 and the bind-sheet placement in §19. No widget control belongs in the document flow.
1. `specs/notebook-widget-framework.md` — the three shape components, the four states, the
   ghost rule. **This is the file to reference when implementing any widget.**
2. `SPEC.md` §18–§19 — the model underneath it (a widget is a function of declared inputs,
   bound per instance; the phone).
3. `design/Notebook Widget Framework.dc.html` — open it in a browser: every shape in every
   state, with the rules printed beside them.

**Commit this folder into the repo at `.design-sync/handoff/`**, replacing the previous
bundle. It supersedes the 2026-08-30 bundle.

**This pass closes the book on the current design direction.** Exploratory work on a
different planning model has started in the design project (`Wireframes.dc.html` — five
competing models, nothing decided). None of it is in this bundle and none of it is a
build instruction. Everything here describes the design as it stands and is safe to build.

What is new since the last bundle:

- **The assistant reaches the phone.** `SPEC.md` §23 (extending §9), `DRIFT.md` §2i. An
  `Ask` pill, last in the top row of all four in-trip screens, opening a bottom sheet over
  what you are looking at. **Deliberately not a tab:** a tab is a destination and would have
  to default to a trip-wide scope, losing the day or the Notebook page you were reading. The
  sheet states its scope in its first line and derives its placeholder and quick asks from
  it. Proposals reuse the **desktop ghost path** — no phone-only proposal type. One hole this
  opens: the pill has **no entitlement-gated state** for a Free user (`DRIFT.md` §8).
- **The phone tab bar is scoped to where you are, and no tab is ever disabled.**
  `SPEC.md` §22, `DRIFT.md` §2h. Inside a trip the bar is Plan · Map · Notebook; everywhere
  else it is Trips · Playbooks. Plan and Map had no meaning on "Your trips", on Discover or on
  a shared day, and a greyed-out tab would have been UI with no purpose on the page. **The
  tab list is derived from the route, not a constant array** — that is the part a build has to
  change. The phone Notebook index gained the `‹ Trips` back link it now depends on, and the
  active tab is a `--color-brand-tint` pill behind the glyph rather than a colour swap alone.
- **The notebook widget framework — three reusable components, not just prose.**
  `specs/notebook-widget-framework.md` (`SPEC.md` §21), the gallery at
  `design/Notebook Widget Framework.dc.html`, and the components themselves:
  `NotebookInline`, `NotebookBlock`, `NotebookRepeat`. All inline widgets, all blocks and
  all repeats now behave identically because one component draws each class. Includes the
  **ghost**: a dropped-in widget renders as the shape of its value (`$XXX`, `NN rows`, its
  real sentence) and fills in per part as inputs bind. One rule needs a build decision —
  ghosts are editing-only.
- **`specs/save-a-day-as-a-playbook.md` — a flow that was built and never written down.**
  `SPEC.md` §20 points at it. Entry point, dialog, save action, the exact animation
  (elements, durations, easings, spark offsets), where a kept day surfaces afterwards, what
  a build owes, and five open questions. A build asking "how does a day become a Playbook"
  had no answer before this; §15 only described the library it lands in.
- **The phone Notebook is the whole widget model.** `SPEC.md` §19, `DRIFT.md` §2f. It was one
  repeater hardwired to the focused day; it is now index → page, with per-widget binds and the
  full insert registry. **It adds no API surface** — the same resolvers §18 already asks for —
  so Notebook should be costed as one number across both surfaces, not desktop-now /
  phone-later. The one divergence is density: rebinding is a 44px "Pointed at …" button opening
  a bind sheet, because the desktop's inline chrome row does not fit 390px.
- **Notebook pages no longer have a scope.** `SPEC.md` §18, `DRIFT.md` §2e. Each **widget**
  owns its inputs — a day, a stretch of days, a person, a tag set, a trip — bound when you
  insert it and rebindable in place, so two widgets on one page can read two different days.
  This is the one item in this bundle that makes the build's job **smaller**: it retires
  `PageContext.dayRef` as a page property (with `handleBindDay` / `focusDayBinding`), the
  page-header day dropdown, the "this page follows" Banner, and scope as a facet in the insert
  picker. It also **restates the oldest Notebook blocker**: settle what a seeded template
  *instantiates*, not whether macro authoring returns. §18 supersedes the page-scope half of
  §7; the struck text there is kept on purpose, because the code it names still exists.
- **Billing has four designed surfaces** — pricing on the landing page, an operator console
  (route `admin`), the collaboration gate in Trip settings, and plan + usage in the account
  sheet. `SPEC.md` §17 is the whole design; `DRIFT.md` §2c is what it needs. **Read both
  before estimating M20 or M21.** Three things to take from them before anything else:
  **the two prices are placeholders** and the design has not chosen them; **the nested
  ladder is presentation only**, and no screen may read a display order as authority; and
  **publishing / migrating plan versions is deliberately not in the UI** (Mitchell,
  2026-09-02), which narrows M20 link 7 — its tier panel is read-only.
- **The shared day has a map, and Playbooks is a fifth phone tab.** `SPEC.md` §16,
  `DRIFT.md` §2d. The previous bundle predated both. §16's three map constraints are each a
  bug that was hit and fixed in the design file; §13's four-tab list is superseded.
- **The design file in `design/` is refreshed** to the current prototype — the previous copy
  predated the Notebook widget model, the day-view map, the phone Playbooks tab and all of
  the billing work.
- Still carried and unchanged: Playbooks as a public library (§15), the landing page (§14),
  Calendar as a city view (§12), mobile as a `surface` of this same file (§13), and
  `DS-UPSTREAM.md` for what is owed to the DS package.

The six binding **project rules** from the previous bundle are unchanged and still govern
what may exist on a page — read `RULES.md` first.

## Contents

| Path | What it is |
|---|---|
| `RULES.md` | The six project rules. Read this first — they decide what may exist on a page |
| `design/Trip Planner Redesign.dc.html` | The living desktop design reference — every screen, all copy, all interaction behaviour. **New this pass: the `/account` route with three tabs, the API-token surface, trip download and import, and the phone's account and Plans screens** |
| _(mobile has no separate file)_ | The phone is a **surface inside the desktop design file**, reached by its `surface` prop. SPEC §10 scopes it, §13 states its foundations, **§19 is the phone Notebook** |
| `SPEC.md` | Written spec for what the design file cannot say out loud. **§30 (new-trip conversation, transcript type) is this pass**; §29 (plans route); §21 (widget framework), §20 (Save as Playbook), §19 (phone Notebook), §18 (Notebook widgets — supersedes §7's page scope), §17 (billing) and §16 (day map, phone Playbooks) are this pass**; §15 Playbooks, §14 landing, §12 Calendar, §11 rules |
| `DRIFT.md` | Design ↔ build reconciliation — §1 open drift (**D10 is billing**, D9 Playbooks scope), §2 landing, §2b Playbooks, **§2c billing, §2d day map + phone Playbooks, §2e Notebook widgets, §2f phone Notebook**, §4 what's real in code and undesigned, §5 closed, §6 build checks, §7 their KIs |
| **`specs/notebook-widget-framework.md`** | **The notebook widget framework** — three shape components, four states per shape, the ghost. `SPEC.md` §21 summarises it; this file is the contract |
| `design/NotebookInline.dc.html` | Component — an inline widget: a segment list of your text, its values, and ghosts |
| `design/NotebookBlock.dc.html` | Component — a block widget: declared columns, rows, caption, total, one note line per state |
| `design/NotebookRepeat.dc.html` | Component — a repeat widget: one authored sentence per item; its rows **are** `NotebookInline` mounts |
| `design/Notebook Widget Framework.dc.html` | The framework gallery — every shape × every state, live, with its rules |
| `specs/save-a-day-as-a-playbook.md` | The Save-a-day-as-a-Playbook flow: entry point, dialog, save action, the exact animation, five open questions |
| `data/japan-trip-seed.json` | Structure export of the Japan trip, for seed data |
| `DS-UPSTREAM.md` | Bugs and gaps owed to the **design-system** package, not to this product. Route these to the DS repo |

<!-- ROUTE-ARTBOARD-INDEX:START -->

### Route → artboard → spec

**Generated — do not edit by hand.** Run `node scripts/route-artboard-index.mjs --write`;
`pnpm test` fails when a gate below has been renamed out of the design file, when a line
number has drifted, or when the app grows a route nobody has decided an artboard for.

The design file is one document, not a folder of artboards: a screen is the
`<sc-if value="{{ … }}">` block named below, reached by driving `startScreen` and the nav.
Open the line, then read the `SPEC.md` sections beside it — **in that order**, and diff both
against the milestone link that owns the screen before writing code
(`docs/guidelines/building-from-the-design.md`).

| Route | Where it is drawn | Spec | Notes |
|---|---|---|---|
| `/` | `isHome` · line 1442 | §28, §32 | Trips, the new-trip fork and the import entry |
| `/trips/[tripId]` | `isTrip` · line 1740 | §24, §25 | The four tabs; Overview is a notebook page |
| `/trips/[tripId]/pages` | `isNotebook` · line 3577 | §7, §18, §19 | Notebook index |
| `/trips/[tripId]/pages/[pageId]` | `isDoc` · line 3672 | §18, §21, §26 | One page, and the widget framework |
| `/playbooks` | `isPlaybooks` · line 2436 | §15, §33 | Discover — §33 re-sorts the header by kind of decision |
| `/playbooks/day/[savedDayId]` | `isDay` · line 2677 | §15, §16, §33 | The shared day; §16 gives it a map, §33 gives it day scope |
| `/playbooks/board` | `isBoard` · line 3477 | §15 | Leaderboard |
| `/playbooks/profile/[userId]` | `isProfile` · line 3511 | §15 | Public profile |
| `/plans` | `isPlansRoute` · line 3184 | §29, §34 | §34.3 adds the phone treatment |
| `/account` | `isAccountRoute` · line 2928 | §12, §34 | Three tabs in `?tab=`; was a Sheet until M26 link 1 |
| `/admin` | `isAdminRoute` · line 3316 | §17 | Operator console. The artboard also draws M21's strip — read M20 link 7's split note |
| `/welcome` | `isDeskLanding` · line 4608 | §14, §17 | The landing page; `isPhoneLanding` is its phone artboard. §17.1 is the pricing block |
| `/signin` | `isSignin` · line 5021 | §14, §28 | Inside the `isAuth` block |
| `/signup` | `isSignup` · line 5018 | §14, §28 | Inside the `isAuth` block |
| `/demo` | `isTrip` · line 1740 | §27 | No artboard of its own — the trip surface in `readOnly` (§27) |
| `/s/[token]` | `isTrip` · line 1740 | §27 | No artboard of its own — the trip surface in `readOnly` (§27) |
| `/invite/[token]` | _not drawn_ | §17 | Undrawn. The gate it leads to is §17.3, in Trip settings |

<!-- ROUTE-ARTBOARD-INDEX:END -->

## How to read the design file

It is a **design reference written in HTML**, not production code. Do not copy its markup.
The four notebook components in `design/` are the exception: they are the framework itself, and their **props and state names are the contract** — read their logic comments. Everything else in the folder uses a small template runtime — `<sc-for>`, `<sc-if>`, `{{ value }}` holes, and
`<x-import component-from-global-scope="TravelCollabUI.X">`. Read it as intent: layout,
spacing, tokens, copy, component choice, interaction behaviour. `TravelCollabUI.*` mounts
map 1:1 to the real design-system package components.

**To open it:** the design file expects the design-system bundle at
`_ds/travel-collab-ui-baseline-c5b66415-77a7-4370-aec7-2bcbd6dd88ec/` relative to itself
(the repo's own `ds-bundle/` is the same library). `support.js`, `ios-frame.jsx` and the
seed JSON in `design/` are its other siblings and are included here.

**Tweak props worth driving while reading it** (they are how the undrawn states are
reviewed): `surface` (desktop / phone), `plan` + `billingStatus` (the token gate, the
invite gate, lapsed copy), `dataState` (live / loading / empty / failed) and — new this
pass — `importOutcome` (lands / refused), which renders the import refusal.

One caveat added this pass: the design file loads the **precompiled** `_ds_bundle.css` with
no Tailwind JIT, so a few values are inline styles that would be utility classes in the
app. Treat an inline `max-height`/`opacity` as intent, not as a styling instruction.

## Resolving a "the design references X but never gives its copy" dead end

1. Search the design files for the nearest label or `aria-label` (desktop first).
2. Check `SPEC.md` § Component mapping — most "unnamed element" cases are a design-system
   component used in a specific way, not a missing component.
3. Check `RULES.md` — if the element you are looking for is trip-scoped chrome in the top
   bar, a duplicated value, or a drawer on a non-droppable page, it was **removed on
   purpose** and there is no copy to find.
4. Only if all three fail, ask. Do not invent product copy.

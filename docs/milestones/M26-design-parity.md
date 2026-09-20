# M26 — The build looks like the design again

**Status: IN PROGRESS. Scoped 2026-09-19, PLACED AND STARTED 2026-09-19 by
Mitchell ("start the big design milestone we just created"), which is the
decision this file was waiting on.** It runs **ahead of M13**, on the argument
already written under *Prerequisites* below: M13 adds a second actor to surfaces
this milestone is about to rebuild, and rebuilding them twice is the cost of the
other order. M13 is unblocked by this and stays next. The number M26 was
assigned on 2026-09-19; it had no row, no file and no number before that day.

**Link 0 (the preflight) is done** — see the first box of the Wave 1 gate. Wave 1
link 1 is the next work.

**Read this file in halves.** *Wave 1* is the desktop and shared surfaces. *Wave 2*
is **the phone as a surface** — the milestone `docs/guidelines/design-system.md`
has been promising since M5 (*"below 1024px, layout is best-effort **until the
mobile milestone**"*) and that has never been minted. They are one milestone
because they are one question asked at two widths, and they have two exit gates
because no one sitting can walk both.

**This milestone opens with a preflight** (link 0) and the preflight is not
optional: `KI-2026-09-14-c` measured that building **one** screen from this
handoff cost four review rounds and three wrong builds, and named the five
missing aids. This milestone builds ~20 screens from the same handoff. Paying
that cost twenty times is the predictable outcome of skipping a day's work.

---

## Why this exists

**No milestone has owned "the build looks like the design" since M10's Wave-2
gate closed on 2026-08-27.** That gate was honest about what it closed: a delta
against *the handoff generation available at the time*. The design has moved
**fourteen commits** since (`git log --since=2026-08-27 -- .design-sync/handoff/`),
and **seven of those landed between 2026-09-12 and 2026-09-19** — while the build
was executing M20, M21, M22, M25 and M23 — milestones whose scope was
entitlements, Stripe, a REST API, a file format and a row shape. **Three of the
four that closed had no design surface at all** until the design went and drew
them on 2026-09-19: API tokens, downloading a trip as a file, and importing one
back. That is the design side's own account (`DRIFT.md` §0b,
`handoff/README.md`).

So the two sides did not diverge because anyone was careless. They diverged
because for three weeks nobody's job was to make them agree, and the design kept
working.

**What that adds up to, measured rather than asserted.** Five read-only surveys
against the handoff and the working tree, 2026-09-19:

| Surface | State |
|---|---|
| Playbooks Discover header | Scope is a `SegmentedControl` below the search; the design has underlined **tabs above** it. Filters are three `NativeSelect`s; the design has chips and one *More filters* menu. **There is no results sentence at all**, so sort has nowhere to move to |
| The multi-day day view | M23 shipped `dayIndex` and `dayCount` on 2026-09-19 and **no surface uses them for scope**: no `All days · Day 1 · Day 2` tabs, bare `Day N` dividers, no continuous stop numbering, and the CTA never says *Add all N days* |
| The shared day | **Has no map.** §16 designed one on 2026-09-01 and it has never had an owner (`TODO.md:1015-1029`) |
| Account settings | One `Sheet`. The design made it a **route with three tabs** (§34.4), and the build filed the same complaint independently as `KI-2026-09-17-a` from Mitchell's own words |
| The Map lens's day rail | Click-only. The design's **hover-to-detail card** (design file `:2301`, `:2374-2384`, `:9793-9810`) has no SPEC section, which is almost certainly why it was never picked up |
| The phone | Four surfaces are genuinely built to spec. **Everything else a phone can reach is the desktop layout reflowed**, and KI-046 measures 191 of 211 controls under 44px |

**Three of those six are things Mitchell named directly** when asking for this
work: Playbooks looking nothing like the designs, account settings as its own
page, and filters and tabs re-imagined. The map hover card was the fourth. The
survey found the rest by reading.

### What this milestone is not

**It is not a re-skin.** M5 answered *is it consistent*, M10 answered *is it
beautiful* against a 2026-08 handoff. This one answers a narrower and more
checkable question: **does each screen do what the current handoff says it
does**, at both widths. Where the build and the design disagree and the *build*
is right, this milestone says so and amends the design rather than regressing
the code — the survey found **fifteen** such cases, and they are listed under
*The design is stale here* below.

**It is not a licence to widen.** Every link below is UI over data that already
exists, or a named, sized exception. The three genuinely blocked bodies of work —
reviews, per-stop attribution, cost classification — are routed to M12, M13 and
M19 and are **out of this milestone's scope on purpose**.

---

## Link 0 — PREFLIGHT: make this handoff buildable, once

**This closes `KI-2026-09-14-c`**, which is already written, already scoped, and
already names the five aids. It runs before any screen work.

1. **`docs/guidelines/building-from-the-design.md`** — the order of operations:
   find the artboard → read `SPEC.md`'s prose for the same screen → **diff it
   against the link that owns the screen and write down what is out of scope
   before writing any code** → run the surface's invariant sweep → then build.
2. **A route→artboard index** in `.design-sync/handoff/README.md`: one table,
   route → artboard heading → `SPEC.md` section. The KI calls it *"ten lines,
   and it removes step one's guesswork permanently."*
3. **A generated section index at the top of `SPEC.md`**, with a test that it
   matches the headings. `SPEC.md` is append-by-date on purpose — §18 begins at
   line 184 and §17 at line 744 — so a reader who greps `§17` and reads forward
   lands in the wrong section.
4. **A line in the same guideline that design ids are not domain ids.**
   `fourthPlan.test.ts` already enforces this for plans; the guideline is what
   stops it being rediscovered per surface.
5. **The sixth gap, and the one that bears hardest on this milestone's own
   gate:** *"when a milestone owns a surface in the design, the gate needs a box
   a person could fail by looking at the screen"*, not only boxes a test can pass
   against the server. Mitchell, 2026-09-14: *"the exit gates are incorrect if
   it's in the designs but wasn't included in the gates."*

**And one addition this survey found, which is not in the KI.** The colour wall
scans for **raw hex** and an **undefined token NAME passes it clean** — M23
shipped a selected chip with a transparent background through exactly that hole
(`docs/STATUS.md`, M23's *two quality gates cannot see a whole class of
defect*). This milestone introduces more new token usage than anything since
M10 (an underline treatment, a moss header strip, per-day accent inks on the map
rail). **Extend `scripts/check-color-wall.mjs` to fail on a `--color-*` /
`bg-*` / `text-*` name that `globals.css` does not define**, before the links
that would exercise the hole.

**What link 0 actually found, 2026-09-19.** Recorded here because it changes what
a later link can assume, not as a progress note:

- **The token wall found two live defects on its first run**, in code no link had
  reached yet: `bg-canvas` three times in `access/SharedTripScreen.tsx` — the
  page ground of the screen a non-member sees on a share link, rendering as
  nothing — and `ring-primary` on the selected-widget ring in
  `pages/editor/MacroNodeView.tsx`, shadcn's default colour this app never
  defined. Both fixed in the same change. **The hole was wider than
  `KI-2026-09-19-g` estimated**: it costed the risk against *new* token
  vocabulary, and these were already shipped.
- **The design file has no artboards, only route gates.** A screen is a
  `<sc-if value="{{ isAdminRoute }}">` block reached by driving `startScreen`
  and the nav — so "find the artboard" is a lookup in the generated table, not a
  heading search. Every link below should use it rather than grepping.
- **`/demo` and `/s/[token]` have no artboard of their own on purpose** (SPEC
  §27: read-only is a mode over the trip surface, not a separate route). The
  build has separate screen components for both. Nobody should invent a demo
  artboard; this is now recorded in the route table itself.
- **`/account` is the only mapped route the build does not have.** That is link
  1, and the route table's test asserts it is the *only* one — so a second gap
  appearing is a failure rather than a discovery.

---

# WAVE 1 — desktop and shared surfaces

## Link 1 — Account becomes a page with tabs

Closes **DRIFT D14**, **DRIFT D12** and **`KI-2026-09-17-a`**.

**1a. The container.** `/account` as a real route with **Profile · Plan & usage ·
API tokens** (§34.4). `PlanSection` and `TokensSection` both self-fetch
(`PlanSection.tsx:99`, `TokensSection.tsx:95-98`) and take only an `onNavigate`
prop that exists solely to close the sheet — so **they move unchanged and the
prop is deleted**. The identity and display fields are the part that has to be
lifted out of `AccountSettingsSheet.tsx:131-277` into their own components
first.

Three things that are not obvious:

- **A tab's label is the section's heading.** Delete
  `PlanSection.tsx:185-187`'s `<Heading>Plan</Heading>` and
  `TokensSection.tsx:203-205`'s `<Heading>API tokens</Heading>`, and the
  `aria-labelledby` on both `<section>`s with them — the tab panel takes over
  the labelling. Keeping both is project rule 4 twice on one screen.
- **The tab is the route** (DRIFT §6 build-check 4), so account tab state is
  `?tab=`, not component state. `ui/tab-strip.tsx` is state-driven **and
  pill-shaped**; §34.4 asks for Discover's underline treatment, which the DS
  does not ship and §33.2 says to build from tokens (see `DS-UPSTREAM.md`).
  Link 2 builds the same primitive for Discover — **build it once, in link 2,
  and consume it here.**
- **`PreferencesProvider`'s editing guards must survive the move.**
  `AccountSettingsSheet.tsx:59-114` holds per-field revert-on-refusal and an
  `editing.current` gate. That gate is the fix for the PR-112 wipe bug.
  Re-implementing the move without it reintroduces it.

**Seven test files bind to the Sheet and all of them change:**
`AccountMenu.test.tsx:48-57`; `AccountSettingsSheet.test.tsx` (10 tests, whole
file); `e2e/m17-account-preferences.spec.ts:52-56,:102`;
`e2e/m22-api-tokens.spec.ts:23-27,:49`; `e2e/m20-entitlements.spec.ts` (six
`Your account` clicks); `e2e/m21-plans.spec.ts:154`, which is **scoped to
`role="dialog"`** and therefore fails rather than drifts; and
`e2e/responsive.spec.ts:512-531`, whose comment calls the popover *"the only
route to account settings on a phone"*. **`m22-api-tokens.spec.ts` is M22's
proof that a token can be minted and revoked by clicking** and it must keep
proving that wherever the controls live.

**1b. §34.5's styling rules**, which are the part to copy rather than re-derive:
panels on a **580px measure** inside a `--color-surface` card with a
`--color-moss` header strip, a **170px label column**, controls sized to their
content (96px for a three-letter airport, 240px for a name), secondary
explanation **under the label**. And **a list of like things is a table**: the
token list becomes one card of rows with a moss header (Token · What it may do ·
Expires), not the stack of per-row hairline boxes at `TokensSection.tsx:298-349`
— which is a hairline card on a hairline card on paper, and is the exact defect
§34.5 was written to correct. `ui/table.tsx` already exists.

**The cheapest item in the whole milestone is here.** §34.5: *"Every box on the
page is `--color-surface` — no exceptions."* Five boxes are missing the fill
today — `PlanSection.tsx:189`, `:293`, `:321`, `TokensSection.tsx:304`, `:360` —
and they read as holes in the column beside the filled ones. That is five
classes.

**1c. Which trips — and it is not blocked.** DRIFT D12 frames this as the design
being ahead; the survey checked every layer and **the field is shipped and
enforced end to end**: `schema.ts:231`, `publicApi.ts:377` and `:312`,
`api-tokens/index.ts:259` and `:345`, `actor.ts:113`, and
`public-api/route.ts:584-592` **already refuses the widening** a trip-scoped
token would need to create a trip. The entire gap is one line —
`TokensSection.tsx:144` posts `tripIds: null` — plus a control above it and a
fetch of the caller's trips (`/api/trips` exists). Decision 5's rule is not
something to implement; it is something to **state in the UI**, because it is
already true.

**1d. The token section's remaining obligations** (§34.1). Five are already met
and better than the design — time remaining not created-at, expired reading
differently from revoked, no Rotate button, revoke-on-live-only with no undo,
and a one-time reveal in a selectable field whose Copy fails honestly
(`TokensSection.tsx:231-285`, whose `copiedFor` identity key is a
late-resolving-clipboard fix the design does not have). What is missing:

- under a week reads in `--color-warning-ink` (`:318` is unconditionally slate);
- lifetime as **30 / 90 / a year** chips, not the raw number field at `:429-447`
  — `:123-128` and `:131-133` exist only to defend that field and go with it;
- the scope line reads `"1 trip(s)"` and joins with `", "` not `" · "` — the
  same defect class KI-048 records as `1 travellers`;
- the opening sentence stops at *"Treat one like a password."* The third clause —
  *"it can never do more than you can"* — is the build's second gate in plain
  words and is **true of this build** (`route.ts:568-583` re-checks membership
  per call);
- the gate copy names neither half of the split §34.1 requires (*tokens are
  Premium, downloading a trip is not*) nor the **lapsed** variant, though
  `billing.state` is already on the wire at `accountPlan.ts:43` and unused.

**1e. Plans' back link** points at `/account?tab=plan`. It has none today —
`PlansScreen.tsx:437` says *"Back to your trips"*.

**Two things to settle before writing code, not after. BOTH ARE NOW SETTLED —
2026-09-19, when link 1 opened.**

- **Sign out — DECIDED: the popover only on desktop; the phone account screen
  carries its own.** So **`/account` has no Sign out**, and this is not an
  omission. Three things agree and the fourth was a misreading: SPEC §12 put it
  in the popover alone *"on rule-4 grounds"*; the design's **desktop** `/account`
  artboard has no sign-out anywhere in it (checked — `isAccountRoute`, no match);
  and §34.4's *"Sign out sits below [the tabs]"* sits in a paragraph whose
  subject is **the phone account screen**, which needs one because §34.3 makes
  it a task screen the tab bar steps aside for, with no avatar popover to hold
  it. Putting it in both is project rule 4 twice on one account. Wave 2 link 11
  builds the phone half; it is the only place this decision adds a control.
- **An account-level currency — DECIDED: no, and not deferred.** Currency stays
  **per trip** (`SetTripCurrency`, and `TripMoneySettings` is where it is set).
  `KI-2026-09-17-a`'s sketch proposed a *Preferences* tab holding it; §34.4's
  three tabs, which are newer, do not have one. The tab list is not the real
  argument though — this is: **every other Profile field is a property of the
  reader and has no per-trip counterpart.** Distance units, home airport and
  the name are true of you wherever you are. A currency is a property of *where
  the trip happens*, and a trip already carries one. An account-level default
  would therefore not replace the per-trip value, it would sit above it and owe
  a precedence rule — "use the trip's, unless" — which nothing in the product
  has asked for and which no artboard draws. **If it is ever wanted, it is a
  new field with an override rule, not a move of the existing one.**
  `KI-2026-09-17-a` is closed by this link on its account-settings complaint;
  the currency line in its fix sketch is answered here rather than inherited.

**And what link 1 does NOT build, written down before the code (the guideline's
step 3).** The Profile artboard draws a second Display row — **Home time on
hover** — and this link does not build it. It is not a styling gap: it needs a
timezone for the home airport and a `trip.tz` to compare against, and the app
has neither. That box was amended out of **M17's** exit gate on 2026-09-01 for
exactly this reason. It stays where it is — a placed item blocked on data, not
an M26 omission — and the tab ships with the one Display row the build can
honestly render. The design is ahead here, not the build behind.

**Link 1 landed 2026-09-19.** What it changed beyond the obvious, for whoever
opens link 2:

- **The underline tab primitive exists** — `ui/underline-tabs.tsx`, built here
  and meant to be *consumed* by link 2 rather than rebuilt. It is §33.2's
  treatment exactly: 2px `--color-brand` edge, `--color-ink` active against
  `--color-slate` idle, on a `--color-hairline` base line. It takes
  `value`/`onValueChange` and knows nothing about routers, because Account puts
  the tab in `?tab=` and Discover will put it somewhere of its own. It also
  carries arrow-key movement and a roving tabindex, which `TabStrip` does not —
  that is a gap in `TabStrip`, not a precedent to copy.
- **`ui/settings-card.tsx` is §34.5's card and row**, and §34.5 says the same
  rules govern whatever Account grows next, so it is a primitive rather than
  markup. **Widths are spacing multiples** — `w-42.5` is 170px, `max-w-145` is
  580px — because the artboard's own `grid-cols-[170px_minmax(0,1fr)]` is an
  arbitrary Tailwind value the colour wall rejects. Expect the same friction
  anywhere an artboard hands you a pixel value.
- **A real bug was found and fixed on the way**: `TokensSection` read
  `plan.billing.state` unguarded, so a plan body without `billing` threw, hit
  the catch, and rendered "your API tokens could not be loaded" — the whole
  section lost to a field that decides one sentence of gate copy. Its own test
  fixture had been omitting `billing` while every real response carries it,
  which is why no test could have caught it. **Check what a fixture leaves out,
  not only what it sets.**
- **Two decisions were settled and written down** (sign out, account currency)
  and one scope line was written down *before* the code: Home time on hover is
  not built, because it needs a timezone and a `trip.tz` the app does not have.

---

## Link 2 — Discover is re-sorted by kind of decision (§33.2)

The rule this link implements governs **any list surface**, which is why it is
worth doing properly once: **a place is a tab, a question is a chip, a property
of the list rides the sentence about the list.**

- **`Everyone / Yours / Saved` becomes an underlined tab bar above the search
  card.** It is a place, so it **never counts as an active filter and Clear
  filters does not reset it** — today `DiscoverScreen.tsx:310`'s *Search
  everywhere* resets the scope, which §33.2 forbids. This is where the
  underline primitive gets built; link 1 consumes it.
- **Filters become chips.** `Rating` and `Budget` are `face: true` — always
  present, outline + slate when empty, `--color-brand-tint` + brand border
  showing **their value** when set. Everything else appears only once it carries
  a value, in one *More filters* popover.
- **Sort leaves the filter row for a results sentence that does not exist yet.**
  `128 shared days · Most added ▾`. The count and `truncated` are already on the
  wire (`lib/playbooks.ts:335-344`). The sentence states **the count only** — it
  used to end *", most added first"*, which both duplicated a live control and
  could contradict it.
- **The filter count excludes scope and sort.** The phone badge previously
  counted *"sorted by newest"* as a filter, which it is not.
- **`Length` already exists and is already right** — `LengthBand` and
  `LENGTH_BAND_LABELS` (`lib/playbooks.ts:181-198`) are the design's four bands
  filtering on `day_count`. It only moves into *More filters*.
- **`Season` is cut.** It is a top-level select (`DiscoverScreen.tsx:233-244`),
  a `Filters` field (`:69`), a parsed query param
  (`api/playbooks/route.ts:44-46`), a SQL filter (`server/playbooks.ts:198`) and
  a rail fact (`SharedDayScreen.tsx:440`). **`seasonOfMonth` and
  `SEASON_MONTHS` stay** — `pnpm content:verify` prints season occupancy and
  that is a separate consumer. Cutting the *filter* is not cutting the concept.

**§33.3 rides with this link**, because it is the same rule one surface over:
the tag-focus notice moves **out of the Plan toolbar** onto its own line above
the content it dims. It is a statement about the list below, not a control in
the toolbar. Today it is inside the toolbar row at `TripBoardScreen.tsx:838`;
§33.3 says *"a build owes: nothing structural"* and that is accurate — it is one
JSX move. Update the two comments that go stale with it (`:832-836`, `:839-841`).

**The design is stale in two places here and the build is right.** The
empty-state copy still blames the season filter §33.2 cut; and *"$N each"* /
*"Budget each"* was retired on Mitchell's instruction and must not be re-added.

## Link 3 — A Playbook's days become a scope (§33.1)

M23 landed the data on 2026-09-19 and no surface reads it for scope.

- **An `All days · Day 1 · Day 2 · Day 3` `TabStrip` under the title block**,
  `All days` default and first, **no tab row at all for a single-day Playbook**.
  Opening any Playbook resets the scope to `All days`.
- **`All days` merges, it does not concatenate**: a `Day N · 9:45 am – 6:30 pm ·
  4 stops` divider before each day (today it is the bare string `Day {n}` at
  `SharedDayScreen.tsx:319-325`), **continuous stop numbering 1…N** across the
  whole rollup (today stops are unnumbered), and the tag roll and booking line
  counting the whole Playbook.
- **Picking one day rescopes everything below the title.** The title block
  always speaks for the whole Playbook (`3 days · 12 stops · run in November`),
  so no number is stated twice — which also fixes the rail duplicating stops,
  window and days that the title block should own (`:371-441`).
- **The CTA becomes `Add all N days to a trip`.** `day.dayCount` is already in
  hand at `:371`; the count only surfaces inside the dialog today.

**Do not regress the build's rest-day rendering** (`:326-332`). The design
derives its tab list from stops and would silently omit an empty interior day;
the build walks `dayCount` and renders *"Nothing planned — kept as a rest day."*
ADR-048 decision 2 says a gap **is** an empty day, and the build is right.

## Link 4 — The shared day gets its map (§16)

The largest single item in Wave 1, and the one with the most prior art to copy
and the most traps already documented.

**Not blocked on a contract field.** `Location.lat`/`lng` are optional and
`SavedStop.location` is nullable, so the map **degrades** to list-only below two
located stops — which is a state to design for, not a blocker.

Four constraints, each one a bug that has already been hit:

1. **The map node stays mounted.** Only the focus card and the legend are
   conditional. A React conditional around the container detaches the node
   mid-style-load and the load aborts with no error. This is DRIFT §6
   build-check 5 **on its third recurrence**.
2. **Pins draw immediately; lines wait for the style.** A line drawn before the
   style is ready silently drops the layer.
3. **Style-load recovery is per instance**: rebuild at 3.5s and 7.5s, list-only
   at 11s, re-arming until *that* instance finishes. A shared timer cancels a
   live load when the route changes.
4. **Accents leave `oklch` before reaching a paint property** — see link 8,
   which makes this enforceable instead of remembered.

**Geometry is per day and `All days` is a merge**: compute each day, concatenate
points, legs and gaps, and **no leg may join the last stop of one day to the
first of the next** — a straight line across a night is a fact the map would be
inventing. The map cache key includes the day, or switching tabs leaves the
previous day's line on screen.

Reuse `MapLens.tsx`'s mount discipline, and transcribe these four constraints
into the code as comments. Each is cheaper to read than to rediscover.

**Link 4 is PART DONE as of 2026-09-19, and the half that is done is the half
that can be decided without a browser.**

**Done: `sharedDayGeometry.ts`, with 18 tests.** It owns the three rules that
have historically been got wrong, and each is now impossible rather than merely
avoided:

- **`All days` merges by concatenating per-day results**, never by one pass over
  all the stops. That is what makes "no leg across a night" structural: a single
  pass joins the last located stop of day 1 to the first of day 2, and the
  resulting line looks exactly like every other leg. Proven by writing that
  defect and watching four tests go red.
- **The cache key includes the scope.** Without it, switching from `All days` to
  `Day 2` leaves the previous line on screen — the points are a subset, so
  nothing looks changed.
- **`worthDrawing` is the degrade rule** — below two located stops the surface is
  list-only rather than an empty canvas (§16).

Two decisions inside it worth knowing before building the rendering: pin numbers
follow the **list**, so an unlocated stop leaves a gap in the pin numbers rather
than shifting them (a pin 4 beside a list row 5 is worse than a missing 4); and
a leg that steps over an unlocated stop is marked `contiguous: false`, because
it is a guess about a route that skipped something rather than a leg somebody
took.

**Not done: the rendering, and it cannot be finished to this gate's standard
without a browser.** What remains is the `SharedDayMap` component itself —
transcribing `MapLens.tsx`'s mount discipline (the four constraints above are
each a bug already hit) and the 3.5s / 7.5s / 11s per-instance recovery ladder,
which **does not exist anywhere in the build yet**: no `3500`/`7500`/`11000`
appears in `apps/web/src`, so it is new work rather than a copy. The gate asks
for that ladder to be **proven by forcing it**, which is a browser walk, so this
link stays open on purpose rather than being marked done from inspection.

---

## Link 5 — The Map lens's day rail

**5a. The hover-to-detail card, and the decision it needs first.**

The design's rail day rows carry `onMouseEnter`/`onMouseLeave` and raise a
256px card at `left: 296px`, **top-aligned to the hovered row** and clamped to
`[16, mapwrapHeight - 168]`, `pointer-events: none`, `riseIn 140ms`, suppressed
unless the canvas is showing, and torn down on route/view/trip change. It
carries the day's accent dot, `Day N · City`, a mono `N stops · km · M min
moving`, and one of three notes — the empty day, the longest hop, or *"A single
anchor. Nothing to travel between."* The design's own comment is the argument:
*"The day's detail is a hover card beside the rail, not a panel parked over the
map: it costs no space until you ask a day a question."*

**DECIDED 2026-09-19 — build it.** Mitchell: *"Yes still add the hover, the idea
being is if you want more info you can move your mouse over and hover or move
your mouse out to see the ui witout the hover."* That is the design's own
argument restated as a user's: the card is **detail on demand**, and moving out
is how you get the clean map back. Reveal-on-demand, not a second way to select
a day.

**And the build's objection turns out not to conflict with it — check this
before deleting anything.** `MapRail.tsx:329-333` says *"No hover tint … a hover
state would compete with that as a second, misleading selection cue"*, asserted
at `MapRail.test.tsx:51-56` as `not.toMatch(/hover:bg-/)`. Both are about a
**hover background on the row**. The design does not tint the row on hover
either: its `bg` is `on ? m.ac.tint : 'var(--color-surface)'` — **focus-driven
only**. It raises a card *beside* the rail and leaves the row exactly as it was.

So the rule the test encodes survives intact, and **the test stays green rather
than being deleted**: the row's appearance is a function of focus, hovering
changes nothing about the row, and the card is the only thing that appears.
Keeping both is not a compromise — it is the distinction Mitchell's sentence
draws. Add a sibling test asserting the card appears on `mouseenter` and clears
on `mouseleave`, and leave the no-hover-tint assertion where it is.

What exists today is `MapFocusCard.tsx` — an always-on card at `bottom: 18px`,
no `pointer-events: none`, no animation, and different copy (`day.city ?? label`
rather than both; no *moving* figure; a note about unlocated stops rather than
the longest hop). It is roughly 60% reusable.

**5b. The rail row itself.** Text in the day's accent ink, not `text-ink` and
`text-slate` (`:341`, `:359`); label and date at `baseline gap-8` rather than
pushed to opposite ends of 268px (`:339`); **the month only at the first day and
at month boundaries** — ~~`DayChips` already implements `monthEdge`, so the two
rails currently disagree **inside the build**~~; bars one per **leg** rather than
one per stop, with the phantom first bar removed.

> **Correction, 2026-09-20, on building it.** *"`DayChips` already implements
> `monthEdge`"* is **false**, and the disagreement it describes never existed.
> `DayChips` renders `dow` and `dateNum` — a weekday and a day-of-month number —
> and prints **no month at all**, on any row; `grep -rn monthEdge` over the whole
> tree returns nothing. Two surfaces cannot disagree about a month only one of
> them has ever shown.
>
> So this was a fresh implementation rather than a reuse: `monthEdges()` in
> `mapRailData.ts`, deciding from each row's ISO `YYYY-MM` prefix — never a
> parsed `Date`, which can drift a day across a timezone — with non-boundary
> rows taking a new `formatTripDateNoMonth`. Recorded here rather than fixed
> silently, because left standing this line sends the next reader looking for a
> function that does not exist, and the danger then is that they find something
> plausible and reuse the wrong thing.

**5c. Two derivations, one of them blocked.** `longest` — the longest leg and
its endpoints — is pure derivation from coordinates and titles already on
`MapStop`, and it feeds the hover note, the rail flag and the shared-day map.
**`N min moving` and the walk-vs-ride split are blocked** on per-leg transport
mode, which is `map-legend-modes` → `unplaced` in `preview-registry.ts`.
`routeLegs()` splits on `kind === "transit"` as a coarser proxy that exists
today; **ask before using it**, because shipping "on foot" over a proxy is a
claim the data does not make.

**5d. Clicking a rail day scrolls the rail** the way `railTo` does — 14% from
the top, under a 700ms lock. Today `onClick` only sets focus.

## Link 6 — Trip lifecycle, and one verb with two homes

**6a. D13 — Delete and Duplicate leave Trip settings.** All three sit together
at `SettingsSheet.tsx:462-496`; §34.2 and §27 put lifecycle on the trip card's
popover on Home, where it already works. **Download stays**, and the build's
plain `<a download>` is exactly what §34.2 asks for. The removal is easy; the
work is unwinding `onDeleted` → `TripHeader` → `applyOutcome`, which exists
because the sheet's own subtree unmounts before it could raise a toast
(`:67-79`).

**6b. `Leave this trip` does not exist**, and the absence is a live defect, not
a missing nicety: the Home popover offers **Delete unconditionally**, so a
non-owner is shown a verb the server will refuse. §27 says a trip someone shared
with you offers *Leave this trip* instead. Needs a `LeaveTrip` verb and `myRole`
on the trip-list projection. **This fixes 6a's mis-gate on the way past, so land
them together.**

**6a AND 6b ARE DONE, 2026-09-20, and the verb is not an event.** The milestone
said "a `LeaveTrip` verb"; the verb is real and the event is not, because
membership is not in the planning log. Access is CRUD (ADR-003, AGENTS.md
invariant 1) — `trip_memberships` rows are the Access module's, `TripCreated` is
the only thing that mints an owner, and inventing a planning event to carry a
membership change is the boundary smell. So no contract type moved, no reducer
case was added and `MINIMUM_ROLE` is untouched: `DELETE /api/trips/{id}/membership`
calls the `removeMember` that KI-65 already built, whose owner rule already
existed. `members.ts` had even written down what was missing — *"an owner-only
endpoint cannot express it, and self-removal for a guest is a product surface,
not a permission tweak"* — and this is that product surface.

**A route of its own rather than widening `DELETE .../members/[userId]`.** That
endpoint asks "are you this trip's owner"; this one asks "is the person you are
removing you". One handler answering both decides per request which rule
applies, which is how the looser rule eventually leaks onto the stricter path.
And it cannot share the response: the sibling answers with the trip's
`TripAccess`, which would hand a non-member the member list one request after
taking their access away.

**`myRole` on the trip-list projection was not needed.** `TripSummary` already
carries `members` and `TripMember` carries `role`, so the answer was on the
wire; `viewerOwnsTrip` (`lib/tripRole.ts`) is the UI's own comparison, because
the lint wall bars importing `server/accessPolicy`'s `memberRole`. It answers
`false` while the session probe is in flight — the milder verb is the safe side
to be wrong on.

**Leaving raises no undo toast, where Delete does.** That is the difference
between the verbs. §27's toast exists because deleting is destructive and
`RestoreTrip` puts the trip back; leaving destroys nothing, and no verb puts you
back on somebody else's trip — only its owner can re-invite you. An Undo there
could not keep its promise.

**6a took the confirm dialog with the buttons**, and it was arguing against
itself: *"You can undo this from the toast that follows"* is a modal explaining
that the action it guards is reversible, which is §27's own reason for having
no modal. `TripHeader`'s delete toast and `undoDelete` went too — Home's toast,
one level up, has always been there and is now the only one. A15-fix's
`applyOutcome` reconciliation is not lost, only out of reach: nothing on that
screen can delete the trip any more, so no window opens for `trip.status` to go
stale.

Four tests asserting the opposite were REPLACED rather than deleted, in both
files: "Delete is gone" is a claim worth holding, or a later tidy-up restores it
for one role and nothing says so. `m11-clone.spec.ts` now duplicates from Home's
card menu, which is where the verb lives.

**6c. Duplicate clears dates and travellers** (§27 — *"a copy is a starting
point, not a commitment"*). `cloneTrip.ts:83` carries every field but the name.
**Check with Mitchell first**: `cloneSharedTrip` and `cloneDemoTrip` share
`cloneFrom`, and clearing dates may not be wanted for *"Make this trip mine"*.

**6c is DONE, 2026-09-20, and the check answered itself.** The worry was
right, so `cloneFrom` takes `clearDates` and only `duplicateTrip` passes it.
*"Make this trip mine"* from `/demo` is somebody's FIRST trip and a demo
stripped of its dates on the way in is a worse example than one that keeps
them; *"Make this my trip"* from a share link is a copy of a particular state
its holder chose to take, and the dates are part of what they saw. §27's
sentence is about Duplicate, and only Duplicate.

**Travellers needed no code, and that is asserted rather than assumed.**
`diff.ts` does not diff `members` (*"tripId and members never differ between
two states of one trip"*), so a copy's membership is whatever `CreateTrip`
gave it — the cloner, as owner. The test asserts it anyway, so the day
membership becomes diffable this half of §27 fails loudly instead of
silently regressing.

**The days stay and only their anchor goes.** The shape of the trip is what
was worth copying, and an undated day is an ordinary state here (`startDate`
is what gives days their dates). Seen to fail three ways: `clearDates: false`
on Duplicate, the default flipped to `true` (which clears the share clone's
dates), and clearing `days` alongside `startDate` — four red.

**6d. Download gets its section and its second sentence** — a *Take it with you*
heading and *history does not travel*. The fact is in a code comment and has
never been shown to a person.

## Link 7 — The states every screen owes (§3b, project rule 6)

DRIFT §3b designed region-by-region loading on 2026-09-12. **None of it is
built** — and "none" is literal: `Skeleton`, `animate-pulse`, `data-sk` and
`breathe` return **no placeholder component and no placeholder markup anywhere
in `apps/web/src`**. The design declares nine named regions across five
surfaces with staggered arrival and per-region retry (`LOAD_PLAN`,
`dc.html:6868-6947`). The build has four whole-surface strings and one
page-level retry.

Three rules to take literally: a page's chrome and primary actions are **real
from the first frame and never placeholdered**; a failed region is a **retry in
place** while every region that did arrive stays; and an empty account gets
**one empty state per surface, not one per section**. Placeholders are hairline
outlines only, never invented values.

What each surface does today:

- **Home** renders the date line, *Your trips* and three buttons and **nothing
  else** while loading (`page.tsx:511`, `:567`), and on failure sets one
  page-level error whose single *Try again* re-runs the whole read
  (`:457-466`) — the dead screen §3b forbids. Its per-card cost fetch already
  does the right thing (`:332-354`: a failed `TripDetail` simply yields no
  budget line), so the region model is not foreign to the page.
- **Overview** is one whole-tab *"Loading the Overview…"* and an error as muted
  text **with no retry control at all** (`OverviewLens.tsx:122-136`), and its
  one primary action — *Edit in Notebook* — is not rendered in either state,
  which §3b forbids directly.
- **The Notebook index** is a bare `Loading…` for the entire route, chrome
  included (`NotebookScreen.tsx:245`), and an error that replaces the page
  (`:246-250`). Its empty state is correct and singular (`:367-371`), and its
  templates gallery is exempt by being static — accidentally right, and worth
  making deliberate.
- **The Map lens** has no loading or error branch at all. **Its split is not
  just a skeleton**: `TripProvider` loads the whole `TripDetail` before the lens
  mounts, so the design's rail-then-canvas staging has no seam to attach to.
  Either give it one or record that this surface's answer is different; do not
  fake a stagger over data that has already arrived.

**Home's `homePb` region has no build counterpart** — the Playbooks strip was
deleted in M11b. That is a divergence to record in `DRIFT.md`, not a region to
build.

**The Map lens is the worst case and it is the one that matters most.** It has
no loading state, no failed state, no `map.on("error")` handler anywhere, and
its empty branch (`MapLens.tsx:793-795`) drops **the rail too**. There is no
style-load recovery ladder — if `map.on("load")` never fires, `setReady(true)`
never runs, silently, forever — and no container-identity guard, though the
container sits inside two React conditionals.

**This is what bounds KI-49.** The Map lens's tiles *"have never been confirmed
to paint, in any environment"*, and *"a blank canvas is not a pass"*. Until this
link lands, no browser walk can distinguish tiles-blocked from
style-never-loaded from working. **KI-49 is not closed by this link, but it
becomes diagnosable**, and that is the honest claim.

## Link 8 — The two guards that cannot see this class of defect

Both are small, both are enforcement rather than UI, and both exist because
this milestone is about to exercise exactly the hole they leave.

**8a. `oklch` reaching a paint property.** `MapLens.tsx:39-41`'s `accentVar`
reads a token through `getComputedStyle` and feeds it straight into
`line-color` (`:440`, `:574`) and `new Marker({ color })` (`:485`). That is
**precisely the non-fix DRIFT §6 build-check 2 names** — `getComputedStyle`
preserves modern colour syntax verbatim, so it looks like a conversion and is
not. It is correct today **only because the tokens happen to be hex**, and
`globals.css:213-214` states *"No `oklch` anywhere, deliberately"* as a comment
with no enforcement. §28's Ledger chroma bump is described as an oklch bump.
One token, and every route line and marker goes black in silence. Add an
arithmetic conversion behind `accentVar`, or a test over the accent tokens —
either, but not the comment alone.

**8b. The undefined token name.** The colour wall greps for raw hex, so a
`--color-` name `globals.css` never defines passes clean; M23 shipped a
transparent chip through it. Extend `scripts/check-color-wall.mjs`.

## Link 9 — Home, and the new-trip fork

The front door needs almost nothing: the landing page runs on fixtures with its
copy rules test-enforced, the rotating hero stops for good on a click, the
decorative layers are `pointer-events: none` (DRIFT §2's named trap, avoided),
and read-only renders its absent controls rather than disabled ones on every
surface §27 names. The new-trip conversation is **built to §31 and §32**,
including the two-sided transcript, the single answer dock in §31.3's order, the
derived question list, the split dates turn and formatting at commit.

What is left here is four things.

- **The new-trip entitlement fork (§30.3), free half.** This is the last wizard
  `<Preview>` shell (`NewTripWizard.tsx:444-452`), and **its free half is not
  blocked**: the entitlements port and `useAiEntitled` both exist. Without
  access the design gives one description, a quiet Plus note and a *See plans*
  button, and **removes the dock entirely — never a disabled input** (§31.3).
  The paid half — a live composer continuing in the trip's context — is **M9's**
  and stays shelled. Today the build has only `phase: "asking" | "made"` and no
  entitlement read, and its closing turn is honest about it.

  **DONE 2026-09-20.** Three things a later reader should not re-derive:
  **The fork moved to after the fifth ANSWER**, where the shell rendered on the
  fifth QUESTION — §30.3 says *"After the fifth answer the flow splits"*, and
  the old placement put a claim about the trip on screen before there was one.
  **`null` takes the PAID branch.** `useAiEntitled` returns `null` both while
  unknown and on a failed read, and its own note requires every caller to treat
  that as entitled: flashing a paywall at a subscriber is a worse failure than
  one optimistic frame, and here that frame is a `Preview`, which promises
  nothing. The dock needed no change at all — it already renders only while
  `phase === "asking"`, so §31.3's *"no teaser, no disabled input"* was already
  true and is now asserted.
  **It surfaced a real defect in `useAiEntitled`.** Mounting the hook on a
  second screen produced FIVE unhandled rejections in a run that still reported
  every test passing: `body.plan.entitlements` on a 200 whose body was anything
  else threw inside the caller's `.then`, breaking the no-helper-ever-rejects
  invariant the file claims in its own header. Fixed at the source, with the
  hook's first test file — five 200s a real deployment can serve (an auth
  redirect to HTML, an envelope with no key, a null plan) each resolving to
  `null` instead of rejecting.
- **D13's remaining half, and a dialog that argues against itself.** Home is
  already right — the two-verb popover, the optimistic delete, the single-action
  undo toast and `RestoreTrip` are all built and quote §27 in place. The
  **settings sheet still carries Duplicate and Delete**, and its confirm dialog
  body reads *"You can undo this from the toast that follows"* — a modal whose
  own copy explains the action is reversible, which is the exact thing §27
  argues against. Deleting the buttons deletes the dialog with them. *(This is
  link 6a seen from the other side; they are one change.)*
- **The empty state's file sentence.** `ImportTripButton` is placed correctly on
  both screens and already surfaces **the server's own words**, falling back
  only for a response that never reached the route — exactly §34.2. Two gaps:
  the empty state never says **what a trip file is**, which §34.2 puts precisely
  there, and the refusal renders as a `Text role="alert"` rather than the
  design's `Banner`.

  **Both DONE 2026-09-20.** The sentence is the artboard's own
  (`dc.html:1530`), and *"or from another account"* is its load-bearing half:
  a download is portable, and without saying so the control reads as a backup
  of your own trips, which is the narrower and less useful thing.
  The `Banner` keeps `role="alert"`, overriding the primitive's default
  `role="status"` — a refusal that lands after the reader has chosen a file and
  looked away from the button is worth interrupting for, and that override is
  behaviour rather than decoration, so a test holds it. The banner's LOOK is
  not asserted: class assertions live in `components/ui/**` by the lint wall's
  rule and the colour wall owns the rest.
- **D6 / KI-034 — the next-trip hero**, and the survey narrowed it usefully.
  `TripSummary` carries no start date, so `nextTrip` is `visibleTrips[0]` and
  **the selection can surface the wrong trip**. But `NextTripHero` already
  fetches the full `TripDetail` for its one trip, so **the countdown is not
  blocked — only the choice of trip is.** In scope here only if Mitchell wants
  the contract field; otherwise the countdown ships and KI-034 keeps the
  selection.

  **The countdown SHIPPED 2026-09-20; KI-034 keeps the selection**, which is
  the "otherwise" branch and needed no decision. `relativeCalendarDays` is the
  artboard's `relDays` kept to its five cases and its exact words, and the two
  backward ones are the point rather than completeness: with nothing to sort
  by the hero can land on a trip that has already gone, so it says *"12 days
  ago"* as readily as *"in 47 days"*. A countdown that only counted down would
  print nothing, or a negative, in exactly the case D6 warns about.
  **One overclaim corrected in passing.** The first version of its note said
  UTC arithmetic was needed because a local-time subtraction "rounds to the
  wrong day roughly twice a year" across DST. That is false — `Math.round`
  absorbs an hour over a span of days, and the DST test was watched to PASS
  against a deliberately local-time implementation. The note now says what UTC
  actually buys: an exact subtraction rather than one rescued by the rounding.

**D11 is closed and DRIFT has not caught up. RESYNCED 2026-09-20** — `DRIFT.md`
§3 now lists the registry's real SIX entries (it said 11), D11 is marked closed
with the opposite resolution to the one it asked for (Mitchell placed the
shells rather than dropping them), *Suggested order* items 1 and 3 are struck,
and D6 is half-closed with the countdown built and the selection left to
KI-034. The line §3 used to end on — that `wizard-longer-chip` was "the only
entry here that is purely unbuilt UI" — is gone, because that shell shipped;
all six remaining entries are blocked on a missing contract field or on M9.

**D11 is closed and DRIFT has not caught up.** Its two *"honestly orphaned"*
wizard shells were resolved by decisions D-A and D-B on 2026-09-16:
`wizard-destination-chips` and `wizard-longer-chip` are **built**, not orphaned,
and `Longer: 21` is a real day count. `preview-registry.ts` holds **six**
entries, not the eleven DRIFT §3 lists, and **five of the six are blocked on a
missing field or an unbuilt feature** — the opposite of DRIFT's account, in
which the last purely-unbuilt-UI shell was the one that has since shipped.
Resyncing §3, D11 and *Suggested order* item 3 is part of this link.

## Link 10 — The assistant picks its own shape

§9 is *"one panel, three presentations, **and the user picks**"*. All three
geometries are built — `AssistantRail.tsx:311` — and **nobody can choose
between them**: the trip board hardcodes `docked`, the notebook hardcodes
`floating`. Dragging is the other half and is not built at all; the file says so
(`AssistantBubble.tsx:44-46`). §9 also asks for clamping to the viewport with a
16px pad, **re-clamped on resize**.

The collapsed state is done and correct (the 92×44 *Ask* bar, §28), and the
no-bubbles transcript is done and **guarded** by a test across all four looks.

**One consequence to land with it, not after.** §29 requires the dock on
`plans` to be `visibility: hidden`, not unmounted, because unmounting loses the
thread, the open state and the dragged position. The build's reason for not
doing that is sound today — the dock is trip-scoped, so on an account-scope
route there is nothing in the tree to hide — **and it stops being sound the
moment this link gives the assistant a position worth losing.** Build the hide
in the same change, or the rule becomes a landmine with a note on it.

**LINK 10 IS DONE, 2026-09-20, and it landed all three parts together.** What a
later reader should not have to re-derive:

**The choice is per surface and per device**, in `localStorage`. Not the account
preferences API: a 27" monitor has room to dock where a laptop does not, and an
account-wide setting would have to be changed back on every machine. Not one
global key either — that would make docking the board silently change the
notebook.

**Only the board offers it.** §9's own table says docked costs *"real — a flex
sibling, so the plan shrinks instead of hiding"*, and `PageScreen` is a centred
measure inside `PageContainer`: docking there takes 356px off the column that IS
the reading experience, which is why Mitchell asked for floating there by name.
`PageScreen` withholds `onShapeChange` so the rail draws no control it cannot
honour. Recorded in `DRIFT.md` for the design side to accept or push back on.

**§29 was delivered by outliving the unmount, not by hiding the element** —
there is nothing in `/plans`'s tree to hide. The thread already survived
(`persistAs`), the shape survives, the position now survives. **The open/closed
state deliberately does NOT**, and that is the one shortfall, traded openly:
`TripBoardScreen` documents that `useState(false)` with no restore is exactly
what makes the `useIsPhone` presentation swap safe at first paint, and restoring
it would flash a 356px docked rail on a phone to save one click.

**Two clamp details worth keeping.** The upper bound is itself clamped, because
on a viewport narrower than the panel plus two pads `width - panel - pad` falls
below `pad` and a naive clamp pins the panel off the LEFT edge, header and Hide
button gone. And no position is adopted until a drag gives one — until then
`.assistant-float`'s `right`/`bottom` hold §9's planted corner through a resize
with no JavaScript running at all.

**Three tests were caught asserting nothing** and replaced, each found by rule 3
rather than by review: the docked-drag test asserted a style a docked panel
never carries; the two-surfaces test rerendered a hook whose state was already
right in memory; and a `typeof`/`Number.isFinite` pair meant deleting either
guard left the suite green. The redundant guard is gone.

---

## Wave 1 exit gate

Per link 0's sixth aid, boxes a person can fail **by looking at the screen** are
marked **[walk]** and are not satisfiable by a green test.

- [x] Link 0 shipped: the guideline, the route→artboard index, the generated
      `SPEC.md` section index with a test that it matches the headings, the
      design-ids-are-not-domain-ids line, and the extended colour wall.
      **`KI-2026-09-14-c` moves to `resolved/` in the same PR.** Done
      2026-09-19 — `docs/guidelines/building-from-the-design.md`,
      `scripts/route-artboard-index.mjs`, `scripts/spec-section-index.mjs` and
      the token wall inside `scripts/check-color-wall.mjs`, each with a test.
      Both KIs moved to `resolved/` (`KI-2026-09-14-c`, `KI-2026-09-19-g`).
      **Two of the five aids were built generated-plus-tested rather than
      hand-written**, because a hand-written route table is stale the next time
      the design side rewrites its README in place, which it does every pass.
- [~] **[walk]** `/account` is a route with three tabs; each tab is a URL a
      browser back button walks; `PlanSection` and `TokensSection` render inside
      it unchanged; no `PLAN` or `API TOKENS` rule is repeated under the tab
      that already says it. `KI-2026-09-17-a` moves to `resolved/`.
      **Built 2026-09-19 and `KI-2026-09-17-a` is resolved; the `[walk]` half is
      unwalked** — this box needs a person on a preview, which is what `[walk]`
      means, and no preview has been driven yet.
- [~] **All seven Sheet-bound test files are migrated, not deleted**, and
      `e2e/m22-api-tokens.spec.ts` still proves a token can be minted and
      revoked by clicking. A token minted on the route is usable against
      `/api/v1`. **Migration done 2026-09-19** behind one `openAccountPage`
      helper; `m21-plans.spec.ts` failed rather than drifted, as predicted.
      **The e2e lane has not been run**, so the second sentence is unproven.
- [ ] **[walk]** A token minted with **Chosen trips** reaches those trips and is
      refused on another with `trip-out-of-scope`, and the same token is refused
      on `POST /v1/trips`. The refusals are the shipped ones — **no server
      change appears in this link's diff.**
- [~] **[walk]** Account renders on a 580px measure inside filled cards with a
      170px label column; the token list is one card of rows with a moss header;
      **no box on the page is unfilled.** **Built 2026-09-19** — the measure is
      the tab panel's (one place, as the artboard has it), `ui/settings-card.tsx`
      is the card and row, the token list is a `Table` in a filled card with a
      moss header, and all five unfilled boxes now carry `bg-surface`. Unwalked.
- [~] **[walk]** Discover's scope is underlined tabs above the search; Rating
      and Budget are always-present chips showing their value when set;
      *More filters* holds the rest; the results sentence reads `N shared days ·
      <sort> ▾`; the filter count excludes scope and sort; *Clear filters* does
      **not** reset the scope tab. `Season` is gone from the header, the query
      parameters and the rail — and `pnpm content:verify` still prints season
      occupancy. **Built 2026-09-19, with one deliberate difference and one
      judgement call, both unwalked:**
      **Rating is NOT a chip** — §33.2 names it as the second face filter, and
      there is no reviews table (M12 owns it), so it would be a control over
      data that does not exist (project rule 2). Budget is the only face filter
      until M12, and `discoverFilters.test.ts` asserts that so the absence reads
      as a decision and M12 finds the test when it adds the second.
      **The rail keeps the MONTH and loses the season bucket**, rather than
      losing the whole fact: the bucket was there because Discover filtered on
      it (*"showing only the bucket would make the filter unexplainable"*), and
      with the filter gone it classifies nothing — but Mitchell asked for the
      month by name on 2026-09-01, so `Season: Summer · August 2026` became
      `Kept in: August 2026`.
- [~] **[walk]** A three-day Playbook opens on `All days` with per-day dividers
      carrying a window and a stop count, stops numbered continuously, and a CTA
      reading `Add all 3 days to a trip`. Picking `Day 2` rescopes everything
      below the title and nothing above it. A one-day Playbook shows **no** tab
      row. A rest day still reads as a rest day. **Built 2026-09-19, unwalked.**
      Two things a later reader should not have to re-derive:
      **`TabStrip`, not link 2's `UnderlineTabs`** — these are views of ONE
      Playbook, and §33.2's own distinction makes that the pill; the artboard
      mounts `TabStrip` here too.
      **The rail lost Days, Stops and Kept in, and lost Window only where
      something else says it.** The title block's line owns the first three. A
      multi-day Playbook's Window row said *"Spans several days"*, which the
      per-day dividers now replace with each day's real range — but a ONE-day
      Playbook has no tab row and no divider, so its Window row stays. Removing
      it there would have deleted a fact rather than de-duplicated one.
- [ ] **[walk]** The shared day draws its stops on a map beside the list, the
      container survives a tab switch, **no leg crosses a night** on `All days`,
      and a day with fewer than two located stops degrades to list-only rather
      than to an empty canvas.
- [x] The map's style-load recovery ladder is **proven by forcing it**, not by
      inspection: a blocked style produces a rebuild at 3.5s, a second at 7.5s,
      and a list-only fallback at 11s, scoped to the instance that started it.
      **Done 2026-09-20** — `mapRecovery.ts`, and the map stub gained a
      `suppressLoad` knob because that is the only way to produce the failure
      this exists for: `map.on("load")` never firing, which emits no `error`,
      so `failed` was never set and the reader got a paper rectangle forever.
      The test steps a fake clock through 3499ms (nothing), 3500ms (a second
      instance, and still no panel — a rebuild is not a give-up), 7500ms (a
      third) and 11000ms (the panel, and no fourth instance).
      **A rebuild, not a retry**, because MapLibre offers no "load the style
      again" on an instance whose first attempt died. **Absolute deadlines,
      not gaps**, so a slow rebuild cannot push the give-up point past 11s
      without anybody changing a number — asserted against `Date.now()`.
      **`ladderRun` is separate from `attempt`**: a rung bumps `attempt`, only
      *Try again* bumps `ladderRun`, because a rung that re-armed its own
      ladder would retry until the tab closed.
      The unmount test is the one worth reading: its first version (unmount,
      advance an hour, assert no second `new Map`) passed with the disarm
      DELETED, because the effect that would build one is gone anyway. It now
      asserts `vi.getTimerCount()` drops to 0, and that version does go red.
- [ ] **[walk]** The Map rail's hover card appears top-aligned to the hovered
      row, never eats a click, and disappears on leave without flickering
      between adjacent rows. **And the row itself does not change on hover** —
      `MapRail.test.tsx:51-56`'s no-hover-tint assertion is still green and was
      not modified, because the card is detail on demand and not a second way to
      select a day.
- [~] **[walk]** Delete and Duplicate are gone from Trip settings and Download
      remains, under a *Take it with you* heading that says history does not
      travel. A trip shared with you offers **Leave this trip** and no Delete.
      A duplicate lands with dates and travellers cleared.
      **All three built 2026-09-20 (links 6a, 6b, 6c), unwalked.** The one
      thing a later reader should not re-derive: **the `LeaveTrip` verb is real
      and its event is not.** Membership is not in the planning log, so leaving
      is `DELETE /api/trips/{id}/membership` calling KI-65's own `removeMember`
      — no contract type moved, no reducer case, no `MINIMUM_ROLE` entry.
      Leaving raises no undo toast, deliberately: nothing puts you back on
      somebody else's trip, so an Undo could not keep its promise.
- [~] The tag-focus notice renders above the content it dims, on every lens,
      and `clearTagFilter` is unchanged. **Moved 2026-09-19** — one JSX move, as
      §33.3 said. The toolbar's explicit spacer stayed (it still keeps the
      design's 12px floor between the tabs and the pill), and `TagFocusLine`
      dropped the `min-w-0`/truncate squeeze it only needed while sharing a row.
      Its own doc comment said it sits beside `TripViewTabs`; that is rewritten
      rather than left to rot. **Unwalked on every lens.**
- [x] An accent that is not a hex token **fails a test** rather than reaching a
      map paint property; an undefined token name **fails the colour wall**.
      Both proven by adding the bad value and watching it go red (CLAUDE.md
      rule 3). *Second half done in link 0 and proven red. **First half done
      2026-09-20**, closing `KI-2026-09-19-f`: `mapColor.ts` converts `oklch()`
      arithmetically and both maps paint through it, and `mapTokens.test.ts`
      reads `globals.css` and asserts every token still lands on CSS Color 3
      after conversion — resolving `var()` aliases first, because the browser
      does, and asserting it found >20 tokens so a stylesheet reshape cannot
      make the sweep vacuous. Proven red both ways: `--color-brand: lab(45% -30
      5)` fails, while `oklch(0.4986 0.0903 173.4)` — the spelling §28's Ledger
      chroma bump invites — now PASSES, because the conversion handles it.*
- [~] **[walk]** Home, Overview and the Notebook index each paint their own
      shape before data arrives, fill in **region by region**, and survive a
      **partial** failure — the failed region offers a retry **in place** while
      every region that arrived stays on the page. Proven by failing one region
      deliberately, not by a fast network. The Map lens either gets its
      rail-then-canvas seam or its different answer is **recorded** here.
      **Built 2026-09-20, unwalked.** Each surface's failure is forced in a
      test rather than waited for: Home's `/api/trips` 500s once and recovers
      on *Try again*; Overview's `fetchPages` fails then succeeds; the
      Notebook's list 500s then recovers, and the assertion that the retry
      really went back to the network is `attempts === 2` (`cachedRead` never
      stores a failure — `queryCache.ts:189`).
      **The Map lens took the "different answer", and it is recorded in
      `DRIFT.md` §3b** alongside four other deliberate differences.
      `TripProvider` loads the whole `TripDetail` before the lens mounts, so
      `mapRail` at 360ms and `mapCanvas` at 940ms have nothing to attach to —
      the rail's data is in hand when the first frame paints, and staging it
      would be inventing a wait. What the lens got instead is the recovery
      ladder above, which is the thing it actually lacked.
      Two more differences worth not re-deriving: **Home's `homeHero` and
      `homeTrips` resolve together**, because both are the one `/api/trips`
      read — painting both SHAPES is §3b's rule, making one arrive first is
      the faked stagger §3b forbids; and **`homePb` has no build counterpart
      at all**, the Playbooks strip having been deleted in M11b, so it is a
      divergence sent back rather than a region to build.
- [ ] **[walk]** A free account creating a trip reaches the no-access fork: one
      description, a quiet Plus note, *See plans*, and **the dock absent rather
      than disabled**. The paid half stays a registered `<Preview>`.
- [x] The empty state says what a trip file is, and an import refusal renders
      the server's own words in a `Banner`. **Done 2026-09-20 (link 9c).** The
      words are the server's, unchanged — `v1`'s refusals are already written
      for a person to act on, and restating them would be a second copy that
      drifts. The `Banner` keeps `role="alert"` over the primitive's default
      `role="status"`, which is the half a test can hold; removing the override
      reddens three.
- [~] **[walk]** The assistant's presentation is the reader's choice and it
      survives a reload; it drags, clamps to a 16px pad and **re-clamps on
      resize**; and the dock on `/plans` is hidden rather than unmounted, so the
      thread and the position survive the trip there and back.
      **Built 2026-09-20 (link 10), unwalked.** Two differences from the
      sentence, both recorded in `DRIFT.md` §3b: the choice is offered on the
      TRIP BOARD only — a notebook page is a centred measure, and docking costs
      it 356px of the column that IS the reading experience — and `/plans` is
      answered by the state outliving the unmount rather than by hiding an
      element that is not in that route's tree. This box's own two names, the
      thread and the position, both survive; the open/closed state does not,
      deliberately, because restoring it would flash a docked rail on a phone.
- [~] Every surface in the handoff that Wave 1 owns is **either built or behind
      a registered `<Preview>` — no third state**, and no entry is tagged to a
      milestone that will not wire it.
      **Second half verified 2026-09-20 and mechanically held.** The registry
      has SIX entries, tagged `M13` (x2), `M19`, `M9` (x2) and `unplaced` — all
      real open milestones or the honest value; nothing points at a milestone
      that will not wire it, and `preview-registry.test.ts` fails on an orphan
      in either direction. `DRIFT.md` §3 is resynced to match.
      **First half is not ticked from here.** "Every surface the handoff owns"
      is a claim about the whole design file, and the only honest way to close
      it is the route-to-artboard walk link 0 built the index for — not an
      assertion that each of links 1-10 landed, which is what I would be
      substituting. It belongs with the four `[walk]` boxes.
- [~] `DRIFT.md` is updated by this milestone, not left for the design side.
      **Part done 2026-09-20 (link 9's resync).** §3's entry count is now the
      registry's real SIX, not eleven — with the four separate reasons five
      entries left, and without the stale closing line calling
      `wizard-longer-chip` the only purely-unbuilt-UI shell (it shipped).
      D11 is CLOSED with the opposite resolution to the one it asked for:
      Mitchell placed the shells rather than dropping them. D6 is HALF closed —
      the countdown built, the selection left to KI-034. *Suggested order*
      items 1 and 3 are struck (D12 and D13 closed by links 1c, 6a and 6b).
      **Still owed on this box:** D14, D3, §3b's `w-open` line, §7's
      *21-designed / 7-registered* figure, and the four places the build is
      ahead of the design.
      **Closed:** D12, D13, D14; D3 decided either way. **Resynced:** §3's entry
      count (six, not eleven), **D11 and *Suggested order* item 3 (both already
      closed by decisions D-A/D-B)**, §3b's `w-open` line (shipped), and §7's
      *21-designed / 7-registered* figure (13 primitives, 20 presets). **Sent
      back:** the four places the build is ahead of the design — the
      pending-webhook state, the plans-unavailable state, the stale-version
      conflict, and the phone loading/failed regions.
- [x] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — **not** `test:e2e` (CLAUDE.md
      rule 1). **Green 2026-09-20**, AGENTS.md's Tier 3 run, once:
      `pnpm check` EXIT 0 (typecheck, lint, 3427 web unit + every package +
      the `node --test` scripts suite, and 789 integration tests across 62
      files against a real Postgres); `pnpm --filter web test:e2e:ci-like`
      **150 passed, exit 0**; `pnpm seed:verify` EXIT 0.
      Exit codes checked, not the `Tests` line — this branch has already been
      bitten once by a run that printed `3349 passed` and a separate `Errors 1`
      below it, and once more by `useAiEntitled` throwing five unhandled
      rejections while every assertion passed.
- [x] Wave 1 retro appended here. **2026-09-20:**

### Wave 1 retro

**The thing that kept happening: a test that asserted nothing.** Six of them,
across links 7, 10 and 13, every one found by CLAUDE.md rule 3 and none by
reading the diff. They fell into three shapes worth naming, because the shapes
recur and the instances will not:

1. **Asserting a rendered artefact the broken code never produces either.** The
   docked-drag test checked an inline style that a docked panel does not carry
   whatever the drag does; the unmount test checked that no second `new Map`
   appeared, when the effect that would build one was gone anyway. Both passed
   with the code they tested deleted. The fix in both cases was to assert the
   MECHANISM (`vi.getTimerCount()`, a position surviving a remount) rather than
   its visible consequence.
2. **Two overlapping guards, so neither is load-bearing.** `typeof x ===
   "number"` beside `Number.isFinite(x)` meant deleting either left the suite
   green. The redundant one went.
3. **A fixture whose defaults happen to match the assertion.** The
   two-surfaces test rerendered a hook whose state was already right in memory,
   against a second surface whose default was the same value.

**The second thing: green is an exit code, not a line of output.** Twice. A run
printed `3349 passed` with `Errors 1` below it, and `useAiEntitled` threw five
unhandled rejections while every assertion passed. Both were reported as green
before the exit code was read. Every verification line in this milestone's
commits after that says EXIT 0 because of it.

**What the milestone's own machinery caught that review did not.** The lint
wall refused an inline style that had been spread past it as a conditional
object — the disable came back "unused", which is how the smuggle was
noticed. `apiClient.test.ts`'s totality witness caught `leaveTrip` missing from
its table. `phoneTouch.test.tsx` caught the 44px sweep silently turning
`size: "touch"` from "44px everywhere" into "44px on a phone". The colour wall,
the KI citation wall and the case-collision wall each refused something. None
of that was judgement; all of it was a mechanism somebody built earlier.

**Three decisions taken rather than escalated**, all recorded in `DRIFT.md` for
the design side to accept or push back on: the notebook offers no Dock (docking
a centred measure costs 356px of the reading column); §29's
`visibility: hidden` is delivered by the state outliving the unmount, because
`/plans` has nothing in its tree to hide; and the Map lens keeps its rail out of
the failed AND empty canvas, matching a call already made one state over.

**One claim corrected mid-flight.** `relativeCalendarDays` was documented as
needing UTC because local-time arithmetic "rounds to the wrong day twice a year"
across DST. It does not — `Math.round` absorbs an hour over a span of days, and
the DST test was watched to PASS against a deliberately local-time
implementation. The note now says what UTC actually buys.

---

# WAVE 2 — the phone is a surface

## What is already true, so nobody rescopes it

Four phone surfaces are **built to spec** and are not this wave's work:

- **The tab bar is route-derived**, exactly as §22 asks — `tabsForScope(inTrip)`
  at `PhoneTabBar.tsx:70-72`, `activePhoneTab` at `:113-129`, the
  `--color-brand-tint` 46×26 pill at `:279-284`. **SPEC §16's five-tab list is
  stale**; §22 supersedes it and both the build and the living design file are
  on §22. Do not re-add a fifth tab.
- **The Ask pill and its sheet** (§23), with scope derivation in its own module
  and eight e2e tests.
- **The Map day strip** — a genuinely different component tree at
  `MapLens.tsx:773-790`, not a restyle.
- **The Notebook's index→page push, bind sheet and one-sheet insert** (§19),
  six e2e tests. **DRIFT §8's "the phone Notebook has one hardwired widget" is
  stale** — closed on both sides.
- And on the signed-out side, **the phone front door** (§28), with all three of
  its build notes implemented and annotated.

## Why the rest is a wave and not a fix

The build has **no surface concept**. The design models the phone as an
explicitly-picked second layout tree (`surface: 'phone'`, ~20 branches); the
build is one responsive tree with a 768px line and **thirteen files** carrying
any phone gating at all. SPEC §13 is explicit that this is intended: *"the two
layouts are picked explicitly, not by media query."*

`docs/guidelines/design-system.md` says layout below 1024px is best-effort
*"until the mobile milestone"*. `KI-046` says *"building that is a milestone,
not a fix."* `TODO.md:1030-1037` says *"no milestone in this file owns the phone
at all… placing the phone is a milestone-sized decision."* **Three independent
places in this repo have been waiting for this wave to be minted.**

## Where the phone edits — sequenced 2026-09-19, and no longer open-ended

**The question.** `TODO.md:1048-1054` — §24 deleted the Timeline lens, and the
Timeline lens **was** the phone's editing surface. The same bundle now says both
that Plan (day columns) is the only surface that edits **and** that a phone
cannot render day columns honestly (§10). Built as the design states it on
Mitchell's call (2026-09-12: *"Lets just build the plan as is for now, and when
its ready we will figure out where editing moved to"*), so a phone renders day
columns at 390px today — *"a known, accepted, temporary state rather than an
answer."* KI-046's surviving symptom is exactly this surface: **82px of text
column inside a 364px card**, a one-line note wrapping to 121px tall.

**Mitchell, 2026-09-19, asked where the phone edits:** *"Phone edit is right
after."*

**What this file takes that to mean, stated so it can be corrected cheaply
rather than assumed silently.** Link 13 is **sequenced, not blocked**: it runs
immediately after the rest of Wave 2 rather than waiting on an open-ended
product decision, and the question of *what* the phone's editing surface becomes
is answered **at that point**, by design, with the rest of the phone already
built underneath it. That ordering is the useful half of the answer either way —
every other phone surface lands first, so the decision is made against a phone
that works rather than against a hypothesis.

**What it does not settle**, and what whoever opens link 13 still owes: whether
Plan gets a genuine phone treatment, or whether §10 is amended to say a phone
*can* render day columns and the 92px time gutter is what goes. `TODO.md`'s
standing line holds until one of those is written down — *"whoever picks this up
owes either a phone treatment of Plan or a design decision that §10 no longer
holds."*

**So Wave 2 runs 11 → 12 → 14 → 15 → 16 → 13**, with link 13 last and no link
blocked. The one thing not to do is paper over it early: the build deliberately
did not ship a phone-only fallback view, and it should not start now.

## Link 11 — The phone account screen, and Plans' phone treatment

§34.3: *"A build owes no new endpoint for any of it: the phone calls exactly
what the desktop calls."* Confirmed — every section self-fetches from routes
that are surface-agnostic.

- **Account is a screen, not a rail.** Today the desktop `Sheet` opens at 640px
  over a 390px page, from a 224px popover, with no tabs and no `Done`. §34.3
  makes it a **task**, so it takes the whole frame and **the tab bar steps
  aside**. Same three tabs at 44px; **Sign out below them** (this is where the
  design does put it — see link 1's open question).
- **Plans gets its phone treatment.** One correction to §34.3 for the record:
  its claim that a phone CTA *"put a phone user on a blank screen"* **is not
  true of this build** — `PlansScreen.tsx:508` stacks the three cards and
  `PlanComparison.tsx:116` scrolls the table, both deliberately. What is missing
  is the `‹ Account` back header, the 44px floor, and tab-bar suppression on
  `/plans`.

**Link 11 landed 2026-09-20.** What the next links inherit:

- **`taskOwnsScreen(pathname)` in `PhoneTabBar.tsx` is the "a task owns this
  screen" rule**, and links 14 and 15 both need it rather than a second copy.
  It holds `/account` and `/plans` today. It is deliberately a short explicit
  list and **not** "anything that lights no tab" — `/invite/<token>` lights no
  tab and is still a view, so it keeps its bar.
- **The height effect runs even when the bar is hidden.** The bar publishes
  `--phone-tab-bar-height` on `documentElement` and the layout's inset reserves
  it; the inset is the bar's *sibling* and cannot see that it is gone, so a
  stale value reserves 83px at the foot of a screen with no bar in it. The
  `if (hidden) return null` sits **after** the hooks for that reason.
- **Sign out now exists in exactly one place per surface**, which is both halves
  of link 1's decision: the avatar popover on desktop, the account screen on a
  phone (`md:hidden`), because §34.3 makes that screen a task with no popover
  over it.
- **The 44px floor is applied where money moves, not everywhere** — the plan
  cards' Choose, the confirm pair, the back link, and the account tabs. Link 14
  still owns the sweep; these were taken early because they are the controls a
  phone user taps to spend.

---

## Link 12 — Phone Playbooks

The tab bar routes phone users into Playbooks on every non-trip route, and
Playbooks has **no phone treatment at all** — `grid-cols-1 sm:grid-cols-2
lg:grid-cols-3` is the entirety of it. §16 asks for full parity: the sticky
header with tabs and search, a one-column card list, and **one** filter bottom
sheet rather than a stack of popovers (rule 3), holding filters **and sort**
with **scope deliberately outside it** — a place is not a sheet setting. The
shared day's map collapses behind a *Show route* row.

Link 2 makes this tractable: the chips, the sheet groups and the filter count
are the same model at a different density.

**Link 12 landed 2026-09-20, except for one item it cannot reach.**

- **One filter bottom sheet**, holding filters **and sort**, with scope
  deliberately outside it. The desktop's chips-and-popovers row and the phone's
  single sheet are **both rendered, one hidden by CSS** rather than switched on
  `useIsPhone()` — that hook starts `false` on the server and the first client
  paint by design, so a JS-gated row shows the desktop shape for one paint on a
  phone and then swaps. They share one `filters` state; there is a test that
  they cannot disagree.
- **The header is sticky below `md`**, bleeding `bg-paper` to the page edges
  while its content keeps the container's gutter.
- **The one-column card list was already right** — `grid-cols-1 sm:grid-cols-2
  lg:grid-cols-3` — and is not this link's work.

**NOT DONE: *"the shared day's map collapses behind a `Show route` row."*** It
is blocked on link 4's rendering, which does not exist — there is no map on the
shared day to collapse. When link 4 lands, this row is its phone treatment and
belongs in the same change. Flagged here rather than silently dropped, because
the Wave 2 gate asks for it.

---

## Link 13 — Plan on a phone *(LAST, by Mitchell's sequencing — see above)*

Carries KI-046's surviving symptom: **82px of text column inside a 364px card**,
and a one-line note that wraps to 121px tall. It runs **after every other Wave 2
link**, so the decision it needs is made against a phone that otherwise works.

**Do not build a phone-only fallback view to paper over it** — the build
deliberately did not, and it should not start now. This link ends in one of two
things and the file it changes is different for each: **a phone treatment of
Plan** (§13's flush 3px city spine, the 92px desktop time gutter dropped, cards
that give the text column its width back), or **a recorded amendment to §10**
saying a phone can render day columns after all. Write whichever one down before
writing code, per link 0's guideline.

**Its own gate box is the only one in this milestone that is a measurement**,
because KI-046 is a measured entry and is amended by measurement, never by an
impression that it looks better.

### The measurement, taken 2026-09-20 at 390x844

Against a production build, through Playwright, on a trip's Plan with a title
long enough to fill the column:

| | KI-046 (2026-09-05, 412px, Timeline lens) | Now (390px, day columns) |
|---|---|---|
| Card width | 364px | **241px** |
| Text column | 82px | **141px** |
| Share of the card | 22.5% | **58.5%** |
| Row controls | 42x28, 43x28 | **32x32** |

**The starved column is better and the card is worse, and both have the same
cause.** The 92px time gutter is gone — it went with the Timeline lens (SPEC
§24) — which is what took the text column from 82px to 141px without anybody
working on it. But the card shrank from 364px to 241px, because the phone
renders the DESKTOP board: `Column` is a fixed `DAY_COLUMN_WIDTH_PX = 268`
inside a horizontally scrolling row, at every width. A 390px phone is showing
one and a bit 268px columns side by side.

**The row's Edit and Remove are 32x32**, under §13.1's 44px floor. Link 14's
pass did not reach them — it covered chrome, and these are inside a card.

### The decision: a phone treatment of Plan, not an amendment to §10

The milestone allows either. The measurement chooses, and it chooses the
treatment, for one reason that is not a matter of taste: **the card is narrow
because of a desktop layout constant, not because a phone is narrow.** 390px is
enough for a readable card; 268px of it is being spent on the next day's column,
which a phone cannot usefully show beside this one anyway.

§13.4 already specifies the answer and the build already has every piece of it:
*"The day rail never collapses. It is the spine of every trip-scoped screen and
holds the same selection across Plan, Map and Notebook. **A phone can hold one
day at a time; the rail is how you change which.**"* `DayChips` IS that rail,
`FocusProvider` already holds the selection across Plan, Map and Notebook, and
the phone already defaults to day 1. What is missing is only that Plan renders
every day instead of the focused one.

So: **on a phone, Plan renders the focused day's column alone, at full width.**
No new view, no phone-only fallback — the same `Column`, the same cards, the
same drag logic, at a different width and a count of one. That is §13's
"mobile is a variant layer", not a second design system.

**Amending §10 was the alternative and is refused**, because §10 is not what is
wrong: it says a phone gets two views rather than four and scopes it to
retrieval and small edits, all of which the build honours. Nothing in §10 says
a phone shows several days at once — that is `DAY_COLUMN_WIDTH_PX` leaking
through a breakpoint nobody drew.

### Built 2026-09-20, and re-measured

| | KI-046 (412px) | Before link 13 (390px) | **After (390px)** |
|---|---|---|---|
| Card width | 364px | 241px | **315px** |
| Text column | **82px** | 141px | **215px** |
| Card height, that title | 121px | 131px | **91px** |
| Row controls | 42x28 / 43x28 | 32x32 | **44x44** |

`Board` takes `oneDay`; `Column` and the trailing "One more day?" take
`fullWidth`. The row becomes a flex COLUMN on a phone, because with one
full-width day there is nothing to scroll sideways.

Three decisions inside it worth not re-deriving:

**The day's index survives the filter.** Every day's accent, its `dayLabel`,
its focus ring and its keep-a-day pennant are keyed on its real position in the
trip, so the single day is selected by index rather than re-mapped — a
re-indexed day silently becomes Day 1 of a fortnight.

**"One more day?" appears only at the end of the trip on a phone.** With one day
on screen it is no longer a column past the last one; under Day 3 of a fortnight
it asks a question about somewhere the reader is not.

**The 44px floor came from widening `PHONE_TOUCH`, not from a new class.** It
was `min-h-11 md:min-h-0` — height only, which is enough for every control that
carries a label and exactly half a target for an icon-only one. `size: "touch"`
had already made the both-axes call for the same reason and said so in its own
note; the two now agree, and labelled call sites are unaffected because a button
with words in it already exceeds 44px wide.

`e2e/m26-phone-plan.spec.ts` holds all of it, in the only layer that can measure.
Its floor is 180px rather than 215px deliberately: it holds the ORDER OF
MAGNITUDE this link changed, not a pixel count a font metric would make brittle.
Both halves seen to fail against a real browser (CLAUDE.md rule 3): `oneDay`
pinned to `false` gives 117px where 180 is wanted, and dropping `PHONE_TOUCH`
gives a 32px target where 44 is.

## Link 14 — The 44px pass, and the chrome that owes it

`button.tsx:32` defines `touch` correctly, cites §13.1 verbatim, and has **five
call sites in the entire application**: the sheet's own header buttons, the Ask
pill, the assistant rail, and the front door. Against that, KI-046 measures
**191 of 211 controls under 44px (91%)** on one trip screen — `Ask` 42×28,
`Edit` 43×28, `Add stop` and `History` 36px tall.

Wide but shallow: the primitive exists, the surfaces are enumerable, and two
hand-rolled substitutes (`NewTripWizard.tsx:55`, `PhoneTabBar.tsx:178`) fold
into it. Also here: **the tab bar hides when a task owns the screen**
(`(app)/layout.tsx:29-34` mounts it unconditionally; `/plans` renders it over a
screen the design says has none), and **the phone Map tab's offline state**,
which §13 designed and `MapLens.tsx` has zero hits for.

**One deviation to record rather than fix.** §16 asks for `min-content` grid
scrollers *"because it was got wrong once"*; the build uses flex with `shrink-0`
per child. **Same guarantee, different mechanism.** Write it down in the
guideline and move on.

## Link 15 — New trip is a full screen on a phone (§32.2)

A `Sheet` today at every width. §32.2 wants a full-screen conversation with a
*Cancel · New trip · Empty* header, the tab bar hidden while it is open, and
first-run rendering in-frame. The 44px inputs are already there via
`NewTripWizard.tsx:55`.

## Link 16 — The phone lane stops being two specs

`playwright.config.ts`'s `phone` project (411×852) runs exactly
`m16-mobile-assistant` and `m14-mobile-notebook`. **Nothing else is phone-tested
— not the trips list, Plan, Playbooks, the shared day, Plans, account, trip
settings, Download or Import.** The `narrow` project sits at 1100px, *above*
KI-046's band by construction.

Add coverage for what Wave 2 builds, and only for that. **Do not pin link 13's
surface while its design question is open** — a test written over a state
everyone agrees is temporary is a test that will have to be argued with later.

---

## Wave 2 exit gate

- [x] **[walk]** The phone has an account screen: full frame, three tabs at
      44px, `Done` returns to Trips, **the tab bar is not on it**, and Sign out
      sits below the tabs. **WALKED 2026-09-20** at 411×852 by
      `m26-phone-surfaces.spec.ts`: the bar is asserted VISIBLE on Trips first
      and hidden on `/account`, so its absence is a measurement rather than an
      assumption; the tabs are measured with `boundingBox()` against 44; and
      `‹ Trips` is followed back to a screen that has its bar again.
- [~] **[walk]** Every CTA that points at Plans — Change plan, the invite gate,
      the token gate — lands on a phone screen with a `‹ Account` way back, and
      the tab bar is absent there too. **The DESTINATION is walked** (2026-09-20):
      `/plans` at 411px has no bar, a 44px `‹ Account` that lands on the Plan &
      usage tab, and does not scroll sideways. **The three CTAs themselves are
      not** — each needs its own entitlement state to reach, and that is the
      walk this box still owes.
- [~] **[walk]** Playbooks on a phone: tabs above the search, a one-column list,
      and **one** filter sheet holding filters and sort with scope outside it.
      The shared day's map is behind a *Show route* row. **The filter sheet half
      is walked** (2026-09-20): one sheet, the desktop chip row absent, sort
      inside it, scope outside it and still a tab after the sheet closes, and no
      sideways scroll at 411px. **The *Show route* row is blocked on link 4** —
      there is no map on the shared day to collapse.
- [~] **[walk]** New trip owns the whole frame with a `Cancel · New trip ·
      Empty` header and no tab bar. **Two of the three done and WALKED,
      2026-09-20** — the sheet is measured against the viewport width at 411px
      and the bar is asserted hidden behind it.
      *Full frame*: `(app)/page.tsx` passes `size="full"` below the phone
      breakpoint — `useIsPhone()` is correct here and wrong for chrome, because
      this sheet only renders after somebody presses New trip, long after the
      first paint the hook is false for. *No tab bar*: already true and not new
      work — the sheet's `.overlay-layer` is `z-60` over the bar's `z-20` and
      Radix `aria-hidden`s the page behind it, so the bar is hidden both
      visually and to assistive technology.
      **NOT done: the `Cancel · New trip · Empty` header.** `SheetActions`
      requires `onSave`, so opting into that header always renders a third
      button — and *Create empty* lives inside `NewTripConversation`, wired to
      `submit(false)` over local `name`/`submitting`/`disabled` state. Putting a
      second one in the header would be project rule 4; doing it properly means
      lifting that exit out of the conversation, which is a restructure of that
      component rather than a prop. **Whoever takes it: move the exit, do not
      duplicate it.**
- [x] **A re-measurement of KI-046's own numbers on the surfaces this wave
      owns**, reported as a figure and not as an impression — the entry was
      written from measurement and is amended by measurement. **KI-046 is
      amended, not closed**, unless link 13 landed. **It cannot be closed from a
      class scan.** KI-046's 191-of-211 came from rendered heights in a browser;
      counting `min-h-11` in the source would be a different claim wearing the
      same number.
      **DONE 2026-09-20, from rendered heights in a browser**, seven phone
      routes at 411x852 against a production build:

      | | under 44px |
      |---|---|
      | KI-046, 2026-09-05 (one trip screen, 412px) | 191 of 211, 91% |
      | Before the sweep | **48 of 91, 53%** |
      | After | **4 of 91, 4%** |

      The denominators differ — KI-046 counted one screen on a build with four
      lenses and a Timeline card carrying Ask and Edit per stop, and §24 deleted
      that lens. KI-046 says the same of its own two figures.
      **All four that remain are MapLibre's own attribution**, which is a
      decision rather than a miss: the credit is legally required and the
      library styles it.
      **THE SWEEP WAS NOT DONE WHEN LINK 14 SAID IT WAS**, and this box is how
      that was found — 53% is what a milestone that had already claimed the
      44px pass measured. It is finished now, through three primitives rather
      than N call sites: `buttonVariants`' base, `Input`'s base, and
      `PHONE_TOUCH` for the elements styled like controls without being them.
      `e2e/m26-phone-targets.spec.ts` keeps counting, and prints the offending
      list rather than a bare number.
- [x] **[walk]** Link 13 has either given Plan a phone treatment **or** put an
      amendment to §10 in writing — and the text column's width at 390px is
      reported as a **number**, against KI-046's 82px-of-364px. It runs last, so
      this box is the wave's closing one.
      **Done 2026-09-20: a phone TREATMENT, and the number is 215px of a 315px
      card** (was 141px of 241px before this link, and KI-046's 82px of 364px
      before the Timeline lens was deleted). Measured through Playwright against
      a production build at 390x844, with a title long enough to fill the
      column — KI-046's own figure was an available-width measurement.
      **Why a treatment and not an amendment:** the card was narrow because of a
      DESKTOP constant, not because the screen is. `DAY_COLUMN_WIDTH_PX` is a
      fixed 268px at every width, so a 390px phone showed one and a bit columns
      side by side. §13.4 already specified the answer and the build already had
      every piece of it.
      Ticked rather than left `[~]` because this box asks for a number and the
      number is measured, not walked — and `e2e/m26-phone-plan.spec.ts` keeps
      measuring it.
- [x] The phone Map tab has an offline state: a titled panel, the
      stops-are-still-readable message, *Try again* and *Open Plan*. **Built
      2026-09-20** as `lenses/MapOfflineState.tsx`, mounted by `MapLens` behind
      MapLibre's `error` event. Two things worth knowing: it is an **overlay
      over the canvas, never a conditional around it** (a React conditional
      detaches the node mid-style-load and the load aborts silently — DRIFT §6
      build-check 5, third recurrence), and *Try again* rebuilds by bumping an
      `attempt` in the mount effect's deps rather than by flipping a flag,
      because a MapLibre instance whose style failed cannot be retried in
      place. Link 4's shared-day map mounts this same panel rather than wording
      a second one differently.
- [x] The `phone` Playwright project covers every surface this wave built, and
      **does not** pin link 13's layout while its question is open. **It also
      owns three claims the unit layer tried to make and could not**, each one
      a class swap that jsdom has no layout or media queries to judge: that
      `/account`'s sign out and `‹ Trips` are phone-only, that the account tabs
      are 44px there, and that the new-trip sheet is full-frame below the
      breakpoint. The lint wall refused all three at the unit layer, correctly.
      **Done 2026-09-20: `e2e/m26-phone-surfaces.spec.ts`, 8 tests, RUN AND
      GREEN at 411×852 against a production build** (`pnpm build` then the
      `phone` project — the `ci-like` lane, not `test:e2e`). This is the first
      real browser evidence in the whole of M26, and it earned its keep on the
      first run: two tests failed because they called `openAccountPage` without
      navigating first, so they sat at `about:blank` waiting for a header that
      was never rendered. My spec's defect, not the product's — but the point
      stands that nothing before this had been opened at all.
- [x] `DRIFT.md` §8 is updated: the stale phone-Notebook bullet struck, and the
      two states the **design** still owes (the phone conflict state, and the
      loading/failed regions for tokens and plan) stated as design-owed rather
      than build-owed. **Done 2026-09-20.** The Notebook bullet is struck — §19
      closed that gap on 2026-09-03 and §3b's own entry already said the bullet
      was *"kept because it dated the gap"*, which made a closed gap read as
      live for two passes. Both remaining states are now marked DESIGN-OWED
      with the reason: link 7 built §3b's primitives, so the token and plan
      regions are short work once somebody DRAWS them — `LOAD_PLAN` names nine
      regions and neither of those is one. The phone conflict state is named as
      the wave's one genuine design debt: it is the only one of rule 6's three
      the design has never drawn.
      One bullet ADDED that should have been on the list already: a phone
      rendering the desktop day-column board, closed by link 13.
- [ ] The full Definition of Done is green, including `test:e2e:ci-like`.
- [x] Wave 2 retro appended here. **2026-09-20:**

### Wave 2 retro

**The measurement box did its job, and what it caught was this milestone.** The
gate asked for KI-046's numbers re-measured "as a figure and not as an
impression". The figure came back **48 of 91 controls under 44px (53%)** — on a
wave whose link 14 had already claimed the 44px pass. Nothing else would have
found that: the primitive existed, five call sites used it, and every review of
those five would have said the pass was done.

**A number needs a denominator and a method, or it is an impression wearing a
figure's clothes.** KI-046's 191-of-211 was one screen at 412px on a build with
four lenses; this wave's 48-of-91 is seven routes at 411px on a build where §24
deleted one of them. They are not comparable and both entries now say so. The
same care applied to link 13: its first measurement read the width of a SHORT
title rather than the width available to text, and would have reported 87px
where the honest figure was 141px.

**Two measurements, twice each, because the first build was stale.** The
`ci-like` lane builds `.next` and serves it; a source edit after that build is
invisible to a measurement taken against it. Both of link 13's figures were
taken twice for that reason, and the second time is the one in the record.

**A census that passes in isolation is not a census.** `m26-phone-targets`
passed alone and failed twice in the full lane, each time for a real reason: the
lane's other specs seed Playbooks and trips, so cards render that an empty
account never had. Four more row actions were found that way. They were FIXED
rather than added to the exception list, which still has exactly one entry —
MapLibre's own legally required attribution — because an exception list that
grows whenever the number is inconvenient is how a measured entry turns back
into an impression.

**Link 13's answer was in the spec the whole time.** §13.4 says "a phone can
hold one day at a time; the rail is how you change which", `DayChips` was
already that rail, and `FocusProvider` already held the selection across three
surfaces. The only thing missing was that Plan rendered every day. The card was
narrow because `DAY_COLUMN_WIDTH_PX` is a desktop constant at every width — not
because a phone is narrow — and the fix was a count, not a layout.

---

## Deliberately not here

- **Reviews, ratings and everything that reads them.** The shared day's rating
  rail and 5→1 histogram, the review form and its three states, Discover's
  rating floor and its `highest-rated` / `most-reviewed` sorts, the leaderboard
  row's rating clause, and the profile's average rating and reviews-received
  are **M12's**, and they are blocked on a table that does not exist.
  `DiscoverScreen.tsx:36-41` already states this in the code. **If this
  milestone's diff adds a rating control, project rule 2 has been broken** — a
  control over data that does not exist is a control that does nothing.
- **Per-stop attribution.** `rack-provenance` and `add-stop-who` are **M13
  link 5's**. The map rail, the shared day and the hover card do not need them
  and must not add their own field.
- **Cost classification.** `cost-estimate-state` and `budget-breakdown` are
  **M19's**, minted for exactly these on 2026-08-31.
- **The Notebook's widget framework, and the ghost above all.** A dropped-in
  widget should render **as the shape of its value** (`$XXX`, `NN rows`, its
  real sentence) and fill in **per part** as inputs bind. None of that exists —
  every unbound case collapses to one `EmptyChip` with a short label, so there
  is no shape, no monospace, no hatch and no dashed underline. The **four
  states are correctly built as a resolver contract** (including the hard one:
  a deleted day gives `unbound` and **never falls back to Day 1**); what is
  missing is the entire rendering layer. That, `NotebookBlock`'s declared
  columns, the repeat's dashed rail, and `WidgetSettings`' missing *Wording*,
  *Remove* and numbered multi-entry are all **M14's**, which owns the whole
  Notebook redesign.
  **Two of them are questions, not tickets, and M14 should carry them as
  such:** whether ghosts are editing-only (SPEC §21 says this needs the build's
  sign-off and it is **still unanswered**), and what the Save-a-day dialog's
  four *Include* chips do to the snapshot (the design says they only toast).
  **`w-open` is already registered** and needs nothing here. And the catalogue
  gap is largely closed — 13 primitives and 20 presets, not the 7 DRIFT cites —
  leaving §18's author-supplied repeat template as the one real hole.
- **`Ask` in read-only.** §27 requires it — *"a reader with a question is the
  most likely visitor the demo has, and answering is not changing"* — and the
  build removes the assistant from `/demo` in four places while the server 403s
  it. That is **not an oversight**: `KI-079` records that a viewer-gated `/ask`
  would be an unauthenticated internet-facing model proxy on the operator's key,
  with one shared quota bucket and a Postgres write on a path ADR-031 keeps
  DB-free. **Three product decisions have to land first** — who pays, whether
  `/demo` may touch Postgres, and what an anonymous prompt may reach — and
  KI-079 is carried by **M9**.
- **Home time on hover** (§12, the Profile tab). It needs a `UserPreferences`
  field, a column and a migration — and **timezone infrastructure that does not
  exist anywhere in this repo**, plus a `trip.tz` that does not exist either
  (`packages/contracts/src/identity.ts:49-56` says so). The control alone would
  be a toggle that does nothing, which is worse than its absence. **Recorded as
  blocked; not built.**
- **Real collaborator names on the plans confirm step** (§29). It needs account
  scope to read trip membership, which this repo has deliberately avoided, and
  the build declines it in an argued comment (`PlansScreen.tsx:611-618`).
  **Settle whether §29 really wants that read** before anyone builds it.
- **A tablet.** Out of scope, Mitchell, 2026-09-12. KI-046 is actionable on its
  phone half only.
- **Routing on the map.** Straight lines, as M10 decided. Nothing in this
  milestone needs a directions API.
- **`ApiToken.lastUsedAt`.** It is on the contract, deliberately five-minute
  coarse, and rendered by **nobody** — neither the design nor the build. Either
  it gets a column in the token table or someone says out loud that it is not
  shown. **Not decided here.**

## The design is stale here — do not "fix" these back

Fifteen places where the build is right and the handoff is behind — sixteen
since link 11 added one of its own, numbered 0 because it was found rather than
surveyed. Link 0's
guideline should say that finding one of these is a **normal outcome of a parity
pass, not an anomaly** — and that the answer is an amendment to the handoff, in
the same PR, not a regression in the code.

0. **§34.3's *"put a phone user on a blank screen"* — CONFIRMED FALSE of this
   build, 2026-09-20, when link 11 opened.** The claim is that every CTA
   pointing at `/plans` stranded a phone user. It did not:
   `PlansScreen.tsx`'s chooser stacks its three cards at one column and
   `PlanComparison.tsx` scrolls its table horizontally, both deliberately and
   both commented as such — the comparison table's own note explains why the
   width comes from `whitespace-nowrap` on the cells rather than a `min-w-`
   arbitrary value. What was genuinely missing on that route was the `‹ Account`
   header (link 1e), the 44px floor and tab-bar suppression, all of which link 11
   built. **Amend the sentence, do not build a phone Plans screen that already
   exists.**
1. **`$N each` / `Budget each`** — retired on Mitchell's instruction.
2. **The Discover empty-state copy still blames the `Season` filter** §33.2 cut.
3. **SPEC §16's five-tab phone bar** — superseded by §22, which both the build
   and the design file already follow.
4. **§33.1's "a real API should carry `day` as a field"** — it already does
   (`SavedStop.dayIndex`), 0-based, with a gap meaning an empty day.
5. **DRIFT §8's phone-Notebook bullet** — closed on both sides.
6. **DRIFT §3's eleven shelled surfaces** — there are six, and five of them are
   blocked on a missing field or feature. **Zero are purely unbuilt UI**, which
   inverts the section's conclusion.
7. **DRIFT D11's two orphaned wizard shells** — resolved by decisions D-A and
   D-B on 2026-09-16; both are built. *Suggested order* item 3 goes with it.
8. **DRIFT §3b's "one registry addition owed: `w-open`"** — shipped.
9. **DRIFT §7's "21-designed / 7-in-registry catalogue gap"** — 13 primitives
   and 20 browsable presets after ADR-039.
10. **§34.3's "Plans put a phone user on a blank screen"** — it stacks and
    scrolls today, deliberately.
11. **§29's "return-from-Stripe-before-webhook has no design yet"** — the build
    has one (`PlansScreen.tsx:757-795`), with a forged-session-id guard and a
    `sessionStorage` baseline. **Send it back to design for adoption.**
12. **§29's undrawn plans-unavailable and stale-version states** — both built
    (`:401-407`, `:330-338`).
13. **§30.1 and §32.3 still list a `who` turn** that was dropped on Mitchell's
    instruction on 2026-09-15 and is recorded as a deliberate delta in
    `newTripScript.ts:20-30`.
14. **The Save-a-day spec still describes the expanding "Kept" label**, removed
    on Mitchell's instruction on 2026-09-06 because at 412px it pushed
    *Add stop* onto a second line.
15. **§18's two-step insert sheet** — superseded by a one-step picker, because
    ADR-039 decision 2 makes an unbound filter mean *everything*, so every row
    is ready as soon as it lands. Convergent, not drift.

**And two places the design disagrees with itself**, which only the design side
can settle: the empty-home hero (a dashed "No trips yet" card) versus §32.1's
first-run conversation — the build followed the newer one; and §9's
*"the user picks"* against §10's phone scope, which link 10 has to land on one
side of.

## Open questions this milestone must not answer silently

Each of these is a decision, not a task. They are listed here so a build does
not resolve one by accident and call it an implementation detail.

**Four of the original nine are now answered and are kept here struck rather
than deleted, because each was load-bearing enough that a later reader will want
to know it was asked.** Two were answered by Mitchell when the milestone was
scoped; two more (3 and 4) were settled when link 1 opened, which is the rule
this milestone set itself — settle it *before* the code, and write down why.

1. ~~**Does the Map rail get a hover state at all?**~~ **ANSWERED — yes.**
   Mitchell: *"the idea being is if you want more info you can move your mouse
   over and hover or move your mouse out to see the ui witout the hover."*
   Detail on demand, not a second selection cue — and on that reading the
   build's no-hover-tint rule and the design's card are **compatible**, so
   nothing is deleted. Link 5a.
2. ~~**Where does the phone edit?**~~ **SEQUENCED — link 13 runs last in Wave 2**
   (Mitchell: *"Phone edit is right after."*). Not blocked; the design answer is
   owed when that link opens, against a phone that otherwise works. The
   substance — a phone treatment of Plan, or an amendment to §10 — is still to
   be written down, and link 13 says which file each lands in.
3. ~~**Sign out: popover, account page, or both?**~~ **ANSWERED — the popover on
   desktop, and the phone account screen's own.** `/account` has no Sign out.
   The desktop artboard has none either; §34.4's sentence is about the phone
   screen, which has no popover to hold it. Link 1, and the reasoning is there.
4. ~~**Is there an account-level currency?**~~ **ANSWERED — no, and not
   deferred.** Currency stays per-trip. Every other Profile field is a property
   of the reader with no per-trip counterpart; a currency is a property of where
   the trip happens and the trip already carries one, so an account default
   would owe a precedence rule nothing has asked for. Link 1.
5. **Is the day chip rail on the Map tab?** §24 reversed §12 without re-arguing
   the map case, and the build's reason for hiding it is the one §12 acted on.
6. **Does the trip status badge stay?** D3, unchanged for three weeks. It reads
   *"Active"* beside every trip name.
7. **May "on foot" be inferred from `kind === "transit"`?** It is the only
   proxy available before `map-legend-modes` gets an owner, and shipping it
   states something the data does not.
8. **Does `ApiToken.lastUsedAt` get a column in the token table**, or does
   someone say out loud that it is not shown?
9. **Should `Duplicate` clear dates for `cloneSharedTrip` and `cloneDemoTrip`
   too**, or only for the Home popover's verb?

## Prerequisites

**M23, and it is closed.** Link 3 is the surface for the row shape M23 landed.

**M22 and M25, and both are closed.** Link 1 moves M22's token surface; link 6
moves M25's download.

**M11b, and it is closed.** Links 2, 3 and 4 all render what M11b published.

**Not blocked on M13.** This milestone deliberately touches none of M13's
scope, and M13 is the current milestone. **Where this runs relative to M13 is
Mitchell's call.** The argument for going first is that M13 adds a second actor
to surfaces this milestone is about to rebuild, and rebuilding them twice is the
cost of the other order. The argument for going second is that M13 is already
current and has a preflight of its own waiting.

**One thing it owes forward:** M12 renders reviews into the shared day's rail
and Discover's header — **both of which this milestone rebuilds**. If link 2 and
link 3 land first, M12 adds rows to a finished surface. If they do not, M12
builds its rating rail into a layout that changes underneath it. That is the
same argument M23 made for running before M12, and it points the same way.

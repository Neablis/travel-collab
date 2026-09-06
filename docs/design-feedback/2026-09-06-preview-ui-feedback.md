# UI feedback round — 2026-09-06 (live preview)

**Status, as of 20:10: thirty-two threads — twenty-seven fixed, two answered,
three open.** This file exists so Mitchell has a preview deployment to comment on
and a place for those comments to land.

The sections below are in the order they were written and each one's totals
were true when it was written; the running total above is the one to read.
Copilot caught the drift between them on PR 149. **Reconciliation** at the
bottom of this file has the whole tally and what moved.

## Why this PR exists

`main` had no open PR on 2026-09-06, so there was no preview deployment and no
Vercel toolbar to leave UI comments through. Production
(`caesura.today` / `travel-collab-three.vercel.app`) does **not** load the
toolbar — it is preview-only, which is the whole point of
`docs/guidelines/environments-and-deploys.md`'s "what a preview shows that a
local production build cannot". So this branch carries a prose-only change off
the current `main` (`af37b6b`, PR #148) purely to open a preview at the exact
code Mitchell is looking at.

The branch deliberately contains **no code**. That keeps the preview an honest
picture of `main`: anything reported here is a real defect in shipped code, not
an artefact of a half-finished branch.

## The surface under review

`main` at `af37b6b` — which is M14's widget framework plus the M16 mobile work
merged in #143, #146, #147, and #148. The most recently built surfaces, and so
the likeliest place for new defects:

- The phone (412×856): the scoped tab bar from SPEC §22, and the `Ask` pill and
  bottom sheet from SPEC §23 across all four in-trip screens.
- The Notebook: PageDoc widgets, the three insert surfaces, the preset picker.
- Desktop trip board, Map and Calendar lenses, which #147 touched while
  clearing seven known issues.

`apps/web/src/lib/preview-registry.ts` remains the authoritative list of
deliberately unbuilt surfaces. Anything in it is known-absent, not a bug.

## How to leave feedback

The preview, built from `4728239` and confirmed READY on 2026-09-06:

    https://travel-collab-git-claude-vercel-preview-6497b8-neablis-projects.vercel.app

Open it and use the Vercel toolbar's comment tool. Each comment anchors to the
element and route it was written on, which is what makes this pass cheap to act on: the selector and React component
tree come back with the thread and map straight to a file, no guessing. That is
how `2026-07-12-pr11-vercel-ui-comments.md` and `2026-08-30-design-pass-preview.md`
were both worked.

The preview is behind Vercel Authentication. Signed in to the `neablis-projects`
account it opens directly; from anywhere else it needs a `?_vercel_share=` link
(23-hour lifetime), per `environments-and-deploys.md` → "Testing against a
preview deployment".

## How the comments get collected

Threads are pulled with the Vercel MCP's `list_toolbar_threads`, transcribed
verbatim into the table below with their selector and component tree, and only
then triaged. Verbatim first, analysis second — the two earlier passes both
found that a paraphrased comment loses the detail that identifies the element.

Each finding then ends in exactly one of three states, and none of them is
silence:

- **Fixed here** — if it is small and local, with the fix on this branch, which
  makes the branch Tier 2 or Tier 3 and no longer prose-only. See `AGENTS.md` →
  Definition of Done.
- **Filed** — a `docs/known-issues/open/` entry, named in the PR's Known issues
  section. A defect found and consciously left is fine; found and unrecorded is
  not.
- **Answered** — not a defect, with the reason recorded next to it.

## Findings

Twelve threads, in the order left. Detail below the table. **Four are fixed on
this branch (1, 2, 3, 7); three are open and need a decision (4, 5, 6).** The
branch is no longer prose-only.

| # | Route / surface | Viewport | What's wrong | Outcome |
| - | --------------- | -------- | ------------ | ------- |
| 1 | `/signin` — dev-login submit | 1728×836 | Dev-login button is the faintest control on a screen where it is the only one that works | **Fixed** |
| 2 | `/signup?error=MISSING_INVITE_CODE` | 1728×836 | Error copy is one dense line; wants two, and the em dash dropped | **Fixed** |
| 3 | `/` — first-trip card | 1728×836 | "Look around an example trip" doesn't read as a button | **Fixed** |
| 4 | `/demo?lens=Map&view=Calendar` | 1728×836 | Travel lines drawn for every day; should be the selected day only | **Fixed** |
| 5 | Notebook page — widget chrome | 1728×836 | Widget option select is inline, pushing content; should overlay | **Filed** — KI-2026-09-06-c |
| 6 | Notebook page — `day.rows` | 1728×836 | Renders as stacked spans; the design says a real table | **Filed** — KI-2026-09-06-d |
| 7 | Notebook page — header row | 1728×836 | "Edit page" row sits flush against the global top bar | **Fixed** |
| 8 | Schedule / Timeline — attributee | 1728×836 | A raw internal user id is printed on every timed card | **Fixed** |
| 9 | Schedule / Timeline — avatar | 1728×836 | Avatar initials read "0D" — derived from that same raw id | **Fixed** |
| 10 | Schedule / Timeline — `timeline-ghost` | 1728×836 | "Is ask still under construction?" | **Answered** — registry shell, M9 |
| 11 | Schedule / Timeline — `cost-estimate-state` | 1728×836 | "Whats under construction here?" | **Answered** — registry shell, M19 |
| 12 | Board / Timeline — day scroller | 1728×836 | Cannot scroll to day 14 or day 1; stops at day 13 | **Fixed** |

**Groupings worth reading together.** 1 and 3 are the same complaint about the
same thing: `variant="ghost"` (`text-slate`, no border, no background) does not
read as an actionable control; both are now `secondary`. 5, 6 and 7 are all the
same Notebook page, and 6 is the only item here that cannot be done as a styling
change.

**What was verified for the four fixes** (Tier 2 — the minimal subset covering
the changed files, not `pnpm check`):

- `vitest run src/components/front/AuthScreen.test.tsx` — **52 passed**
- `vitest run src/app/(app)/page.test.tsx src/components/pages/ src/components/home/` — **196 passed, 1 skipped**, 15 files
- `tsc --noEmit` — clean
- `eslint` on the four changed files plus the new test — clean

**The new test was seen red before green.** `AuthScreen.test.tsx` gains
"breaks the missing-invite refusal into why-shut and what-to-do paragraphs".
Collapsing the copy back to one string with the em dash restored fails it with
`AssertionError: expected <p></p> not to be <p></p> // Object.is equality` —
both phrases resolving to the same element is exactly the regression. Restored,
52 pass.

**Not verified:** none of this was seen in a browser. This is a cloud session
and the preview blocks it at the bot checkpoint, so the four fixes are proven by
tests and types, not by looking at the screen. Worth a glance on the next
preview before they are called done.

### 1. `/signin` — "Sign in with dev login" prominence

> "Make the \"Sign in with dev login\" button more pronounced"

- Thread: `cBvDTW4vOces` (neablis, 2026-09-06)
- Route: `/signin` ("Sign in — Caesura"), Chrome 151 on macOS, 1728×836 @2x
- Selector: `body > div.flex > main.grid > div.flex > div.rounded-md > form.flex > button.inline-flex`
- Component tree: inside `AuthScreen` (`mode="signin" devLoginEnabled googleAvailable`) →
  the `devLoginEnabled` `<form className="flex flex-col gap-2 border-t border-hairline pt-3.5">`
  → its submit `Button`, captured as `variant="ghost" disabled`.
- Maps to: `apps/web/src/components/front/AuthScreen.tsx:309`.

**Why the contrast is as stark as it is.** The button directly above it —
"Continue with Google" — is `variant="secondary"` with
`className="h-11.5 w-full text-md font-semibold"`. The dev-login button is
`variant="ghost"` with no sizing classes at all. So the hierarchy is not
incidental; it is two deliberate and opposite styling decisions stacked in the
same card.

**And the hierarchy is right in general, but backwards on a preview.** Ghost is
the correct weight for a control whose own `FormField` hint reads "Preview and
local only" — it should not compete with Google in production. But this surface
*is* a preview, where dev login is typically the only path that actually
completes, so the one button a reviewer needs is the quietest thing on screen.
Any fix should key off the environment rather than just darkening the button
everywhere.

**On the captured `disabled`.** That is `disabled={!hydrated}`, not a defect —
it is the fix for finding 1 of the 2026-08-30 pass ("Enter appeared to do
nothing"), which deliberately shows a disabled control pre-hydration rather than
failing silently. The toolbar snapshotted before hydration. Noted so it is not
re-reported as a bug.

### 2. `/signup` — MISSING_INVITE_CODE copy

> "Move this to two lines, and drop the em dash
>
> \"
> Caesura is invite-only while it is small, so we are requiring invite codes at this time
>
>  Follow Create an account below and enter your invite code. If someone invited you to their trip, open that invite link instead and it admits you on its own.
> \""

- Thread: `QnYE9jfJ5ufi` (neablis, 2026-09-06)
- Route: `/signup?error=MISSING_INVITE_CODE` ("Start planning — Caesura")
- Selector: `body > div.flex > main.grid > div.flex > div.flex:nth-of-type(2) > div.flex-1`
- Component tree: `AuthScreen` (`mode="signup"`) → the `variant="danger"`
  `<div role="status">` → its `<div className="flex-1">`.
- Maps to: `apps/web/src/components/front/authCopy.ts:116-117`.

The replacement text is given verbatim in the comment, so this is a copy edit
with the wording already decided, not a judgement call. Two things it implies
beyond a find-and-replace: the string becomes **two paragraphs**, so the banner
has to render them as separate blocks rather than one string, and
`AuthScreen.test.tsx:226` asserts on `/Caesura is invite-only while it is
small/`, which the new first line still satisfies — worth confirming rather
than assuming when the change is made.

### 3. `/` — "Look around an example trip" doesn't read as a button

> "Make this look like a button"

- Thread: `xg47DCyoWH1F` (neablis, 2026-09-06)
- Route: `/` ("Caesura")
- Selector: `body > div.phone-tab-bar-inset > main.mx-auto > div.home-stack > div:nth-of-type(2) > div.rounded-md > div.flex:nth-of-type(2) > a.inline-flex:nth-of-type(2)`
- Component tree: inside `FirstTripStart` (`data-testid="first-trip-start"`) →
  the `<div className="flex flex-wrap items-center gap-2">` → the second `<a>`,
  `href="/demo"`.
- Maps to: `apps/web/src/components/home/FirstTripStart.tsx:100`.

**Same root cause as finding 1.** The row holds three controls in descending
weight — `Button variant="primary"` ("Name your trip"), `Link` with
`buttonVariants({ variant: "secondary" })` ("Start from a Playbook"), then this
one with `buttonVariants({ variant: "ghost" })`. It already uses the button
class helper, so it *is* styled as a button; the ask is that `ghost` is too
faint to read as one. That makes this and finding 1 a single question about the
`ghost` variant rather than two local tweaks — worth settling once in the
design system instead of patching two call sites.

### 4. `/demo` Map + Calendar — travel lines on unselected days

> "Lets try the UI in the designs. Remove the travel lines from all days that are not currently selected."

- Thread: `WiuIzofRY-p_` (neablis, 2026-09-06)
- Route: `/demo?lens=Map&view=Calendar` ("An example trip — Caesura")
- Selector: `… > div.map-lens > div.map-lens-canvas > div.h-full > div.maplibregl-canvas-container > div.maplibregl-marker:nth-of-type(8) > svg > g > g:nth-of-type(2) > path`
- Component tree: **none captured** — "Could not find React fiber for this
  element", because the selected element is inside MapLibre's own canvas
  container rather than the React tree. Expected for a map marker, not a defect.

**Fixed — but read the assumption, because "the designs" could not confirm it.**
The map lens already knew the focused day: non-focused days were *ghosted*
(opacity 0.25, shifted to a neutral grey) rather than removed. The change is
that a non-focused day's **travel** legs now go to opacity 0 outright.

**Only the travel variant, and that is an interpretation.** `ROUTE_VARIANTS` is
`["rest", "travel"]`, and "travel legs" is this project's established term for
the dashed inter-city ones — the 2026-08-30 pass used the same words ("Travel
legs should be dotted, not solid"). The reason it is also the right reading: a
`rest` leg is local to one city and stays inside its own day's cluster, while a
`travel` leg spans the distance between cities, so on a fourteen-day trip the
unfocused ones rake across the whole map and cross the pins of the day you are
reading. Ghosting lowers their contrast without lowering the number of lines
drawn over that day.

**What was checked and did not settle it:** `.design-sync/handoff/design/Trip
Planner Redesign.dc.html` mentions travel days and travel legs but says nothing
about how the map treats unfocused ones. So this implements the comment's own
sentence rather than a design it could not read. If "travel lines" meant every
route line, the change is one condition wider — say so and it is a one-line
edit.

Pinned by two tests, seen red first (`expected 0.25 to be +0` — the ghosted
travel leg that should have been gone): a non-focused day loses its travel legs
and keeps its rest legs ghosted, and a focused day keeps its own travel legs,
because the rule is about other days rather than about travel legs being
unwelcome.

### 5. Notebook — widget option select is inline

> "The widget option select is still inline and not hovering over or blocking the existing elements."

- Thread: `5n5sS3H7MJcJ` (neablis, 2026-09-06)
- Route: `/trips/164138c7-…/pages/e36cc8fc-…` ("Caesura")
- Selector: `… > div.tc-page-editor > div.tiptap > p:nth-of-type(4) > span.react-renderer > span.block > span.mt-1 > span:nth-of-type(2) > #widget-chrome-day\.rows-city`
- Component tree: the selected `Macro` (`data-macro-name="day.rows"`, ringed
  `className="block ring-2 ring-primary rounded"`) → `<span className="mt-1 flex
  flex-wrap items-center gap-1">` → the widget chrome at `layout="inline"`,
  `idPrefix="widget-chrome-day.rows"` → `<select id="widget-chrome-day.rows-city">`.
- Maps to: `apps/web/src/components/pages/editor/WidgetChrome.tsx` — the
  `layout` split around lines 133-163.

**"Still" is the important word**, and the code says why. `WidgetChrome` chose
this deliberately: `const inline = def?.shape === "single"` at line 133, under a
comment reading "**A block's chrome gets its own row; a single value's stays
inline**" — because "an inline row that cannot wrap pushes the paragraph it sits
in". So the current behaviour is a considered fix for a different problem, and
the ask is to replace it with an overlay rather than to restore something that
regressed. **Checked, and it is already on the stacked branch** — the captured
`<span className="mt-1 flex flex-wrap items-center gap-1">` is the non-inline
path, so there is no bug here to fix. What stays inline is the *inner*
`WidgetBindControls`, which `WidgetChrome` passes `layout="inline"`
unconditionally. So the ask is a genuinely new behaviour — a floating overlay
positioned above the document — not a restoration of something that regressed.

**Left open deliberately.** This surface has already ping-ponged once: the row
was inline for every shape, Mitchell reported "the dropdown is also overtop the
widget block", and it was moved to its own row in response. Going back to
overlaying it — properly this time, hovering rather than displacing — needs
positioning, stacking order and a dismissal rule decided rather than guessed,
and guessing is what produced the first round trip.

### 6. Notebook — `day.rows` should be a real table

> "This also doesnt look like the design, these should literally be a table"

- Thread: `FTPrMnvG8U0v` (neablis, 2026-09-06)
- Route: same Notebook page as finding 5
- Selector: `… > div.tiptap > p:nth-of-type(4) > span.react-renderer > span.block > span.flex > span.flex:nth-of-type(4) > span.text-ink`
- Component tree: `Macro` (`data-macro-name="day.rows"`) → `<span role="list"
  className="flex flex-col gap-0.5">` → `<span role="listitem" className="flex
  flex-wrap items-baseline gap-x-2">` → a segment `<span className="text-ink">`.
- Maps to: `packages/pages/src/macros/primitives/rows.ts` (the row model) and
  `MacroView` (which turns it into spans).

**This is the one item that cannot be done as styling.** The reason is written
into `rows.ts:127-131`: `Rendered.rows` is typed `Seg[][]`, "a repeat renders N
lines and `MacroView` maps them to `role="listitem"` spans", and the comment
explicitly rejects pushing "a grouping concept through the render seam and into
`apps/web` for one widget's benefit". A real `<table>` needs columns — a cell
model — which is exactly the concept that seam was designed not to carry. So
this is a change to the widget render contract, plausibly an ADR-039 follow-up,
not a CSS pass. It should be scoped and decided before anyone starts it.

### 7. Notebook — "Edit page" row is flush against the top bar

> "Edit page is up against the top bar"

- Thread: `U0lAwel6iyz9` (neablis, 2026-09-06)
- Route: same Notebook page as findings 5 and 6
- Selector: `body > div.phone-tab-bar-inset > div.mx-auto > div.mb-3 > div.flex > button.inline-flex`
- Component tree: the page component → `<div className="mx-auto w-full px-6
  max-w-content">` → `<div className="mb-3 flex flex-wrap items-center
  justify-between gap-3">` → `<div className="flex flex-wrap items-center
  gap-2">` → the `Button variant="secondary" aria-pressed={false}` ("Edit page").
- Maps to: `apps/web/src/components/pages/PageScreen.tsx:381`.

**Confirmed in the source rather than inferred.** That row carries `mb-3` —
bottom margin only, nothing above it — and it is the first child of
`PageContainer`, which is `cn("mx-auto w-full px-6", …)`: horizontal padding
only, no vertical. So there is genuinely no top spacing anywhere in the chain,
and the row lands hard against the global `AppHeader`. For contrast, `/signin`'s
`<main>` carries `pt-3`.

The narrow fix is top spacing on this row or on `PageContainer`. Worth noting
before picking: `PageContainer` is shared with the trip board, the Notebook
index, the demo screen, the invite screen and Home, so changing it there is a
change to six surfaces, not one. There is also a live architecture question in
`docs/STATUS.md` about the phone continuing to render the global `AppHeader` —
this is a symptom adjacent to it, though the desktop viewport here shows the
spacing gap is not phone-specific.

### 8 and 9. Schedule / Timeline — a raw user id, and the initials made from it

Two threads, one defect. Both were asked as questions, and the answer is the
finding.

> "Whats this long id string?" — thread `I36VBahubnuh`
> "Whats 0D?" — thread `Blp2OWn23_Ez`

- Route: `/trips/164138c7-…?lens=Schedule&view=Timeline` ("Trip plan — Caesura")
- Both selectors land in the same timed card
  (`data-testid="timeline-item-fa1ceda9-…"`, `start="14:30" end="16:00"`), in
  its `<div className="flex shrink-0 flex-col items-end gap-1.5">` attributee
  column: the `<span className="text-slate">` for 8, the `<span aria-hidden>`
  avatar circle for 9.
- Maps to: `apps/web/src/components/lenses/TimelineLens.tsx:304-326`.

**What they are.** Line 316 renders `{member.userId}` — the raw internal user
id — as an 11px label, and line 324 renders `initialsFor(member.userId)` beside
it. `initialsFor` (`apps/web/src/lib/initials.ts:8`) splits on non-alphanumerics
and, failing to find two parts, takes the **first two characters of the id** and
upper-cases them. So an id beginning `0d…` becomes exactly the "0D" in the
question. The avatar is not showing anyone's initials; it is showing the first
two characters of a database key.

**Why it is like that, from the code's own comment.** `TripMember`
(`packages/contracts/src/trip.ts`) "carries only a userId, no display name and
no per-activity 'who's this for' field", so the trip's first member is used as a
"generic, reasonable stand-in for 'attributee avatar' rather than fabricated
assignment data". The intent was to avoid inventing assignment data — reasonable
— but the result prints an internal identifier to the user on every timed card.

**Fixed, and it needed no contracts change — the answer already existed.**
`apps/web/src/lib/displayName.ts` is documented as "the ONE place `who` becomes
something to call a person", and its `handleFor` fallback exists precisely
because of the same complaint made earlier: *"Dont show the UUID in the Header
bar where publish button is"* (Mitchell, 2026-09-01). It turns an id into
`Alice` for a dev-login id and `Traveler 3f4a5b` otherwise, and never returns
the id. TravelersPanel, SharedDayScreen, DiscoverCard and LeaderboardScreen all
route through it. **The timeline was simply the surface that was missed.**

**And it was missed in two more places than were reported.** `initialsFor(member.userId)`
— initials built from a raw key — was also in `home/TripCard.tsx:190` and
`home/NextTripHero.tsx:206`. Both are fixed here too: leaving them would have
knowingly shipped the same "0D" avatar on Home the day after it was reported on
the timeline. `AccountMenu` already did the right thing (`initialsFor(name)`),
which is what made the other three visible as the odd ones out.

**Red-first, and the first attempt was wrong in an instructive way.** A dashed
UUID does *not* reproduce "0D": `initialsFor` splits on non-alphanumerics and
only takes "the first two characters" when that yields fewer than two parts, so
a UUID renders "04" and the test passed against the bug. It needs a
separator-free id. With that corrected, all three tests fail on the old code —
`expected <span class="text-slate"> to be null` for the label, and the same for
the avatar — and pass on the new.

### 10 and 11. Two "under construction" markers — both are registry shells

> "Is ask still under construction? we could build this easily" — thread `hGHfcXnvmxec`
> "Whats under construction here?" — thread `FqU55jwEb-nZ`

Neither is a defect. Both selectors land on a `data-preview-id` element with
`role="group" aria-disabled="true"` — the deliberate unbuilt-surface markers
listed in `apps/web/src/lib/preview-registry.ts`, which this file's header
already named as authoritative. The construction icon is the marker, not a bug.
The two differ sharply in cost, which is the part worth knowing:

- **`timeline-ghost`** (`title="Coming in M9"`, registry line 64) — *"Proposals
  rendered inline in the timeline — the approval mechanism itself shipped in
  PR #88"*. **Not the assistant.** It is the ghost of a proposed change drawn in
  the timeline. "We could build this easily" is plausible here precisely because
  the approval mechanism already exists; what is missing is the inline
  rendering. Note the registry's own history: the neighbouring entry was
  retagged M9 → `unplaced` on 2026-09-01 because M9's scope did not actually
  support the claim, so M9's ownership of this one is worth re-checking before
  committing to it.
- **`cost-estimate-state`** (`title="Coming in M19"`, registry line 79) —
  *"Confirmed-vs-estimate flag per cost — no field models it"*. **Not easy.** It
  is blocked on a contract field that does not exist; M19 was minted for exactly
  this (`docs/milestones/M19-cost-model.md`) after M11b found it mis-tagged.

### 12. Board / Timeline — the first and last day columns cannot be reached

> "Its impossible to scroll right all the way to day 14, because it stops at day 13. Same with day 1"

- Thread: `_exXctu1bEit`
- Route: `/trips/164138c7-…?lens=Board&view=Timeline`
- Selector: `… > div.flex > div.-mx-1 > section.flex:nth-of-type(13) > ul.m-0 > li.rounded-md`
- Component tree: the `role="group" aria-label="Day columns"` scroller
  (`focusedDay={11}`) → `section[data-testid="day-column"]` for
  `title="Day 13 — Sep 28"`.
- Maps to: `apps/web/src/components/board/Board.tsx:356-367`.

**The most serious item in this round.** Everything else here is cosmetic, a
copy edit, or a deliberate placeholder; this one means two of fourteen days are
unreachable, on the trip board's primary lens.

**Diagnosed, and it was neither guess in full: the cause is arithmetic.**
`centralDayIndex` names the column nearest the box's reading line, which is its
true centre horizontally. A scrollport is wider than one column, so the first
and last columns can never bring their own centres to that line — scrolled hard
right, an interior column still owns the centre. Nearest-to-the-line therefore
never returns `0` or `length - 1`, and both end days were unselectable however
far you scrolled. The `-mx-1 px-1` pattern is innocent.

**Fixed** by giving `centralDayIndex` the scroll-edge state its caller measures
(`Board.tsx`, `box.scrollLeft` against `scrollWidth - clientWidth`, 1px slack
for fractional scroll). Being at an end is a stronger statement about what you
are looking at than a distance is, so it wins. Proven red first at both layers:
the unit test went `expected 11 to be 13` and `expected 1 to be +0`, and the new
e2e test on `/demo`'s fourteen-day fixture went `Expected [13], Received [11]`
in a real browser — day 14 unreachable, exactly as reported.

**The superseded guesses, kept because being wrong in public is cheaper than
quietly rewriting history.** The
scroller is `className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-1"`:

1. **The `-mx-1 px-1` pair.** This is a deliberate pattern shared with
   `ui/sheet.tsx` and `ui/dialog.tsx`, which use it so a focus ring is not
   clipped by the scrollport — `overlays.test.tsx:129` pins it. It pulls the
   container 4px wider than its parent each side while padding 4px back in, so
   an ancestor that clips would eat both ends. That matches "same with day 1"
   symmetrically, but 4px is small to describe as a whole column.
2. **The focus-following scroll.** `useFollowFocusedDay` (line 181) drives
   `scrollRef` from `focusedDay`, which the capture shows as `11`. Programmatic
   scrolling that competes with a manual drag would explain a hard stop better
   than 4px of padding does.

The symmetry across both ends favours the first; the magnitude favours the
second. Left open rather than guessed: this is a functional regression and
deserves a real repro at 1728×836 with fourteen days, plus an e2e test that
reaches the first and last column, since nothing currently covers it.

## Outcome

Twelve threads. **Eight fixed** on this branch, **two answered** as
preview-registry shells needing no code, and **two filed** as known issues
because each is blocked on a decision rather than on effort.

| Outcome | Findings |
| ------- | -------- |
| Fixed | 1 dev-login prominence · 2 signup copy · 3 home link · 4 map travel legs · 7 page top spacing · 8 + 9 raw user id and its initials · 12 the day scroller |
| Answered | 10 `timeline-ghost` (M9) · 11 `cost-estimate-state` (M19) |
| Filed | 5 → `KI-2026-09-06-c` · 6 → `KI-2026-09-06-d` |

**The two filed ones were built or scoped before being filed, not waved off.**

- **5** had a working implementation — a `top-full` popover on a `relative`
  wrapper, gated to the selected widget. It was reverted because it fails
  `PageScreen.test.tsx:379`, the test carrying ADR-037 open question 1: a
  notebook showing day 1, day 3 and day 9 could no longer show where its three
  widgets point without clicking each. The request collides with an earlier
  decision by the same person, and that collision is the finding.
- **6** is blocked twice over, and the first blocker was not in the original
  triage: a widget node is inline inside a `<p>`, where `MacroView` has already
  measured that a block element causes a hydration error — so a literal
  `<table>` is unavailable for the same reason `<div>` is, before the missing
  cell model is even reached.

**Two fixes went wider than reported**, both because the reported surface was
one instance of a defect rather than the whole of it: the raw-id avatar was also
on `home/TripCard` and `home/NextTripHero`, and finding 1's `ghost` variant was
the same bug as finding 3.

**Still not seen in a browser.** Every fix here is proven by tests, types and —
for the day scroller — a real-browser e2e run. None has been looked at on the
preview, because this container is blocked at Vercel's bot checkpoint. That
walk is the one thing still owed.

## Second batch — four more threads, 2026-09-06 05:56–06:00

All four on a phone (411–412px), on a real trip rather than `/demo`.

| # | Route / surface | What | Outcome |
| - | --------------- | ---- | ------- |
| 13 | Map lens day strip | "day 1 and 2 and the last two days are not scrollable to" | **Fixed** |
| 14 | Timeline day head | "add stop goes briefly to the second line when the flag button is clicked" | **Filed** — KI-2026-09-06-f |
| 15 | Assistant sheet | "you are still scrolling the background rather than the assistant chat" | **Filed** — KI-2026-09-06-e |
| 16 | Timeline card | "move the activity description down under the header sub elements" | **Fixed** |

**13 is the same defect as 12, in a component the first fix did not touch.**
`centralDayIndex` is shared by three horizontal day scrollers; only `Board` got
the scroll-edge state, and the Map strip and `DayChips` were left. "Day 1 **and
2**" rather than day 1 alone is the strip's chips being far narrower than a day
column, so more of them fit between the track's edge and its centre. All three
now pass the same edges.

**15 is the one place a claimed reproduction was wrong**, and the entry records
why: the first probe drove `document.scrollingElement.scrollBy`, which passes
through `overflow: hidden` by design and so moves the page with or without a
lock. A wheel gesture does not move it — with or without the lock that was
written for it — so Radix's modal lock is already doing that job and the fix was
deleted rather than shipped as decoration. Only `overscroll-contain` shipped,
labelled as unverified.

## Thread 17, 06:51 — and it closes a question left open on 2026-08-30

> "on the map view page on mobile, I'm able to scroll way off the page"

- Thread: `qJYYDdp_FTDW`, `/trips/081f2e6d-…?lens=Map`, Chrome 152 on Android, 912×1685
- Selector: `body > div.phone-tab-bar-inset > main.mx-auto > div.flex > div.trip-board-content > header.sticky > div.flex`
- Maps to: `apps/web/src/components/lenses/MapLens.tsx:90-104` and `:526-529`

**This is the same defect as finding 12 of the 2026-08-30 pass** — *"I was able
to scroll way past the bottom, not sure how, its not a always thing"* — which
was left open with an explicit **"Needs: which lens, and what you had just
done"**. This names the lens. Filed as `KI-2026-09-06-g` with the mechanism:
the canvas is sized in `100dvh`, and `dvh` grows as Android's URL bar
collapses, so scrolling makes the canvas taller, which makes the document
taller, which allows more scrolling. `svh` is the candidate fix and is not
free — it reintroduces, by the toolbar's height, the under-map strip that the
same 2026-08-30 pass fixed as its finding 8.

**Not fixed here**, because the loop needs a browser with a dynamic toolbar and
Playwright's desktop Chromium has none: `dvh`, `svh` and `lvh` are one number
in this harness, so no test written here could tell the fix from the bug.

## Correction, 06:55 — finding 4 was implemented too narrowly

> "what happened to on map view removing stops on the days you arent looking at. I asked for that change"

Finding 4's comment was *"Lets try the UI in the designs. Remove the travel
lines from all days that are not currently selected"*, and it was implemented
as the dashed `travel` route variant only — `rest` legs stayed ghosted at 0.25
and every pin stayed at 0.35. The interpretation was flagged at the time as an
interpretation, which is not the same as getting it right.

**The correct reading is the whole day.** A day you are not looking at is now
not drawn at all: both route variants at opacity 0, its pins at 0, and
`pointer-events: none` on those pins so an invisible marker cannot still be
tapped.

**What this does NOT change: the tag axis.** M18b's *"dim, never hide"* is
about tag focus, and an off-tag stop on the focused day still fades to 0.32.
Day focus and tag focus were being weighed against each other as two dims; the
day axis is no longer a dim, so `MapLens.test.tsx`'s "fainter of the two, never
their product" test has been re-scoped rather than deleted — the rule it
protected still holds for the axis that still has one.

`ghostRouteColor()` went with the behaviour it served: the neutral tone existed
so a faint line would not still read as its day's colour, and nothing is faint
any more.


## Reconciliation, 10:30 — the running tally, and what moved after it was written

Copilot, reviewing PR 149: *"These totals are stale relative to this diff …
findings 5, 6, and 14 are now resolved, and thread 17 was added."* Correct, and
15 has moved since as well. The sections above are a log and stay as written;
this is the tally.

| Outcome | Threads | Count |
| ------- | ------- | ----- |
| Fixed | 1 · 2 · 3 · 4 (+ the 06:55 correction) · 5 · 6 · 7 · 8 + 9 · 12 · 13 · 14 · 15 · 16 | 14 |
| Answered, no code | 10 `timeline-ghost` (M9) · 11 `cost-estimate-state` (M19) | 2 |
| Filed, still open | 17 → `KI-2026-09-06-g` | 1 |

**Four of those fixed were filed first, and all four were unblocked by an
answer rather than by effort.**

- **5** (widget chrome inline) — `KI-2026-09-06-c`, resolved. Blocked on a
  collision with ADR-037 open question 1, settled by Mitchell: *"I dont care
  about always visible, people editing the one they are focusing on. Reveal on
  hover/focus."*
- **6** (repeat widgets as tables) — `KI-2026-09-06-d`, resolved. *"These were
  always meant to be tables with columns … just build it, no need for a ADR."*
  One of its two blockers turned out to be my own mistake: the cell model was
  never missing, only discarded at the render seam.
- **14** (keep-day pennant width) — `KI-2026-09-06-f`, resolved. *"Reserve the
  width permanently."*
- **15** (assistant sheet scroll-through) — `KI-2026-09-06-e`, resolved, and
  the entry is worth reading rather than summarising: it records a claimed
  reproduction that was wrong, and then a claimed NON-reproduction that was
  also wrong. CI reproduced the defect on `2bcc8a4` after I had written that it
  could not be reproduced.

**Two of the review bots' findings on this PR were defects I had shipped in the
course of fixing these**, and both are recorded where they happened rather than
only here: the widget popover was hidden with `visibility: hidden`, which took
its own controls out of the tab order and made the *focus* half of "reveal on
hover/focus" unreachable; and the repeat table carried a Tailwind `block`
utility that beat `.tc-widget-table`'s `display: table` in the cascade, so the
table it was supposed to be was a shrink-to-fit box floating inside a
full-width card. Both now have a walk that fails without the fix.


## Third batch — threads 18, 19, 20, 2026-09-06 10:07–10:10

Left while PR 149's review round was being worked. All three on the same trip,
two of them at 912px and one at 412px.

| # | Thread | Route / surface | What | Outcome |
| - | ------ | --------------- | ---- | ------- |
| 18 | `FeAGRfPJn5p3` | Schedule → Timeline, 412px, day head | "lets go back to this being smaller, drop the word kept and the expanded UI and just have it turn green and do the animation when it succeeds" | **Fixed** |
| 19 | `PBcXql7hanpO` | Map lens, 912px, `div.phone-tab-bar-inset` | "this is no longer filling the height available" | **Open — needs a decision** |
| 20 | `3AP1dMISqZxO` | Account menu, 912px | "the your account screen has the desktop styling, it should be a full height page like the activity adder" | **Open — M17 work, not a defect** |

### 18 — the keep-day pennant, and a fix that was overturned by a better one

This reverses finding 14's fix rather than extending it. That fix reserved the
"Kept" label's width permanently so the day head could not reflow; it worked,
and it left an un-kept pennant nearly three times the design's 30px. Dropping
the label removes the reflow for a simpler reason — nothing can change size any
more — and it is what was asked for.

Gone with it: `om-flag-label`, `.flag-celebrate-label`, and the
`prefers-reduced-motion` carve-out written to keep the label appearing when the
motion was dropped. The fill, ring and sparks are `--color-success` now instead
of `--color-brand`; the design specified brand, and brand reads as *selected*
where green reads as *saved*. `KI-2026-09-06-f` records the supersession.

### 19 — "no longer filling the height available"

Selector `body > div.phone-tab-bar-inset`, Map lens, 912×1685 Android. **Not
fixed, and not yet diagnosed.** "No longer" says it is a regression, and the
element named is the tab-bar inset wrapper rather than the map canvas — which
makes it a different element from `KI-2026-09-06-g`'s `100dvh` canvas even
though the two are on the same screen and could easily be read as one report.

The honest position is that this needs a look at the preview before anything is
changed: at 912px the phone tab bar is not rendered, both terms of the inset's
padding subtraction are zero, and guessing at a height rule on a screen where
another height bug is already open (`g`) is how the wrong one gets "fixed".

### 20 — the account screen at phone width

**Not a defect and not a regression: unbuilt.** M17 is the account-preferences
milestone and its exit gate still has three unticked boxes; the phone treatment
for that screen is inside it. This thread is the clearest statement so far of
what the phone treatment should be — a full-height page, the same shape as the
activity adder — and belongs in M17's notes rather than in this branch.


## Thread 21, 16:17 — the phone tab bar's wasted space

> "The bottom bar has a bit of wasted space, have equal distance between top and bottom for icon and shrink it down a bit"

- Thread: `66aIISW9gWVR`, `/trips/081f2e6d-…/pages`, Chrome 152 on Android, 411×760
- Selector: `body > nav.phone-tab-bar > a.flex:nth-of-type(2)`
- Maps to: `apps/web/src/app/globals.css` `.phone-tab-bar`

**Fixed.** The bar was padded `8px` at the top and `30px` at the bottom, which
is the design's own `padding: 8px 0 30px` — and that 30px is clearance for a
home indicator. On a device that has one, `env(safe-area-inset-bottom)` reports
it (34px on current iPhones) and the `max()` still takes it. On a device that
does not, the inset is 0 and the 30px was 30px of nothing, sitting under a bar
padded 8 at the top: exactly the asymmetry in the report, and exactly the
wasted space.

The floor is now `8px`, so the two sides match and the 44px tap target sits
centred between them. The bar goes from `8 + 44 + 1 + 30 = 83px` to `61px` on
this phone and is **unchanged on any device with a real inset**, since `max()`
takes the larger. `--phone-tab-bar-height`'s pre-hydration fallback moved with
it — that literal restates the element's own padding and has to.

**The 44px floor is untouched.** SPEC §13.1 is about what a thumb can hit, and
the whole shrink comes out of padding that was clearing hardware this device
does not have. The walk asserts both halves: the gap above each tab equals the
gap below to within rounding, and every tab is still at least 44px tall. Seen
red with the 30px restored — `Expected: <= 2, Received: 21`.

**One side effect worth naming:** `MapLens` sizes its canvas with
`calc(100dvh - … - var(--phone-tab-bar-height))`, so the map gains those 22px.
That is not a fix for thread 19, which is at 912px where the bar does not
render at all.


## Fourth batch — threads 22–25, 2026-09-06 16:18–16:21

All four on the phone, on a real trip, minutes apart. Three land on work from
earlier today, which is what a preview is for.

| # | Thread | Route / surface | What | Outcome |
| - | ------ | --------------- | ---- | ------- |
| 22 | `Xud5cQzzx5k8` | Notebook, 411px, `cost.rows` lead | "these should be human readable strings, march 10, 2026 rather than 2026-03-10" | **Fixed** |
| 23 | `EfaaGdPt6FEW` | Notebook, 411px, `day.rows` cell | "text in a widget table shouldn't be color coded like inline text, also add row strips to show it's a table" | **Fixed** |
| 24 | `XxySsTRjrmT6` | Notebook, 411px, `cost.rows` cell | "all tables should have row stripping, and not color.code the text like other inline text" | **Fixed** (same as 23, restated on the other widget) |
| 25 | `ZFduaYRa85yd` | Map lens, 764px, canvas | "have the map default be even more zoomed out by default so the pins aren't so close to the edges" | **Fixed** |

### 22 — one widget was printing an ISO date

`cost.rows` built its lead as `` `Day ${n} · ${date}` `` with the raw ISO
string, while `day.rows` — on the same page, four rows up — went through
`formatDate`. That is the whole defect: one call site skipped the formatter.

It reads `Day 1 · Jun 1, 2027` now. The abbreviated month is `formatDate`'s
own, kept rather than widened to "June": `day.rows` has been drawing it that
way on this page all along and drew no complaint, and inventing a second date
format for one widget is worse than either choice. **If the long month is
wanted, it is one word in `format.ts` and every widget moves together.**

The test asserts through `formatDate` rather than against a literal, so it
tracks the claim ("a human-readable string") rather than today's output —
a hard-coded `"Jun 1, 2027"` would pass just as happily after someone
reverted the widget and updated the fixture to match. Seen red with the ISO
restored.

### 23 and 24 — a table is not a sentence

Two threads, one answer, and it settles a question this file has been carrying
open since the table landed: *"money in the table still renders as a widget
chip rather than the design's flat grey."*

The chip — brand tint, brand underline — exists to answer a question a table
does not ask. Inline, a resolved value sits in a sentence the author wrote, and
the tint says which words came from the trip rather than from them (§7, and
Mitchell's own earlier *"should be clearly coming from a widget"*). Every cell
of a repeat table came from the trip; the whole widget did. So the tint marks
nothing, and at 411px a column of tinted pills reads as a column of buttons.

`Segs` takes a `plain` flag and the `rows` renderer sets it. `data-widget-value`
stays on both paths — it is the handle a test asks "how many values came from a
widget" with, and that question is unchanged.

Striping replaces the per-row hairline rather than joining it: two separators
doing one job read as ruled paper at this row height. `:nth-child(even)` gets
`--color-paper` on the card's white, the same pairing the app already uses for
a page on its background. The total row's `bg-moss` is a Tailwind utility and
outranks the component-layer stripe, so it stays distinct from both — the same
cascade rule that broke `display: table` this morning, working the right way
round this time.

**One judgement call worth flagging:** a city keeps its accent colour inside a
table. "Colour coded like other inline text" was read as the widget-chip
treatment, which is what both comments clicked on; a city's colour is the
trip's own language and appears in Day columns and on the map too, so removing
it here would be a wider change than was asked for. Say the word if it should
go as well.

### 25 — the pins were sitting on the edge

`fitBounds` padded the phone branch by 24px on three sides where the desktop
branch pads by 100, so a day whose bounds already filled the frame put its
outermost pins almost against the canvas edge. It is 48 now, and the top still
adds the day strip's height on top of that.

**Padding rather than `maxZoom`,** which is the lever the report's wording
points at: the zoom cap only bites on a day whose stops are close together,
while this is a day whose bounds are wide. More padding zooms out *and* moves
the pins inward; a lower cap would do neither for the day being complained
about. Seen red at 24.


## Thread 26, 17:17 — the rename moves onto the title

> "rename shouldn't be a button here, the title should be at the top of the notebook as a h1 and when you edit the title it does the actual edit/rename"

- Thread: `sK0lWWvntrm9`, `/trips/081f2e6d-…/pages`, Chrome 152 on Android, 411×816
- Selector: `body > div.phone-tab-bar-inset > div.mx-auto > section:nth-of-type(2) > ul.mt-3 > li.rounded-md > div.flex > button.inline-flex`
- Maps to: `NotebookScreen.tsx` (the button and its inline form), `PageScreen.tsx` (the title)

**Fixed.** The notebook's title is its own `h1` at the top of the document and
is edited in place; the index's Rename button and its inline input/Save/Cancel
row are gone. Delete stays, because it has nowhere else to live.

**`contentEditable` on the heading, not an input dressed as one.** The title has
to stay a heading: it is the document's `h1`, it is what a screen reader lands
on, and a good share of this repo's e2e walks find this page by
`getByRole("heading", …)`. An `<input>` keeps the look and loses all of that; an
`<input>` nested inside an `<h1>` gives the heading an empty accessible name,
which is worse than either. It was also `level={2}` before and is `level={1}`
now — the trip's name is the app chrome above the card, so the page's own title
was never the second-level heading of anything.

**Editable only in Editing.** Reading is the traveller's view (§18) and a title
that took a caret there would be the one piece of chrome left in the mode whose
whole point is having none.

**Where each claim is tested, and why it is not all in one place:**

- `PageTitle.test.tsx` — the commit on blur, the trimmed text, the unchanged-text
  no-op, the empty-title refusal, Escape. The empty-title guard in particular
  has nowhere else it can fail: `PageScreen` restores the old name when the
  request errors, and an empty title is exactly what the API refuses, so a
  `PageScreen` test asserting "the old title is still on screen" passes with the
  guard deleted. That test was written, seen to pass with the guard removed, and
  moved.
- `PageScreen.test.tsx` — the wiring: not editable in Reading, editable in
  Editing, and a blur that reaches `updatePage`.
- `m14-notebook-widgets.spec.ts` — a real browser, because jsdom implements none
  of the editing behaviour a person uses on a `contentEditable`. Select all,
  type over it, Enter, then check the index followed.

**Two things the tests caught about themselves.** `isContentEditable` is not
implemented in jsdom and reads `undefined`, so the first "not editable yet"
assertion passed by accident; it reads the attribute now. And React has routed
`onBlur` through the bubbling `focusout` event since 17, so a dispatched `blur`
reaches no handler at all — the first version of the rename test dispatched one
and would have passed with the whole feature unwired.


## Thread 27, 17:21 — templates go under the notebooks

> "start from template should be below existing notebooks"

- Thread: `8mE14jqheOHL`, `/trips/081f2e6d-…/pages`, Chrome 152 on Android, 411×760
- Selector: `body > div.phone-tab-bar-inset > div.mx-auto > section.mb-8 > #start-from-a-template`
- Maps to: `NotebookScreen.tsx` — the two `<section>`s

**Fixed**, by swapping the two sections. On a trip that already has notebooks,
the gallery was a screenful of choices already made sitting above the list of
what those choices produced — so on a phone this route opened on the answer to
a question nobody asks twice. `mb-8` moved with the order, since the gap
belongs under whichever section comes first.

The test reads the regions off `getAllByRole`, which returns them in document
order, and asserts the two names in sequence. Counting them would pass with the
order reversed, which is the entire finding. Seen red with the sections swapped
back.


## Thread 28, 17:57 — Share leaves the header entirely

> "Put share in the trip settings under invite someone, both here and in mobile"

- Thread: `T3snEMRo5Mjx`, `/trips/081f2e6d-…?lens=Map&view=Calendar`, Chrome 151 on macOS, 1728×836
- Selector: `… > header.sticky > … > div.hidden > button.inline-flex`
- Maps to: `TripHeader.tsx` (the header copy), `SettingsSheet.tsx` (where it lands)

**Fixed, in two parts.**

Share was `hidden md:block` in the header — off the phone only, because of an
earlier report that these controls were *"really crowded and ugly on mobile"*.
Desktop kept it on the reasoning that there was room. Room is not the argument:
"both here and in mobile" says the placement is wrong at every width, and having
it in two places meant a reader had to know which one this build put it in. The
header copy is gone; `SettingsSheet` mounts the only `ShareButton` on a trip
now.

Inside the sheet it moved from the "Who is invited" heading row to below
`TravelersPanel`. Reading down the section now goes: who is already here,
invite a named person, or hand out a link that needs no name. On the heading row
it read as a control for the heading.

**The ordering test caught itself, which is the third time today.** The first
cut compared the index of "Share" against the index of "Invite someone" among
the sheet's buttons — and `TravelersPanel` is *mocked* in that file, so "Invite
someone" was never in the list. `indexOf` returned `-1`, every index beat it,
and the assertion passed with Share put straight back on the heading row. It
reads the sheet's text order now, against the position the mock actually
renders. Seen red: `expected 296 to be greater than 301`.


## Review round, 18:04 — five findings on the code the threads above produced

CodeRabbit's pass over `2583662…51a917a`. None of these came from the toolbar;
they are about the fixes, not the reports. Four were real and one was not, and
the one that was not is the reason the walk proving it exists.

**The stale rename could roll back the newer one** (`PageScreen.tsx`). Two
renames in flight at once finish in whatever order the network gives them, and
the older one's completion still ran: its failure put the *original* title back
over the name the user could see, and its success would have written the older
title over the newer. A counter in a ref settles it — a completion whose
sequence number is no longer the current one returns without touching state.
Seen red with the guard deleted: `expected 'Trip Overview' to be 'Second name'`.

**A group header did not span the table** (`MacroView.tsx`, `globals.css`).
`stop.rows` groups its lines under day headers as soon as the selection spans
more than one day, and a header row renders one cell rather than an empty
second one. The comment above it claimed that cell spanned both columns. It did
not: CSS tables have no way to span columns without an HTML `colspan`, and
these are spans, so a lone cell sat in the label column and a group label
longer than the stop titles under it wrapped inside that column. The layout is
grid + subgrid now — each row is still its own box, so the stripe and the
total's tint survive, and the lone cell spans `1 / -1`. Seen red with the span
removed: the header stopped **115px short** of the table's right edge.

Nothing walked the grouped path at all before this; every other repeat walk
here uses unscheduled stops, which are one group and get no headers.

**"Start from a template above"** (`NotebookScreen.tsx`) — the empty state still
pointed up at a gallery thread 27 moved down. One word.

**The celebration test asserted only that the button had no text**
(`KeepDayFlag.test.tsx`). It holds the square now: equal, non-empty dimensions
before, unchanged after. Seen red with the width forced to 88px.

**The popover is not clipped by the card** — the one finding that was wrong,
and it took two walks to say so honestly. `PageScreen` does put the editor in a
`Card` with `overflow-hidden`, so the reasoning was sound; what is below the
last widget (the insert affordance and 40px of document margin) is enough that
the popover lands inside. The first walk written to check it **passed with the
popover pushed 900px down**, which is worth more than the finding: an element
clipped by `overflow: hidden` still has a box and is still `visible` to
Playwright, and `scrollIntoViewIfNeeded` scrolls an `overflow: hidden`
container itself — bringing into view a strip a person with no scrollbar and no
wheel can never reach. It measures the popover against its clipping ancestor
now, and fails by 804px when the popover is pushed out.


## Thread 29, 18:27 — a table with one column is not a table

> "The date and the city and the text shouldnt all be rolled into each other. Introduce real columns"

- Thread: `8zLyX4dQxCyo`, `/trips/081f2e6d-…/pages/60ec2eae-…`, Chrome 151 on macOS, 1492×836
- Selector: `… > span.tc-widget-table > span.tc-widget-row > span.tc-widget-cell:nth-of-type(2) > span.text-success-ink`
- Maps to: `packages/pages/src/registry-types.ts`, `macros/primitives/rows.ts`, `MacroView.tsx`, `globals.css`

**Fixed**, and it went deeper than the renderer. A repeat row carried a lead
and then a flat `values` list, and every value after the lead landed in ONE
right-hand cell — so a `day.rows` line read "Jun 1, 2027 Rome $84.20" jammed
together, which is exactly what the comment is pointing at.

**A flat list could not have been fixed in the renderer, and that is the whole
finding.** A day that touches two cities has one more value than a day that
touches one, so "the third value" is a date on one row and a city on the next.
There is no column to line up. `RepeatRow` carries `cells` now — one entry per
column, **empty where a row has no answer** — and a resolver decides how many
columns its widget has:

- `day.rows`: date · cities · cost
- `stop.rows`: time · cost
- `city.rows`: which days · how many stops
- `cost.rows`: date · amount — and its lead is `Day 3` alone now, not
  `Day 3 · Jun 3, 2027`. That join was the same mistake one widget over; it
  existed only because the lead was the only place a date could go.

The empty cell is load-bearing: drop it and everything after it shifts a column
left, which is the defect wearing a different hat. The table's
`grid-template-columns` is written by `MacroView` from the widest row, since the
column count is the widget's data rather than a design token. Last column right,
the rest left — figures line up on their own edge, a date reads from where its
column starts.

**Two tests, because the old ones were structurally unable to see this.**
`rows.test.ts` reads rows through a `lines()` helper that flattens the cells
back to a string, so every assertion in that file passes for a widget that
rolled everything into one cell — the reported defect exactly. `cellsOf()` is
the helper that can tell, and `day.rows` now asserts `[date, cities, cost]` per
row including the empties. Seen red with the cells concatenated back together:
`expected [ Array(3) ] to deeply equal [ …(3) ]`, and `lines()` stayed green
throughout, which is the point.

In `MacroView.test.tsx` the claim is that every data row has the SAME number of
cells; seen red at `expected [ 1 ] to deeply equal [ 2 ]`. And the e2e walk over
a grouped `stop.rows` — one scheduled stop with a time, one backlog stop without
— asserts the two rows' cell edges are identical, which is the only place the
ragged case exists. Seen red with empty cells skipped: `expected > 1, received 1`.


## Thread 30, 19:20 — the last raw ISO date

> "Still have the non human readable timestamp here."

- Thread: `DuvX0yo4tmmS`, `/trips/081f2e6d-…/pages/60ec2eae-…`, Chrome 151 on macOS, 1492×836
- Selector: `… > span.block > span.flex:nth-of-type(3) > span.flex > span.font-mono`, on a `day.detail` widget
- Maps to: `packages/pages/src/macros/primitives/block.ts`, `ItineraryTripBlock.tsx`

**Fixed.** "Still", because thread 22 was the same defect in `cost.rows` that
morning and this call site was missed: `dayCard` handed `day.date` through
exactly as storage holds it. Every other string in that payload was already
display-ready — `timeWindow` a joined range, `cost` formatted money — so the
date was the one field crossing the seam raw. It goes through `formatDate` now,
which fixes both the day card and the day table, since they share the payload.

`font-mono` went with it. The face had a job while the field printed
`2027-06-01` — digit columns that line up down a table — and once it reads
"Jun 1, 2027" a monospace face only makes a human date look machine-written
again.

**The test asserting the raw ISO is how this survived a green suite.**
`block.test.ts` pinned `date: "2027-06-01"` as the expected payload, so the
defect was not merely uncaught, it was held in place. It reads through
`formatDate` now — the same reasoning `rows.test.ts` records, that a hard-coded
"Jun 1, 2027" would pass just as happily if the payload went back to the ISO and
someone updated the file to match. The many-day path has its own assertion,
because it renders through a different component and carried the same raw value.
Seen red both ways: `expected [ '2027-06-01', … ] to deeply equal [ 'Jun 1, 2027', … ]`.


## Thread 31, 19:21 — chips in a heading collide when they wrap

> "The second line is overtop the top line"

- Thread: `otYDSjUyIBb0`, `/trips/081f2e6d-…/pages/60ec2eae-…`, Chrome 151 on macOS, 1492×836
- Selector: `… > div.tiptap > h1 > span.react-renderer > span > span.mx-0.5:nth-of-type(11)`, a `city` widget with eleven chips
- Maps to: `apps/web/src/app/globals.css` — the `.tc-page-editor` heading rules

**Fixed.** A widget value is an inline chip: its tint and its `border-b-2` are
painted over the font's content area plus 2px, and vertical padding on an inline
box adds nothing to the line box. The editor's heading scale is deliberately
tight — `--text-2xl--line-height: 1.15`, `--text-xl--line-height: 1.2` — tighter
than the box a chip paints. Measured in the walk: **a 30px chip on a 28.8px line
in an `h2`**. Once eleven city chips wrapped, the second line's tint was drawn
over the first's.

A heading that contains a widget value now gets `line-height: 1.4`. `:has()`
rather than loosening every heading: the tight leading is right for a heading of
words, and only one carrying a chip has anything to make room for. 1.4 clears
the worst case — the 2px rule costs more relative to a small heading than a
large one, so `h4` at 16px needs the most (1.325).

**One chip, no wrapping.** Whether two lines collide is decided by whether one
chip is taller than the line it sits on, which a single widget in a heading can
measure. Reproducing the wrap would have needed eleven cities in an e2e trip to
test the same inequality. Seen red before the rule existed:
`expected <= 28.8, received 30`.

**And the obvious shortening breaks the suite.** Writing the six selectors as
`:is(h1, …, h6):has(…)` throws in jsdom, whose selector engine splits a selector
list on commas before parsing and is left with `h6):has([data-widget-value])`.
`PageEditor.test.tsx` reads these rules against a real editor DOM (KI-44) and
caught it; the CSS carries a note so the next reader does not re-shorten it.


## Thread 32, 20:02 — the same collision in prose, and the general rule

> "This is overlapping to, lets just make sure that all widgets that do inline text consider the border touching the text above or below. expectially if theres another inline text above or below it"

- Thread: `ZdA5Fr5rNGaR`, `/trips/081f2e6d-…/pages/60ec2eae-…`, Chrome 151 on macOS, 1728×836
- Selector: `… > div.tiptap > p:nth-of-type(3) > span.react-renderer:nth-of-type(5) > span > span.mx-0.5`, an `hours` widget
- Maps to: `apps/web/src/app/globals.css` — the `.tc-page-editor` block rules

**Fixed, and thread 31's fix was too narrow.** That one loosened headings only.
Prose has the same defect at a smaller scale and it does not look like an
overlap in a screenshot: `--text-base` is 14px at 1.45, a 20.3px line holding a
**20px** chip, so the tint cleared the line above by three tenths of a pixel.
That is exactly *"the border touching the text above or below"*. Paragraphs and
list items holding a value now get `line-height: 1.7` — 23.8px against 20px, a
gap you can see. Headings keep 1.4 (30px chip, 33.6px line): the 2px rule costs
more relative to a small font than a large one, so the two need different
numbers.

**The walk had to be strengthened before it could see this.** Its claim was
`chip <= line`, which the 0.3px case satisfies — so the prose half PASSED on
first run and the assertion was worth nothing. It asserts **2px of clearance**
now, and covers a chip in prose as well as one in a heading. Seen red with the
prose rule removed: `the chip has no room in P — expected >= 2, received 0.3`.

That makes five assertions this round that were green over a live defect, and
the second of them found by tightening a test I had just written.

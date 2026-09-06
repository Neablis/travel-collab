# UI feedback round — 2026-09-06 (live preview)

**Status, as of 10:45: twenty threads — fifteen fixed, two answered, three
open.** This file exists so Mitchell has a preview deployment to comment on
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

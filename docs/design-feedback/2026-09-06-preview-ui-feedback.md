# UI feedback round — 2026-09-06 (live preview)

**Status: open, collecting.** This file exists so Mitchell has a preview
deployment to comment on and a place for those comments to land. Nothing has
been triaged or fixed yet.

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

Six threads, in the order left. Detail below the table. **Nothing is fixed
yet** — the branch is still prose-only and awaiting a decision on scope.

| # | Route / surface | Viewport | What's wrong | Outcome |
| - | --------------- | -------- | ------------ | ------- |
| 1 | `/signin` — dev-login submit | 1728×836 | Dev-login button is the faintest control on a screen where it is the only one that works | Open |
| 2 | `/signup?error=MISSING_INVITE_CODE` | 1728×836 | Error copy is one dense line; wants two, and the em dash dropped | Open |
| 3 | `/` — first-trip card | 1728×836 | "Look around an example trip" doesn't read as a button | Open |
| 4 | `/demo?lens=Map&view=Calendar` | 1728×836 | Travel lines drawn for every day; should be the selected day only | Open — **behaviour, not cosmetics** |
| 5 | Notebook page — widget chrome | 1728×836 | Widget option select is inline, pushing content; should overlay | Open |
| 6 | Notebook page — `day.rows` | 1728×836 | Renders as stacked spans; the design says a real table | Open — **architectural** |

**Two pairs worth reading together.** 1 and 3 are the same complaint about the
same thing: `variant="ghost"` does not read as an actionable control. 5 and 6
are both the Notebook's widget rendering, and 6 is the only item here that
cannot be done as a styling change.

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

**This one is not cosmetics.** Every other item here changes how something
looks; this changes what is drawn, keyed on selection state, so it needs the
map lens to know the selected day and re-render its legs when that changes. It
also cites "the designs" as the target, which means the design source should be
read before implementing rather than inferring the intended end state from the
comment.

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
regressed. `day.rows` is not `shape === "single"`, so it should already be
taking the `stacked` branch — worth checking on the live page which branch it
actually renders before changing the rule.

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

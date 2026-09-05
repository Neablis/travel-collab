# The phone surface — what is built, and what is left

Written 2026-09-05, when PR #143 merged (`3558685`). This is the durable half of
that work's handover; `docs/STATUS.md` keeps the pointer.

**This is not a milestone file, and that is the point.** `TODO.md:537` records
the gap it sits in: *"no milestone in this file owns the phone at all … placing
the phone is a milestone-sized decision, not something to bolt onto whichever
milestone touches a screen next."* `KI-046` says the same from the other side.
Nothing below changes that — it is an inventory so the decision can be made with
the real numbers, not a substitute for making it.

## What is built (on `main` as of `3558685`)

- **`PhoneTabBar`** — SPEC §22's scoped bar: Plan / Map / Notebook inside a trip,
  Trips / Playbooks outside, **no disabled tabs**. Active tab is a 46×26
  `--color-brand-tint` pill behind the glyph. Holds no state; every tab derives
  from `usePathname()` + `?lens=` and is a real `<Link>` (DRIFT build-check 4).
  Carries an SSR-safe `PhoneTabBarFallback` — see the gotchas below.
- **A 44px primitive** — `Button`'s `touch` size (`min-h-11 min-w-11`, `md`'s type
  scale, because §13.1 grows the box and never the font).
- **`Sheet`'s optional Cancel / title / Save header** (§13.6). **No callers yet.**
- **SPEC §10's "two views, not four"** — the *default* lens is normalised to
  Timeline on a phone; an explicit `?lens=` is honoured deliberately (see below).
  The lens strip, the header's Trips/Playbooks links and the Notebooks pill are
  all hidden below 768px.
- **Two ways out that §22 made load-bearing** — `← Your trips` added to the phone
  Notebook index (it had none, and scoping the bar removed the Trips tab it had
  relied on) and raised to 44px; the account avatar keeps its 30px circle and
  gains a 44px hit box (`.phone-hit-44`), being the only account-scope control a
  phone now has.
- **The unscheduled rack sits above the tab bar** rather than under it.
- **The day chip's clear `×` is hidden on read-only trips** — it read as "delete
  this day" on a trip you cannot edit (Mitchell, preview, 2026-09-05).
- **Two pre-existing defects fixed on the way**: `--launcher-height` published
  `0px` while the in-flow launcher was 56px, so the phone Map overflowed by
  exactly that; and the day-column jump lock let the scroll spy overwrite an
  explicit pick at any width where more than ~two columns fit.

## What is left, roughly in order

### 1. SPEC §23 — the assistant reaches the phone — **BUILT 2026-09-05**

Built in PR #148; `test:e2e:ci-like` 91 passed plus a browser walk at 412×856.
**§23's job is unification** — one pill, one label, one position across all four
in-trip phone screens — and the drift it fixes was worse than the paragraph below
records: the phone had an assistant on three of four screens, in three different
places (an in-flow `◎ Assistant` at the end of the plan column on Plan and Map,
another beside "Edit page" on an open page, nothing on the Notebook index). The
sentence below is kept as written so the correction stays legible. One
consequence the design does not mention: §23's sheet **reverses KI-84**, and
Mitchell chose it knowingly. See `KI-2026-09-05-aa`, and STATUS.md for what §23
left open.

The newest design (2026-09-05) and wholly unbuilt: **there is no phone assistant
in the code at all**, so this is design ahead of build, not drift. `DRIFT.md` §2i
states what a build owes. The load-bearing decision is that the `Ask` pill is
**not a fourth tab** — a tab is a destination and must invent a trip-wide scope,
losing the day or page you were reading. The sheet inherits the surface's scope
and prints it. Proposals reuse the **desktop ghost path**; there is deliberately
no phone-only proposal type.

Two holes it opens are **undesigned** — do not invent copy for either
(`DRIFT.md` §8): the pill has no entitlement-gated state for a Free user (§17
puts `ai.ask` behind Plus), and there is still no phone entry point for "Save
this day as a Playbook".

### 2. The 44px migration — the biggest gap, and barely started

The primitive exists and is **essentially unused**. Measured on the phone trip
board at 412×893 after #143 merged: **189 of 209 interactive controls are under
44px (90%)**. The pre-work audit measured 84% (79/94) — the ratio moved the wrong
way because the phone now lands on Timeline, which renders more controls than Day
columns did, not because anything regressed.

`Add stop` and `History` are 36px; `Ask`, `Edit` and `Keep day` are 28–30px.
§13.1 names tag chips specifically: *"chips grow by `min-height`, never by font
size."*

### 3. The phone Map chrome

Design file lines ~404-431. **No SPEC section**, which is itself worth noting
before building. Two halves of very different size:

- **The bottom day panel** is self-contained — grab handle, `Day 1 · Tokyo` plus
  the date, then `4 stops · 8h out · $990`. The data already exists;
  `TimelineLens` renders the same stats via `formatDuration(outMinutes, "out")`.
- **The compact top bar** (`‹ Trips` / city / avatar, then the day rail) is an
  **architecture decision, not a component**. The design's phone screens each
  draw their own header, so matching it means the phone stops rendering the
  global `AppHeader` from `(app)/layout.tsx` — a change to the layout every
  authenticated route shares. Get that confirmed before building it. §23's
  knock-on header changes point the same way, so doing §23 first settles the
  shape.

### 4. Smaller, well-specified

- **Migrate a caller onto `Sheet`'s `actions` header**, so §13.6 is real in the
  product rather than only in the primitive. `WidgetInsert.tsx` carries a comment
  reading *"Cancel is the Sheet's own close button"* — whoever migrates it must
  move that Cancel into `actions` rather than leave the comment pointing at a
  button that no longer exists.
- **§13.2's flush 3px city spines** on Board stop cards. Timeline already has them.

### 5. Known defects left open

- **`--rack-height` publishes `0px` while the rack is 39px**, so the fixed rack
  bar overlaps the day columns it exists to clear. Same root cause as the
  launcher bug that was fixed. **It has a trap:** the rack's ref observes its
  wrapper's *child*, the wrapper stays mounted while the child comes and goes,
  and `MapLens` subtracts that variable — so the obvious same-shape fix strands a
  stale 39px and opens a gap on the Map. Today's `0px` is accidentally correct
  there.
- **Two `PageAssistant.test.tsx` unit tests fail intermittently** and are
  pre-existing (identical at `0b79e59`). **No KI is filed for them.**

### 6. Blocked on design

- **The phone conflict state** — the last of `RULES.md` rule 6. SPEC §13 says the
  mobile equivalent is *"undecided"*. Do not invent copy.

## One decision that was made and then not honoured

Mitchell chose, when asked directly, that the unscheduled rack should **become a
bottom sheet** on the phone. That was not built. What shipped instead lifts the
rack above the tab bar — a fix for the overlap defect, not the design that was
chosen. The rack is now in an in-between state worth resolving deliberately: it
only renders on the Board lens, which §10 keeps out of the phone's UI, so on a
phone it is reachable only by an explicit `?lens=Board` link. "Hide it on the
phone entirely" may now be the better answer than either.

## Gotchas that cost real time to rediscover

- **Only `pnpm --filter web test:e2e:ci-like` is a verdict** (CLAUDE.md rule 1).
  The dev lane fails ~5 tests under load purely from cold compiles — KI-27's
  signature. `m1-board` fails inside a two-minute combined run and passes alone
  in 9s.
- **Node 26 breaks the local unit lane** — `pendingDemoClone.test.ts` and
  `app/(app)/page.test.tsx`, 12 failures on `window.localStorage` being
  undefined. **KI-2026-09-02-a.** CI runs Node 22 and is green. Do not chase it.
- **The colour wall bans arbitrary Tailwind values.** Design-fixed geometry with
  no token equivalent becomes a named class in `globals.css` — `.phone-tab-pill`
  (46×26) and `.phone-hit-44` are the precedents.
- **The lint wall bans `container.querySelector`** in tests outside
  `components/ui`, and treats token/presentation classes as a test contract only
  inside `components/ui`. Use `data-testid` for a styling seam;
  `trip-board-content` and `phone-tab-pill` both exist for that reason.
- **Anything `position: fixed` and bottom-anchored must offset by
  `--phone-tab-bar-height`.** It has both a CSS fallback at the breakpoint and a
  JS measurement, and the CSS one is not redundant: a JS-only reservation left an
  83px gap with no navigation in it before hydration.
- **`useIsPhone` starts `false` on SSR and the first client paint by design.**
  Anything that would flash must use a CSS breakpoint (`md:` / `max-md:`).
- **An explicit `?lens=` is honoured on a phone on purpose.** `usePhoneTwoViews`
  rewrites only the *default* lens. Rewriting an explicit one discards a URL
  someone is holding, and it broke `m10-growth`'s day-sync spec, which loads
  `?lens=Board` to force ten columns off-screen.
- **The Vercel preview is behind deployment protection** — it cannot be driven.
  Reproduce locally at the same commit.
- **`Vercel Preview Comments` fails when a preview toolbar thread is
  unresolved.** It is a feedback gate, not a code check.
- **CodeRabbit posts a green status while skipping.** Its green is not evidence
  (AGENTS.md, KI-2026-09-01); it must be triggered manually.

## Where to read in

- `.design-sync/handoff/SPEC.md` — §10, §13, §16, §22, **§23**
- `.design-sync/handoff/DRIFT.md` — **§2i**, §2h, build-check 4c, §8
- `.design-sync/handoff/RULES.md` — the six binding project rules
- `TODO.md:537` — why no milestone owns the phone

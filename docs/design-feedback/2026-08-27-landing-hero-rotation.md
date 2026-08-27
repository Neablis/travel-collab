# Landing hero rotation — the build now contradicts SPEC §14 on purpose

**Date:** 2026-08-27 · **Branch:** `claude/landing-page-design-review-ivv7ib` · **PR #58**
**Audience:** whoever writes the next `.design-sync/handoff/` bundle.

One deliberate divergence, one stale number. Both are design-side to settle; neither
is a build defect, and neither should be filed as drift on the next sync.

## 1. A day-pill click STOPS the rotation. SPEC §14 says it restarts the timer.

SPEC §14 (2026-08-26) says of the rotating hero:

> Day pills read only "Day 5", no view labels; clicking one jumps to it and restarts
> the timer.

**The build does not restart the timer. It ends the rotation for the rest of the
visit.** Decided by Mitchell on 2026-08-27, after CodeRabbit raised the same gap
independently on PR #58.

The reasoning is accessibility, and it is the stronger argument:

- WCAG **2.2.2 (Pause, Stop, Hide)** wants a mechanism to stop content that moves,
  blinks or scrolls automatically. A restart-on-click carousel never provides one —
  every control it offers restarts the thing you wanted stopped.
- It is actively hostile in the specific case it is meant to serve: a reader who
  clicks "Day 5" has *told you what they want to look at*, and ten seconds later it
  is taken away from them.
- The day pills are now that stop mechanism. They are labelled, focusable, carry
  `aria-pressed`, and their group is named "Preview day — choosing one stops the
  preview rotating" so the behaviour is discoverable to a screen reader rather than
  being a hidden side effect.

**Note that this is what the design file itself already said.** `heroStart()`'s own
comment reads:

> The landing hero cycles three real views of the same trip. A click on a day
> stops the rotation for good — once you have chosen, it should stay put.

The design file's `d.pick` handler calls `heroStart()` again, contradicting that
comment, and SPEC §14 wrote down the handler's behaviour rather than the comment's.
The build has landed on the comment. **Please update SPEC §14 and make `d.pick`
agree with its own comment**, so the next sync does not read this as drift.

Related, and unchanged: the rotation also does not run at all under
`prefers-reduced-motion`. That has no counterpart in the design either — the design
rotates unconditionally — and is the same accessibility argument. Worth stating in
SPEC §14 alongside the above.

## 2. The Notebook block's cost table totals $550, not SPEC §14's $596.

SPEC §14 says "activity / who / cost, Day 6 total $596". The design file's own table
is `$340 + $210` and labels the total **$550**. The build follows the design file,
because it is the internally consistent one and `README.md` makes it authoritative
for copy. A unit test asserts `$550` explicitly with this reasoning inline, so nobody
"corrects" it upward later.

**$596 appears nowhere except SPEC §14.** Please fix the SPEC.

## 3. The hero art drops its map labels below `lg` — the phone treatment is build-side

The design file is desktop-only, so this is invented rather than transcribed, and it
should be either blessed or replaced when a phone landing design exists.

**The problem is arithmetic, not a positioning slip.** Each map pin group is centred on
its coordinate (`-translate-x-1/2`). With its label attached the group is ~161px wide,
so the first pin — anchored at `left: 14%` — only clears the left edge once the art box
exceeds ~575px. Measured clipping of that pin, at the widths `STATUS.md`'s audit walks
and below:

| viewport | pin 1 left edge |
|---|---|
| 1280px / 1024px | +656 / +520 (clean) |
| 402px | −4px |
| 375px | −8px |
| 360px | −10px |
| 320px | −15px |

Re-anchoring does not fix it, it relocates it: drop the centring and pin 3 (at 70%) goes
off the right edge instead. Three labelled pins spread across 14–70% of a ~300px box do
not fit at any anchoring.

**Chosen (Mitchell, 2026-08-27): labels render from `lg` up only.** Below that the map
keeps its route line, its three numbered pins, the comment thread and the presence pill —
a 28px circle fits comfortably (pin 1 at 28.6px, pin 3 at 227px at 320px wide). What a
phone loses is the place names.

Rejected, and why, so the design side has the tradeoffs rather than just the outcome:
hiding the art entirely below `lg` was the smallest change but costs the whole rotating
showcase on every phone; scaling the illustration preserves the composition exactly but
pushes its 11px labels under 6px, well through the 12px legibility floor
`design-system.md` sets; accepting the clip was defensible on the letter of
"below 1024px is best-effort" but leaves a sliced pin on the product's front door.

`responsive.spec.ts` holds both halves: nothing in the art is clipped at 402/375/320, and
the labels are still present at 1280 — the second matters because a `hidden lg:inline`
that never turned back on would satisfy the first perfectly by showing nothing anywhere.

**If the phone landing gets a real design, this is the first thing to replace.**

## 4. Not a divergence, just a heads-up: the feature grid is `lg:`, not `md:`.

The design file is a desktop-only mock, so the responsive behaviour is the build's
invention and not something you specified. Recording the constraint in case a future
version of this block changes shape: at the `md` breakpoint (768px) each of the three
cards is ~225px, and after the Playbooks strip's two fixed 62px jungle days and their
gaps, the borrowed Day 2 card is left ~51px — about 17px of usable text width. Its
stop rows cannot render. The grid therefore goes three-up only at `lg` (1024px) and
is single-column below that. An e2e assertion in `responsive.spec.ts` holds it.

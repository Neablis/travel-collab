# Design-system items owed upstream

These are **not** trip-planner tasks. Each one is a change to the `travel-collab`
design-system package (`TravelCollabUI`). They were found while building the design and
have been worked around in the design file; the workaround is the bug, not the fix.

Raise each as an issue against the design-system repo. Until they land, the design file
will keep containing per-consumer patches that implementers should **not** copy.

---

## U1 — `Sheet` scroll body clips `Input`'s focus ring

**Severity: high — accessibility.** Every full-width input in every Sheet loses its left
and right focus ring.

`Sheet`'s body is `<div className="flex-1 overflow-y-auto">`. `overflow-y: auto` forces
`overflow-x: auto`, so the element becomes a scroll box that clips paint outside its
padding edge. `Input` draws `outline-2 outline-offset-1` — 3px outside its border box —
which lands in the clipped region.

**Fix:** horizontal padding on `Sheet`'s scroll div (or move the padding from the content
to the scroller). Audit `Dialog` for the same shape — any scroller with one-sided padding
has it.

**Design-side workaround in place:** per-Sheet inline padding. Remove it when U1 lands.

## U2 — No city-accent scale

The product needs a repeatable set of accent colours to identify a **place**: the same
city must be the same colour in every trip, every view, forever. The DS ships semantic
colours only (brand / success / warning / danger / info), which carry meaning and cannot
be reused as identity.

Both design files now implement the same scale independently:

```
hues  25 · 60 · 95 · 130 · 165 · 200 · 240 · 280 · 315 · 350
tint  oklch(0.945 0.042 <hue>)
ink   oklch(0.44  0.115 <hue>)
solid oklch(0.50  0.125 <hue>)
```

Ten hues at the tint/ink lightness the DS tokens already use, spaced **at least 35° apart**.
Assignment is FNV-1a over the lower-cased city name, modulo 10, with forward linear probing
on collision.

**The 35° floor is a hard requirement, not a preference.** The first version of this ramp
was built to include the DS's own hues (brand 170, success 150, info 250, warning 80,
danger 30) plus in-betweens, which put two pairs 20° apart. At the tint chroma (C=0.042) a
20° difference is not perceptible at chip size: Tokyo (150) and Hakone (170) landed on
adjacent days in the day rail and read as one city, with only the 2px selection ring
separating them. Distinguishability *between any two hues in the ramp* is the whole point —
harmony with the semantic palette is secondary, and a scale that includes both success and
brand cannot have both.

**Ship a non-CSS accessor with it.** The ramp is `oklch()`, which CSS resolves but most
other consumers do not: MapLibre rejects it as a paint colour and falls back to black, and
canvas/SVG/chart libraries have the same limitation. Note that the usual browser-based
conversion tricks do **not** help: both canvas `fillStyle` and `getComputedStyle` preserve
modern colour syntax verbatim rather than downconverting it, so a consumer that reaches for
either gets its input back and ships a silently-black element. The conversion has to be
arithmetic. The DS should expose each accent as a
plain sRGB string alongside the custom property, so consumers are not each writing their own
conversion (or, worse, a hardcoded hex twin that drifts when the hues move).

**Fix:** ship the scale as tokens (`--accent-<n>-tint|ink|solid`) plus the hash helper.
Two consumers reimplementing a colour algorithm is how the same city ends up two colours.

**Two known limits to resolve while shipping it:**

1. **Saturation.** Ten buckets, and the current seed data has exactly ten cities — the
   eleventh forces a duplicate. Widening the ramp is not free: 35° spacing over the full
   circle caps it at ten. Going further needs a second dimension (chroma or lightness
   step), not more hues.
2. **Perceptual spacing must be enforced, not assumed.** Any future edit to the hue list
   should be checked for a minimum pairwise gap; the failure mode is silent and only shows
   up when two near-neighbour cities happen to land on adjacent days.

## U3 — No icon-button, chip, or menu-item primitive

The desktop design file contains **58 raw `<button>` elements**. Almost none of them are a
missing `Button` usage — they are three patterns the DS does not ship:

| Pattern | Where it appears | What it needs |
|---|---|---|
| Icon button | trip header actions, card overflow, rail controls | `Button size="icon"` exists but has no unlabelled/borderless resting state; needs a real variant + required `aria-label` |
| Toggle chip | tag filters, day chips, "Kept" flag | pill, 3 states (rest / active / disabled), tint+ink pair driven by a colour prop |
| Menu item row | account menu, Notebooks menu, History entries | leading icon, label, optional trailing badge or shortcut, inside `Popover` |

Every one of these is currently hand-styled inline. They are the highest-value
additions to the DS by usage count.

**Fix:** `IconButton`, `Chip`, `MenuItem`.

## U4 — Precompiled bundle has no Tailwind JIT

Arbitrary utilities (`max-h-[min(420px,80vh)]`, `w-[52px]`) are inert against the shipped
`_ds_bundle.css`, because nothing compiles them. In the real app the JIT handles them, so
this is a **design-file** constraint, not a product bug — but it has a real consequence:
values that would be utility classes in the app appear as inline styles in the design
file, and an implementer cannot tell which inline styles are intentional.

**Fix (pick one):** ship a safelist covering the arbitrary values the design files use, or
document that the bundle is class-complete only for the token set and that arbitrary
utilities must never appear in a design file. The second is cheaper and is what the
handoff README currently tells implementers.

## U5 — Baseline sync is one-way and partial

**Corrected 2026-08-26.** This entry originally said the DS ships no per-component docs.
That was wrong, and the correction narrows the ask considerably: the source repo **does**
carry them — `.design-sync/docs-stubs/*.md` (31 files) and `.design-sync/previews/*.tsx`
(30 rich previews, deliberately authored rather than floor cards). They exist; they just
**do not survive into the vendored snapshot**.

The copy vendored into this project (`_ds/travel-collab-ui-baseline-…/`) is the compiled
bundle and manifest only — no per-component docs, no `*.d.ts`, no variant grids, no
`tokens/*.css`. So prop shapes have to be inferred from the bundle even though a written
doc for each component exists upstream.

Consequence: findings like U1–U3 accumulate in this project's `DRIFT.md` and have no route
back to the DS. That is what this file is for, and it is a stopgap.

**Fix:** carry `docs-stubs/` (and the previews' variant grids) through into the vendored
baseline, and give the DS an intake path for consumer-found bugs.

### U5b — staleness in this pipeline is undetectable, but nothing is stale today

**Corrected 2026-08-26, second time.** I first wrote this up as "the shipped bundle is
flagged stale", citing `ds-bundle/_ds_needs_recompile`. That was reading a leftover marker as
a live signal. `.resync-verdict.json` settles it: all 30 components appear under `added`,
with `changed`, `unchanged` and `removed` all empty — the record of the **initial** sync — and
the marker file was written by the same run. `componentCount: 30` matches the manifest we
consume. **No component has changed since that build, so there is nothing for the bundle to
be stale against, and no recompile is owed.**

What survives is narrower and still worth fixing, because it is about detectability rather
than a current defect: `globals.css` is Tailwind v4 *source*, and the sync appends `cssEntry`
**verbatim** without running PostCSS, so `scripts/design-sync-tailwind.mjs` must precede every
build and the pipeline's own notes say a stale `.ds-compiled.css` **"silently ships old
styles."** Nothing fails; the bundle renders the previous truth. That is a real trap for the
*next* sync — the one that does change something — not a claim about this artifact.

Note this is also the honest explanation of U4: arbitrary Tailwind utilities are inert for
consumers because nothing compiles them at bundle time. Pipeline property, not a design-file
rule to be lifted.

**Fix:** stamp the bundle with the compile's source hash so a consumer can distinguish a
stale baseline from a current one, and make the recompile a build gate rather than a marker
file that outlives its run.

**Checked and currently fine:** the font bridge. `.design-sync/fonts-src/fonts.css` still
matches `layout.tsx` exactly (Bricolage 500/600, IBM Plex Sans 400/500/600, IBM Plex Mono
400/500), so the documented silent-font-staleness risk is not live as of this sync.

## U6 — Mobile is a variant layer, not a second system

The phone is now a surface of the desktop design file rather than a second file, so it
already shares the accent scale, the trip data and the interaction logic. What it still
cannot do is express its five recurring touch patterns through the DS, so every one of
them is hand-styled inline.

**These should ship as variants of existing components, not as a mobile package.** A
separate mobile system is how the two surfaces drift apart again — the same drift this
project just spent a full pass closing. Three of the five already have a desktop
counterpart doing the same job at a different size; treat the phone as a size, not a
product.

| # | Pattern | Proposal | Desktop counterpart |
|---|---|---|---|
| a | **Day-rail chip** — 62px, city tint ground, ink label + date, dot row for stop count, 2px brand ring when selected | `DayChip` with `orientation` (row \| column) and `density` (compact \| touch). One component, two layouts | Desktop day-chips strip and the Map rail are the same element at different sizes — currently two hand-built implementations |
| b | **Touch tag chip** — pill, tint+ink pair from a colour prop, three states, 44px floor | `size="touch"` on the `Chip` proposed in **U3**. Not a new component | Desktop tag chips, at 30px |
| c | **Flush-spine stop card** — accent spine running the card's full height at the padding edge, dashed when the stop is not committed | `Card` gains `spine` (colour) + `spineStyle` (solid \| dashed). Cheap, and it removes the `p-0` + inner-padding workaround used in both surfaces | Desktop timeline card, 4px spine — same treatment, same workaround |
| d | **Sheet header** — Cancel / title / Save, three-up | `Sheet` gains a `header` variant for the mobile convention. Mobile has no top bar to hang actions on, so the sheet must own them | Desktop `Sheet` uses title + close; genuinely different, hence a variant rather than a shared default |
| e | **Bottom tab bar** — four destinations, icon over label, active in brand | `TabBar`, new. The only one of the five with no desktop counterpart — desktop navigates by `TabStrip` inside the trip, not by app-level tabs | None |

**Sequence.** (b) and (c) are prop additions to components that already exist and would
delete the most inline styling for the least risk — do them first. (a) is the valuable one,
because it collapses two existing hand-built desktop implementations as well. (d) and (e)
are new surface area and should wait until the mobile screens past Day 6 are designed, so
the API is drawn from more than one example.

**Do not** add a mobile breakpoint system as part of this. Mobile scope is settled (SPEC
§10: retrieval and small edits, not planning) and the two designs are deliberately
different layouts, not one responsive layout — these variants are picked explicitly, not
by media query.

# Save this day as a Playbook — the full experience

**Written 2026-09-04**, read out of the design file rather than from memory. Source of
record for this flow. Companion to `SPEC.md` §15 (Playbooks as a public library) and §16
(the shared day, Playbooks on the phone).

Everything below exists and runs in
`design/Trip Planner Redesign.dc.html`. Nothing about it was in `SPEC.md`, which is why a
build could not find it. Line references are to that file.

---

## 1. What it is, in one sentence

**A day becomes a standalone, dateless day you can drop into any trip** — the stops, their
order, the gaps between them and the notes, without the date.

That last clause is the whole feature. A Playbook is not a copy of a day; it is a day with
its calendar removed, which is why it can be inserted anywhere and why the insert flow
(`Insert a saved day into a trip`) can talk about shifting dates rather than merging times.

---

## 2. Entry point — the flag button in the day header

**The only entry point today.** It lives in the day header's meta row
(`[data-r="dayhead"]`, line 1212), after the day's stop count / overlap badge and before
**Add stop**.

```
Day 8 · Kyoto   6 stops · 8h out   [⚑]  [Add stop]
```

- A **30px-tall pill**, `min-width: 30px`, `padding: 0 7px`, `border-radius: 999px`,
  1px transparent border (lines 36–41).
- A **16px flag glyph**, 1.6 stroke, drawn as two paths: the pole (`M4 14V2.6`) and the
  banner, which is the element that fills.
- Hover: `translateY(-1px)` and the border turns `--color-brand`; the glyph does a
  **wave** — `rotate(0 → -11deg @40% → +5deg @70% → 0)`, transform origin `4px 14px` (the
  base of the pole, so it waves like a flag rather than spinning). Fired on
  `mouseEnter`, also available as the `pbWave` keyframe (line 35).

### Its three states — `data-kept`

| `data-kept` | When | Looks like |
|---|---|---|
| `0` | this day is not saved | transparent pill, outlined glyph, ink text |
| `1` | this day is in your Playbooks | **brand** pill, **filled** glyph, surface-coloured |
| `2` | just saved, for 2700ms | as `1`, plus the word **Kept** revealed beside the glyph |

The glyph's fill has a resting `transition: fill 260ms ease`, so the state change reads
even if the celebration below never runs.

**Accessible name and tooltip change with state** — `Keep this day as a Playbook` when
unsaved, `In your Playbooks — edit or share` when saved. Both are on `title` **and**
`aria-label`.

---

## 3. The dialog

`TravelCollabUI.Dialog`, title **“Save this day as a Playbook”** (line 3039). Body scrolls
at `max-height: 56vh`; the footer does not.

1. **Lede**, and it is load-bearing copy — say this, not a paraphrase:
   > Day 8 of Japan becomes a standalone day. It keeps the order, the gaps between stops
   > and the notes — but not the date, so it fits any trip.
2. **Name** — a `FormField` + `Input`, **prefilled** `"<City> — day <N>"` (e.g.
   `Kyoto — day 8`). Never blank: the common case is confirming, not typing.
3. **Include** — four chips: `Times`, `Travel between stops`, `Notes`, `Costs`.
   ⚠️ **In the design these only toast** (line 7503). See open question 1.
4. **Preview** — the day's own stops, time + name, from `daySummaryFor(dayIndex)`
   (line 6566). It is the day as it stands, not a sample; this is the one preview in the
   product that *should* show live values, because the user is about to save exactly it.
5. **Who can use it** — a `SegmentedControl`: `Just me` / **`Anyone with the link`**
   (default) / `This trip`. Stored as `private | link | crew`.
6. **Footer** — `Cancel` (ghost) and **`Keep this day`** (primary).

The primary is *not* “Save” — “Keep this day” is the same verb the flag's tooltip uses, so
the button, the tooltip and the resulting state all say one word for one act.

---

## 4. What happens on confirm

In order (line 7507):

1. The dialog closes immediately. **No confirmation step, no second dialog.**
2. The day index joins `savedDays` — idempotent: saving an already-kept day does not
   duplicate it.
3. `justKept = dayIndex`, which puts the button in state `2`.
4. On the **next animation frame**, `celebrate(dayIndex)` runs (§5). Next frame, not
   immediately, because the button must already be re-rendered in its kept state before it
   is animated.
5. A toast: **“Kept in your Playbooks · link copied”**, 2400ms.
6. At **2700ms**, `justKept` clears and the button settles into state `1`.

**The button is the receipt, not the toast.** The toast is gone in 2.4s; the filled flag
is permanent and is what tells you tomorrow that this day is saved. A build that ships the
toast without the persistent state has shipped the wrong half.

The clipboard write is real and is implied by the toast: **confirming with visibility
`link` copies the link**. If the build cannot copy, the toast must not claim it did.

---

## 5. The animation, exactly

`celebrate(i)` (line 4876). All of it is Web Animations API — `el.animate(frames, opts)`
via the `anim()` helper (line 4868), which pins `startTime` to
`document.timeline.currentTime` so every layer starts on the same frame instead of
drifting. It resolves five elements inside `[data-flag="<dayIndex>"]`:

| Element | Selector |
|---|---|
| the pill | `[data-pb="flag"]` |
| the `Kept` label | `[data-lbl]` |
| the flag's banner path | `[data-fill]` |
| the ring | `[data-ring]` — absolute, `inset: -5px`, 2px brand border |
| four sparks | `[data-spark]` — 4–5px brand dots at fixed offsets |

The ring and sparks are **absolutely-positioned siblings with `pointer-events: none`**, so
nothing in the header moves or becomes unclickable while they play.

```
 0ms ─┬─ pill      scale 1 → 0.84 @20% → 1.12 @50% → 1        540ms  ease-out
      ├─ pill      bg surface→brand, text ink→surface         280ms  ease-out, fill forwards
      ├─ banner    fill transparent → currentColor            320ms  ease-out, fill forwards
      ├─ ring      scale 0.6 → 1.75, opacity 0.9 → 0          700ms  ease-out
      ├─ sparks    (see below)                                780ms  ease-out, staggered
      └─ label     maxWidth 0 → 52px @14% … hold … → 0       2600ms  cubic-bezier(.2,1,.3,1)
2700ms ── state 2 → state 1
```

**Sparks** — four, each translating out from the pill's centre and fading, at 30% of the
distance by `offset: 0.3` (so they accelerate outward then decay):

| # | Travel | Delay | Scale |
|---|---|---|---|
| 1 | `-14px, -20px` | 0ms | 0.3 → 1 → 0.7 |
| 2 | `+2px, -26px` | 60ms | " |
| 3 | `+18px, -18px` | 40ms | " |
| 4 | `+12px, +20px` | 120ms | " |

Three of four go **up**, one goes down-right. Not symmetric on purpose — a symmetric burst
reads as a loading spinner.

**The label's shape is the point.** It expands to 52px, holds from 14% to 86% of 2600ms
(≈1.9s of legible “Kept”), then collapses to zero width. So the header shows the word long
enough to read and then returns to its original width — the button never permanently widens
the day header, which is why it can live in a row that also holds the stop count, an
overlap badge and Add stop.

**Order of confidence:** colour lands in 280ms, fill by 320ms, the burst is over by ~900ms,
and the word carries the rest. If a build has to cut something, cut the sparks and the ring
— never the colour/fill (that is the state) or the label (that is the confirmation).

### Reduced motion — owed, not designed

`prefers-reduced-motion` is **not honoured in the design file**, and it should be: keep the
state change, the colour and the fill (they carry meaning), drop the scale bounce, the ring
and the sparks, and show the label without the width animation. Flagged rather than
invented — it is a real gap in this flow.

---

## 6. Where a kept day shows up afterwards

- **Home** — “Your Playbooks”, a 4-up grid of cards, under the line *“Saved days you can
  drop into any trip. Times shift to fit the day you drop them on.”*
- **Playbooks** (`route: playbooks`) — Discover, where your own days carry a `Yours`
  origin badge (§15).
- **The insert flow** — “Ready to drop in” lists them at the end of the board and in the
  unscheduled rack; `Insert a saved day into a trip` is the dialog that places one.
  Inserting **adds a day** — the trip gets longer and every later day slides — it never
  merges into an existing day (line 4227).

---

## 7. What a build owes

1. A **playbook record**: name, visibility (`private | link | crew`), the day snapshot
   (stops with their order and relative gaps, notes, optionally costs), the trip and day it
   came from, and an author.
2. **No dates in the snapshot.** Store offsets from the day's start, not timestamps. This
   is the invariant the whole feature rests on.
3. A **publish/save route**, idempotent per (day, user) so a second Keep updates rather
   than duplicating.
4. The **link copy** on confirm when visibility is `link`.
5. The **three button states** driven by whether a playbook exists for this day — not by
   local component state, or a reload will forget.
6. `prefers-reduced-motion` handling per §5.

---

## 8. Open questions — the design's, not a build's

1. **What do the four Include chips actually do?** In the design they toast and nothing
   else, and they have no on/off rendering. Two readings: they are filters on the snapshot
   (drop times → the Playbook is an ordered list with no clock; drop costs → no money
   travels with it), or they are a preview of what will be included and not editable at
   all. **The first is more useful and more expensive.** Needs a call before it is built,
   because “drop times” changes the stored shape.
2. **Does `Anyone with the link` publish into Discover?** §15's library lists days with
   ratings and add counts. A link-visible day and a *listed* day are not obviously the same
   thing, and the dialog offers no third option.
3. **Multi-day Playbooks.** The insert side already handles them (`days: N`, and the
   insert dialog speaks of N days sliding), but this dialog only ever saves **one** day.
   Where does a two-day Playbook come from?
4. **No phone entry point.** The flag lives in the desktop day header; the phone's Plan tab
   has no equivalent, and §16 gave the phone Playbooks *browsing* only. Saving a day from
   the phone is undesigned.
5. **Editing a kept day.** The tooltip promises *“In your Playbooks — edit or share”*, and
   clicking a kept flag today re-opens the same Save dialog. Whether that is Edit — and
   whether editing a Playbook re-syncs the day it came from — is unspecified. It should not:
   a Playbook is a snapshot, not a live view of the day.

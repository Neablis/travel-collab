# Sun and weather widgets — graphic by default, table on request

**Date:** 2026-09-30
**Status:** design approved by Mitchell 2026-09-30; implementation plan not yet written.
**Design source:** `.design-sync/handoff/specs/sun-and-weather-widgets.md`, with geometry in
`.design-sync/handoff/design/Sun and Weather Widgets.dc.html` (picks **1a** daylight ribbons and
**2a** temperature rows) and `design/Trip Planner Redesign.dc.html` (Overview → *Before you go*,
Notebook, phone).

## What changes

"Weather" (`day.weather`) and "Sunrise and sunset" (`day.sun`) each gain one setting,
**Show as: Graphic · Table**, default **Graphic**. The graphic is the new design; the table is the
accessible and printable reading of the same rows. Every weather and sun widget already on a page
switches to the graphic, because an absent `view` means `graphic`.

## Decisions (Mitchell, 2026-09-30)

| Question | Decision |
|---|---|
| Replace or add beside? | **Follow the handoff spec**: graphic is the default everywhere, table is the handoff's new columns, `day.sun` becomes a block, *DRY* and the golden-hour text go. No extra picker entries |
| Setting label | **"Show as"** for these two widgets. `cost.chart` keeps "Variation" (his #221 choice) and is not touched |
| Forecast conditions (handoff open question 1) | **Keep**, inline under the city: `Day 1 · showers likely` |
| Sun in *Before you go* (handoff open question 2) | **Seed it**, under *Clocks*, for new trips only. Existing notebooks are not rewritten |
| Weather's `headings` param | Applies to the **table view only**; the graphic has no heading row |

## Stored documents need no migration

A widget is stored as `{ type: "macro", attrs: { name, params } }` (`packages/contracts/src/pageDoc.ts`).
The shape is not stored: the editor derives it from the registry (`macroShape` in
`MacroNodeView.tsx`, set on the wrapper by `MacroNodeExtension.ts`). So flipping `day.sun` from
`repeat` to `block` re-renders every saved one as a block with no read-time upgrade, and a saved
node with no `view` reads as `graphic`.

The plan's first task still confirms this in a test: a stored `day.sun` node with `params: {}`
resolves to the new block payload, and one sitting mid-sentence renders as a block the way other
block widgets do.

## Params (`packages/pages`)

Both widgets add to their params schema:

```ts
view: z.enum(["graphic", "table"]).optional() // absent is "graphic"
```

and to their inputs a `choice`, as `spendByDay.ts` declares its own:

```ts
{ name: "view", type: "choice", label: "Show as", default: "graphic",
  options: [{ value: "graphic", label: "Graphic" }, { value: "table", label: "Table" }] }
```

The settings panel (desktop right column, phone settings sheet) already draws `choice` inputs, so
there is no new settings UI and no control in the document flow (SPEC §26).

## Weather

### Payload (`weatherPayload.ts`)

One set of rows serves both views. `WeatherPayload` gains `view`, and an `axis`; `WeatherRow` gains
the numbers the graphic draws. Display strings stay display-ready, as every block payload's are.

| Field | Meaning |
|---|---|
| `payload.view` | `"graphic" \| "table"` |
| `payload.axis` | `{ min, max, ticks: number[], unit: "°F" \| "°C" }` — one scale for the widget. Base 40–80 °F (the °C equivalent for metric accounts), ticks every 10°, widened outward to the nearest tick so the trip's lowest low and highest high fit |
| `row.highValue`, `row.lowValue` | numbers in the axis unit, `null` when the row has none |
| `row.rainValue` | number in the reader's rain unit, `null` when the row has none |
| `row.source` | `"forecast" \| "typical" \| null` — collapses today's six modes for drawing and for the table's Source column |

`row.rain` is always two decimals in the reader's units (`0.00″`, the metric equivalent for metric
accounts). The *DRY* string is removed. `modeText` no longer produces a *Typical for …* label for
the graphic; the table says *Forecast* or *Typical* in its Source column.

### Graphic view (2a)

One row per (day, city), stacked; never scrolls sideways at any trip length.

- **Label column:** city name in city ink; beneath it `Day N`, plus the sky in words for a forecast row.
- **Range bar:** low → high on the shared axis. Forecast is solid in the city colour; typical is a
  dashed outline on a surface fill. Line style is the only signal of which it is.
- **Hi / lo:** mono values at the bar's ends.
- **Rain:** its own column, a short bar (full at 0.35″) and the mono value.
- **Footer:** the existing credit and as-of line, unchanged.
- **Phone:** tighter columns; sky drops under the city line; the rain bar is omitted when its
  column is under 56 px, leaving the value.

City colour comes from the existing `CityAccents`, which `BlockView` already holds and now passes
to `WeatherBlock`.

### Table view

Columns: Day · City · High · Low · Rain · Source. `headings: false` hides the heading row, as today.

## Sunrise and sunset

### Shape and payload

`day.sun` becomes `shape: "block"` and resolves to a new `SunPayload` (`kind: "sun"`), in its own
file beside `weatherPayload.ts` and added to the `BlockPayload` union. `BlockView`'s `never` branch
then demands the component.

| Field | Meaning |
|---|---|
| `view` | `"graphic" \| "table"` |
| `axis` | `{ startMinute, endMinute, ticks: { minute, label }[] }` — local minutes of the day. Base 5 am–6 pm with ticks 6a · 9a · noon · 3p · 6p, widened to the trip's earliest sunrise and latest sunset. Tick labels honour the reader's 12/24-hour setting |
| `rows[]` | `key`, `label` (`Day N`), `city`, `state` (`"normal" \| "up-all-day" \| "down-all-day"`), `sunriseMinute`, `sunsetMinute`, `sunrise`, `sunset` (clock labels, keeping the existing *(next day)* / *(day before)* marks), `daylight` (`12h 47m`), `goldenMorningEndMinute`, `goldenEveningStartMinute` |
| `summary` | one sentence, the block's accessible name |

Golden hour is drawn, not written: the text value is dropped from the resolver. The existing
selection rules stand — a day with no located stop is left out, an undated day is left out, and the
two empty reasons (*add a stop with a place to see this*, *set the trip's dates to see this*) keep
their wording.

### Graphic view (1a)

- **Label column:** city in city ink over `Day N`.
- **Ribbon:** sunrise → sunset in the city colour, the golden-hour spans at each end at lower strength.
- **Values:** mono sunrise and sunset at the ribbon's ends; daylight length at the right.
- **No sentence beneath the graphic.**
- **Polar days:** `up-all-day` draws a full-width ribbon and `down-all-day` none; each says so in
  words in the value slot, since there are no two times to print.
- A sunset past the axis end (Reykjavik in June) clamps the ribbon to the axis and keeps its
  *(next day)* label.

### Table view

Columns: Day · City · Sunrise · Sunset · Daylight.

### States

Sun is computed locally from coordinates, so it has no unavailable state. Weather keeps its one
quiet line when the source is down, and never shows a stale number.

## Components (`apps/web/src/components/pages/blocks`)

| File | Role |
|---|---|
| `WeatherBlock.tsx` | Chooses the view; keeps the credit footer and `asOfText` |
| `WeatherGraphic.tsx` | 2a temperature rows |
| `WeatherTable.tsx` | The table view (today's row markup, new columns) |
| `SunBlock.tsx` | Chooses the view |
| `SunGraphic.tsx`, `SunTable.tsx` | 1a ribbons; the table |

All stay spans with table roles rather than `<table>`, because a widget node is an inline atom
inside a paragraph. `BlockView.tsx` gains the `sun` case.

## Other edits

- `presets.ts`: the two presets' `summary` (and the sun preview) stop promising golden-hour text.
- `time.ts` / `weather.ts`: `description` and `preview` strings updated to match.
- `templates.ts`: `block("day.sun")` under *Clocks* in *Before you go*.
- `docs/contracts/CHANGELOG.md`: the new param and `day.sun`'s shape change.
- `.design-sync/handoff/DRIFT.md`: record what the build now matches.

## Tests

Each is seen failing before it counts (CLAUDE.md rule 3).

- **Resolvers** (`weather.test.ts`, `time.test.ts`): axis base and widening in both units; rain to
  two decimals and no *DRY*; `source` for each mode; `view` default and explicit; sun minutes,
  daylight length, polar states, the next-day sunset, axis widening, 12/24-hour tick labels.
- **Stored documents:** a saved `day.sun` and `day.weather` node with `params: {}` resolves to the
  graphic block.
- **Components:** each view of each block renders its columns; forecast and typical bars differ
  only in line style; the phone rule for the rain bar.
- **Existing tests rewritten:** `WeatherBlock.test.tsx`, `time.test.ts`, the registry and preset
  tests that read the old strings, and `m14-notebook-widgets.spec.ts`'s fixed-columns walk.
- **Templates:** *Before you go* seeds `day.sun`.

## Out of scope

- `cost.chart`'s "Variation" label.
- A second place per day for `day.sun` (still one located stop per day).
- Rewriting existing trips' *Before you go* pages.

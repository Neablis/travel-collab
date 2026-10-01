# Sun and weather widgets — graphic by default, table on request (2026-09-30)

Design: `design/Trip Planner Redesign.dc.html` (Overview → *Before you go*; Notebook; phone
surface). Explorations: `design/Sun and Weather Widgets.dc.html` — **1a** (daylight ribbons)
and **2a** (temperature rows) were picked. Supersedes the weather and sunrise rows in SPEC §36.4.

## One setting: *Show as*

- Both widgets carry **Show as: Graphic · Table** in the widget's settings panel (desktop right
  column, phone settings sheet). **Default: Graphic.**
- **Never a toggle on the page.** No control in the document flow (SPEC §26).
- Stored per widget instance, beside its binds. Same value on desktop Notebook, Overview and phone.
- Both views read the same rows; Table is the accessible/printable reading of the same data.

## Weather — 2a, temperature rows

One row per (day, city), days stacked top to bottom. Never scrolls sideways at any trip length.

| Part | Rule |
|---|---|
| Label column | City name (city ink) on top; beneath it `Day 1` — plus the conditions in words when it's a forecast (`Day 1 · showers likely`). No *Typical for …* label |
| Shared axis | One temperature scale for the whole widget (design: 40–80 °F, ticks every 10°), in the user's units. Axis widens to fit the trip's extremes |
| Range bar | Low → high on the axis. **Forecast = solid, city colour. Typical = dashed outline, surface fill.** Line style is the only signal of which number it is |
| Hi / lo | Mono values at the bar's ends |
| Rain | Its own column: a short bar (full at 0.35″) and a mono value, always two decimals — `0.00″`, never *DRY* |
| Credit | Mono line under the block naming only the sources shown + as-of time (unchanged from §36.4) |

**Table view** columns: Day · City · High · Low · Rain · Source (*Forecast* / *Typical*).

**Phone:** tighter columns; conditions drop under the city line; rain value only, no rain bar
if the column is under 56 px.

## Sunrise and sunset — 1a, daylight ribbons

Becomes a **block** (was an inline/repeat sentence). One ribbon per day on a shared clock axis
that matches Plan's time axis, so it reads the same at 1 day or 100+.

| Part | Rule |
|---|---|
| Label column | City (city ink) over `Day N` |
| Axis | 5 am → 6 pm in the design, ticks 6a · 9a · noon · 3p · 6p; widen to the trip's earliest sunrise / latest sunset. Honour the 12/24-hour account setting |
| Ribbon | Sunrise → sunset in the city colour; first and last ~34 min (golden hour) at lower strength |
| Values | Mono sunrise and sunset at the ribbon ends; daylight length (`12h 47m`) at the right |
| Text comment | **None.** No sentence beneath the graphic |

**Table view** columns: Day · City · Sunrise · Sunset · Daylight.

## States (rule 6)

| State | Weather | Sunrise and sunset |
|---|---|---|
| Happy | as above | as above |
| Empty (no stop with a place) | *add a stop with a place to see this* | same line |
| Sync fail / offline | one quiet line — *Weather is unavailable right now. It fills in when the forecast answers.* Never a stale number | computed locally from coordinates — never fails once a place exists |
| Conflict | a co-editor moving a day re-renders the row; nothing to resolve in the widget | same |
| Mixed | forecast and typical rows coexist; credit names both sources | — |

## What a build owes

- `day.weather` and `day.sun` gain a `view: 'graphic' | 'table'` param, default `graphic`.
- `day.sun` changes shape `repeat` → `block`; drop golden hour as a text value (it's drawn).
- Rain formatted to two decimals in the user's units; remove the *DRY* string.
- Forecast/typical distinguished by line style in graphic, by a word in table.

## Open questions

1. Forecast conditions (*showers likely*): keep inline under the city, or drop entirely?
2. Sunrise and sunset: seed it in the Overview's *Before you go*, or leave it rail-only?
   The design currently shows it in the Overview.

# Sun and Weather Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `day.weather` and `day.sun` render the new graphic design by default (temperature rows, daylight ribbons) with a *Show as: Graphic · Table* setting.

**Architecture:** Each resolver in `packages/pages` gains a `view` param and a payload that carries the numbers a graphic needs alongside the display strings; one set of rows serves both views. `day.sun` changes shape from `repeat` to `block` with its own `SunPayload`. In `apps/web`, each block component picks a graphic or table sub-component from `payload.view`. Shape is derived from the registry, not stored, so no document migration.

**Tech Stack:** TypeScript strict, Zod, Vitest, React (Next.js), Tailwind, Playwright.

**Spec:** `docs/specs/2026-09-30-sun-and-weather-widgets-design.md` — read it with this plan. Design geometry: `.design-sync/handoff/design/Sun and Weather Widgets.dc.html` (picks **1a** and **2a**; the "Turn 2 — weather, vertical" section holds the final 2a) and `.design-sync/handoff/specs/sun-and-weather-widgets.md`.

## Global Constraints

- `AGENTS.md` is binding. UI must not import `packages/domain` or `src/server`. Colour is decided in `apps/web`, never in `packages/pages` (ADR-037 decision 1): payloads carry a city's **name**, components turn it into a colour through `CityAccents`.
- **Node 24** (`.nvmrc`); this box defaults to 26. Run `nvm use` before any `pnpm` command (KI-2026-09-02-a).
- Verification per task is the `minimal-check-subset` skill's output and nothing more (Tier 2). No `pnpm check` mid-branch.
- **A test is not done until it has been seen to fail** for the right reason (CLAUDE.md rule 3; `docs/guidelines/testing.md`; the `write-a-test` skill). Record the source edit and the failure text in your report.
- Never assert presentation in tests: roles, labels, values and behaviour only. `toHaveClass` fails lint outside `src/components/ui/**`.
- Comments follow `docs/guidelines/commenting.md`; match the surrounding files' density.
- Widget markup stays **spans with table roles**, never `<table>`: a widget node is an inline atom inside a paragraph.
- Setting label is exactly **"Show as"**, options **"Graphic"** / **"Table"**, stored values `graphic` / `table`, absent means `graphic`. Do not touch `cost.chart`'s "Variation".
- Empty-state wording is unchanged: *add a stop with a place to see this*, *add a place to a stop to see this*, *set the trip's dates to see this*.
- Rain is always two decimals: `0.00″` for imperial accounts, `0.00 mm` for metric. No "a day" suffix, no `<0.01`.
- Commits: conventional style, one logical change each, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tasks run **sequentially in this worktree**. Do not push.

---

### Task 1: Weather payload and resolver

**Files:**
- Modify: `packages/pages/src/weatherPayload.ts`
- Modify: `packages/pages/src/macros/primitives/weather.ts`
- Test: `packages/pages/src/macros/primitives/weather.test.ts` (and `weather.property.test.ts` only if it reads a changed string)

**Interfaces — Produces** (Task 2 relies on these exact names):

```ts
// weatherPayload.ts
export type WeatherView = "graphic" | "table";
export type WeatherRowSource = "forecast" | "typical";

export interface WeatherAxis {
  /** In `unit`, both on a tick. */
  min: number;
  max: number;
  /** Ascending, inclusive of min and max. */
  ticks: number[];
  unit: "°F" | "°C";
}

// added to WeatherRow
highValue: number | null;   // the rounded number `high` prints, in the axis unit
lowValue: number | null;
rainValue: number | null;   // in the reader's rain unit (inches or mm), unrounded
/** 0–1: how much of the rain bar is filled; full at 0.35 in (8.89 mm). */
rainShare: number | null;
source: WeatherRowSource | null; // null only when mode is "unavailable"

// added to WeatherPayload
view: WeatherView;
axis: WeatherAxis;
```

Existing fields (`key`, `label`, `date`, `city`, `mode`, `modeText`, `now`, `high`, `low`, `rain`, `sky`, `forecastAsOf`, `typicalPeriod`, `credits`, `headings`, `summary`) keep their names and meanings, except `rain`'s format below.

**Rules:**
- Params: add `view: z.enum(["graphic", "table"]).optional()` beside `headings`. Inputs: add `{ name: "view", type: "choice", label: "Show as", default: "graphic", options: [{ value: "graphic", label: "Graphic" }, { value: "table", label: "Table" }] }` before `headings`. `payload.view = params.view ?? "graphic"`.
- `source`: `forecast` and `today` → `"forecast"`; `typical`, `past`, `no-forecast` → `"typical"`; `unavailable` → `null`.
- `highValue` / `lowValue`: the same rounding `degrees()` does (`Math.round(...) || 0`), so the bar and the label cannot disagree. Refactor `degrees` to format from that number.
- Rain: `rainAmount(mm, units)` returns `${(mm / 25.4).toFixed(2)}″` for imperial and `${mm.toFixed(2)} mm` for metric. Typical rows drop the `" a day"` suffix. `rainShare = Math.min(1, mm / 8.89)`.
- Axis: imperial base `40–80`, step `10`; metric base `5–25`, step `5`. Over every row with numbers: `min = Math.min(baseMin, Math.floor(lowest / step) * step)`, `max = Math.max(baseMax, Math.ceil(highest / step) * step)`. `ticks` are every `step` from `min` to `max`. With no numbered rows, the base axis.
- Update the macro's `description` only if it names something no longer true. `preview` stays.

- [ ] **Step 1: Write the failing tests** in `weather.test.ts`, using the file's existing point/trip builders:
  - `view` defaults to `"graphic"` with `params: {}` and is `"table"` when asked.
  - imperial account, rows spanning 52–71 °F → `axis` is `{ min: 40, max: 80, ticks: [40, 50, 60, 70, 80], unit: "°F" }`.
  - imperial, a low of 28 °F and a high of 93 °F → `min: 20`, `max: 100`.
  - metric account, 8–19 °C → `{ min: 5, max: 25, ticks: [5, 10, 15, 20, 25], unit: "°C" }`.
  - a forecast row has `source: "forecast"`; typical, past and no-forecast rows have `"typical"`; an unavailable row has `null` and `null` numbers.
  - rain: 0 mm prints `0.00″` (imperial) and `0.00 mm` (metric); 2.1 mm typical prints `0.08″` with no "a day"; 0.05 mm prints `0.00″`, not `<0.01`.
  - `rainShare` is `1` at 8.89 mm and above, `0` at 0, about `0.5` at 4.445.
  - `highValue` equals the number inside `high` for a value that rounds (e.g. 17.6 °C → `18` and `"18°C"`).
- [ ] **Step 2: Run and see them fail.** `nvm use && pnpm --filter @tc/pages exec vitest run src/macros/primitives/weather.test.ts` — expect failures on the missing fields.
- [ ] **Step 3: Implement** per the rules above. Update existing assertions in the same file that read the old rain strings.
- [ ] **Step 4: Run** the same command plus `weather.property.test.ts`; expect all green. Then `pnpm --filter @tc/pages typecheck` and `pnpm --filter web typecheck` (web must still compile: the new fields are additive).
- [ ] **Step 5: Red-check** one new test by breaking the code it protects (e.g. make the axis ignore the rows), watch it fail for that reason, restore.
- [ ] **Step 6: Commit** — `feat(pages): weather payload carries a view, a shared axis and row numbers`.

---

### Task 2: Weather block — graphic and table views

**Files:**
- Modify: `apps/web/src/components/pages/blocks/WeatherBlock.tsx`
- Create: `apps/web/src/components/pages/blocks/WeatherGraphic.tsx`
- Create: `apps/web/src/components/pages/blocks/WeatherTable.tsx`
- Modify: `apps/web/src/components/pages/BlockView.tsx` (pass `accents`)
- Test: `apps/web/src/components/pages/blocks/WeatherBlock.test.tsx`
- Possibly modify: `apps/web/src/app/globals.css` only if a rule cannot be said in Tailwind classes

**Interfaces:**
- Consumes: `WeatherPayload`, `WeatherRow`, `WeatherAxis` from `@tc/pages` as produced by Task 1; `CityAccents` from `apps/web/src/components/pages/cityAccents.ts` (`accents.ofCity(row.city)` → `AccentFamily`; use that file's static class maps, adding one there if the fill/outline you need has no map yet).
- Produces: `WeatherBlock({ payload, accents }: { payload: WeatherPayload; accents: CityAccents })`.

**Rules:**
- `WeatherBlock` keeps the outer frame, the credit footer and `asOfText`, and renders `<WeatherGraphic>` or `<WeatherTable>` from `payload.view`.
- **Graphic (2a)** — read the design file's "Turn 2 — weather, vertical" section for geometry and tokens:
  - `role="table"` with `aria-label={payload.summary}`; one `role="row"` per payload row; a tick row for the axis (`aria-hidden`).
  - Label cell (`rowheader`): city name in the city's ink; beneath it `row.label`, plus ` · ${row.sky}` when `row.sky` is set. No mode words.
  - Range cell: a bar from `lowValue` to `highValue`, positioned as percentages of `axis.max - axis.min`. `source === "forecast"` → solid fill in the city colour; `"typical"` → dashed outline on the surface colour. Put `data-source={row.source}` on the row. Mono `low` at the bar's left end and `high` at its right, each a `cell` with `aria-label` `low` / `high` (the existing `Value` pattern). An unavailable row shows a dash in place of the bar.
  - Rain cell: a short bar filled to `rainShare`, and the mono `rain` value (`aria-label="rain"`). The bar is `aria-hidden` and hidden when its column is under 56 px (a container query or the `max-md` breakpoint — whichever the surrounding widgets use).
  - Never scrolls sideways: no `min-w-*` on rows; the bar column flexes.
- **Table** — columns Day · City · High · Low · Rain · Source. Source prints `Forecast` or `Typical` (dash when `null`). Headings shown when `payload.headings`. No Now column, no Conditions column. Fixed row height stays (ADR-044).
- `payload.headings` affects the table only.

- [ ] **Step 1: Rewrite `WeatherBlock.test.tsx`** against the new views (keep the `asOfText` and credit-footer tests as they are). Build payloads with the file's existing helper, extended with the Task 1 fields. Cases:
  - graphic (default): a forecast row and a typical row render as rows whose `high`, `low` and `rain` cells hold the payload strings; the rows carry `data-source` `forecast` and `typical`; the sky appears beside `Day 1` for the forecast row only.
  - graphic: no column headers.
  - table: column headers are exactly Day, City, High, Low, Rain, Source; a typical row's Source cell reads `Typical`; `headings: false` removes the header row.
  - an unavailable row renders dashes and no bar in either view.
- [ ] **Step 2: Run and see them fail.** `nvm use && pnpm --filter web exec vitest run src/components/pages/blocks/WeatherBlock.test.tsx`.
- [ ] **Step 3: Implement** the three components and pass `accents` from `BlockView`.
- [ ] **Step 4: Run** the test file, `pnpm --filter web typecheck`, and web lint on the touched files (per `minimal-check-subset`). Also run any other unit test that renders a weather block (`grep -rl "day.weather\|WeatherBlock" apps/web/src --include=*.test.tsx`) and fix what the new markup legitimately changes.
- [ ] **Step 5: Red-check** the `data-source` test and the table-headers test by breaking the component, then restore.
- [ ] **Step 6: Commit** — `feat(web): weather block draws temperature rows, with a table view`.

---

### Task 3: Sunrise and sunset — block payload, resolver and component

**Files:**
- Create: `packages/pages/src/sunPayload.ts`
- Modify: `packages/pages/src/macros/primitives/time.ts` (`day.sun` only; `day.fromHome` untouched)
- Modify: `packages/pages/src/registry-types.ts` (add `SunPayload` to `BlockPayload`), `packages/pages/src/index.ts` (export the types)
- Test: `packages/pages/src/macros/primitives/time.test.ts`, `time.property.test.ts` if it reads the old rows
- Create: `apps/web/src/components/pages/blocks/SunBlock.tsx`, `SunGraphic.tsx`, `SunTable.tsx`
- Modify: `apps/web/src/components/pages/BlockView.tsx` (`case "sun"`)
- Test: `apps/web/src/components/pages/blocks/SunBlock.test.tsx`
- Fix as found: any test or code that assumed `day.sun` is a repeat (`grep -rn "day.sun" packages apps/web/src apps/web/e2e`). Leave `apps/web/e2e` edits to Task 4.

**Interfaces — Produces:**

```ts
// sunPayload.ts
export type SunView = "graphic" | "table";
export type SunState = "normal" | "up-all-day" | "down-all-day";

export interface SunAxisTick { minute: number; label: string }
export interface SunAxis {
  /** Local minutes after the day's midnight; whole hours. */
  startMinute: number;
  endMinute: number;
  ticks: SunAxisTick[];
}

export interface SunRow {
  key: string;            // `${dayIndex}`
  label: string;          // "Day 3"
  city: string | null;
  state: SunState;
  /** Local minutes after THIS day's midnight; may pass 1440 (a sunset the next morning) or be negative. null unless state is "normal". */
  sunriseMinute: number | null;
  sunsetMinute: number | null;
  /** Clock labels in the reader's format, keeping "(next day)" / "(day before)". null unless "normal". */
  sunrise: string | null;
  sunset: string | null;
  /** "12h 47m"; "24h" for up-all-day, "0h" for down-all-day. */
  daylight: string;
  /** Where the morning golden hour ends and the evening one starts; null when there is none to draw. */
  goldenMorningEndMinute: number | null;
  goldenEveningStartMinute: number | null;
}

export interface SunPayload {
  kind: "sun";
  view: SunView;
  axis: SunAxis;
  rows: SunRow[];
  summary: string; // "Sunrise and sunset for 6 days."
}
```

`SunBlock({ payload, accents }: { payload: SunPayload; accents: CityAccents })`.

**Resolver rules:**
- `daySun` becomes `MacroDef<SunParams, SunPayload>`, `shape: "block"`, `render: blockOf`. Params: `filterParams(TIME_FILTERS, { view: z.enum(["graphic", "table"]).optional() })`; inputs gain the same "Show as" choice as Task 1. `day.fromHome` keeps `TimeParams`.
- Day selection, `locatedDay`, the undated rule and both empty reasons are unchanged.
- Minutes: from `clockIn(zone, instant)` → `{ date, time }`; `minute = hh * 60 + mm + 1440 * (days between local.date and the trip day's date)`.
- `state`: `sunrise`/`sunset` `"up"` → `up-all-day`; `"down"` → `down-all-day`; otherwise `normal`.
- `daylight`: `formatKind("duration", Math.round((sunset - sunrise) / 60_000), { currency: trip.currency })` for normal rows.
- Golden minutes: from `goldenMorningEnd` / `goldenEveningStart` when numbers, else `null`.
- Axis: `startMinute = Math.min(300, Math.floor(earliestSunrise / 60) * 60)`, `endMinute = Math.max(1080, Math.ceil(latestSunset / 60) * 60)`, over normal rows; clamp to `[0, 1440]`. An up-all-day row forces `0–1440`. Ticks every 180 minutes from 0 that fall inside `[startMinute, endMinute]`. Labels: 12-hour → `midnight`, `3a`, `6a`, `9a`, `noon`, `3p`, `6p`, `9p`; 24-hour → `00:00`, `03:00`, … Read the format from `readerClock(user)`.
- Delete `goldenHour`, `sunCells` and the `renderRows` import if nothing else uses them. Update the header comment, `description` (no "golden hour" as text; say it is drawn) and `preview` (`"a ribbon of daylight for each day, sunrise to sunset"`).

**Component rules (1a)** — read the design file's 1a in "Turn 1 — sun and weather":
- Graphic: `role="table"`, `aria-label={payload.summary}`; axis tick row `aria-hidden`; per row a `rowheader` (city in city ink over `row.label`), a ribbon cell, and `cell`s labelled `sunrise`, `sunset`, `daylight` holding the strings. Ribbon spans `sunriseMinute → sunsetMinute` as percentages of the axis, clamped to it, in the city colour; the two golden spans at lower strength. `data-state={row.state}` on the row. `up-all-day`: full-width ribbon and the words `sun up all day` in the sunrise cell; `down-all-day`: no ribbon and `sun down all day`. No sentence under the graphic.
- Table: columns Day · City · Sunrise · Sunset · Daylight, with headers. Polar rows put their words in the Sunrise cell and a dash in Sunset.

- [ ] **Step 1: Rewrite the `day.sun` tests in `time.test.ts`** (keep every `day.fromHome` test). Reuse the existing Tokyo / Apia / Reykjavik fixtures. Cases:
  - resolves to `kind: "sun"`, `view: "graphic"` for `params: {}`; `"table"` when asked — this is also the stored-document guarantee (a saved node with `{}` gets the graphic block).
  - Tokyo in June: `sunrise` matches `/^4:2[4-7] am$/`, `sunriseMinute` is within 264–267, `daylight` matches `/^14h \d+m$/`.
  - 24-hour reader: `sunrise` matches `/^04:2[4-7]$/` and a tick label is `06:00`.
  - Apia keeps that day's sunrise (the existing assertion, on `sunrise`).
  - Reykjavik in June: `sunset` ends `(next day)`, `sunsetMinute > 1440`, and `axis.endMinute` is `1440`.
  - a row is named by the stop that located the day (the existing city test, on `row.city`).
  - default axis for one mid-latitude day is `startMinute: 300`, `endMinute: 1080` with tick labels `["6a", "9a", "noon", "3p", "6p"]`.
  - a polar-day fixture (e.g. Longyearbyen 78.22, 15.65, `Arctic/Longyearbyen`, 21 June) → `state: "up-all-day"`, null minutes, `daylight: "24h"`; 21 December → `down-all-day`, `"0h"`.
  - golden minutes: a normal row has `goldenMorningEndMinute > sunriseMinute` and `goldenEveningStartMinute < sunsetMinute`.
  - empty states unchanged.
- [ ] **Step 2: Run and see them fail.** `nvm use && pnpm --filter @tc/pages exec vitest run src/macros/primitives/time.test.ts`.
- [ ] **Step 3: Implement** the payload file, the union member, the resolver.
- [ ] **Step 4: Write `SunBlock.test.tsx`** (failing): graphic rows expose `sunrise`, `sunset`, `daylight` cells with the payload strings and no column headers; `data-state` on a polar row and its words; table view headers are exactly Day, City, Sunrise, Sunset, Daylight.
- [ ] **Step 5: Implement** the three components and the `BlockView` case.
- [ ] **Step 6: Run** both test files, every other `@tc/pages` test file that mentions `day.sun` (`registry.test.ts`, `presets.test.ts`, `widgetSearch.test.ts`, `time.property.test.ts`), any web unit test that does, then `pnpm --filter @tc/pages typecheck` and `pnpm --filter web typecheck` and lint on touched files. Fix what the shape change legitimately moves; report anything that looks like a real conflict instead of forcing it.
- [ ] **Step 7: Red-check** the Reykjavik axis test and one component test, then restore.
- [ ] **Step 8: Commit** — `feat: sunrise and sunset is a block of daylight ribbons, with a table view`.

---

### Task 4: Catalogue wording, template seed, e2e spec, records

**Files:**
- Modify: `packages/pages/src/presets.ts` (the `sunrise-and-sunset` entry)
- Modify: `packages/pages/src/templates.ts` (*Before you go*)
- Test: `packages/pages/src/templates.test.ts`, `presets.test.ts` / `widgetSearch.test.ts` if they read the old summary
- Modify: `apps/web/e2e/m14-notebook-widgets.spec.ts` (around lines 1907–2010 and 2142)
- Modify: `apps/web/src/components/pages/WidgetPicker.test.tsx` only if its "photos" search case breaks
- Modify: `docs/contracts/CHANGELOG.md`, `.design-sync/handoff/DRIFT.md`
- Check and fix if stale: `apps/web/src/server/assistant/tools/widgets.ts`, `apps/web/src/mocks/handlers.ts`, `content/notebooks/built-in-notebooks.json` (only if they describe either widget's old output)

**Interfaces — Consumes:** everything from Tasks 1–3. Produces nothing new.

**Rules:**
- Preset summary: `"Draws each day's daylight as a ribbon from sunrise to sunset in local time, for planning early starts and photos."` Keep the keywords (including `golden hour` and `photo`, so search still finds it).
- Template: in `beforeYouGo`, directly after the `Time difference:` paragraph under `heading("Clocks")`, add `block("day.sun")`. Update the seed's doc comment. Existing notebooks are not rewritten; do not add a migration or backfill.
- E2E: the weather walks that locate `getByRole("table")` and assert columns must match the graphic default (rows, `high`/`low`/`rain` cells) and, where the walk is about the fixed-column table, switch the widget to **Show as: Table** through the settings panel and assert the new headers. The sun walk at ~2142 asserts block rows with `sunrise` and `sunset` cells instead of repeat text. **This box has no Playwright browsers, so the spec cannot be run here** — make the edits carefully against the component markup, typecheck the spec (`pnpm --filter web typecheck`), and say plainly in your report that it was not run.
- `docs/contracts/CHANGELOG.md`: a dated entry for the widget registry: `day.weather` and `day.sun` gain `view: "graphic" | "table"` (absent = graphic); `day.sun` shape `repeat` → `block` with payload kind `sun`; weather rain strings now two decimals; no stored-document change (shape is derived). Match the file's entry format.
- `DRIFT.md`: one line under the current date saying the build now matches `specs/sun-and-weather-widgets.md`, and naming the three decisions (label "Show as", conditions kept inline, sun seeded in *Before you go*). Note: `.design-sync/**` is a build input, so this is not a prose-only edit — irrelevant here since the branch already has code.

- [ ] **Step 1: Write the failing template test:** *Before you go*'s content holds a `day.sun` widget node between the Clocks heading and the Weather heading.
- [ ] **Step 2: Run and see it fail.** `nvm use && pnpm --filter @tc/pages exec vitest run src/templates.test.ts`.
- [ ] **Step 3: Implement** the template and preset edits; run the `@tc/pages` test files touched plus `defaultNotebooks.test.ts`; fix snapshot-style expectations the seed legitimately changes.
- [ ] **Step 4: Update the e2e spec** and the two records. Typecheck web.
- [ ] **Step 5: Run** `pnpm --filter web exec vitest run` on any web unit test that renders the seeded *Before you go* page (`grep -rl "before-you-go\|Before you go" apps/web/src --include=*.test.*`).
- [ ] **Step 6: Commit** — `feat: seed sunrise and sunset in Before you go; records and e2e for the graphic widgets`.

---

### After the tasks (main session)

- Final whole-branch review, then Tier 3: `nvm use && pnpm check` once.
- E2E verdict only from `pnpm --filter web test:e2e:ci-like`; not runnable on this box — recorded on the PR's "Not run, and why" line, CI or the Vercel preview is the verdict.
- Remove this plan at gate close (`docs/plans/README.md`).

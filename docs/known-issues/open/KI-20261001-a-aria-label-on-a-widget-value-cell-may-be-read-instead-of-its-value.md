### KI-2026-10-01-a — a widget's value cell carries an `aria-label`, which some screen readers may announce instead of the value

- **Severity:** correctness, unconfirmed (accessibility). If a screen reader does prefer
  the label, the cell reads as "high" and never says "18°C" — the number is the whole
  point of the cell. Not yet heard in any screen reader, so the size is unknown.
- **Area:** `apps/web/src/components/pages/blocks/WeatherGraphic.tsx`,
  `WeatherTable.tsx`, `SunGraphic.tsx`, `SunTable.tsx` — every `role="cell"` with an
  `aria-label` (`high`, `low`, `rain`, `source`, `sunrise`, `sunset`, `daylight`).
- **Symptom / What happens:** a value cell is written
  `<span role="cell" aria-label="high">18°C</span>`. `aria-label` REPLACES an element's
  accessible name; it does not add to its content. For a `cell` the name is not what a
  screen reader normally announces — it reads the content — but support differs, and
  some combinations announce the label and skip the text. The clearest bad case is a
  polar day: the cell labelled "sunrise" holds "sun up all day", and a reader that
  speaks the label hears "sunrise" for a day that has none. The tests cannot see this:
  they find the cell by its name (`getByRole("cell", { name: "high" })`) and read its
  `textContent`, which is right either way.
- **Why not fixed here:** the pattern predates the graphic (the weather table has
  labelled its cells this way since #222), and what replaces it is a decision that needs
  a screen reader to check, not a guess — a visually hidden column name inside the cell
  ("High 18°C"), `aria-describedby`, or dropping the label where a column header
  already names the column. It matters more than it did: the graphic is the default
  view since 2026-10-01 and has no column headers at all, so the labels are the only
  thing naming its cells. Whatever replaces them also has to keep the unit and e2e
  tests' way of finding a cell (they select on the label throughout
  `WeatherBlock.test.tsx`, `SunBlock.test.tsx` and `e2e/m14-notebook-widgets.spec.ts`).
- **Intended fix:** listen to both blocks, in both views, in VoiceOver (Safari) and NVDA
  (Firefox or Chrome) at least; then pick one pattern for all four components.
- **Cross-reference:** `docs/specs/2026-09-30-sun-and-weather-widgets-design.md` (the
  graphic becoming the default); the row header's visually hidden "Forecast" /
  "Typical" in `WeatherGraphic.tsx` is the pattern a fix would most likely extend.
- **First noted:** 2026-10-01, the final review of the sun-and-weather-widgets branch.

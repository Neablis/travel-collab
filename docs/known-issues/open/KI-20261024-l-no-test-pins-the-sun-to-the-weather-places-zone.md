### KI-2026-10-24-l — no test pins `day.sun` to `weatherPlace.timeZone`; reading the clock's zone instead stays green

- **Severity:** correctness (test gap). The code is right today; a regression would ship unseen.
- **Area:** `packages/pages/src/macros/primitives/time.ts` (`locatedDay`, about line 57: `const
  zone = of === "sky" ? day.weatherPlace?.timeZone : day.timeZone`); `time.test.ts`.
- **Symptom / What happens:** replacing that line with `const zone = day.timeZone;` (the day's
  clock) leaves every pages test (385) and every web test naming `day.sun`, `daySun` or
  `weatherPlace` (183) green. Under that edit a departure day (a flight out of New York, Tokyo by
  evening) prints Tokyo's sunrise in New York clock time, about 17:50 the evening before instead
  of 05:50, and on a Today page off the trip's dates the date is read on the wrong clock
  (`clockIn(located.zone, now.at)`). Every fixture (`time.test.ts:32`, `now.test.ts:42`,
  `test-support/dayTrip.ts:36`, `weather.test.ts:54`) gives `weatherPlace.timeZone` the same value
  as `timeZone`, and `tripWeather.test.ts:306` compares only the rows' cities.
- **Why not fixed here:** found by PR 542's review round 4 as minor, after the part was otherwise
  ready; recorded at its merge. Fix: one `time.test.ts` case with `weatherPlace` in Tokyo
  (`Asia/Tokyo`) and `place`/`timeZone` in New York (`America/New_York`), asserting the sunrise is
  Tokyo-local; see it red under the edit above.
- **Cross-reference:** M52 decision 10 (where the sun and the weather are read); ADR-080,
  *Amendment — notebook settings supersede widget settings*; `docs/contracts/CHANGELOG.md`,
  2026-10-24, `weatherPlace`.
- **First noted:** 2026-10-24, review of PR 542, round 4 (break C), at `d717423`.

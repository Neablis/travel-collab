### KI-2026-09-25-q — surfaces read `activity.location.city` directly, so none of them can choose which end of a travel leg it means

- **Severity:** cleanup now, correctness-adjacent. Nothing renders wrong
  today: every direct read gets the leg's origin, and that is what each surface
  showed before M24. But none of them *chose* the origin, and a surface that
  should use the destination has no way to say so.
- **Milestone:** found closing M24. Its gate box ("every city-deriving surface
  has made an explicit choice… `citiesOfStops`, `cityFor()`, `shortPlace()`")
  names three helpers. The surfaces below never go through a helper, so the gate
  never counted them. Mitchell, 2026-09-25: file it as two steps rather than
  widen M24.
- **Area:** there is no helper that takes an **activity**. The existing ones
  take a `Location` (`shortPlace`, `displayPlace` in `apps/web/src/lib/place.ts`)
  or a whole day (`citiesOfStops`/`citiesOfDay` in
  `packages/domain/src/trip/cities.ts`, `dayCity` in
  `packages/pages/src/dayCity.ts`). Direct reads of the origin, on `main` at
  `7892bed` (tests excluded):
  - `apps/web/src/components/lenses/calendarCityCards.ts:100` groups a day's
    stops into city cards, so an Odawara → Kyoto train sits on the Odawara card.
  - `apps/web/src/server/tripGlobals.ts:57` counts stops per city (feeds
    Discover and profile numbers).
  - `apps/web/src/server/tripGlobals.ts:104` picks the city behind a day's
    `place`, which `packages/pages/src/macros/primitives/time.ts:52` then
    prints.
  - `apps/web/src/server/external/weather/tripWeather.ts:60` chooses the city
    whose weather a day shows.
  - `packages/pages/src/select.ts:178`, `:249`, `:350` match a stop to a city
    for notebook selections.
  - `shortPlace(activity.location)` at
    `apps/web/src/components/board/TripBoardScreen.tsx:424` (the unscheduled
    rack card), and `displayPlace(activity.location)` at `ActivityCard.tsx:202`,
    `ActivityEditorSheet.tsx:211` and `access/SharedTripScreen.tsx:198`.
  - Out of scope: `playbooks/SharedDay*`, `sharedDayGeometry.ts` and
    `server/savedDayPins.ts` read saved-day stops, which carry no `mode` or
    `endLocation`.
- **What to do (this entry): add the helper and change no behaviour.**
  - Add one function that takes an activity and says which place is wanted,
    e.g. `placeOf(activity, "start" | "end"): Location | null`.
  - `"end"` returns `endLocation` only when `kind === "transit"`. Check the kind
    rather than trusting it, as `citiesOfStops` and `dayCity` do, because
    stored rows are never refined. Otherwise it returns `null`.
  - It must be importable by `@tc/pages`, which depends on `@tc/contracts` but
    not `@tc/domain`. So it most likely sits next to `travelLegFieldsOffTransit`
    in `packages/contracts/src/activity.ts`, which is a contract change and
    needs a `docs/contracts/CHANGELOG.md` entry.
  - Move every read listed above onto it with `"start"`, so every surface still
    shows exactly what it shows today.
  - `citiesOfStops` and `dayCity` may move onto it too, keeping their M24
    choices (both ends; destination except a return leg).
  - Add a lint rule, or a test that greps, so a new direct
    `activity.location?.city` read fails and cannot reappear unnoticed.
- **Done means:**
  - The helper exists with tests seen red first: `"end"` on a non-transit stop,
    and `"end"` with no `endLocation`.
  - Every site above calls it.
  - The existing tests pass unchanged, which is the proof nothing moved.
  - **The resolving PR files the follow-up entry:** a new KI listing every call
    site still passing `"start"`, asking for a decision at each one: keep the
    origin (record why in a comment beside the call, with a test pinning it) or
    switch to `"end"`. That decision is deliberately not part of this entry.
- **Cross-reference:** ADR-053 (travel legs); `docs/milestones/M24-travel-legs.md`
  gate box on city-deriving surfaces; `resolved/KI-035-no-true-area-field-route-place.md` (the `name`-as-area
  defect `shortPlace` exists to prevent); KI-2026-09-25-n and KI-2026-09-25-o
  (other readers that skip `endLocation`).
- **First noted:** 2026-09-25, by surveying `location.city` reads while closing
  M24's gate.

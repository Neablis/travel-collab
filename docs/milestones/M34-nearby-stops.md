# M34 — Adding a stop suggests what other travellers did nearby

**Status:** Minted, scoped and placed 2026-10-05 by Mitchell, after M33, which closed the same
day. It replaces the last illustrative placeholder in the add-stop sheet
(`<Preview id="add-stop-suggestions">`), which `preview-registry.ts` had filed under M9.
Build plan: `docs/plans/2026-10-05-M34-nearby-stops.md`.

## Why this exists

The add-stop sheet has shown one fake row under "What or where" since 2026-08: *"Example match —
Appears once M9 grounding is wired up"*. Mitchell, 2026-10-05:

> *"I didnt expect that to use AI, i expected that to use activities from other shared playbooks
> that were nearby"*

**The M9 tag was a routing accident, not a dependency.** When the sheet was built, M9's grounded
place search (`search_places`, LocationIQ) was the only planned way to look a place up, so the
design's list of matches was filed under it. Grounding shipped on 2026-09-16 as an **assistant
tool**, and nothing in the sheet was ever connected to it. Nothing here needs the model or a
place vendor: the public library already holds published days whose stops carry a city and,
for about 87% of the bundled ones, coordinates.

**It is a better answer than a geocoder for this product.** A vendor search returns an address.
A library stop returns something a traveller actually did, with how long it took, what kind of
stop it was and its tags, and it puts the public library to work on the screen where a plan is
built. Finding an exact address is still `LocationInput`'s job, one row below.

## Decisions (Mitchell, 2026-10-05)

1. **"Nearby" is the same city, then distance.** A candidate is a stop from a published day
   whose stored `cities` overlap the cities of the day being added to. Where the day has no
   stops with a city, the trip's cities are used instead. When both the day and the stop have
   coordinates, the closest stop ranks first. A stop whose only coordinate is a city centre
   (`precision: "city"`) is not ranked by distance, because every stop in that city would tie at
   zero.
2. **A pick fills name, place, length, kind and tags.** Not the start time (the day decides
   that), and not the cost (it can be stale or in another currency). Everything stays editable
   before Save.
3. **Shown before and while typing.** With "What or where" empty, the closest few stops for this
   day are listed. As you type, the list narrows to stops whose name or place matches. Clicking
   one fills the form.
4. **No AI and no vendor call.** One database read, scoped to the trip.

### Decisions made while scoping (not asked; Mitchell can overturn any of them)

5. **Fetched once per sheet, filtered on the client.** The route returns up to 40 ranked
   candidates when the sheet opens, and typing filters that list locally. No request per
   keystroke, no debounce, no new quota. Forty is enough for the narrowing to find things and
   small enough to be one cheap response.
6. **Only other people's published days.** Public, not deleted, not moderated, and not written
   by the reader: your own days are not news to you. Private days never appear.
7. **Transit stops are not suggested.** "Train to Osaka" is a leg between two places, not a
   place to add, and copying one would need its mode and destination too.
8. **A stop already on this day is not suggested again**, by its name, case-insensitively.
9. **Duplicates collapse, and the count is shown.** The same stop (same name and place, compared
   case-insensitively) published in several days is one row, labelled *"in 3 playbooks"*. That
   count breaks ties in the ranking after distance.
10. **Each row says where it came from**: the published day's name. The author's name is not
    shown in this milestone.
11. **A picked length outside the five "How long" options is kept as it is**, exactly as M29
    keeps a length drawn on the river: the extra option is added and chosen. Rounding a
    90-minute temple visit to "1 hour" would save a different stop from the one picked.
12. **Create mode only.** Editing an existing stop shows no suggestions.
13. **Viewer access is enough to read suggestions.** The read touches only the public library,
    and the sheet itself is only offered to people who can edit. The route still checks trip
    access, because it reads the trip to find the day's cities.
14. **Named "nearby stops", not "suggestions", in code.** A *suggestion* already means a
    suggester's pending change (ADR-064, `SuggestionChange`, `/suggestions`). The UI may say
    "suggestions"; the contract, route and files say `nearbyStops`.
15. **A new internal route, not a public API endpoint** (AGENTS.md: features ship before their
    endpoints). It is registered in `exposure.ts` as `PLANNED`.

## Scope

1. **Contract** (`packages/contracts`): `NearbyStop` and `NearbyStopsResponse`, with a
   `docs/contracts/CHANGELOG.md` entry. A nearby stop carries the stop's title, location, kind,
   tags and length in minutes (or null when the stop had no time window), the published day's
   id and name, how many published days carry the same stop, and the distance in km (or null).
2. **Server**: a pure ranking function (city filter, exclusions, collapse-and-count, distance
   ordering) with unit tests, and a query over `saved_days` that feeds it, with integration
   tests against real Postgres.
3. **Route**: `GET /api/trips/[tripId]/nearby-stops?dayId=…&lat=…&lng=…`. `dayId` picks the
   day; `lat`/`lng` give an anchor when there is no day (a stop created by double-clicking the
   map). Registered in `exposure.ts`; MSW handler; typed `apiClient` function.
4. **UI**: the add-stop sheet lists suggestions under "What or where", filters them as you type,
   and fills the form on a pick. The `add-stop-suggestions` Preview and its registry entry are
   retired; `preview.test.tsx` moves to the remaining id.
5. **E2E**: one spec, run on the ci-like lane: a published day in a city, a trip day in that
   city, the suggestion appears, picking it fills the form, and the saved stop carries its place.

## Out of scope

- Ranking by reviews or ratings (M12's), or by how often a stop was added to trips.
- Suggestions from the assistant, or from a place vendor.
- Suggestions while editing a stop, or in the new-trip wizard.
- Showing or linking the author, or opening the source playbook from a suggestion.
- A public API endpoint.
- Merging "What or where" and the location row into one field (the 2026-08-26 design audit's
  B10). That waits until this has been used.

## Exit gate

- [ ] **The ranking is unit-tested and each test seen red**: only cities that overlap; the
      reader's own, private, deleted and moderated days excluded at the query; transit stops
      and stops already on the day excluded; duplicates collapsed with their count; closest
      first, with a `precision: "city"` coordinate not ranked by distance.
- [ ] **The route is integration-tested against real Postgres**: it returns another person's
      published stop in the day's city, and never a private, deleted or moderated day's stop
      or the reader's own; a non-member gets the trip-access refusal. Each seen red.
- [ ] **A pick fills name, place, length, kind and tags, and leaves start time and cost
      alone**, held by a component test seen red, including a length outside the five options.
- [ ] **The placeholder is gone**: `grep -c add-stop-suggestions
      apps/web/src/lib/preview-registry.ts` prints 0, and the sheet renders no Preview frame.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**, and the add-stop specs
      that already type into "What or where" still pass.
- [ ] **[walk]** On the PR preview, adding a stop to a day in a city the library covers lists
      library stops before typing, narrows as you type, and a pick fills the form.
- [ ] A retro is appended at gate close.

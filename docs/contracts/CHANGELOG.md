# Contracts changelog

Every change to `packages/contracts` (commands, events, DTOs, Conflict types)
gets an entry here, in the same PR as the change and all consumer updates.

Format:

```
## YYYY-MM-DD — short title
- What changed (schema names)
- Why
- Consumers updated (packages/apps touched)
- Breaking? yes/no — if yes, migration notes
```

## 2026-09-24 — `expectedUpdatedAt` on a page edit: the stale-save guard (M14, CodeRabbit on PR #222)

- **Added:** optional `expectedUpdatedAt` on `EditPage` (`pageEvents.ts`) and on
  `UpdatePageInput` (`pages.ts`, the BFF PATCH body), typed `PageRevision`: a
  string that must parse as a time, echoed verbatim from `Page.updatedAt`
  (Postgres timestamp text, not ISO, hence no `.datetime()`). Also added
  `PAGE_CHANGED_CODE` (`"page-changed"`), the refusal code, which the server
  emits and the editor branches on.
- Why: the notebook editor sends one ordinary commit at a time, but its
  `pagehide` keepalive cannot wait and can overtake one in flight. If the older
  one reached the server last it won, and `appendToStream`'s `expectedSeq`
  could not stop it, because each request reads the head current when it
  arrives. Present, the field makes `executePageCommand` refuse an edit whose
  page has moved since (`page-changed`, HTTP 409 from the BFF route), appending
  nothing. A no-op edit is still answered as a success before the revision is
  looked at. The field never reaches an event; the domain decision ignores it.
- Consumers updated: `apps/web` `server/pageCommands.ts` (the check), the BFF
  PATCH route (forwards it, maps `page-changed` to 409 with `code`),
  `lib/pagesClient.ts` (carries `code` on a refusal), `PageScreen` /
  `useEditSession` (send it; a keepalive overtaking an in-flight commit sends
  none), `mocks/handlers.ts` (honours it). `/api/v1` PATCH parses
  `UpdatePageInput.omit({ expectedUpdatedAt })`, so its body and the OpenAPI
  document are unchanged and a v1 caller keeps last-write-wins.
- Breaking? no. Additive and optional: absent means today's behaviour for every
  existing caller (the assistant's page tools, `/api/v1`, seeds).

## 2026-09-24 — `TripGlobalsDay.place.city`: the place names its own stop's city (#223 review)

- **Added:** `TripGlobalsDay.place` gains `city: string | null`, defaulted to
  `null`. It is the city of the SAME stop whose coordinates are `place`.
- Why: `day.sun` and `day.fromHome` labelled a day by `cities[0]`, while its
  coordinates came from the first *located* stop. An earlier stop with a city
  and no coordinates (Kyoto at 07:00, then located Tokyo at 10:00) put Kyoto's
  name on Tokyo's sunrise. Found by CodeRabbit on #223.
- Consumers updated: `apps/web` `tripGlobals.ts` (`placeOfDay` carries the
  stop's city) and `openapi.json` regenerated; `@tc/pages` `time.ts`
  (`locatedDay` reads `place.city`; `day.fromHome` still falls back to the
  zone's city when the stop has none); test fixtures in `registry.test.ts`
  and `MacroView.test.tsx`.
- Breaking? No. Additive, with a default, so a response or a cached globals
  from before the field parses with `city: null` (`globals.test.ts`).

## 2026-09-24 — `TripGlobals.homeTimeZone` is not told to a `trips:read`-only token (#223 review)

- **Changed (description only):** `TripGlobals.homeTimeZone` now says it is
  `null` for an API token without `account:read` or restricted to specific
  trips. The shape is unchanged: still `string | null`, default `null`.
- Why: the field is the token OWNER's zone, derived from their home airport —
  a fact about the caller that not even `GET /v1/account` publishes. A
  `trips:read` token exposed it on `GET /v1/trips/{tripId}/globals`. It now
  takes the credential that could read the account: `account:read`, and not
  confined to named trips (the wrapper refuses those on `/v1/account`).
  Session callers (`/api/trips/[tripId]/globals`, the app itself) are
  unaffected.
- Consumers updated: `apps/web` — the v1 globals route gates the preference
  read; `openapi.json` regenerated (`pnpm --filter web openapi:generate`);
  `surface.int.test.ts` covers `trips:read`, `trips:read + account:read`, and a
  trip-scoped token holding both.
- Breaking? For an API client that read `homeTimeZone` with a `trips:read`
  token: it now reads `null`, a value the field could already take. No schema
  change.

## 2026-09-24 — `PageRepeatNode` gets its first writer (M14 T13) — no schema change

- **Nothing in `packages/contracts` changed shape.** `PageRepeatNode` has been in
  the AST since ADR-038; the editor now writes it (the authored repeat, ADR-035
  decision 4). The comment in `pageDoc.ts` records the convention: `attrs.name`
  is the rows widget whose selection the repeat iterates (`day.rows`,
  `stop.rows`, `city.rows`), `params` are that widget's filters, and `content`
  is the row template. `@tc/pages`' `insertRepeat` enforces it, as the registry
  does for `macro` params.
- **Consumers:** `@tc/pages` (`repeat.ts`, `ItemScope` widened to day / city /
  stop, `narrow(…, item)`, `findWidgetError` judges repeat attrs);
  `apps/web` (`RepeatNodeExtension`, which puts `repeat` in the editor's schema,
  so `inspectStoredPageDoc` stops refusing a document that holds one).
- **Breaking?** No. A stored repeat that `insertRepeat` refuses (a name that is
  not a rows widget, a filter its widget does not take, `columns`) is now
  refused on write, as a bad widget already was (KI-2026-09-24-d item 3). No
  build ever wrote one.

## 2026-09-24 — field renames and removals convert stored documents (M14 T08)

- **Added:** `FieldChange` (`{ kind: "rename"; from; to; since }` or
  `{ kind: "remove"; path; label; since }`) and `FIELD_CHANGES`, the table of
  every manifest field ever renamed or removed. **Empty**: none has been.
  `pageDocMigrations(changes)` builds the migration chain from a table;
  `PAGE_DOC_MIGRATIONS` is `pageDocMigrations(FIELD_CHANGES)`.
- **What a step does.** For a document older than an entry's `since`, every
  widget whose `field` param names a renamed path is pointed at the new one,
  and every widget naming a removed path becomes the plain text
  `(<label> — no longer available)`. A block widget becomes a paragraph holding
  that text; a `repeat` keeps its row template after it. In `stop.rows`'s
  `columns` list a renamed path is renamed and a removed one drops out of the
  list; the table keeps its other columns.
- **Versioning rule.** Each distinct `since` is one document version, so a
  batch of entries bumps `CURRENT_PAGE_DOC_VERSION` once. A new batch takes
  `CURRENT_PAGE_DOC_VERSION + 1`, and `pageDocMigrations` throws on a gap. A
  merged batch is closed.
- **Changed:** `migratePageDoc(doc, migrations?)` takes an optional chain,
  defaulting to `PAGE_DOC_MIGRATIONS`, so tests can convert with a test-only
  table. The v1 → v2 step now uses the same widget walker. Its output is
  unchanged: the v1 → v2 golden test passes as before.
- **Guard (tests):** `test/fixtures/publishedFieldPaths.ts` records every field
  path ever published (23 today). `manifest.test.ts` fails when a recorded path
  leaves the manifest without an entry, when a live path is missing from the
  record, when a rename ends on a field that is not live, and when a removed
  field is still published.
- Why: M14 field widget, Mitchell's answer 1 (convert documents, so a stored
  page never names a field the manifest lacks) and four more calls, item 4 (a
  removed field's widget becomes a placeholder naming it). A saved template
  (link 10) snapshots a document version and is read through the same
  `migratePageDoc`, so it converts the same way. A test pins that path.
- Consumers updated: none needed. Every caller of `migratePageDoc` (`apps/web`
  `storedPageDoc.ts`, `pageTools.ts`, `server/pages.ts`, `apiClient.ts`, and
  `@tc/pages` `instantiateTemplate` for saved notebooks) passes
  one argument and gets the real chain. `CURRENT_PAGE_DOC_VERSION` is still 2.
- Breaking? no. The table is empty, so no stored document changes and no
  version moves.

## 2026-09-24 — `TripWeather`, and the `unavailable` widget state (M14 T23, ADR-052)

- **Added:** `packages/contracts/src/weather.ts` — `TripWeather { points }`,
  `TripWeatherPoint { date, city, forecast, typical }`, `ForecastDay`,
  `ForecastHour`, `TypicalMonth`, `WeatherSource`, and the route envelope
  `TripWeatherResponse { weather }` for `GET /api/trips/[tripId]/weather`.
  Normalized shapes only; each value carries its `source` id (the block maps it
  to credit text, decision 5) and a forecast carries the source's own `asOf`
  (decision 7). `forecast` / `typical` are a value or `{ unavailable }`.
- **Added (`@tc/pages`, not a contracts schema, recorded here because ADR-052
  names it an Invariant 5 change):** `MacroResult` gains
  `{ status: "unavailable"; reason: "pending" | "source" }` and `RenderOutcome`
  passes it through; `WidgetContext.external?: { weather: Slot<TripWeather> }`;
  `MacroDef.needs?: ExternalNeed[]`; `readSlot`, `externalNeedsOf`, `NO_EXTERNAL`.
- **Shapes the ADR left open, decided here:** `ForecastDay`'s fields (high, low,
  rainfall, MET `symbol_code`, and the hours for the "today" mode) and
  `TypicalMonth`'s (high, low, rainfall per day, averaging period). T24's
  adapters are the first producers; if they need a field these lack, that is a
  further entry, not a silent widening.
- **`WidgetContext.external` is optional** where ADR-052 writes it required:
  absent means every slot pending, so every context built before it — the
  server's `resolveMacro`, the assistant, every test — keeps compiling and
  keeps its meaning.
- Why: ADR-052 (external data enters a widget as a server-fetched input); T23
  is the plumbing, T24 the ports, cache, route and widget.
- Consumers updated: `apps/web` — `fetchTripWeather`, `tripKeys.weather`,
  `useExternalInputs` (fetches only when the page holds a widget declaring
  `needs: ["weather"]`; none does yet), `PageEditor` → `MacroEditorContext` →
  `MacroNodeView` → `MacroView` (a muted "loading weather" / "weather
  unavailable" chip; no ghost, no action), and an MSW handler parsed through
  `TripWeatherResponse`. The route itself is T24; until it exists the client
  reads its 404 as `failed`.
- Breaking? no — every addition is new or optional, and no registered widget
  can return `unavailable`.

## 2026-09-24 — `SavedNotebook`: a notebook kept as a template (M14 T15, link 10)

- **Added** `savedNotebook.ts`: `SavedNotebookVisibility` (`"private"` only),
  `SavedNotebookProvenance` (`sourceTripId`, `sourceTripName`, `sourcePageId`,
  `savedAt`), `SavedNotebookSummary` (no document), `SavedNotebook` (summary +
  `content: PageContent`), `CreateSavedNotebookInput` (`tripId`, `pageId`,
  optional trimmed `title`), and the envelopes `SavedNotebookListResponse` and
  `SavedNotebookResponse`.
- Why: M14 link 10, *"saving notebook templates for future trips"*. The shape
  reuses ADR-029 (personal, CRUD, not event-sourced, private) and ADR-040 (a
  snapshot with provenance). `docVersion` records the `PageDoc.v` the snapshot
  was taken at (ADR-038), because instantiating migrates it forward first.
  Visibility has one member because publishing is not built: a contract that
  accepted `"public"` would describe a state no endpoint produces.
  `CreateSavedNotebookInput` carries no document on purpose. The server
  snapshots what the page's stored projection holds, so a template is always a
  document the trip's log contains.
- Consumers updated: `apps/web` (the `saved_notebooks` table and
  `server/savedNotebooks.ts`, routes under `/api/saved-notebooks` and
  `/api/trips/:tripId/saved-notebooks/:id`, `lib/savedNotebooksClient.ts`,
  `NotebookScreen`'s gallery, `PageScreen`'s *Save as template*, and
  `makeSavedNotebookHandlers` in `mocks/handlers.ts`). Nothing else reads these
  schemas.
- Breaking? no. Additive: new schemas only, no existing one changed.

## 2026-09-24 — `MacroKind` removed (M14 T03, KI-2026-09-05-i item 2)

- **Removed:** `MacroKind` (`z.enum(["inline", "block"])`) and its type from
  `pages.ts`. `WidgetShape` replaced it for widget definitions (ADR-037
  decision 1), and nothing in the repo imported it afterwards. Its only
  reference was the comment beside `WidgetShape`.
- Why: dead vocabulary reads as a seam (review finding F-B06), and the next
  contributor has to work out that it decides nothing.
- Consumers updated: none needed; no package or app imported it. Stored page
  documents never held it (a node stores a widget name and params).
- Breaking? no.

## 2026-09-24 — `TripGlobals` gains each day's place and time zone, and the reader's home zone (M14 T20)

- **Added — `TripGlobalsDay.place`** (`{ lat, lng } | null`, default `null`):
  where the day is, for the sun and the clock — its first stop with
  coordinates in TIME order, untimed stops after timed ones in stored order
  (`citiesOfDay`'s walk, so the day's place and its first city come from one
  ordering). Unannotated: not offered by the field picker.
- **Added — `TripGlobalsDay.timeZone`** (IANA name `| null`, default `null`):
  the zone at `place`, `null` exactly when `place` is. Annotated
  `described("text", "The day's time zone")`, so the picker offers it.
- **Added — `TripGlobals.homeTimeZone`** (IANA name `| null`, default `null`):
  the REQUESTING account's zone, from its home airport. The one field here
  about the reader rather than the trip — two members get two answers. `null`
  with no home airport, an airport not in the table, or nobody signed in.
  Unannotated: the account's facts are the `account` root.
- **Why:** M14 link 11's "Sunrise and sunset" (`day.sun`) and "Time
  difference from home" (`day.fromHome`). M14's *Decided 2026-09-24* default:
  zones are computed on the server and the browser gets a name, so no
  boundary dataset ships to a client; the widgets do their arithmetic with
  `Intl`.
- **Datasets and licences** (named here, as that default asks):
  - Coordinates → zone at runtime: `@photostructure/tz-lookup` 11.7.0,
    CC0-1.0; its data is derived from timezone-boundary-builder, ODbL-1.0.
    73 kB (29 kB gzipped), server-only. Lossy near borders; geo-tz (MIT,
    exact) was measured at ~71 MB installed and rejected for a serverless
    function.
  - Airport → zone: `apps/web/src/server/airportTimeZones.generated.ts`
    (9,054 IATA codes in 386 zones, 38 kB / 22 kB gzipped), generated by
    `apps/web/scripts/generate-airport-timezones.mjs` from OurAirports'
    `airports.csv` (public domain) with geo-tz 8.1.9 over
    timezone-boundary-builder (ODbL-1.0); the table is offered under ODbL-1.0.
    geo-tz is run offline and is not a dependency: tz-lookup disagreed with it
    on the UTC offset for 166 of the 9,054 airports. Attribution in `NOTICE.md`.
- **Consumers updated:** `apps/web/src/server/tripGlobals.ts` (builds all
  three; now takes the reader's `homeAirport`), both globals routes
  (`/api/trips/:id/globals` reads the session's preferences,
  `/v1/trips/:id/globals` the token owner's), `openapi.json` regenerated,
  `@tc/pages` (`day.sun`, `day.fromHome`, two presets), and the hand-written
  `TripGlobals` literals in `packages/pages` and `MacroView.test.tsx`. The
  Japan demo trip exercises it: every day is located, so every day carries
  `Asia/Tokyo` (`tripGlobals.test.ts`).
- **Breaking?** No — additive, nullable, with defaults, so a response from
  before the change still parses (`packages/contracts/test/globals.test.ts`).

## 2026-09-24 — a `stop` manifest root, `described()` as the only opt-in, and one field vocabulary (M14 T06)

- **Added — stop fields are pickable.** `ActivitySnapshot` annotates `title`
  (text), `location` (location), `notes` (text), `kind` (enum), `tags` (enum,
  list) and `cost` (money). `bookedBy` and `participants` hold user ids and stay
  unannotated; `anchors` and `timeWindow` have no value kind that prints them.
  `MANIFEST_ROOTS` gains `stop: [ActivitySnapshot]` and `account`, and is now
  exported (a test checks each published field against its schema).
  `MANIFEST_OBJECTS` / `ManifestObject` name the three objects.
- **Changed — the opt-in gate.** The manifest publishes a field only if
  `described()` (or the new `describedCollection()` for a collection) annotated
  it, and reads the label from that annotation. `.describe()` alone no longer
  publishes anything. Why: `.describe()` is also the public API's OpenAPI text,
  so API wording could become a picker label, and a field described only for
  the API was published. `valueKind.ts` gains `annotationOf()` and
  `describedCollection()`; `valueKindOf()` is unchanged for callers.
  `TripGlobals.days/cities/tags` use `describedCollection`, with the same labels.
- **Changed:** `AttributeField.valueKind` and the `value` entry's `valueKind`
  are **required** (the gate is the kind). Both gain optional `values`, the
  allowed values, present exactly when the kind is `enum`. `AttributeEntry.object`
  and `AttributeRef.object` widen from `"trip"` to `ManifestObject`.
- **Removed:** `AttributeRef.key` and its refinement. It duplicated the `city`
  filter and would go stale in a template (M14 field-widget review, gap 4).
- **Changed — one vocabulary:** `AttributeFieldRef` is `z.enum(ATTRIBUTE_FIELD_PATHS)`,
  the paths of two facts roots in `manifest.ts` (`trip`: name, budgetRemaining,
  countdown; `account`: name, homeAirport). Each borrows `TripDetail`'s or
  `UserPreferences`' own field schema. The five values and their order are
  unchanged.
- **Added:** `HIDDEN_STOP_FIELDS`, a typed exclusion list (`keyof
  ActivitySnapshot`), empty. `buildAttributeManifest(hiddenStopFields?)` takes
  it as an optional argument that can only remove fields.
- Why: M14 field widget, build step 2 (review and Mitchell's answers,
  2026-09-24).
- Consumers updated: none needed outside `packages/contracts`. Nothing outside
  contracts tests reads the manifest, `AttributeEntry`, `AttributeField` or
  `AttributeRef`. `@tc/pages`' `attribute` primitive reads `AttributeFieldRef`,
  whose inferred type and options are identical. OpenAPI (`apps/web/src/app/api/v1/openapi.json`)
  is unchanged: `ActivitySnapshot` is on no public route, and `described()`
  and `describedCollection()` still call `.describe(label)`, so `TripGlobals`'
  documented descriptions are byte-identical. No fixture change: no schema
  gained a data field.
- Breaking? no for stored data. `AttributeRef` is stored nowhere, and the
  `AttributeFieldRef` values stored in pages did not change, so no
  `PAGE_DOC_MIGRATIONS` step. Code-level, the `AttributeRef.key` removal and
  the required `valueKind` break only contracts' own tests, which are updated.

## 2026-09-24 — value kinds `enum` and `location`, a `list` flag, and three mislabelled globals (M14 T05)

- **Added:** `VALUE_KINDS` gains `enum` (a closed vocabulary — activity kind,
  tag, M24's transit `mode`) and `location` (a `Location`, printed as a place).
  `AttributeField` and `AttributeEntry`'s `value` branch gain an optional
  `list: true`.
- **List representation — a flag beside the kind, derived from the schema.**
  `list` is present exactly when the annotated field unwraps to a `ZodArray`,
  and `valueKind` then names the element. Not one list-kind per scalar kind
  (`textList`, `countList`, …), which would double a set whose whole value is
  being small and closed, and give every future formatter table two entries
  per kind. Not a declared flag on `described()` either (`{ kind, list }`):
  that is a second fact the author can get wrong against the schema right next
  to it — exactly how `cities` came to be labelled a scalar. `described()` and
  its WeakMap are unchanged.
- **Fixed labels (`TripGlobals`):** `TripGlobalsTag.tag` is `enum`, not `text`.
  `TripGlobalsDay.cities` (`text`) and `TripGlobalsCity.dayIndexes` (`count`)
  keep their kinds, which now name the element, and the manifest reports both
  with `list: true` — before, a formatter picked by kind would have printed an
  array as one string or one number. `TripGlobals.days` / `.cities` / `.tags`
  lose their `"text"` kind for a bare `.describe()`: a collection is walked,
  never printed, and the manifest had been dropping that kind silently.
- **Changed:** `buildAttributeManifest()` publishes a described top-level array
  of scalars as a `value` with `list: true`; it used to skip one. No root has
  such a field today.
- Why: M14's field-widget review (2026-09-24, gap 3) — the widget will expose
  activity fields the old five kinds could not describe.
- Consumers updated: none needed. Nothing outside `packages/contracts` reads
  `ValueKind`, `valueKindOf` or the manifest yet (the per-kind formatter table
  in `@tc/pages` is the next build step and will be exhaustive over this set).
  No fixture change: `TripGlobals`' parsed shape is identical, so no data field
  was added.
- Breaking? no — both schema changes are additive and optional, and
  `TripGlobals` parses exactly what it did.

## 2026-09-24 — `TripSummary.startDate` (KI-034)

- **Changed:** `TripSummary` gains `startDate: string (YYYY-MM-DD) | null`,
  `.default(null)`. Shape-only regex, as on `TripStartDateSetV1`, since the
  value is copied from that event. No event or command changed.
- Why: KI-034 — Home's "Next trip" was `visibleTrips[0]` of a list query with
  no `ORDER BY`, so the hero was whichever row the heap returned first, and
  trip cards printed "Created {date}" because the summary had no real date.
- Consumers updated: `packages/domain` (`projectTripSummaries` folds
  `TripStartDateSet`); `apps/web` — `trip_summaries.start_date` (migration
  `0028_trip_summary_start_date`, nullable `text`, backfilled from
  `trip_details.doc->>'startDate'`), `applyTripEvents` writes it,
  `listTripSummariesVisibleTo` now orders `created_at DESC, trip_id DESC`
  (the same order as `listTripSummariesPage`), Home picks its hero with the new
  `lib/homeTripOrder.ts`, and `TripCard` / `NextTripHero` print the date.
  Test fixtures building a `TripSummary` add `startDate: null`.
  `openapi.json` regenerated: `GET /v1/trips` items gain `startDate`; nothing
  else moved.
- Breaking? no — additive. A payload without the key parses to `null`.
  **Deploy note:** the code reads and writes `start_date`, so migration `0028`
  must be applied before (or with) the deploy that ships this; dispatch
  `migrate-production` as usual (`docs/guidelines/environments-and-deploys.md`).

## 2026-09-24 — `SetTripDates` / `SetTripStartDate` refuse a date that is not on the calendar (KI-92)

- **Changed:** `SetTripStartDate.startDate` and `SetTripDates.startDate` /
  `.endDate` now use a `TripDateInput` (`YYYY-MM-DD` **and** a real day), so
  `2026-02-30`, `2027-02-29`, `2026-13-45` fail at the parse instead of reaching
  the domain's date math. **`TripStartDateSetV1` is deliberately unchanged** —
  a stored event is history and must replay even if it predates `decide.ts`'s
  `invalid-dates` refusal (PR #84); a test pins that.
- Why: KI-92 — shape is not calendar validity; the command pipeline was closed
  in PR #84, the contract was not, so any path around `decide.ts` could still
  reach a `RangeError`.
- Consumers updated: none needed. The UI's `<input type="date">` cannot emit an
  impossible date, and `decide.ts` already refused one; a crafted request now
  gets the parse error (4xx) at the boundary. `openapi.json` is unchanged (the
  generator's drift test passes).
- Breaking? no — every value it now refuses was already refused one layer in.
- **Also exported (same day, from review): `isCalendarDate`**, the one calendar
  check — the command schemas, `pages.ts`'s date filters (which had their own
  `Date.UTC` copy) and the domain's `decide.ts` (which now re-exports it) all
  use it. It parses the ISO string rather than calling `Date.UTC(y, m, d)`,
  which read years 0–99 as 1900–1999: a page date filter on `0050-01-01` was
  refused at the boundary while the domain accepted it. Not breaking for any
  date a person can enter.

## 2026-09-24 — A Playbook as a file, Discover over `v1`, keyed create (ADR-050 Pass C)

- **No `packages/contracts` schema changed.** A `v1` surface change plus an
  additive change to the content-bundle FORMAT (a fixture format, not a
  contract — `schema.ts`'s header says why). `openapi.json` regenerated;
  `/v1/library`'s entries are byte-identical, and `/v1/playbooks` moved only by
  the `Idempotency-Key` / `Idempotent-Replayed` headers on its `POST`.
- **New endpoints:** `GET /v1/playbooks/{playbookId}/export` (`library:read`,
  answers a `PlaybookExportBundle` raw, 409 for a stop the format cannot say),
  `POST /v1/playbooks/import` (`library:write`, body `PlaybookImportBundle`,
  answers `{ playbook, warnings, sourceVersion }` where a warning is
  `date-anchor-removed` | `visibility-reset`; idempotent), and
  `GET /v1/discover/playbooks` (`library:read`, a collection of the app's
  `DiscoverDay` cards; `?city`, `?country`, `?length`, `?rating`, `?sort`).
- **`POST /v1/playbooks`** takes `Idempotency-Key`.
- **`@tc/fixtures`**: `BundlePlaybook` gains optional `version` (int >= 1);
  new `PlaybookImportBundle`, `PlaybookExportBundle`, `playbookToBundle`,
  `toBundleDays`; `toSavedSequence` is now exported; `toBundleStop`'s parameter
  widens from `ActivityView` to `StopFields` (the eight fields it reads).
- **Server internals:** `storeSavedDay` takes an optional `authorKind`; new
  `discoverPage` (keyset) beside `discoverDays`, which is unchanged in
  behaviour (its select now shares `matchedCount` / `discoverColumns`).
- Why: ADR-050's remaining proposal items — a Playbook leaves and re-enters as
  a file, and everyone's published Playbooks are listable over `v1`.
- Consumers updated: `apps/web` (three new route files,
  `server/public-api/{playbooks,discover}.ts`, `server/playbooks.ts`,
  `server/savedDays.ts`); `packages/fixtures` (`schema.ts`, `fromTrip.ts`, new
  `fromPlaybook.ts`, `index.ts`). No bundle under `content/` changes.
- Breaking? No. Every change is additive.

## 2026-09-24 — Applying a Playbook: version pin, `expectedTripSeq`, `startingAt`, `Idempotency-Key`, warnings (ADR-050 Pass B, ADR-051)

- **No `packages/contracts` schema changed.** A `v1` surface change;
  `openapi.json` regenerated, and only
  `/v1/trips/{tripId}/playbook-applications` moved — `/v1/library`'s entries are
  byte-identical.
- **`POST /v1/trips/{tripId}/playbook-applications`** body gains `version?`
  (int >= 1), `placement?` (`{ mode: "append" }` default, or `{ mode:
  "startingAt", dayId }`) and `expectedTripSeq?` (int >= 0). The answer gains
  `playbookVersion`, `createdDayIds` and `warnings` (`conflict` |
  `weekday-mismatch`); `dayIds` now means "the day each Playbook day landed on"
  (identical to before on an append). A stale `version` or `expectedTripSeq` is
  409 `conflict` with `details.currentVersion` / `details.currentSeq`; an
  unknown `startingAt` day is 400. It declares the `Idempotency-Key` request
  header and the `Idempotent-Replayed` response header.
- **`route()`** gains `idempotent` (POST only), backed by the new table
  `api_idempotency_keys` — **migration `0027_api_idempotency_keys`**.
- **Server internals** (not contracts): `executeTripCommandBatch` takes an
  optional `{ expectedSeq }`; `CommandResult`'s error may carry `currentSeq`;
  `insertCommands` takes the days to merge onto (default `[]`, i.e. append);
  `insertSavedDay`'s fourth argument is now an options object (`now`, `version`,
  `startingAt`, `expectedSeq`) — no caller passed the old positional `now`;
  `InsertedIds` gains `createdDayIds`.
- Why: ADR-050's deferred Phase 2 — a safe retry, a concurrency precondition,
  and applying onto days a trip already has.
- Consumers updated: `apps/web` only — the route, `server/{commands,savedDays}.ts`,
  `server/public-api/{route,openapi,idempotency,applications}.ts`,
  `server/db/schema.ts`. The app's internal saved-day route and the assistant's
  insert pass nothing new and are unchanged.
- Breaking? No. Every new request field is optional and every new answer field
  is additive.

## 2026-09-24 — `SavedDay.version` and `SavedDay.summary`; Playbook composition and edits over `v1` (ADR-050, Pass A)

- **`SavedDay`** (`packages/contracts/src/saved.ts`) gains two fields, both
  defaulted so stored and old bytes still parse (the rule `SavedStop` states):
  - `version: int >= 1, default 1` — the content revision. Moves by exactly one
    on a change to `name`, `summary` or the days; never on a visibility flip.
  - `summary: string <= 500 | null, default null` — one authored paragraph.
- **Migration `0026_saved_day_version_and_summary`**: `saved_days.version integer
  NOT NULL DEFAULT 1`, `saved_days.summary text` — metadata-only, no backfill.
- **`v1` surface** (`openapi.json` regenerated; only the two `/v1/playbooks`
  paths moved — `/v1/library`'s entries are byte-identical):
  - `POST /v1/playbooks` body is now exactly one of `{ name, summary?, source:
    { tripId, days: [{ dayId, activityIds? }] } }` or `{ name, summary?,
    sourceName?, days: [{ stops: StopInput[] }] }` (`StopInput` =
    `SavedStop.omit({ dayIndex })`); rendered as `anyOf` of two strict objects,
    which the generator cannot emit as `oneOf`. Answers `{ playbook, warnings }`.
    **Breaking against Phase 1's body** (`CreateSavedDayInput`), which was never
    merged.
  - `PATCH /v1/playbooks/{playbookId}` takes `{ name?, summary?, visibility?,
    days?, expectedVersion? }` and answers `{ playbook, warnings }`; a stale
    version is 409 `conflict` with `details: { currentVersion }`.
  - `GET /v1/playbooks/{playbookId}` reads anyone's published Playbook;
    `GET /v1/playbooks` takes `?visibility=`.
  - The error envelope's `details` can now come from a handler
    (`PublicApiError`'s fourth argument), not only from the wrapper's zod issues.
- Why: composing a Playbook from part of a trip or inline, and editing one
  without a lost update, were ADR-050's deferred Phase 2.
- Consumers updated: `apps/web` — `savedDays.ts` (`toDto`, `newSavedDayRow`,
  `saveDay` split into `captureDays` + `storeSavedDay`, new
  `updatePlaybookContent` and `withoutDateAnchors`), `lib/savedStops.ts`
  (optional per-day activity filter; the app never passes it), the content
  importer (dev route and `import-content-production.ts` store a bundle's
  `summary`), `/api/dev/saved-days`, `server/public-api/{library,playbooks,
  commands,route}.ts`, two component tests' `SavedDay` literals.
  `/v1/library` declares over `LibraryDay` (`SavedDay.omit({ version, summary })`)
  so its answers are unchanged. `packages/fixtures` — `JapanSavedDay.summary`,
  three demo days carry one, `verify.ts`/`expectations.ts` count them;
  `resolvePlaybook` carries a bundle's summary.
- Breaking? no for `SavedDay` (additive, defaulted). The UI reads neither field
  yet.

## 2026-09-23 — `/v1/playbooks` and applying a Playbook over `v1` (ADR-050)

- **No `packages/contracts` schema changed.** This is a `v1` surface change:
  `apps/web/src/app/api/v1/openapi.json` gains three paths and loses nothing.
  - `GET`/`POST /v1/playbooks` and `GET`/`PATCH`/`DELETE
    /v1/playbooks/{playbookId}` — the same `saved_days` rows `/v1/library`
    serves, answering `SavedDay`. The `POST` body **is** `CreateSavedDayInput`
    (`dayIds`, ordered, 1–366), not a copy of it.
  - `POST /v1/trips/{tripId}/playbook-applications` — body `{ playbookId }`,
    answers a route-local `{ tripId, playbookId, dayIds, activityIds,
    historySeq }`: the minted ids in the Playbook's day order and `stops[]`
    order, and the `toSeq` of the one history entry the apply wrote.
- Why: `v1` could keep one day at a time and apply nothing. M23 had built both
  halves server-side (`saveDay` over `dayIds`, `insertSavedDay`); this publishes
  them without a new object type (ADR-048) and without touching `/v1/library`.
- Consumers updated: `apps/web` only — the three route files, the new shared
  `server/public-api/library.ts` (which `/v1/library`'s two route files now
  declare through), `insertSavedDay` (returns `minted` on success; the internal
  route's response is unchanged), `openapi.json` (regenerated), and
  `docs/guidelines/using-the-api.md`. No MSW handler — the frontend does not
  call these.
- Breaking? no. `/v1/library`'s `openapi.json` entries are byte-identical, and
  its handlers moved rather than changed.

## 2026-09-23 — `UndoLastChange` may name the batch it undoes (M27 D17)

- Added optional **`undoesBatchId: uuid`** to `UndoLastChange`
  (`packages/contracts/src/history.ts`). When present and it is not the batch
  the undo would take, `decideHistoryCommand` refuses with the new domain
  rejection code **`undo-target-changed`** and appends nothing;
  `POST /api/trips/:id/commands` answers it **409**. Rejection codes are free
  strings in the domain, not a contract schema, so no schema was added for it.
- Why: an assistant card's Undo checked "still the trip's last change?" only
  against the client's history, which can be a poll interval old, then sent a
  plain undo — so a collaborator's write landing first was the change undone.
  The precondition moves the check to where the decision is made.
- Consumers updated: `packages/domain` (`decideHistoryCommand`), `apps/web`
  (the commands route's status map; `TripBoardScreen`'s card Undo sends the
  applied batch; `TripProvider.dispatch` refetches on `undo-target-changed`
  rather than raising a banner, so the card derives "Changed since"). The
  header/keyboard Undo, the public API's `POST …/history/undo`, the MSW mock
  and every other `{ type, tripId }` caller are unchanged.
- Breaking? no — the field is optional and absent means exactly what it did.

## 2026-09-23 — the invite landing replaces the invite preview (M27 link 6)

- Added **`InviteLanding`** to `packages/contracts/src/access.ts`, a
  discriminated union on `state`: `valid` (inviter name, recipient email,
  sent-at, role, the trip's name/start/day/city/stop counts, a per-day
  `InviteLandingDay[]`, per-leg `InviteLandingLeg[]`, crew first names),
  `member` (trip id and name, `signedIn: true` only), `revoked`, and
  `unavailable` (the server's sentence). Every member is `.strict()`.
- **Removed `InvitePreview`.** Its one route, `GET /api/invites/:token`, now
  answers `{ landing: InviteLanding }` and no longer requires a session.
- Why: SPEC §35.6 draws the screen an invite link opens for somebody with no
  account — who asked, what the trip is, who is on it — and the preview could
  not be read signed out. The refusals stay as thin as the #71 review §7 made
  them, and `.strict()` is what holds them there: a field spread into
  `revoked` is a parse error at the route, not a leak (M27 D10). No user id
  crosses (ADR-027): the crew is first names, and the name chain stops before
  its email fallback. No `expired` state and no invite note — invites have
  neither (M27 D9, D11).
- Consumers updated: `apps/web` — the route, `server/inviteLanding.ts` (new;
  composed outside Access, which does not know what a trip contains),
  `apiClient.fetchInviteLanding` (replaces `fetchInvitePreview`), the new
  `InviteLandingScreen` (replaces `InviteAcceptScreen`), and their tests.
- Breaking? yes, for the BFF only — `InvitePreview` and `fetchInvitePreview`
  are gone, and the route's body key moved from `invite` to `landing`. No
  public-API (`/api/v1`) surface and no stored data involved.

## 2026-09-23 — report and moderation response shapes (M12 link 6)

- Added web-local `apps/web/src/lib/reports.ts` (not `packages/contracts`,
  for the reason `lib/playbooks.ts` gives): **`CreateReportResponse`**
  `{ report }`, **`AdminReportQueueItem`** `{ report, day | null, review |
  null, reportsOnTarget }`, **`AdminReportsResponse`** `{ reports }` and
  **`AdminReportActionResponse`** `{ report }`. Each wraps `ContentReport`
  rather than restating it.
- Why: the bodies of `POST /api/reports`, `GET /api/admin/reports` and
  `POST /api/admin/reports/:reportId`. A queue row carries the day's name and
  owner and the review's text because an operator deciding from a reason code
  alone is deciding blind.
- Consumers updated: `apps/web` — `server/reports.ts`, the three routes, and
  `mocks/handlers.ts` (`makeReportHandlers`). No `apiClient` function or screen
  reads them yet; the UI is a later step.
- `SavedDay` gains **no** `moderatedAt` field in this change: the owner's read
  is unchanged in shape, and whether the author's copy shows the operator's
  note is a UI decision left open.
- Breaking? no — new shapes only.

## 2026-09-23 — reviews, reports and place search: M12's contracts

- Added `packages/contracts/src/review.ts`: **`ReviewStars`** (int 1-5),
  **`ReviewNote`** (trimmed, at most **`REVIEW_NOTE_MAX`** = 140 code points,
  empty → `null`), **`PutReviewInput`** `{ stars, note, seenPublishedAt? }`,
  **`ReviewDayChanged`** (the 409 body), **`Review`**, **`ReviewSummary`**
  `{ average, count, histogram: {1..5} }`, **`SavedDayReviewsResponse`**
  `{ summary, reviews, mine }`, and the shared **`boundedNote(max)`**.
- Added `packages/contracts/src/report.ts`: **`ReportReason`**,
  **`ReportStatus`**, **`ReportTarget`** (discriminated on `kind`:
  `saved_day { savedDayId }` | `review { savedDayId, reviewerId }`),
  **`ReportTargetKind`**, **`CreateReportInput`** (note ≤ `REPORT_NOTE_MAX` =
  500), **`ContentReport`**, **`AdminReportAction`** (discriminated on
  `action`: `hide-day { note? }` | `hide-review` | `dismiss` | `restore-day` |
  `restore-review`).
- Widened the web-local shapes in `apps/web/src/lib/playbooks.ts` (not
  `packages/contracts`, for the reason that file gives): **`DiscoverSort`**
  gains `highest-rated` and `most-reviewed`; new **`RatingFloor`** `any | 3 | 4
  | 4.5` with `RATING_FLOOR_MIN` / `RATING_FLOOR_LABELS`; **`DiscoverDay`**
  gains `rating` and `reviewCount`; **`PublicAuthor`** gains `reviewsReceived`
  and `averageRating`. `apps/web/src/lib/cities.ts` gains **`PlaceMatch`**
  (discriminated on `kind`: `city` | `country { countryCode, name }`) and
  `PlaceSearchResponse`, beside `CityMatch` and on its precedent.
- Why: M12 links 1-7. A review attaches to the whole `saved_days` row (M12
  D1); the note cap is refused at the contract rather than truncated in the UI
  (a gate box), and is counted in code points because the column's
  `char_length` CHECK is. `seenPublishedAt` is the conflict state (D4): absent
  means "do not check", which is distinct from `null`. A review target has no
  id of its own, so it is named by the reviews table's key.
- Consumers updated: `apps/web` — schema + migration `0025_reviews_and_moderation`
  (`saved_days.rating`, `review_count`, `countries`, `moderated_at`,
  `moderation_note`; tables `saved_day_reviews`, `content_reports`),
  `server/playbooks.ts` (the new columns on Discover cards, both new sorts, and
  the author totals), `server/savedDays.ts` (`newSavedDayRow`), and the
  playbook screen test fixtures. No endpoint reads or writes a review or a
  report yet; those land with M12's later units.
- Breaking? no — every change is additive. `?sort=highest-rated` used to fall
  back to `most-added` and now sorts by rating, which is what the route's
  comment promised a link written against §15 would eventually get.

## 2026-09-22 — notebook pages become commands and events

- Added `packages/contracts/src/pageEvents.ts`: commands **`CreatePage`**,
  **`EditPage`**, **`DeletePage`** (union `PageCommand`) and events
  **`PageCreatedV1`**, **`PageEditedV1`**, **`PageDeletedV1`** (union
  `PageEvent`), plus the `isPageEventType` guard.
- Added to `HistoryEntry` (`packages/contracts/src/history.ts`) an optional
  **`pageId`**, so a history row can name the notebook it is about.
- Why: a notebook save wrote the `pages` table directly, so it moved no
  `headSeq`, appeared in no history and could not be undone or reverted to —
  reported by Mitchell on 2026-09-22 as a notebook edited on one device never
  reaching another. Page events now share the trip's stream.
- **`PageEvent` is NOT part of `TripEvent`, and that is the load-bearing
  decision.** One stream, two aggregates: `hydrate.ts` is the documented
  inverse of the projection under a round-trip property test, which makes
  `TripDetail` a strict superset of `TripState` — so a `pages` field on one is
  a `pages` field on the other, stored whole in `trip_details.doc` and
  refetched on every 2s poll. Each fold skips the other aggregate's events **by
  name**, so an envelope belonging to neither still throws.
- **`EditPage` has no `context` field**, deliberately: the Overview marker
  (`PageContext.kind`) is then structurally unwritable by an edit, so no
  command can promote an ordinary page into the undeletable one.
- Consumers updated: `@tc/domain` (`pageState.ts`, `history.ts`, `detail.ts`,
  `project.ts`), `apps/web` (page commands, BFF + v1 routes, importer, history
  panel, Overview lens) — in this same PR
- Breaking? no — no stored event payload changes, and `TripEvent.parse` still
  accepts every previously stored event. Pages that predate this have a ROW and
  no genesis event; they are backfilled lazily on first command rather than by
  a migration, and `HistoryEntry.pageId` is not in `required`.

## 2026-09-22 — a stop knows who booked it and who is going (M13 link 5)

- Added to `ActivitySnapshot` (`packages/contracts/src/activity.ts`):
  **`bookedBy: string | null`** (default `null`) and **`participants: string[]`**
  (default `[]`). Both flow automatically into `ActivityAddedV1` /
  `ActivityUpdatedV1` (which `.extend()` the snapshot) and into
  `ActivityState` (which is `z.infer<typeof ActivitySnapshot>`).
- Added to `ActivityView` (`packages/contracts/src/detail.ts`) **by hand** — the
  read model is deliberately not derived, and the `ActivityViewCoversSnapshot`
  guard forced the key. Its validators are deliberately looser than the
  snapshot's: a `bookedBy` naming somebody who has since left the trip must
  still READ, because membership changing under a stored document is an
  ordinary outcome.
- Added to `AddActivity` and `UpdateActivity` as optional inputs. On update,
  **omitted = unchanged and `bookedBy: null` CLEARS** — hence
  `=== undefined` rather than `??` in the decider, or "nobody booked this after
  all" would be read as "unchanged". `participants` is replaced wholesale
  rather than merged.
- **Two relations, not one**, and that is the load-bearing decision:
  Mitchell, 2026-09-03 (recorded in `M19-cost-model.md` link 3) — *"we need
  activities to have owners (and i think participants that are going to that
  activity)"*. Who BOOKED a stop is not who is GOING to it, and M19's cost
  splits need the participants. A single `assignee` would have satisfied
  `add-stop-who`'s wording and been wrong for every split built on it.
  Named `bookedBy` rather than `owner` because `owner` is already a `TripRole`
  and the `saved_days.owner_id` column.
- **`SavedStop` deliberately does NOT carry either field**, and
  `packages/contracts/test/saved.test.ts` now asserts the omission by name. A
  saved day is publishable — `visibility` flips to `"public"` — so copying
  attribution in would publish the originating trip's member ids to strangers,
  and it would be meaningless on the other end besides.
- **No migration.** Activities live in jsonb (`events.payload`,
  `trip_details.doc`), so there is no DDL to run; the contract defaults are
  what let a document written before this field existed read back at all. That
  is asserted, not assumed — `route.int.test.ts` strips both keys from a stored
  projection and reads the trip back.
- Why: M13 link 5. `add-stop-who` and `rack-provenance` had sat in
  `preview-registry.ts` since M11b blocked on exactly this absence; both
  entries are now gone, and M19 link 3 and M14's two cut person widgets are
  unblocked.
- Consumers updated: `packages/domain` (`decide`, `evolve`, `diff`, `detail`,
  `hydrate`, `equality`'s `FIELD_EQUAL`), `packages/factories`, `apps/web`
  (the editor's two new controls, the rack's provenance line, the MSW mock),
  and `apps/web/src/app/api/v1/openapi.json` (regenerated — `ActivityView` is a
  public v1 response shape).
- Breaking? **no** — both fields are defaulted on every schema that parses
  stored data, so every existing payload and document still parses.

## 2026-09-22 — a trip's log is pollable: `TripEventsPage` (M13 link 2, ADR-049)

- Added: `TripEventsPage` (`packages/contracts/src/envelope.ts`) — the response
  of `GET /api/trips/:tripId/events?after=<seq>`: `headSeq` (non-negative int),
  `events` (an array of the existing `EventEnvelope`), and `resync` (bool).
- **`EventEnvelope` is unchanged, and that is a decision rather than an
  omission.** ADR-049 Decision 1 rejects `events.global_seq` as the
  subscription cursor, so it stays off the wire: a `bigserial` takes its value
  at `INSERT` and becomes visible at `COMMIT`, so a reader polling
  `global_seq > cursor` can advance past an event that commits late and never
  be served it again. The cursor is per-stream `seq`, which `EventEnvelope`
  already carries and which cannot do that, because writing `seq` N+1 requires
  having read N committed rows in that stream.
- `resync: true` means the caller is further behind than one poll will carry
  (`MAX_EVENTS_PER_POLL`, 200) and should refetch the trip instead of
  collecting the gap; `events` is empty whenever it is set, so the two are
  alternatives rather than a partial answer plus a warning.
- Why: M13 link 2 — "the second person's edits do not arrive". Before this
  there was no shape for "what happened on this trip since `seq` N", and
  `ADR-046` had already recorded the consequence: with no realtime,
  refetch-on-mount was the only way anyone saw a co-traveller's edit.
- Consumers updated: `apps/web` only — `src/server/eventStore.ts`
  (`readStreamHeadSeq`, `readStreamAfter`), `src/server/broadcast.ts`, and the
  route `src/app/api/trips/[tripId]/events/route.ts`, which parses the response
  through this schema at the boundary. **No client consumer yet**: wiring
  received events into `TripProvider` waits on M13 link 3's re-prediction
  reducer, because ADR-049 forbids broadcast having its own merge path.
- Breaking? **no** — a pure addition. No existing schema changed, no migration,
  and no new index (the poll's range scan uses `events_stream_seq` as it
  stands).

## 2026-09-21 — the activity field set is declared once (KI-2026-09-05-o)

- Added: `ActivitySnapshot` (`packages/contracts/src/activity.ts`) — an exported
  `z.object` holding the eight fields an activity carries in state and on the
  wire (`title`, `timeWindow`, `location`, `notes`, `anchors`, `kind`, `tags`,
  `cost`), with the exact validators, nullability and `.default()`s the private
  `ActivityPayloadFields` object carried before it, **in the same key order**.
- **Removed: `ActivityPayloadFields`** — it was module-private and is replaced
  by `ActivitySnapshot.shape`, which `ActivityAddedV1` and `ActivityUpdatedV1`
  now `.extend()`. No consumer could reference it. Two historical entries below
  (2026-08-28 and 2026-09-05) name it; they are left verbatim as the record of
  what was true when they were written.
- **Changed: `ActivityState` (`packages/domain/src/trip/state.ts`) is now
  `z.infer<typeof ActivitySnapshot>`** instead of a hand-written mirror. Proven
  identical to the type it replaces with a `[A] extends [B] ? …` type-identity
  check (which distinguishes `k?: T` from `k: T | undefined`), including that
  `.default()` resolves to non-optional on the output type: `kind` is an
  `ActivityKind` and never null, `tags` an array and never null, `cost` is
  `Money | null`.
- Why: the field set was hand-enumerated in ~21 non-test files and **nothing
  went red when one was missed**. That class had already shipped three times,
  each as a silently dropped field — KI-1 (day order), KI-54 (`city` and
  `countryCode` invisible to equality, so a city-only edit was rejected as a
  no-op) and M18's editor sheet dropping `kind`/`tags`. The compile error now
  lands at `equality.ts`'s `FIELD_EQUAL` (a `Record<keyof ActivityState, …>`
  replacing the boolean chain) and at every derived site. **Verified by adding a
  ninth field and reading the errors**: `contracts/src/detail.ts`,
  `domain/src/trip/{decide,diff,equality,evolve,hydrate}.ts`, plus `factories`,
  `mocks/handlers.ts`, `ActivityEditorSheet.tsx` and ~27 test files.
- **NOT changed: `ActivityView` (`packages/contracts/src/detail.ts`).** Deriving
  it was built, measured and backed out — Mitchell's call, 2026-09-21. The
  snapshot carries write-path bounds (`title` 1..200, `notes` ≤2000) that the
  read model does not, and `getTripDetail` parses `trip_details.doc` straight
  off jsonb, so a stored value violating one would not fail a write, it would
  500 the board on read — the #71 shape (a required `kind` taking out every
  untouched pre-M18 trip), one field later. Measured, the derivation moved
  `ActivityView`'s parse behaviour in five ways: `cost` and `anchors` absent
  became permissive, and `title` empty, `title` >200 and `notes` >2000 became
  failures. The read model stays permissive; `ActivityViewCoversSnapshot`, a
  key-parity type assertion in `detail.ts`, keeps the compile-forcing without
  the behaviour change. It is weaker in one stated way — it forces the key to
  exist, not that its type matches.
- **NOT changed: `SavedStop` (`packages/contracts/src/saved.ts`).** Deliberate.
  It looks like the same eight fields but its header states a different rule
  (every field added from 2026-09-19 carries `.default()`) and its `kind`/`tags`
  are required, not defaulted; deriving it would change how already-saved
  `saved_days.stops` jsonb parses. Verified byte-identical parse behaviour after
  the change, including `kind` absent still failing.
- Consumers updated: `packages/domain` (`state.ts`, `equality.ts`),
  `packages/contracts` (`activity.ts`, `detail.ts`, two test comments naming the
  removed identifier). Nothing else needed an edit — the other sites were
  already typed against the derived shape.
- **Breaking? no, and wire identity was measured rather than argued.** A
  fingerprint harness parsed the same inputs against `ActivityAddedV1`,
  `ActivityUpdatedV1`, `ActivityView` and `SavedStop` before and after: zero
  diff on all four. No event payload, `trip_details.doc` or `saved_days.stops`
  changes shape, key order or parse behaviour. `apps/web/src/app/api/v1/openapi.json`
  regenerates byte-identical, so the public API spec does not move. No migration.

## 2026-09-19 — a Playbook is a sequence of days (M23, ADR-048)

- Added: `SavedStop.dayIndex` — `z.number().int().nonnegative().default(0)`
  (`packages/contracts/src/saved.ts`). Which day of the sequence a stop is on,
  0-based, and a **relative offset inside the Playbook, never an absolute trip
  day**: a three-day Playbook stores `{0, 1, 2}` whether it is appended to a
  five-day trip (becoming its days 6-8) or used to start a new one (days 1-3).
- Added: `SavedStop`'s header rule — **every field added to it from now on
  carries `.default()`**. `dayIndex` is the first adopter. `KI-20260905-l` asked
  for this; that entry is narrowed, not closed, because the `{ v, stops }`
  wrapper it also proposes is still absent.
- Added: `SavedDaySequence` — `SavedStop.array()` plus a monotonic
  non-decreasing `dayIndex` refinement. **Used by the write path only.** The two
  read boundaries share the plain `SavedStop.array()`, deliberately: a
  refinement on the shared array would drop rows whose stops are each valid, at
  read time, out of a person's library.
- Added: `SavedDay.dayCount` — `z.number().int().min(1).default(1)`. Stored
  rather than derived from `max(dayIndex) + 1`; ADR-048 decision 2 has the three
  reasons, the shortest being that Discover's new length filter has to be a SQL
  predicate and only a column can be one.
- **Changed: `CreateSavedDayInput.dayId` → `dayIds`**, an ordered
  `z.array(z.string().uuid()).min(1).max(366)`. The days need not be adjacent in
  the source trip and are renumbered from zero. 366 reuses the bound
  `POST /v1/trips/import` already applies to a trip's days.
- Why: M23 — the library held exactly one unit, a day, and nothing a person
  travels is one day. A saved day generalises into a saved SEQUENCE in the same
  row rather than gaining a sibling object type, so M12 can key reviews to a row
  that is already final.
- Consumers updated: `@tc/domain` (`citiesOfSequence` — the per-day fold, because
  `citiesOfStops` sorts timed stops across everything it is handed and would
  interleave a sequence's days), `@tc/fixtures` (`BundlePlaybook` gains `days`,
  `toSavedSequence`, `playbookStops`; the two seed sets), `apps/web` (the
  `day_count` migration and column, `parseSavedDayColumns` at both read sites,
  `stopsForDays`, `insertCommands` over N days, the Keep-day picker, the
  Discover card and its length filter, `openapi.json`) — same PR.
- **Breaking? For stored rows, no.** `dayIndex` is defaulted, so every
  `saved_days.stops` value written before today parses unchanged, with every
  stop on day one, through both read boundaries — asserted over rows in the
  pre-migration shape rather than by inspecting a library
  (`savedDays.sequence.int.test.ts`). `day_count` lands `NOT NULL DEFAULT 1`,
  which is metadata-only and needs no backfill.
- **Breaking? For TypeScript callers, yes, and deliberately so.**
  `z.infer<typeof SavedStop>` makes a `.default()` field REQUIRED on the output
  type, so every literal construction of a `SavedStop` must now supply
  `dayIndex`. That is a compile-time prompt, not a runtime break, and it is the
  half of this change that makes the additive half safe.
- **Breaking? For `v1`, no — and the non-change is deliberate.**
  `POST /v1/library` declares its own `SaveDayBody` and keeps `dayId`, singular.
  It is a published contract with a generated `openapi.json`, M23's scope says
  nothing about the public API, and widening it would either break callers or
  leave two shapes for one question. It calls the sequence path with a
  one-element list. `openapi.json` changes only by ADDING `dayIndex` and
  `dayCount` to the `SavedDay` response shape, which no reader breaks on.

## 2026-09-18 — `Location.address`, and the geocode vocabulary of `v1`

- Added: `PostalAddress` and optional `Location.address`
  (`packages/contracts/src/activity.ts`). Structured on the CLDR /
  libaddressinput model — `countryCode`, `lines[]` in local order,
  `dependentLocality`, `locality`, `administrativeArea`, `postalCode` (string) —
  because addresses differ too much across countries for one string or a
  `street`+`houseNumber` split. Caller-authored only; never assembled from
  vendor output.
- Added: refine — `Location.countryCode`, when present, must equal
  `address.countryCode`.
- Added: `GeocodeOutcome`, `GEOCODE_OUTCOME_HEADER`, `GeocodeCandidates`
  (`packages/contracts/src/publicApi.ts`).
- Why: an AI building trips over `v1` had no way to get a stop onto the map
  without already knowing its coordinates.
- Consumers updated: `packages/domain` (`activityStatesEqual` compares
  `address`), `apps/web` (v1 stop routes, new geocode route, `openapi.json`).
- Breaking? no — every addition is optional; a stored document without
  `address` parses unchanged (location-address.test.ts). The new refine can
  only reject a document that has `address`, and none exists yet.

## 2026-09-16 — `conflict`, and `PageSummary` gains `createdAt`

- Added: `ApiErrorCode` gains **`conflict`** (409)
  (`packages/contracts/src/publicApi.ts`). `executeTripCommand` answers
  `concurrency-conflict` when an append loses the optimistic-concurrency race,
  and every other route in the app has mapped that to 409 since M1 — `v1` mapped
  it to 400 and the enum had no word for it, so the one refusal a caller should
  retry unchanged was reported as the one thing they must change.
- Added: `PageSummary` gains **`createdAt`** (`packages/contracts/src/pages.ts`).
  `listPages` orders `(created_at asc, id asc)`, so a summary carrying only
  `updatedAt` left `GET /v1/trips/:id/pages` paging on a field the rows are not
  sorted by — no comparison over the summary as it stood could be made correct.
- Why: both surfaced in CodeRabbit's second pass on M22, and both are defects in
  what `v1` publishes rather than tidying.
- Consumers updated: `apps/web` (`toSummary`, the two `v1` route declarations,
  `openapi.json`).
- Breaking? no — both are additive. A client switching on `ApiErrorCode` that
  does not know `conflict` still reads the status; `PageSummary` gains a field
  and loses none.

## 2026-09-16 — the public API's vocabulary, and `api.tokens`

- Added: `ApiScope` and `API_SCOPES` — the eight scopes an API token may hold
  (`packages/contracts/src/publicApi.ts`)
- Added: `SCOPE_CATALOGUE` — an exhaustive, frozen `Record<ApiScope,
  ApiScopeDescription>` giving each scope a title and the sentence a person reads
  when deciding whether to grant it
- Added: `ApiErrorCode` and `ApiError` — the one error envelope every `v1` route
  returns, `{ error: { code, message, details? } }`
- Added: `ApiToken`, `ApiTokenCreated`, `ApiTokenCreateInput`, and the four
  format constants (`API_TOKEN_PREFIX`, `API_TOKEN_PREFIX_LENGTH`,
  `API_TOKEN_MAX_LIFETIME_DAYS`, `API_TOKEN_DEFAULT_LIFETIME_DAYS`)
- Added: **`Entitlement` gains `api.tokens`** — a fourth member
  (`packages/contracts/src/entitlement.ts`)
- Why: M22 Phase 0. The design is
  `docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`; the scope
  and gate are `docs/milestones/M22-public-api-and-tokens.md`. The vocabulary
  lands before anything reads it because every later phase depends on these
  words, and a word changed after its second consumer exists is a migration
  rather than an edit
- **`api.tokens` gates two acts, not one**: minting a token
  (`accountCan(userId, "api.tokens")`, 402 if not) and *using* one (the owner's
  entitlements resolved per request, same 402). The second half is what makes a
  downgrade bite before a token refreshes — a token lives for months, so an
  entitlement cached on its row would be that defect with a longer fuse. It is
  granted by `premium` and no other plan, recorded as a named plan and never as a
  height
- **There is no route registry here and there must never be one.** A route is
  public if and only if its file is under `apps/web/src/app/api/v1/**`
  (Decision 1). The Next.js file router already decides the URL; a constant
  listing the same routes is the drift invariant 5 exists to stop, and
  `publicApi.test.ts` fails if one appears
- **`SCOPE_CATALOGUE` is copy in a contracts package, deliberately.** Its
  exhaustiveness is the mechanism: a ninth scope **fails to compile** until
  somebody writes the sentence — verified by adding one, which errors `TS2741` at
  the catalogue. The alternative is eight sentences drafted in a hurry by whoever
  builds the form, and two copies of them that disagree within a release.
  `AdminGrantInput`'s refusal message is the precedent for user-facing text here
- **`ApiToken` carries no secret and no entitlement, in any spelling.** The
  secret is returned once by `ApiTokenCreated` and stored as `sha256`, which
  breaks with `TripShare`'s plaintext token on a stated reason that does not
  transfer: nothing re-shows an API token. Tests assert both absences by parsing
  an object that contains them and checking they are stripped
- **`ApiToken.scopes` has no `.min(1)` while `ApiTokenCreateInput.scopes` does**,
  and the asymmetry is intentional: minting a scopeless token is refused, listing
  one is not. A row that somehow has no scopes is the one its owner most needs to
  find in order to revoke it, and a read schema that refused to parse it would
  hide exactly that row
- Consumers updated: `packages/contracts` only — `entitlement.test.ts`'s
  vocabulary assertion now names four capabilities. **Nothing else needed a
  change**, verified rather than assumed: no `Record<Entitlement, …>` exists
  anywhere, so the fourth member breaks no exhaustiveness, and every UI check is
  an `includes(…)` against a list
- Breaking? **No.** Everything here is additive. `Entitlement` gaining a member
  widens a union, which no existing consumer narrows over; the new schemas have
  no existing callers by design — Phase 0 lands the words, and Phases 1 to 4
  supply the readers

## 2026-09-15 — `losesOnLapse`, and `sessionId` on a started checkout

- Added: `PlanBillingView.losesOnLapse` — the entitlements an account would stop
  conferring if its subscription stopped (`apps/web/src/server/entitlements/
  accountPlan.ts`, mirrored in `apps/web/src/lib/accountPlan.ts`)
- Added: `CheckoutStart.sessionId` and `kind: "checkout"`'s `sessionId` on
  `POST /api/billing/change` — the Checkout Session's own id
  (`apps/web/src/server/billing/{checkout,planChange}.ts`)
- Why, for `losesOnLapse`: the account sheet's past-due and lapsed banners each
  name what a lapse costs other people, and **neither set already on the wire
  can answer that**. The effective entitlements include what grants supply, so
  reading them names losses that never happen; the held plan's own list is blind
  to grants, so it names a loss that does not occur for any account whose grant
  covers the same thing — on this deployment, most of them, since every account
  predating M20's migration carries a founder grant. Both are false in one of
  the two worlds. The value is the difference of two unions, computed once by
  `entitlementsLostIfSubscriptionStops`
- **A list rather than the one boolean the sheet needs today**, so the next
  sentence that has to name a loss needs no second wire change
- Why, for `sessionId`: the plans route decides "did this checkout reconcile" by
  comparing against a baseline, and its only other source was the first read
  AFTER returning from Stripe — which loses a race to a fast webhook and leaves
  a completed purchase sitting on the pending screen. The id lets the browser
  key a baseline captured BEFORE the redirect to the session it describes. It is
  not a secret and it proves nothing on its own; only the webhook does
- Consumers updated: `apps/web` (account sheet, plans route, and the fixtures in
  `PlanSection.test.tsx` / `PlansScreen.test.tsx`, which the wire-shape
  type-identity checks required)
- Breaking? **No** for `sessionId` — an added optional field on a response.
  **Yes, narrowly,** for `losesOnLapse`: it is required on `PlanBillingView`, so
  any other construction of that type fails to build until it supplies one. That
  is the intended behaviour of the wire-shape checks and it caught both fixtures
  in this PR rather than letting them drift

## 2026-09-14 — `SubscriptionStatus`, and what still confers

- Added: `SubscriptionStatus` — the eight statuses a Stripe subscription can
  hold, spelled as Stripe spells them
  (`packages/contracts/src/entitlement.ts`)
- Added: `CONFERRING_STATUSES` — the three under which a subscription is still
  handing its account the plan it pinned (`trialing`, `active`, `past_due`)
- Why: M21 link 1. The subscription row stores what Stripe told us, and the
  vocabulary for that has to cross a boundary — the webhook writes it, the
  account sheet renders it, and the Entitlements resolver reads whether it still
  confers
- **A transcription, not a model.** M21 link 2's division of authority is that
  the plan version is the source of truth for what is granted and Stripe is the
  source of truth for what is charged. Translating a status at the write
  boundary is how two sources of truth start to disagree: a status we had no
  word for would have to be mapped onto one we did, and the first such mapping
  is silent. A status Stripe adds later fails *parsing* instead, loudly, at the
  one place equipped to say so
- **`past_due` confers**, and that is the milestone's grace window rather than
  an oversight: a declined card keeps its entitlements for three days from the
  decline (M21 link 6). The window — not the status — is what ends that, so this
  list answers only the first half of the question and
  `server/billing/standing.ts` answers the second
- **No member of this enum is an entitlement**, and no gate reads one. What an
  account may do is still `can(ent, capability)` over the resolver's answer.
  M21 adds no entitlement and no gate
- **Presentation is a different vocabulary and is not here.** The account sheet
  reads `Active` / `Free week` / `Payment failed` / `Lapsed` — four words over
  eight statuses plus a window — and that mapping is a rendering decision
- Consumers updated: `apps/web` (`server/db/schema.ts`, the whole
  `server/billing/**` module)
- Breaking? no — additive

## 2026-09-13 — `AdminGrantInput`, and a fourth `PlanId`

- Added: `AdminGrantInput` — `{ userId, planId, expiresAt: string|null, reason }`
  (`packages/contracts/src/entitlement.ts`), the operator console's one write
- Changed: `PlanId` gains **`studio`**. Its version entry ships `enabled: false`
- Why: M20 links 7 and 8. `studio` is the milestone's **fourth-plan proof** — a
  plan granting `trip.collaborators` **without** `ai.command`, so it is
  incomparable with `plus` and no rank can place it. The gate box asks for a
  plan that can be *added*, not one that could be, and adding it cost this one
  member plus one entry in the committed plan file: **no gate, resolver or
  authorisation path changed.** `planVersions.fourthPlan.test.ts` proves that
  by sweeping the whole app for a *comparison* against a plan id
- **The honest limit, written down rather than left to be found as a
  contradiction:** `studio` IS a subset of `premium`, because `premium` holds
  the entire three-word vocabulary. That is a fact about there being three
  capability strings, not about the plans, and it stops being true the moment a
  fourth capability exists that `premium` does not grant. The incomparability
  with `plus` never depended on it
- **`AdminGrantInput` carries no version field**, deliberately: a grant pins the
  version live when it is issued, resolved server-side. An operator typing a
  version number is an operator who can type one that does not exist, and the
  failure would be a silent entitlement hole rather than a 400. `expiresAt` is
  nullable rather than optional — "forever" is a decision, and an omitted field
  would let one be made by accident. `reason` is required: a comp nobody can
  explain six months later is a billing dispute with no evidence
- **No price field.** M20 never learns what a plan costs
- Consumers updated, same PR: `app/api/admin/grants/route.ts` (the only write on
  the operator surface — it refuses a disabled plan, so `studio` is published,
  typed and resolvable while being unreceivable),
  `components/admin/GrantForm.tsx`, `server/entitlements/planVersions.ts`
- Breaking? no — `AdminGrantInput` is new, and widening a `z.enum` accepts
  strictly more. Nothing that parsed before stops parsing

## 2026-09-13 — `TripAccess.collaboratorsEntitled`: is this trip collaborative

- Added: `collaboratorsEntitled: z.boolean()` on `TripAccess`
  (`packages/contracts/src/access.ts`). Nothing else changed shape
- Why: M20 link 6. Inviting anyone requires the trip **owner's**
  `trip.collaborators`, and the Travelers panel has to know before it renders a
  control — the design handoff (§17.3) does not disable the *Invite someone*
  button for an unentitled owner, it does not render it at all and puts a
  named-tier block in its place
- **The OWNER's entitlement, not the reader's**, and the asymmetry is the
  design: the owner is the billing subject, so an editor reading this learns
  whether the trip they are on is collaborative, not whether their own account
  could pay for one
- **Advisory, exactly like `myRole`.** `POST /api/trips/:tripId/invites`
  refuses with **402** and `code: "collaborators-not-entitled"` whatever a
  client does with this field
- **Entitlements never learns what a trip is** (ADR-045 rule 5). This is the
  boolean Access & Membership reads out of that module and puts on its own DTO;
  `trip.collaborators` is an opaque capability string on the other side of that
  call, and `moduleBoundary.test.ts` enforces the direction
- Consumers updated, same PR: `app/api/trips/[tripId]/access/route.ts`
  (computes it from the owner; the demo trip is entitled by construction,
  because its travellers are invented people and that path must touch no
  database), `components/trip/TravelersPanel.tsx` (the named-tier block and the
  lapse banner)
- Breaking? no — a new required field on a response DTO, produced by the one
  route that builds it. No stored payload and no request shape moved

## 2026-09-13 — `ai-not-entitled` answers 402, not 403 (BREAKING, wire)

- Changed: `POST /api/trips/:tripId/ask` answers **402 Payment Required** with
  `code: "ai-not-entitled"` where it answered **403 Forbidden**. The body's
  shape and the `code` string are unchanged
- Changed: the refusal's `error` text. It was *"AI is not available for this
  account."*; it is now one exported constant, `AI_NOT_ENTITLED_REASON`
  (`apps/web/src/server/ai/modelSelection.ts`), which **names the tier**:
  *"The assistant is part of Plus. This account is on a plan that does not
  include it."*
- Added: `AI_NOT_ENTITLED_STATUS` beside `AI_NOT_ENTITLED_CODE`, on both sides
  of the UI/server wall (`server/ai/modelSelection.ts` and `lib/apiClient.ts`),
  pinned equal by the existing cross-wall parity test
- Why: M20 link 4. `modelSelection.ts` recorded the old choice in as many
  words — *"403, not 402: 402 asserts a payment relationship that does not
  exist yet"* — and M20 creates one. The two statuses differ by exactly what
  matters at this surface: a 403 says the account did something it may not, a
  402 says it does not have a thing it could have. The second is actionable
- **Breaking? YES, and this is the one wire break M20 makes.** The `code` is
  unchanged, so a client branching on it — which is what this repo's own
  client does, and what the code exists for — is unaffected. Anything branching
  on the status alone moves with it. There is no compatibility window: the
  status and the meaning changed together, and serving 403 to "old" clients
  would mean serving the wrong answer to all of them
- Consumers updated, same PR: `lib/apiClient.ts` (the constant and its error
  table), `components/board/TripBoardScreen.tsx` (stops rewriting the refusal
  as *"The assistant is switched off for this account"* — a permission error
  where the server now sends a tier — and passes `askUpgrade` from the CODE,
  never from the prose), `components/assistant/useAskThread.ts` (carries
  `askErrorCode` beside `askError`, because a surface cannot tell an actionable
  refusal from a failure by reading prose), `components/assistant/AssistantRail.tsx`
  (renders this one refusal as a `role="status"` upgrade block rather than a
  `role="alert"` red line)
- **No price, anywhere on this path.** M20 never learns what a plan costs. The
  refusal names `Plus` and stops; the rail says plans live in account settings
  and offers no control, because M20 ships no billing surface for one to open —
  M21 link 5 fills the `onOpenAccount` seam. A test asserts the rendered
  refusal carries no currency, amount or period

## 2026-09-13 — the entitlement vocabulary: what an account may do

- Added: `Entitlement` (`ai.ask` | `ai.command` | `trip.collaborators`),
  `PlanId` (`free` | `plus` | `premium`), `PlanVersionRef`
  (`"<planId>@v<n>"`, regex built from `PlanId.options`), `GrantSource`
  (`trial` | `referral` | `admin` | `founder`), plus the `ENTITLEMENTS` and
  `PLAN_IDS` iteration constants — all in
  `packages/contracts/src/entitlement.ts`, re-exported from the index
- Why: M20 link 1 — the first commercial vocabulary in the product. ADR-045
  rule 6 splits the Entitlements module in two: **contracts owns the words,
  the committed plan file owns the offers.** A capability no code checks is
  meaningless, and a check for a capability that does not exist must fail to
  compile — which is why the strings are an enum here rather than data in the
  plan file
- **`PlanId` is an identity, not a rank.** There is no ordering export beside
  it and none inside the file; `z.enum` preserves declaration order in
  `.options`, and that order is an artifact of how the constant is written,
  never authority. `accessPolicy.ts`'s `RANK` is the right shape for roles
  inside one trip and the wrong shape here — a comparison operator near a plan
  forces every later tier to be a superset of an earlier one, permanently
  (ADR-045 rule 4). `test/entitlement.test.ts` sweeps the file's own source
- **This package says the words and never what a plan contains.** No `PLANS`
  constant, no ceilings, and **no price of any kind** — M20 publishes versions
  that are free by construction and M21 link 2 adds `priceMinor`, `currency`
  and `stripePriceId` to the plan file's entries. A price string in a M20 diff
  means the split failed, and a test asserts its absence here
- **No trip type is imported and no planning capability is named.** ADR-045
  rule 5: Entitlements answers `can(account, "trip.collaborators")` and the
  *caller* knows that capability is about invites. There is deliberately no
  `trip.plan` string, because trip planning is free for every account and a
  capability that exists is one somebody will eventually check
- Consumers updated: `apps/web` —
  `src/server/entitlements/planVersions.ts` (the committed plan-version file,
  typed against `Entitlement`), `src/server/entitlements/capability.ts`
  (`can()`), and `src/server/assistant/entitlements.ts`, whose `AiCapability`
  becomes `Extract<Entitlement, "ai.ask" | "ai.command">` rather than two
  hand-written strings — exactly what that file's comment said would happen
  when link 1 landed — so the kernel's subset is provably a subset
- Breaking? no — every name is new. Nothing parsed differently, no stored
  payload changed shape, and no wire response moved. *(M20 Phase 3's 403→402
  on `/ask` and `/ai` **is** a breaking wire change and gets its own entry
  when it lands.)*

## 2026-09-13 — `PageContext.kind`: which page this is, stored
- Added: `kind: z.literal("overview").optional()` on `PageContext`
  (`packages/contracts/src/pages.ts`). Nothing else changed shape
- Why: SPEC §25 — *"every trip is created with one notebook page it cannot
  delete"*. Something has to say WHICH page that is, and it cannot be the title
  (a reader may rename it) or the position (sorting decides that). It is in
  `context` rather than as a column because `pages.context` is already `jsonb`
  and this is a fact about the page's identity, which is what that field holds
- **Not a scope.** A page is trip-bound and about nothing in particular (§18);
  `kind` says which page it is, not what it is about
- **This entry is late, and that is the finding rather than the fix.** The field
  landed with the §25 work and Invariant 5 says contracts change by protocol,
  not by drift — CodeRabbit flagged the missing entry on PR 170. Recorded here
  with the behaviour it turned out to need, which is worth more than a
  same-day stub would have been
- **Optional, so every page written before it parses unchanged**, and its
  absence is the ordinary case: `isOverviewPage` is `context.kind ===
  OVERVIEW_KIND`, false for every page that has no `kind` at all
- **It is IMMUTABLE once stored, and that is enforced rather than assumed.**
  `updatePage` carries the stored `kind` across a PATCH and discards the
  caller's, and `deletePage` refuses in its own `WHERE` clause rather than in a
  read-then-delete pair. Before both, a PATCH carrying `{ tripId }` — which is
  exactly what the one route that PATCHes a page sends — stripped the marker,
  and the next DELETE removed the page every trip is supposed to keep. Three
  integration tests pin it, including one that marks a row through raw SQL to
  prove the refusal is the database's
- Consumers updated: `packages/pages` (`OVERVIEW_KIND`, `isOverviewPage`,
  `overviewPage`'s `buildContext`), `apps/web` (`server/pages.ts`,
  `OverviewLens`, the pages routes)
- Breaking? no

## 2026-09-13 — `trip.countdown` joins the `attribute` allow-list
- Added: `"trip.countdown"` to `AttributeFieldRef`
  (`packages/contracts/src/pages.ts`). Nothing else changed shape
- Why: the Overview a brand-new trip opens on is otherwise a page of empty
  states. Every other widget reads the trip against itself; this one reads it
  against **today** — "in 34 days", "starts tomorrow", "day 3 of 14", "ended
  last week" — and it is the one line on a new trip's Overview that is about to
  be true. It is an `attribute` field rather than a thirteenth primitive for
  ADR-039 decision 6's reason: it reads one fact about one thing and there is no
  set to narrow, so `LEGAL_FILTERS.trip` being empty is the right answer for it
- **Additive to a live database, and it does not migrate anything.** A preset is
  data, not a stored identifier (ADR-039 decision 4): a document stores
  `attribute` and `{ field: "trip.countdown" }`, and no page written before this
  can contain the new value. Widening a `z.enum` accepts strictly more, so every
  stored `attribute` node parses exactly as it did
- Consumers updated: `packages/pages` (`attribute`'s `read()` and its
  `NOTHING_TO_SHOW` map, the `trip.countdown` preset, `WidgetContext.today`),
  `apps/web` (`MacroView` passes the reader's date, `lib/today.ts` reads it).
  The registry's own tests enumerate the enum — `registry.test.ts`'s
  "names each primitive's non-filter params" and `attribute.test.ts`'s
  "accepts every field on the list" both failed on the new member, which is what
  those tests are for
- Breaking? no

## 2026-09-12 — `Location.precision`: what a coordinate DESCRIBES, so the map can stop overclaiming
- Added: `LocationPrecision = z.enum(["venue", "area", "city"])`, exported, and
  `precision: LocationPrecision.optional()` on `Location`
  (`packages/contracts/src/activity.ts`). Nothing else changed shape. Because it
  sits on `Location`, it reaches `AddActivity`/`UpdateActivity` and both activity
  event payloads for free — unlike `placeRef` below, this one IS meant to be
  stored forever
- Why: a user asked the assistant to add locations to a day of Jeonju stops on
  prod (2026-09-12) and the approval answered 400 "This change would have no
  effect." LocationIQ carries none of those venues — KI-2026-08-30-f records that
  OSM's coverage of small independent venues is structurally thin, so this is the
  common case rather than the rare one. The fix is for enrichment to fall back to
  a city-level coordinate, and the moment it does, a city centroid and a real
  venue fix become byte-identical in storage. The map cannot draw an honest pin
  for something it cannot distinguish, so the distinction has to be stored
- **The three words are not new, and that is the point.** `scripts/geocode-content.py`
  already tiers its answers `venue`/`area`/`city` and refuses to write the third
  (`docs/guidelines/content-bundles.md:314-325`, "City pins are withheld because
  putting every stop of a day on one point draws a map that says something false
  about the day"). Reusing that vocabulary makes the offline pipeline's tiering
  and the runtime's the same concept rather than two that drift. It also records
  what changed about the old objection: the map now groups coincident city-level
  stops into one pin, which is the half that was missing when city pins were
  withheld
- **Granularity, not quality — and absent means UNKNOWN.** A city centroid is a
  precise coordinate for a city, not an imprecise one for a venue; naming the
  granularity keeps it a fact rather than a verdict. There is deliberately **no
  `.default()`**: every location already in the database predates this field —
  the hand-authored Japan fixtures, everything a user typed, every coordinate the
  assistant has written — and defaulting them to `venue` would claim a precision
  nobody established, which is the laundering of a guess into a stored fact that
  KI-15 is about. `packages/contracts/test/location-precision.test.ts` pins the
  enum, the absence, the command/event round-trip, and a pre-`precision`
  `trip_details.doc` still parsing (the `area`/KI-35 tripwire, repeated — M18
  shipped a required field into this shape and 500'd every pre-M18 board)
- **Deliberately NOT a fourth tier for the assistant's own unverified guess.**
  When no vendor can corroborate a venue, enrichment keeps the model's own
  coordinates, and those reach the map indistinguishable from a vendor-verified
  venue — arguably the least trustworthy pin on it, since a city centroid is at
  least a real place. Enrichment therefore leaves `precision` ABSENT for them
  rather than claiming `venue`. Naming that tier is a product decision about what
  the map should claim, not a shape this change can settle
- Consumers updated: `packages/domain/src/trip/equality.ts`
  (`activityStatesEqual` — a field missing there makes changes to it a silent
  no-op, which is KI-54 and is exactly the bug class that produced this work);
  `apps/web/src/server/ai/geocodeEnrichment.ts` (writes it);
  `apps/web/src/server/assistant/tools/read.ts` (the assistant's view of a
  location, so it can say a stop is only placed at city level instead of implying
  it pinned it); `apps/web/src/components/lenses/` (MapLens, mapRailData,
  MapLegend — the grouped disc and its legend key)
- **The enum is exported as a named schema, and `area` is currently unreachable
  at runtime.** `GeocodeResult` carries no granularity of its own, so
  `enrichCommandLocations` can only write `venue` or `city`; the middle tier
  exists so the runtime enum can represent what `geocode-content.py` already
  produces offline, which is the whole point of sharing one vocabulary. Anything
  rendering these must still treat `area` as possible. Exported because the first
  consumer (`read.ts`) was otherwise reduced to
  `Location.innerType().shape.precision.unwrap()` — a reach through `Location`'s
  `.refine()` that breaks the moment the refinement moves
- Breaking? **no.** Optional, no default, additive against a live database;
  pre-change projections parse unchanged, and every consumer treats absence as
  "unknown" rather than as a tier

## 2026-09-12 — `placeRef` on `AddActivity`/`UpdateActivity`: the grounding citation (M9 link 1, KI-81/KI-15)
- Added: `placeRef: z.number().int().nonnegative().optional()` on `AddActivity`
  and `UpdateActivity` (`packages/contracts/src/activity.ts`). Nothing else
  changed shape
- Why: M9's grounding. A proposed stop's `location` is currently whatever the
  model wrote, and blind enrichment then geocodes that text — which is how a
  Niagara Falls dinner moved to Shropshire (KI-15). The field is the citation
  half of the fix: the model cites candidate N of what the server's place search
  returned this turn, and the server resolves the ref into the vendor's name and
  coordinates. The tool that produces the candidates and the resolution that
  consumes the ref are the next PR; this is the shape they both agree on, landed
  first so neither is written against a type that does not exist yet
- **Optional, and that is the design, not a migration convenience.** A location
  a *user* typed arrives as free text with no ref, and `enrichCommandLocations`
  still geocodes it best-effort. Grounding replaces the model's guess, never the
  user's words — which is what closes KI-15's remaining half rather than
  deleting the fallback
- **Transport only: deliberately NOT added to `ActivityPayloadFields`**, so it
  reaches neither `ActivityAddedV1` nor `ActivityUpdatedV1`. An index into a
  per-turn server-side cache means nothing once the turn is over; what is worth
  storing forever is the resolved place. `packages/contracts/test/m9-place-ref.test.ts`
  asserts the payload shapes stay free of it, because "we resolve it before the
  domain sees it" is a claim a later PR could quietly stop honouring
- Consumers checked, and this is the part invariant 5 is actually about — every
  place that enumerates activity-command fields BY HAND was inspected:
  - **Derived, so they carry it for free and are tested to:** the planning tools
    (`assistant/tools/planning.ts`, one tool per `BatchableCommand` member with
    the id fields subtracted — `planning.test.ts` now pins that the subtraction
    never reaches `placeRef`), `batchResolver.ts` (copies every non-ref arg, then
    parses), `parseApprovedCommands` (`ai/writeTools.ts`, re-parses through
    `BatchableCommand` — `writeTools.test.ts` now pins that the approval door
    carries a ref through), `AssistantProposal.commands`
    (`contracts/src/assistant.ts`) and the client that posts it back
  - **Hand-enumerating and correctly unchanged:** `decideTripCommand` and
    `evolveTrip` (`@tc/domain`) enumerate the fields that get STORED, which
    `placeRef` is not; `describeProposedChange`/`summarizeBatch` switch over
    command TYPES and word `title`, not the field set; `src/mocks/handlers.ts`
    mirrors the domain's projection and would drift from the real server if it
    started keeping a ref
- `@tc/fixtures` exercises it in `src/japan/placeRef.test.ts`: the canonical
  Japan commands now parse through `TripCommand` (nothing in that package ever
  did, so a tightened activity command could have broken `db:seed` at runtime
  with the package green), a ref rides them without being rejected, and no
  fixture row carries one — there is no search turn behind a hand-written row.
  `pnpm seed:verify` green, report unchanged
- Breaking? No. The field is optional on both commands, absent from every event,
  and no stored payload changes

## 2026-09-11 — the `/ask` stream envelope: `AskStreamMetadata`, and the proposal it carries (KI-22, M9 Phase 0 P6)
- Added: `packages/contracts/src/assistant.ts` — `AskStreamMetadata`, the union
  of the four shapes the `/ask` stream's final chunk may carry as the AI SDK's
  `messageMetadata` (`{ proposal }` · `{ pageInserts: { content } }` ·
  `{ composeError }` · `{}`), plus the payload schemas it is built from:
  `AssistantProposal`, `ProposedChange` and `ProposedInsert`. Also `SIMULATED_HEADER`
- Why: KI-22. The envelope was an object literal in `handleAskRequest.ts` and a
  set of `typeof` guards in `apiClient.ts` — a cross-boundary type living in
  neither `packages/contracts` nor this file, which is invariant 5's drift case
  exactly. `AssistantProposal` was worse than unschematized: it was hand-written
  TWICE, once per side, and the copies had already diverged — `ProposedChange.type`
  was `BatchableCommand["type"]` on the server and `string` on the client, which
  is how a test fixture asserting `type: "activity.move"`, a name no command has
  ever had, sat in the suite unnoticed. It fails to compile now
- Named `AskStreamMetadata` after the SDK field it IS, not `AskEnvelope`:
  `envelope.ts` already exports `EventEnvelope` for the event log's envelope, and
  two envelopes in one package is a collision the reader pays for. In a new file
  rather than in `pages.ts` or `trip.ts` because it belongs to neither module —
  it composes both (`BatchableCommand`, `PageDoc`)
- `ProposedChange.type` is derived from `BatchableCommand.options`, not a
  hand-written `z.enum`, so a thirteenth command joins it for free
- **`simulated` is deliberately not a member of the union, and the decision is
  half of what KI-22 asked for.** It is a response header
  (`x-tc-ai-simulated`), set before a byte of the stream so a turn that fails
  mid-answer is still badged; stream metadata rides the FINAL chunk, which that
  failure path never sends, so folding it in would reintroduce the bug the header
  exists to prevent. What it needed was one owner rather than a schema — it had
  two, and `apiClient.ts` carried a comment explaining that it could not import
  the server's copy. The NAME moves here; the transport does not change
- Consumers updated: `apps/web` — `server/ai/handleAskRequest.ts` (the
  `messageMetadata` callback and `pageInsertsMetadata` are typed
  `AskStreamMetadata`, so a misspelled key is a compile error; the local
  `SIMULATED_HEADER` is gone), `server/ai/writeTools.ts` (the local
  `AssistantProposal`/`ProposedChange` interfaces are gone), `lib/apiClient.ts`
  (parses through `AskStreamMetadata`; `proposalFrom`, the local
  `ProposedInserts` schema, the duplicate types and the re-declared header
  literal are gone, and `pageInsertsFrom` is reduced to the migrate-on-read step
  a schema cannot do), `components/assistant/ProposalCard.tsx` and three test
  files that imported the type from `@/lib/apiClient`
- **Nothing on the wire changed**, which is the point: the bytes the server
  writes and the bytes the client reads are identical, and the `/ask`,
  `/ask/apply` and telemetry integration suites plus the milestone e2e ran
  unedited to prove it
- Read path, and the one behaviour that DID change: the client now rejects a
  payload it used to repair. `changes` and `skipped` were read with a
  `flatMap`/`filter` that dropped a malformed entry and kept the rest, so a
  proposal could reach the card describing fewer changes than Approve would
  commit — the same desync the all-or-nothing rule on `inserts` was written to
  prevent, pointed the other way. A malformed entry anywhere now fails the whole
  parse and no card is rendered. No server this repo has ever shipped can produce
  such a payload
- Forward compatibility is deliberate and asymmetric: the three payload branches
  strip an unknown key, so a key a newer deployment adds beside a valid
  `proposal` costs an older client nothing; the empty branch is `strictObject`,
  because a permissive `z.object({})` matches any object and would swallow every
  malformed payload as "nothing"
- **Review follow-through on #163 — two holes the schema alone had left, both
  unreachable from our own server and both fixed for the same reason: a contract
  that holds only while the producer is correct is not doing KI-22's job.**
  - The empty branch's inferred type is `Record<string, never>`, not the `{}`
    zod infers. `{}` is assignable FROM every object, so a single `{}` member
    made the whole union accept any object and a producer's
    `{ proposalTypo: proposal }` compiled. The client's parse still rejected it;
    what failed was the producer-side safety that is half of why this moved
    here. Runtime is unchanged — the branch still parses `{}` and still rejects
    `{ anything: 1 }` — and a `@ts-expect-error` test now holds the guarantee
  - A chunk carrying more than one RECOGNISED outcome key is rejected. A union
    returns the FIRST matching branch, so `{ proposal, composeError }` parsed as
    the proposal and silently discarded the server's refusal, and
    `{ proposal: <invalid>, composeError }` fell through to the refusal — a
    valid sibling key hiding a broken one. An unrecognised key beside a single
    outcome is still stripped: this narrows ambiguity between known shapes and
    is deliberately not `.strict()`
- Breaking? **no.** No wire field added, renamed or removed, and no stored data
  is involved — the envelope exists only for the lifetime of one streamed turn

## 2026-09-06 — `SavedDay.authorKind`: a playbook says who wrote it
- Added: `SavedDayAuthorKind` (`"human"` · `"ai"`) and `SavedDay.authorKind`,
  defaulted to `"human"`, in `packages/contracts/src/saved.ts`
- Why: Mitchell, 2026-09-06 — *"we will need to indicate in the database when
  its a human playbook or a AI seed data"*. The content importer
  (`travel-collab/content-bundle/v1`, ADR-041) seeds a library of generated
  playbook days beside days people kept out of their own trips, and the two have
  to be distinguishable from a row, not from a commit message
- Named `authorKind`, not `origin`: `Origin` in `history.ts` already means the
  provenance of a batch of EVENTS (user / undo / redo / revert) and
  `events.origin` is a real column carrying it. It is also not an id — `ownerId`
  is who owns the day, this is what sort of author wrote it
- Consumers updated: `apps/web` (`saved_days.author_kind` + migration
  `0017_saved_day_author_kind`, `newSavedDayRow`, `fromRow`, `toDiscoverDay`,
  the local `DiscoverDay` response shape, and `AuthorKindBadge` on the Discover
  card and the shared-day screen), `@tc/fixtures` (the bundle schema's
  `bundle.origin`, and `resolvePlaybook`)
- Read path: an unparseable stored value falls back to `"human"` and LOGS,
  rather than dropping the row the way an unparseable `stops` or `visibility`
  does. That asymmetry is deliberate and is argued in `fromRow`: those two
  decide what a reader may see, this decides a label — and only `"ai"` is ever
  rendered, so a value we cannot read asserts nothing about the author, which is
  the truth
- Breaking? **no.** The column is `NOT NULL DEFAULT 'human'`, so the migration
  lands on existing rows with no backfill; the contract field is `.default()`,
  so a producer that omits it still parses. Every route except the importer
  writes `"human"` by not saying anything

## 2026-09-04 — `PageDoc` v2: the seventeen widget names become twelve primitives
- Added: `AttributeFieldRef` in `packages/contracts/src/pages.ts` — the closed
  list of fields `attribute` may read (`trip.name`, `trip.budgetRemaining`,
  `account.name`, `account.homeAirport`). Named `…Ref` rather than
  `AttributeField` because `manifest.ts` already exports that for a describable
  field of a collection, which is a different thing
- Added: `WIDGET_NAME_MIGRATION` and the v1 → v2 step in
  `PAGE_DOC_MIGRATIONS` (`packages/contracts/src/pageDoc.ts`).
  `CURRENT_PAGE_DOC_VERSION` is **2**, derived from the chain as it always was
- Why: ADR-039 decision 9, *"one migration, once"*. Four of the seventeen names
  were the same widget written twice, and a preset is data that is never stored
  — so this is the whole cost of the vocabulary change to stored documents, and
  it is one function. `PAGE_DOC_MIGRATIONS` was built empty for exactly this
- Note: the node SHAPE is unchanged, which is what lets the step be
  `(PageDoc) => PageDoc`. It rewrites `attrs.name` and the KEYS of
  `attrs.params` (`dayRef` → `day`), both of which the current schema already
  accepts. The file's warning that a real migration would need a per-version
  schema is still owed by the first change that alters the vocabulary of nodes
- Note: a name this build does not recognise is left ALONE, not dropped —
  decision 3's carry-don't-drop applied to a name rather than a node type
- Consumers updated: `@tc/pages` (the twelve primitives, the preset table, and
  `insertPreset`; the seventeen named defs are deleted), `apps/web` (the picker,
  the slash menu, drag-and-drop, the chrome row, the assistant's tool surface,
  and `apiClient`, which now migrates an inserts payload before it reaches the
  editor)
- Fixtures: `packages/contracts/test/fixtures/pageDocV2.ts` is the v2 golden,
  hand-written beside the now-FROZEN v1 one. The round-trip tests moved to it;
  the v1 golden is what the migration is tested against
- Breaking? **no for readers, yes for writers.** Every stored v1 row migrates on
  read and is written back at v2. Nothing outside this repo writes these
  documents. A build older than this one reading a v2 row would refuse it
  (`migratePageDoc` rejects a future version) and open the page read-only with
  an explanation, which is ADR-038 decision 4 working as designed

## 2026-09-04 — the filter vocabulary: six dimensions and their value shapes
- Added: `FilterDimension` (`day` · `city` · `tag` · `kind` · `person` · `dates`),
  `CityRef`, `KindRef`, `PersonRef`, `DateRangeRef` and `FILTER_VALUE_SCHEMAS` in
  `packages/contracts/src/pages.ts`. Together with the existing `DayRef` and
  `TagRef` they are the closed vocabulary a widget's selection can be narrowed
  along (ADR-039 decision 1)
- Why: they are here for exactly the reason `DayRef` and `TagRef` are — these
  values are PERSISTED in `MacroNode.attrs.params`, and the editor, the AI
  compose path and the resolvers all read them. `FILTER_VALUE_SCHEMAS` is the one
  map `@tc/pages` builds each primitive's params schema from, so "the declared
  filters and the params schema agree" is true by construction rather than by six
  files remembering
- Note: **an absent dimension means every member, not "unset"** (ADR-039 decision
  2). `TagRef` already worked this way; this generalises it. `DateRangeRef`
  refuses a reversed range rather than swapping the endpoints — quietly
  reinterpreting a mistake is how a widget shows a confident wrong answer — and a
  single date is `from === through`, so the control has one shape rather than two
- Note: `PersonRef` is **vocabulary, not a capability** (ADR-039 decision 7).
  `TripMember` has no display name and no stop carries a person, so a widget
  handed one renders the "needs a field" state. It is declared now so the shape is
  settled; the capability lights up with M13 `add-stop-who` / M19 link 3
- Consumers updated: `@tc/pages` (the legality matrix, `filterParams`, and the
  eleven primitives), `apps/web` (`MacroView`'s `person` branch now says "needs a
  person field" rather than "no one set", which invited a choice no control can
  offer)
- Breaking? no — every schema is new, and nothing stored today carries one

## 2026-09-04 — `TagRef`, and `valueKindOf` through a wrapper
- Added: `TagRef` in `packages/contracts/src/pages.ts` — the value shape of a
  `tags` input inside one widget's params, alongside `DayRef`. It is
  `ActivityTag`; absent means "every stop", which is a real binding and not an
  unset one
- Why: it was declared locally inside `stop.line`, in `@tc/pages`. ADR-037
  decision 9 puts these shapes in `packages/contracts` precisely because "the
  editor, the AI path and the resolvers all read them", and this one is
  PERSISTED in every document carrying that widget — three readers of a stored
  value with no single definition between them. Found by Copilot on PR 139
- Note: this is narrower than decision 9's own row, which reads
  `"all" | ActivityTag[]`. SPEC §18 (later) asks for one tag or none, and no
  control in the design expresses a set. Recorded in the ADR as Mitchell's call;
  widening is one line here plus a control
- Changed: `valueKindOf` now walks a schema's wrappers, so a kind attached by
  `described()` survives a later `.nullable()` / `.optional()`. It read only the
  outer object, so an ordinary nullable field was published with a label and no
  kind — "listed but not printable". `unwrapSchema` is shared with the
  manifest's label lookup, which already unwrapped
- Consumers updated: `@tc/pages` (`stop.line`), `apps/web` (the bind controls
  read the shared schema)
- Breaking? no — `TagRef` is the shape `stop.line` already wrote, given a name
  and a home; the `valueKindOf` change only widens what it can find

## 2026-09-04 — the widget contract completed: `WidgetShape`, value kinds, an optional trip
- Added: `WidgetShape` (`single` | `block` | `repeat`), superseding `MacroKind`
  for widget definitions — `MacroKind` could say inline or block and had nowhere
  to put a repeater (link 6). `MacroKind` stays for the older callers
- Added: `ValueKind` (`money` | `date` | `count` | `text` | `duration`) and
  `described(kind, label, schema)`, which annotates a readable field with both
  facts in one line. `TripGlobals`' fields all go through it
- Changed: `AttributeEntry` is a Zod discriminated union with `AttributeField`,
  so the type is inferred rather than hand-written (invariant 5) and the
  manifest's own output is parseable — a malformed entry is now a test failure
- Changed: `AttributeRef` refuses a `key` with no `collection`
- Why: all four came out of Copilot's review of PR 134. The value kind is what
  ADR-037 open question 4 means by "how to serialize them"; without it
  `costSubtotal` was indistinguishable from `activityCount`, so the manifest
  could name a field and still not say how to print it
- Consumers updated: `@tc/pages` (`MacroDef` gains `title`, `shape`, `preview`
  and an `item?: ItemScope` argument; `WidgetContext.trip` becomes optional and
  every resolver answers `unbound("trip")` without one), `apps/web`
  (`MacroView` renders that state) — in this same PR
- Breaking? **no** on the wire. `TripGlobals`' shape is unchanged — `described()`
  is `.describe()` plus a WeakMap entry, so the schema it returns parses
  identically. The widget-definition changes are internal to `@tc/pages`

## 2026-09-03 — the attribute manifest, and `AttributeRef` (ADR-037 open question 4)
- Added: `buildAttributeManifest()`, `AttributeEntry`, `AttributeRef`
- Why: the settled answer to *"a developer adding a new global attribute gets it
  for free"* — a widget whose control is a searchable select over a GENERATED
  list of readable paths, with a structured stored param and no user-facing
  syntax. `{{trip.cities[Tokyo].activities.length}}` was dropped because a
  freeform string has no declared inputs (so no control, no preview, no
  `needs a field` badge) and cannot express a lookup that MISSES, which
  decision 6's "not set up" requires
- Built by inverting the **Zod** schema, not the TypeScript type, per that
  decision's own refinement: in this repo the type is the derived artifact
  (invariant 5), so inverting it would need the compiler API plus a codegen
  artifact to recover what Zod already holds at runtime. Walking
  `ZodObject.shape` needs no build step and lives in `packages/contracts`, which
  depends on nothing
- **Exposure is opt-in twice over**, which is the half that is a safety property
  rather than a feature: only schemas named in `MANIFEST_ROOTS` are walked
  (`TripGlobals` and nothing else — there is no "walk everything" entry point,
  so `TripDetail`'s `dismissedConflictIds`, `forkedFrom` and internal uuids
  cannot be published by accident), and within a root only fields carrying
  `.describe()` are listed. Anything added later is EXCLUDED by default
- `AttributeRef` is `.strict()`: an extra key is a parse error rather than
  something dropped on the next save, and a string expression does not parse at
  all
- Consumers updated: none yet — the `trip.attribute` widget that reads this
  needs an `attribute` input type and a control to render it, which arrives with
  the insert surface (item G). The manifest's contract is fully asserted by
  `packages/contracts/test/manifest.test.ts` in the meantime
- Breaking? **no.** Additive: new exports only

## 2026-09-03 — `TripGlobals`: the trip's addressable collections (ADR-037 open question 4)
- Added: `TripGlobals` (`days`, `cities`, `tags`, `bookedCount`) with
  `TripGlobalsDay`, `TripGlobalsCity`, `TripGlobalsTag`
- Why: ADR-037 open question 4's settled answer needs `trip.cities` to BE a
  collection. It is not stored — cities are derived per-activity by
  `citiesOfDay` in `@tc/domain`, and AGENTS.md's module map makes
  `apps/web/src/server/**` the only code that may import domain. So the
  projection is computed server-side, described here, and delivered to the
  client, exactly as `TripDetail` already is. Mitchell chose this shape over
  letting `@tc/pages` import `@tc/domain` (2026-09-03), which would have put
  domain code in the browser bundle through a side door that three files in
  `apps/web/src/lib` deliberately avoid
- Every field carries `.describe()`, which is not documentation: item E's
  attribute manifest is built by inverting this schema, per ADR-037 open
  question 4's settled refinement (invert the Zod schema, not the TS type,
  because in this repo the type is the derived artifact)
- `people` is deliberately absent, not empty: nothing links an activity to a
  person, and an empty array would read as "this trip has nobody on it" rather
  than "this build cannot answer that". It arrives with M13 `add-stop-who` /
  M19 link 3
- Consumers updated: `apps/web` (`server/tripGlobals.ts`, a new
  `GET /api/trips/:tripId/globals` behind the same viewer guard as the detail
  route, `fetchTripGlobals`, and `WidgetContext.globals` through
  `PageScreen` → `PageEditor` → `MacroView`) — in this same PR
- Breaking? **no.** Additive: a new schema and a new route. No existing response
  shape changed, and `fetchTripDetail` is untouched on purpose so the board, the
  lenses and the map do not pay for a projection only the Notebook reads
## 2026-09-03 — the page write path becomes `PageDoc`; the read path stays permissive (ADR-038 decision 4)
- Changed: `CreatePageInput.content` and `UpdatePageInput.content` are `PageDoc`,
  not `PageContent` — a document this build cannot parse is refused at the API
  boundary, and comes back out carrying its `v` (decision 2, "written on every
  save")
- Unchanged, deliberately: `Page.content` and `PageSummary` stay `PageContent`.
  A strict read schema would make `fetchPage` throw on exactly the row decision
  4 needs to show the reader a read-only explanation for. Read what is there,
  write only what we understand — the asymmetry is the design, and ADR-038
  decision 4 now says so
- Added: `newPageDoc(content?)` — builds a document at
  `CURRENT_PAGE_DOC_VERSION`, so no producer hard-codes `v: 1`
- Added: `collectPageDocNodeTypes(doc)` — every node type in a document, at any
  depth, with an unknown node reported by the type it WRAPS. This is the half of
  decision 4's guard contracts can answer without importing TipTap; the editor
  half is `PAGE_EDITOR_NODE_TYPES` in `apps/web`
- Moved: `MacroNode` from `pages.ts` to `pageDoc.ts`. Same export from
  `@tc/contracts`, no consumer change — `pages.ts` needs `PageDoc` now, and Zod
  schemas built at module load do not survive a circular import
- Why: ADR-038 decision 4. Its stated round-trip criterion was measured not to
  detect either form of the loss it exists to prevent (a `repeat` node and a
  newer build's node both round-trip byte-identically and both make TipTap
  discard the whole document) — see the ADR's 2026-09-03 amendment
- Consumers updated: `@tc/pages` (templates typed against the AST), `apps/web`
  (`PageScreen` guard + read-only page, `PageEditor`, `pageTools`, `apiClient`,
  `ComposePanel`, `NotebookScreen`, `NotebooksMenu`) — in this same PR
- Breaking? **yes, on writes only.** A `POST`/`PATCH` whose `content` is not a
  parseable `PageDoc` now 400s where it previously stored anything doc-shaped.
  No stored row changes and no migration is needed: reads stay permissive, `v`
  defaults to 1 for the rows that have none, and a row is rewritten at the
  current version on its next ordinary save

## 2026-09-03 — `PageDoc` widens to the real v1 vocabulary (ADR-038 amendment)

- Added to the node union: **`PageBlockquoteNode`, `PageBulletListNode`,
  `PageOrderedListNode`, `PageListItemNode`, `PageCodeBlockNode`,
  `PageHorizontalRuleNode`** at block position and **`PageHardBreakNode`** at inline
  position, plus `PageCodeTextNode` (a code block's text carries no marks) and
  `PageListContentNode`. `PageHeadingNode` now accepts **levels 1-6**, not 1-3
- The union is now **recursive** — `bulletList → listItem → paragraph`, and a blockquote
  holds blocks — so `PageNode` carries an explicit `z.ZodType` annotation and the four
  recursive shapes are hand-written interfaces. `serializePageNode` recurses with it
- Why: `PageEditor` loads full `StarterKit`, so every one of these is reachable **today**.
  They were classifying as `unknown`, and under ADR-038 decision 4 a document that does
  not round-trip opens **read-only** — so any existing notebook containing a bulleted list
  would have become uneditable the moment the editor integration landed. Mitchell chose
  widening the AST over narrowing `server/ai/pageTools.ts` (2026-09-03)
- Every shape here is **measured**, not read off the ADR: an editor built with
  `PageEditor`'s own `[StarterKit, MacroNodeExtension]` was fed one of each node and its
  `getJSON()`/`schema.nodes` read back. That is where `orderedList`'s second attr (`type`,
  not just `start`), `codeBlock`'s `language: null`, and the *absence* of an `attrs` key on
  `horizontalRule`/`hardBreak` come from. The previous entry's "levels 1-3 per the ADR" is
  what this reverses
- The v1 golden fixture grew to match. A golden that omits half the version it is the
  golden *for* is not a guard; it freezes when a v2 fixture sits beside it, not before
- Consumers updated: none — nothing imports `PageDoc` yet, which is exactly why this was
  worth doing now and not after the editor integration
- Breaking? **no.** Strictly widening: every document that parsed before still parses,
  and documents that previously became walls of unknown nodes now parse as themselves

## 2026-09-03 — `PageDoc`: the notebook document becomes a versioned AST (ADR-038 step 1)

- Added: `PageDoc` (`{ v, type: "doc", content: PageNode[] }`) and its node union —
  `PageParagraphNode`, `PageHeadingNode`, `PageWidgetNode`, `PageRepeatNode`,
  `PageUnknownNode`, plus `PageInlineNode`/`PageTextNode`/`PageMark` — in a new
  `src/pageDoc.ts`. With them: `PAGE_DOC_MIGRATIONS` (an ordered, currently EMPTY
  chain of pure `(doc) => doc` steps), `CURRENT_PAGE_DOC_VERSION` derived from its
  length, `migratePageDoc`, `parsePageDoc`, `serializePageNode`, `serializePageDoc`
- **`PageContent` is untouched and still in use.** `PageDoc` lands *alongside* it;
  swapping the call sites belongs with the editor work (ADR-038 decision 4) and would
  break the app if done here
- Why: `PageContent`'s `z.array(z.unknown())` cannot say whether a stored page is
  valid or what format it was written in. ADR-038 asked for the empirical answer first,
  and it is now measured rather than asserted — see
  `apps/web/src/components/pages/editor/PageEditor.test.tsx`, "PageEditor given a node
  type the schema does not know". TipTap does not throw and does not drop the one node:
  it catches ProseMirror's `RangeError: Unknown node type`, warns, and mounts an EMPTY
  document, which `PageScreen` then autosaves over the original 800 ms later. The blast
  radius is the whole page
- Two places this build deviates from ADR-038 as written, both deliberate and both
  pinned by tests: the widget node's stored discriminator stays **`"macro"`** (the ADR
  writes `"widget"`; renaming it would reclassify every existing widget as an unknown
  node, so it is a v2 migration, not a rename), and `heading` is **levels 1-3** per the
  ADR even though `server/ai/pageTools.ts` accepts 1-6 today
- Consumers updated: none — the schema is additive and nothing imports it yet.
  `packages/contracts` gains `fast-check` as a devDependency for the round-trip property
- Breaking? **no.** No stored data changes, no migration, no call site moves

## 2026-09-03 — `PageContext` loses `dayRef`: a page has no scope (M14 link 2, ADR-035)

- Changed: `PageContext` is now `{ tripId }`. The optional `dayRef` is **removed**
- Kept, deliberately: **`DayRef` itself**, which is no longer a page property but *is*
  now the value shape of a day binding inside a widget's `params` — still a
  cross-boundary type, so it stays in contracts rather than moving into `@tc/pages`
- Why: SPEC §18 (2026-09-02) replaced §7's page-scope model with ADR-035's — *a page is
  not "about" anything; a widget is a function of its own declared inputs*. The case the
  old model could not express is the one that motivates the new one: **two widgets on one
  page reading two different days**. A page-level `dayRef` makes that impossible by
  construction
- **This un-ships part of PR #126 on purpose.** #126 shipped the Trip-wide / Day 6 badge
  on the notebook index on 2026-09-03, built against §7 a day after §18 replaced it. A
  conformance change, not a regression — `docs/STATUS.md` and `M14-rich-layer.md` both
  say so in advance
- Also here, because invariant 5 requires every consumer updated in the same PR and
  leaving them broken is not "updated": **`cost.day` and `itinerary.day` now take their
  day from their own `params`** rather than from the page context. That is ADR-035
  decision 3 ("a binding lives on the widget instance, in the node's `params`") arriving
  one link early. Without it these two widgets could not resolve a day at all between
  this PR and link 4 — a dead widget on `main` across two merges. `inputs: WidgetInput[]`
  and the UI that reads it are **not** here; they are links 3 and 4
- Consumers updated: `packages/pages` (`macros/inline.ts`, `macros/block.ts`,
  `templates.ts`), `apps/web` (`lib/pageScope.ts` — `scopeLabel` deleted,
  `components/pages/DayBindingControl.tsx` — deleted, `PageScreen`, `NotebookScreen`,
  `NotebooksMenu`, `server/ai/context.ts` — `resolveBoundDay` deleted,
  `server/ai/handleAskRequest.ts`), plus the e2e spec and every test that built a
  day-bound `PageContext`
- Breaking? **yes for TypeScript, no for stored data and no migration.** `pages.context`
  is a `jsonb` column (`server/db/schema.ts:103`) and `PageContext` is a plain, non-strict
  Zod object, so a row still carrying `dayRef` parses and the key is stripped on read.
  Nothing backfills; nothing needs to

## 2026-09-03 — the notebook list route answers with `viewerId` (M14, follow-up)

- Added: `GET /api/trips/:tripId/pages` now returns `{ pages, viewerId }`, and
  `fetchPages` resolves a `NotebookList` (`{ pages, viewerId }`) instead of a
  bare array
- **Not a `packages/contracts` change** — the route's response envelope was
  never a contract schema; `PageSummary` itself is untouched. Recorded here
  anyway because it changes a shape two consumers read, and because the entry
  below is what made `actorId` available in the first place
- Why: `actorId` proves a *person* wrote a notebook, not that the **reader**
  did, so the index's provenance line labelled every collaborator's notebook
  "Yours" on a shared trip. The route already resolves the reader from its own
  `guard(tripId, "viewer")`, so the truthful answer costs no extra request —
  which is also why `KI-20260903` (filed on the premise that this needed a
  `users` join) is resolved rather than carried
- `viewerId` is `null` when absent, and `provenanceLabel` then stays
  author-neutral rather than guessing
- **`listPages` now projects a real `PageSummary`.** Its declared return type
  said so already while it returned full `Page` rows, so every notebook's
  unbounded `content` crossed the wire and was stripped client-side after
  download — on a list the Notebooks menu re-reads on every open
- Consumers updated: the list route, `lib/pagesClient.ts`, `lib/pageScope.ts`,
  `NotebookScreen`, `NotebooksMenu`, `mocks/handlers.ts`
- Breaking? **no** for the wire (additive field); **yes** for `fetchPages`'
  TypeScript signature, and both call sites are updated here

## 2026-09-03 — `PageSummary` carries `actorId`, and `SYSTEM_ACTOR_ID` moves into contracts (M14, navigation-and-index half)

- Added: `actorId` to `PageSummary`'s `Page.pick({...})`, and a new exported
  `SYSTEM_ACTOR_ID = "system"` in `packages/contracts/src/pages.ts`
- Why: SPEC §7's Notebook index draws a provenance line — "Comes with your trip"
  for a notebook the lazy template seeder wrote, "Yours" for one a person wrote
  — and the only fact that separates the two is whether the row's `actorId` is
  the seeder's sentinel. The list had no way to know
- **Nothing new goes over the wire.** `listPages` already returns `toPage(row)`,
  a full `Page`, on every call (`apps/web/src/server/pages.ts`); `PageSummary`'s
  `.pick` was stripping `actorId` off at parse time in `pagesClient`. This
  widens what the client is allowed to keep, not what the server sends
- **`content` deliberately stays off `PageSummary`.** It is the one field that
  makes a list response unbounded, and nothing in a list renders it. The
  pre-existing test asserting a summary carries no `content`
  (`pagesClient.test.ts:23`) still holds
- **Why `SYSTEM_ACTOR_ID` is a contract and not a server constant:** it was
  `const SYSTEM_ACTOR_ID` inside `apps/web/src/server/pages.ts`, private to the
  module that writes it. The UI now READS it — the provenance line is "is this
  row's `actorId` that sentinel?" — so a value compared on both sides of the
  server/UI wall is exactly what `packages/contracts` is for (AGENTS.md
  invariant 5). The server now imports it rather than declaring its own
- **It is still load-bearing for a migration.** Migration 0005's
  `pages_system_seed_unique` partial unique index is scoped to
  `WHERE actor_id = 'system'`, so changing the string means changing that index.
  The comment saying so moved with the constant rather than being left behind in
  the file that no longer defines it
- Consumers updated: `packages/contracts`, `apps/web` (`server/pages.ts`,
  `lib/pageScope.ts`, `components/pages/NotebookScreen.tsx`)
- Breaking? **no** — additive on a read DTO. An older client parsing a newer
  response ignores the extra key; the field was already present in the JSON

## 2026-09-02 — `UserPreferences`, the Identity module's first cross-boundary DTO (M17 PR1)

- Added: `packages/contracts/src/identity.ts` with `DistanceUnit`
  (`z.enum(["km", "mi"])`), `UserPreferences` and `UpdateUserPreferences`, all
  types inferred. Exported from the package index
- Why it is a contract and not an `apps/web` type: preferences cross the
  server/UI wall — written by `PATCH /api/account/preferences`, read by the
  settings Sheet and by every surface that renders a distance — which is
  exactly what `packages/contracts` is for (AGENTS.md invariant 5)
- Why it is NOT event-sourced: ADR-003 scopes the log to planning, and a
  preference is not trip state. Putting "switch to miles" in the event log
  would make it an entry in some trip's undo stack. These are ordinary CRUD
  columns on `users` (ADR-025), the same shape as the Access module's tables
- **`displayName` is a new column, not `users.name`.** `upsertUser`'s
  `onConflictDoUpdate` rewrites `name` from the OAuth provider on every
  sign-in, so one column cannot hold both the provider's value and a
  user-chosen one — a name typed into settings would be silently clobbered at
  the next Google sign-in. The resolution order becomes
  `displayName ?? name ?? email ?? handle`, filling the seam `displayNameFor`
  (`apps/web/src/lib/displayName.ts`) already reserved for M17
- **Absent and `null` mean different things** on `UpdateUserPreferences`:
  absent leaves a field alone, `null` clears it. That is why `UserPreferences`
  declares its fields nullable rather than optional — a schema of optional
  fields cannot express "clear this". `distanceUnit` has no `null` because the
  storage layer defaults it and it has no unset state
- **The empty patch is refused, not treated as a no-op.** A `PATCH` carrying
  nothing is far likelier to be a client bug — a field name that silently
  failed to match — than a deliberate request to change nothing, and a 200
  would hide it. **"Empty" is measured by values, not keys** (fixed on #111
  after review): a key whose value is `undefined` is still a key, so
  `Object.keys(...).length` accepted `{ displayName: undefined }` — a patch
  asking for nothing, passing the check written to refuse patches asking for
  nothing. `null` still counts as a real instruction, since clearing a field is
  the distinction this schema exists to preserve
- **`homeAirport` is validated, never coerced.** Three uppercase letters or
  `null`; this package holds no transforms by convention, so trimming and
  upcasing a typed `sfo` belongs to the accepting route, before the parse. It
  is deliberately not resolved against any airport dataset: the timezone it
  would eventually feed is out of M17's gate by Mitchell's decision
  (2026-09-01), because the app has no timezone infrastructure at all
- Consumers updated: none yet, and that is the point — this PR is schema plus
  changelog so it is reviewable on its own, per AGENTS.md's rule that a
  contract change is its own reviewed step before dependent work continues.
  The migration, the Identity module functions, the route, `kmLabel` and the
  settings Sheet all land in M17 PR2
- Tests: `packages/contracts/test/identity.test.ts` — presence of every field,
  the null-vs-absent distinction, the empty-patch refusal, and that a
  lowercase code is rejected rather than upcased (which fails loudly if
  someone later adds the transform this package does not have)
- Breaking? **no** — purely additive; nothing imports it yet

## 2026-08-30 — `SavedDay` gains `cities`, `visibility` and `adds` (M11b PR1)

- Added: `cities: z.array(z.string().min(1))`, `visibility: SavedDayVisibility`
  and `adds: z.number().int().nonnegative()` on `SavedDay`
  (`packages/contracts/src/saved.ts`), plus a new
  `SavedDayVisibility = z.enum(["private", "public"])` with the type inferred.
  All three are REQUIRED — a saved day always has all three, and `[]` / `0` are
  the "nothing yet" values rather than an absent field a reader has to interpret
- Why `cities` is stored and not derived per query: `saved_days.stops` is jsonb
  precisely because a saved day is a value that is never queried into
  (ADR-029), and M11b link 5's Discover matches a day on **any** city it
  contains, on every keystroke. Deriving it per read would query into the value
  the ADR says is not queried into, so it is a SNAPSHOT taken at save time, on
  exactly the terms `sourceTripName` already is (ADR-028)
- **One derivation, shared.** `packages/domain/src/trip/cities.ts` already held
  `citiesOfDay(detail, dayIndex)` with the decisions made and tested — time
  order not stored order, `location.city` only with no name/area fallback,
  duplicates collapsed to the first occurrence, `[]` when nothing is located.
  Its core is now `citiesOfStops(stops)`, and `citiesOfDay` folds it. A second
  rule over `SavedStop[]` is what would let a public profile's cities disagree
  with Discover's, which is one of M11b's own exit-gate boxes; the agreement is
  asserted directly in `packages/domain/test/cities.test.ts`
- `visibility` is an enum rather than an `isPublic` boolean: M12 quarantines
  moderation, and a day withdrawn by a moderator is neither the author's
  `private` nor `public`, so a third member is already foreseeable — adding one
  is a contract change with an exhaustiveness typecheck behind it, where
  widening a boolean is a column rewrite. It also matches how this repo already
  spells a small closed state set (`trip_invites.status`, `TripStatus`).
  ADR-029's "anyone with the link" reversal is explicitly NOT a member here —
  that returns as a bearer token on its own table (ADR-027's shape)
- `adds` is denormalised from a new `saved_day_adds` ledger keyed on
  (saved day, trip). The ledger is not a contract type: nothing about it
  crosses the UI/server boundary in this milestone, so it lives only in
  `apps/web/src/server/db/schema.ts`. The rule it exists for, verbatim from the
  design: *an add only counts once per trip, and only after the trip has dates;
  copying your own day into your own trip does not count.* Its composite
  primary key makes the first clause true by construction — proved against the
  database, not the type, in `apps/web/src/server/savedDayAdds.int.test.ts`
- Consumers updated, all in this change: `apps/web/src/server/savedDays.ts`
  produces all three (`citiesOfStops` at save time,
  `SavedDayVisibility.enum.private`, `adds: 0`) and `toDto` returns them;
  `apps/web/src/server/db/schema.ts` gains the columns and the ledger table;
  `apps/web/src/components/trip/SavedDaysDialog.test.tsx`'s typed `SavedDay`
  literal gains the three fields. `packages/fixtures` gains the demo library
  (`JAPAN_SAVED_DAYS`, five days across two owners) so the new fields are
  exercised by the fixture, per the Definition of Done
- Contract tests: `packages/contracts/test/saved.test.ts` — round-trip, the
  absent-field cases for all three, a blank city, non-string cities, a
  visibility outside the enum and a casing variant of one, and a fractional and
  a negative `adds`
- Breaking? **Yes, for producers.** Anything constructing a `SavedDay` must now
  supply all three. Migration `apps/web/drizzle/0012_nervous_tomas.sql` adds
  `cities text[] NOT NULL DEFAULT '{}'`, `visibility text NOT NULL DEFAULT
  'private'`, `adds integer NOT NULL DEFAULT 0`, a GIN index on `cities`, and
  the `saved_day_adds` table — every column defaulted, so it applies to
  existing rows without a rewrite. Rows saved before it carry `cities = '{}'`
  until `pnpm --filter web db:backfill-cities` derives them from the stored
  `stops`; the backfill is a script rather than SQL in the migration so it runs
  the one `citiesOfStops` rather than a second copy of the rule in SQL

## 2026-08-30 — `AdmissionRefusal`: the invite gate's refusal codes become a closed set

- Added: `AdmissionRefusal` in a new `packages/contracts/src/admission.ts`,
  re-exported from `src/index.ts` — `z.enum(["MISSING_INVITE_CODE",
  "INVALID_INVITE_CODE", "SPENT_INVITE_CODE"])` plus the inferred type
- Why: M11a's gate decides the refusal in `server/admission.ts`, `recordSignIn`
  returns it as `/signin?error=<code>`, and the sign-in screen reads it back off
  the query param — so the value makes a round trip through a URL the browser
  controls and is untrusted by the time anything renders from it. It has to
  travel that way at all because Auth.js collapses every falsy `signIn` return
  into a single `AccessDenied` (`@auth/core@0.41.3`
  `lib/actions/callback/index.js:393-409`), and a returned **string** is the
  only channel that can carry three distinct reasons. Mitchell's call,
  2026-08-30: *"make sure every error type is a hard coded case static string
  that is typed ... so any random string cant pass"*
- The enum buys two things a bare string could not. `errorMessage()` in
  `apps/web/src/components/front/authCopy.ts` `safeParse`s the param instead of
  indexing a map, so an arbitrary `?error=` value cannot reach the copy at all;
  and the copy map is declared `Record<AdmissionRefusal, string>`, so adding a
  fourth refusal without writing copy for it is a typecheck failure rather than
  a production screen silently showing the generic fallback. Invariant 5 puts a
  cross-boundary type here, inferred once, never hand-written on both sides
- Supersedes the prose spelling in `docs/plans/2026-08-30-M11a-M11b.md`, which
  named these `InviteRequired` / `InviteInvalid` / `InviteSpent`. Mapping, in
  that order: `MISSING_INVITE_CODE`, `INVALID_INVITE_CODE`,
  `SPENT_INVITE_CODE`. No PascalCase spelling was ever released — the plan is
  write-once scaffolding and both sides were built against the new names
- Auth.js's own error codes (`AccessDenied`, `Configuration`, `Verification`,
  `OAuthAccountNotLinked`) travel on the same `?error=` param and are
  deliberately NOT in this enum: they are Auth.js's set, not ours to enumerate,
  and they keep their PascalCase spelling in `ERROR_MESSAGES` and their
  existing `Object.hasOwn` guard. The two sets stay distinguishable at a glance
- Consumers updated, both in the same milestone: `apps/web/src/server/admission.ts`
  produces it (`refusalRedirect`) and `recordSignIn` returns the path;
  `components/front/authCopy.ts` consumes it (`ADMISSION_MESSAGES` plus the
  parse in `errorMessage`). Neither side spells a member as a string literal —
  both go through `AdmissionRefusal.enum`
- Contract test: `packages/contracts/test/admission.test.ts` — the member list
  and order, the three valid codes, and a refusal set covering casing variants,
  a trailing space, regex bait, the prototype-pollution keys, an Auth.js code,
  and non-strings
- Breaking? no. Nothing existed to break: a new type with no prior wire format,
  no schema edited, no event, command or DTO changed shape. No migration

## 2026-08-28 — compose the duplicated `ActivityAdded`/`ActivityUpdated` payload block

- Changed (source only): the eight-field block
  (`title, timeWindow, location, notes, anchors, kind, tags, cost`) that
  `ActivityAddedV1.payload` and `ActivityUpdatedV1.payload` each spelled out
  verbatim now lives once as `ActivityPayloadFields` in
  `packages/contracts/src/activity.ts`; both payloads `.extend()` it after
  their own id fields
- Why: the project review's §6.2. Two verbatim copies meant a `.default()`
  could land on one payload and be missed on the other — which corrupts replay
  for *updated* activities only, and would stay invisible until someone
  replayed an old event log. That failure mode is now unrepresentable, and
  `packages/contracts/test/activity-payload-parity.test.ts` enforces the field
  sets and the materialised defaults still agree
- **Wire shape unchanged — byte-identical, not merely compatible.** `.extend()`
  is applied *after* the id fields, so the object's key order (and therefore
  the serialised payload) is exactly what it was; the `.default()`s, the
  nullability, every `min`/`max` and the strip behaviour are the same schema
  objects, moved. Demonstrated rather than asserted: a throwaway probe parsed
  both payloads' full case matrix — every `.default()` exercised, explicit
  nulls, extra-key strip, and each invalid-input class — through the old
  verbatim schemas and the composed ones and compared `JSON.stringify` of the
  result (pinning key order, not just values) plus exact `z.input`/`z.output`
  type identity. All matched; deleting one `.default()` from the old copy made
  both the runtime and the type check fail, so the probe was not vacuous
- Consumers updated: none needed, and that is the point — no consumer can
  observe this. `@tc/domain` and `apps/web` are unchanged; their suites were
  run as the check
- Not the §6.1 descriptor refactor. That one changes the domain and ten call
  sites and is its own reviewed PR (AGENTS.md: a contract change is its own
  step); this is the piece the review marks safe without it
- Breaking? no — no schema semantics changed. No migration, no event rewrite

## 2026-08-28 — KI-35: `Location.area`
- Added: `area: z.string().min(1).max(200).optional()` on `Location`
  (`packages/contracts/src/activity.ts`) — the sub-settlement locality
  (neighbourhood/suburb/quarter/city district), one level finer than `city`
  and read from the same structured geocoder address breakdown
- Why: KI-35 — nothing carried an area, so `shortPlace()` and `cityFor()` fell
  back to the first comma-delimited segment of `name` when there was no city,
  and that segment is the *venue*: a coffee shop rendered where a neighbourhood
  should be, and a day inside one city rendered "Tokyo → Tokyo → Tokyo"
- Display-only. Nothing groups, colours or buckets by it —
  `calendarCityCards.ts` still groups strictly on `location.city`
- Consumers updated (same change): `@tc/domain` `equality.ts` (it is the ONE
  module that compares `Location` field by field; without it `diffTripStates`
  treats an area-only edit as a no-op and revert/undo silently keeps the old
  value), the shared property generator
  (`packages/domain/test/support/tripGenerator.ts`) so the field is actually
  in the generated input space, and in `apps/web`: `geocoding/geocoder.ts` +
  `geocoding/locationiq.ts` (`suburb ?? neighbourhood ?? quarter ??
  city_district`, the `city` read untouched), `ai/geocodeEnrichment.ts`,
  `LocationInput.tsx`, the MSW handlers, `lib/place.ts`, `DayChips.tsx`,
  `japanTripImporter.ts` and `scripts/db-seed.ts`.
  `diff.ts`/`hydrate.ts`/`detail.ts` pass `location` through whole and needed
  no change
- Breaking? no — `.optional()`, exactly like `city`. A `trip_details.doc` or a
  stored event written before this change parses unchanged; there is no
  migration and no event rewrite. Asserted directly, not just claimed:
  `packages/contracts/test/ki35-location-area.test.ts` parses a complete
  pre-`area` projection document. M18 added *required* fields to this same
  raw-jsonb-then-parse shape and 500'd every untouched board (fix `8abbaa3`) —
  that test is the tripwire
- **Amended when this landed on the M11 branch (`#71`):** `cityFor()`
  (`DayChips.tsx`) does NOT fall back to `name`. This entry was written off a
  `main` that predated Mitchell's instruction on the #71 preview — "Never fall
  back to name, if you have absolutely no city, then make a new bucket with no
  city in title" — and shipped `city ?? area ?? name`. The merge resolved it to
  `city ?? area`, null otherwise. `area` does not violate that rule (a locality
  is a place); a venue name does, and was how a restaurant came to label a day

## 2026-08-27 — `ActivityView.kind` and `.tags` read a pre-M18 document

- Changed: `ActivityView.kind` is now `ActivityKind.default("planned")` and
  `ActivityView.tags` is `z.array(ActivityTag).default([])`, where M18 (#63)
  made both required. `hydrate()` gained the matching `?? "planned"` / `?? []`
- Why: this was a live 500, found by Mitchell walking the #71 preview.
  `getTripDetail` returns `trip_details.doc` as RAW jsonb — no parse — and the
  read route then runs `TripDetail.parse` on it. A document written before M18
  carries neither key, and a projection row is only rewritten when its trip
  next changes, so `GET /api/trips/:id` threw `ZodError: kind Required` for
  every trip nobody had touched since M18. `main` has this too; it is not
  specific to M11 and it is not a missing migration
- Not a widening of the contract: `AddActivity.kind` is already optional and
  documented "omitted = planned", `ActivityAddedV1` and `ActivityUpdatedV1`
  already carry `.default("planned")` / `.default([])`, and `state.ts` calls
  "planned" the zero value that is never null. The read model was the only
  place that did not apply the zero values the rest of the stack agrees on
- Chosen over rebuilding the projections: a rebuild is an ops step that fixes
  today's rows and nothing about the next stale one, and it would have to be
  run against every environment. A default is additive and needs no migration
- Consumers updated: `packages/contracts`, `packages/domain` (`hydrate.ts`)
- Breaking? no — additive. An activity that DOES store a kind or tags keeps
  them, pinned by a test

## 2026-08-27 — M11 link 6: saved days

- Added: `packages/contracts/src/saved.ts`, exported from the package index —
  `SavedStop`, `SavedDay`, `CreateSavedDayInput`
- Why: M11's fourth user story, "select parts of my trip and save them for
  reuse". A saved day is a personal, reusable fragment — it belongs to a
  person, not to a trip — so it is CRUD in its own module, not planning state
  (ADR-029)
- `SavedStop` is `ActivityView` minus `activityId`, and a contract test pins
  exactly that against `ActivityView.shape` so the two cannot drift. The id is
  dropped on purpose: it would tie the fragment to the activity it came from,
  and inserting one saved day into two trips would put one id in two streams —
  the KI-1 hazard, and the same reason `cloneTrip` remaps ids
- `CreateSavedDayInput` is `{ name, tripId, dayId }` and deliberately NOT
  `{ name, stops }`: letting a client post plan content would make this an
  unvalidated write path into a person's library, and the server has to read
  the trip to authorize the save anyway
- **`TripDetail`, `TripSummary`, `TripMember`, `TripRole` and every planning
  command are unchanged.** Like links 3 and 4 this adds a module rather than
  touching the planning contracts, so the hand-enumeration trap
  (`equality.ts`, `diff.ts`, `hydrate.ts`, `detail.ts`, `tripGenerator.ts`)
  had nothing to catch
- Consumers updated: `apps/web` only — `server/savedDays.ts` (new),
  `lib/savedStops.ts` (new, shared with the UI because the lint wall forbids
  UI importing `@/server/*` and two copies of "what is included" would be two
  chances to disagree), the `saved-days` routes, `lib/apiClient.ts`,
  `KeepDayFlag`, `KeepDayDialog`, `SavedDaysDialog` (new),
  `AddSavedDayButton`, `EndOfTrip`, `TimelineLens`, `TripProvider`
  (exposes `tripId`), `preview-registry.ts`.
  `@tc/domain`, `@tc/factories`, `@tc/pages` and `@tc/predict` needed no change
- Migration: `apps/web/drizzle/0009_numerous_red_skull.sql` — creates
  `saved_days`. Additive; nothing existing is altered
- Breaking? no — every schema here is new, and no existing schema changed

## 2026-08-27 — M11 link 5: the trip lineage pointer

- Added: `TripLineage` (`{ tripId, atSeq, name }`) in
  `packages/contracts/src/trip.ts`
- Changed: `CreateTrip.forkedFrom`, `TripCreatedV1.payload.forkedFrom` and
  `TripDetail.forkedFrom`, all `TripLineage.nullable().default(null)`
- Why: M11's third user story is cloning a trip someone shared with you, and
  "with lineage" is the milestone's headline. M8 shipped Duplicate deliberately
  lineage-free (its decision 4) and this is where that comes due (ADR-028)
- **This one is a real planning-contract change**, unlike links 3 and 4 — so
  the hand-enumeration trap was live, and every site was walked:
  `state.ts` (the field), `evolve.ts` (carried from the genesis event),
  `detail.ts` and `hydrate.ts` (both directions of the state↔document
  round trip), `equality.ts` (a new `lineageEqual`), and
  `test/support/tripGenerator.ts`. `diff.ts` needed no change and has none —
  lineage is genesis-only, no command changes it, and there is nothing to
  diff; that is stated in `decide.ts`'s comment rather than left implied
- **The generator half of the trap, specifically:** `historyFrom` now takes
  `forkedFrom` as a parameter instead of hardcoding null. No raw op can
  produce lineage, so a generator that always passed null would let every
  property built on it pass while never once seeing a forked trip.
  `diff.property.test.ts`'s round-trip property generates one and asserts
  replay carries it through; `hydrate.property.test.ts`'s arbitrary generates
  one directly, for the same reason it generates non-owner members
- `.default(null)`, NOT `.optional()`: every `TripCreated` row already in
  `events` and every `trip_details.doc` already in Postgres omits the key, and
  a default makes them all parse to one shape — explicit null — rather than
  two. `hydrate()` additionally coalesces `?? null`, because it is called on a
  raw `trip_details.doc` that never goes through `TripDetail.parse`.
  `packages/contracts/test/trip.test.ts` asserts all three defaults against
  payloads written the old way
- Deliberately NOT on `TripSummary`: the home grid's card says nothing about
  provenance, and adding it there would mean a `trip_summaries` column and a
  migration for a line of text the trip's own settings sheet already carries
- Consumers updated: `@tc/domain` (the six sites above), `@tc/factories`
  (`trip.ts`, `legacy.ts`, `conflicts.test.ts`), `@tc/pages` (three fixtures),
  `apps/web` (`server/cloneTrip.ts` — renamed from `duplicateTrip.ts` —
  `server/history.ts`'s `getTripHead`, `server/access/shares.ts`'s
  `readShareForClone`, the new `api/shares/[token]/clone` route,
  `lib/apiClient.ts`, `SharedTripScreen`, `SettingsSheet`, `TripHeader`)
- Migration: **none.** The field rides in an existing jsonb payload and an
  existing jsonb projection document
- Breaking? no — every change is a nullable field with a default

## 2026-08-27 — M11 link 4: pinned share links

- Added: `packages/contracts/src/share.ts`, exported from the package index —
  `TripShare` (the sharer's view, including the token to re-copy) and
  `SharedTripView` (what a stranger holding the link is served)
- Why: M11's second user story is a link pinned to the history point it was
  created at, so the share has to carry a `seq` and the read has to replay to
  it. `trip_details` is the trip as it is NOW, so serving that projection
  would make every link track the live trip (ADR-027)
- **`SharedTripView` is an explicit field list, not a `TripDetail` derivative.**
  A public read is the one place a field leaks to people the trip's owner never
  chose, so a new `TripDetail` field must be opted IN rather than arriving by
  spread. It drops `members` (actor ids are real people — `travellerCount`
  replaces them), `conflicts`/`dismissedConflictIds` (planning advice for
  whoever is editing) and `status` (a deleted trip's link is refused outright).
  `packages/contracts/test/share.test.ts` asserts all four absences, asserts
  that supplying them strips them, and pins every remaining field name against
  `TripDetail.shape` so the two cannot drift into meaning different things
- **`TripDetail`, `TripSummary`, `TripMember` and `TripRole` are again
  unchanged**, so the hand-enumeration trap (`equality.ts`, `diff.ts`,
  `hydrate.ts`, `detail.ts`, `tripGenerator.ts`) had nothing to catch here
  either
- Consumers updated: `apps/web` only — `server/access/shares.ts` (new),
  `server/history.ts` (`getTripDetailAtWithHead`, so the pinned read answers
  "what did it look like" and "has it moved on" from one stream read),
  the `shares` routes, the public `api/shares/[token]` and
  `api/shares/featured` routes, `lib/apiClient.ts`,
  `components/trip/ShareButton.tsx` (was an inert Preview shell),
  `components/access/SharedTripScreen.tsx` (new),
  `app/(front)/s/[token]/page.tsx` (new), `LandingScreen`, `TripHeader`,
  `app/(app)/page.tsx`, `preview-registry.ts`.
  `@tc/domain`, `@tc/factories`, `@tc/pages` and `@tc/predict` needed no change
- Migration: `apps/web/drizzle/0008_glamorous_giant_girl.sql` — creates
  `trip_shares`. Additive; nothing existing is altered
- Breaking? no — every schema here is new, and no existing schema changed

## 2026-08-27 — M11 link 3: the Access & Membership contract

- Added: `packages/contracts/src/access.ts`, exported from the package index —
  `InviteRole` (`viewer|editor`), `InviteStatus` (`pending|accepted|revoked`),
  `TripInvite`, `CreateInviteInput`, `TripMemberProfile`, `TripAccess`,
  `InvitePreview`
- Why: link 3 creates non-owner members, and none of what that needs — an
  invite, its status, who accepted it, a member's display name — belongs on
  `TripDetail`. The Access & Membership module owns invites/roles/revocation
  (AGENTS.md module map) and Identity owns names; putting either on a planning
  read model would be the ADR-003 boundary smell in the other direction
- `InviteRole` is deliberately NOT `TripRole`: an invite hands out
  participation, never ownership. Transferring a trip is a different operation
  (the owner is the only role that can delete one) and no milestone has asked
  for it
- **`TripDetail`, `TripSummary`, `TripMember` and `TripRole` are unchanged.**
  That is the point of the split: the planning contracts did not move, so the
  hand-enumeration trap (`equality.ts`, `diff.ts`, `hydrate.ts`, `detail.ts`
  and `tripGenerator.ts` each enumerating fields by hand) had nothing to catch
  this time. `members` is passed through whole on every one of those paths and
  no new field was added to it
- Consumers updated: `apps/web` only — `server/access/*` (new module),
  `server/accessPolicy.ts` (`memberRole`/`hasAtLeast` added; `canExecute` now
  delegates to `hasAtLeast` so one ranking serves both), `server/commands.ts`
  (authorizes against the effective member list), `server/pages-guard.ts`
  (required minimum-role parameter), `server/ai/handleAiRequest.ts` (`editor`),
  the trip read/list/history routes, `lib/apiClient.ts`, `mocks/handlers.ts`,
  `components/trip/TravelersPanel.tsx` (new), `components/access/
  InviteAcceptScreen.tsx` (new), `SettingsSheet`, `TripHeader`, `TripProvider`,
  `NewTripWizard`, `middleware.ts`, `preview-registry.ts`.
  `@tc/domain`, `@tc/factories`, `@tc/pages` and `@tc/predict` needed no change
- Migration: `apps/web/drizzle/0007_silly_quasimodo.sql` — creates
  `trip_invites` and `trip_memberships`. Additive; nothing existing is altered
- Breaking? no — every schema here is new, and no existing schema changed

## 2026-08-27 — M11: TripMember roles
- Added: `TripRole` (`viewer|editor|owner`, ordered least- to most-privileged)
- Changed: `TripMember.role` from `z.literal("owner")` to `TripRole`
- Why: M11 link 2 — `AccessPolicy` could only ask "is this actor a member?",
  so an invited person (link 3) would land with the owner's powers, including
  `DeleteTrip`. Roles have to exist and be enforced *before* anything creates a
  non-owner member, not alongside it
- Values: three, matching the milestone table. `viewer` and `editor` are the
  two distinctions the five M11 user stories actually need — "invite someone
  and have them modify it" and "share a read-only version". A fourth
  (`commenter`) was considered and dropped: nothing in the planning domain
  models a comment, so it would be a role with no command to distinguish it
- Where the role is interpreted: `apps/web/src/server/accessPolicy.ts` only.
  The planning domain still never reads a role (AGENTS.md invariant 6c) — the
  domain carries `members` and the server decides. The policy is a `Record<
  Exclude<TripCommand["type"], "CreateTrip">, TripRole>`, so a new command
  cannot compile until someone decides who may run it; `DeleteTrip`/
  `RestoreTrip` are owner-only, every other command is editor-or-above, and no
  command is viewer-reachable
- Consumers updated: `apps/web` (`accessPolicy.ts` — `soleMemberPolicy` renamed
  `memberRolePolicy` because it no longer describes what it does; `commands.ts`,
  where the batch path now authorizes EVERY sub-command rather than just the
  first, since minimums are per-command; `api/dev/reset-demo-data`, now scoped
  to trips you *own*; `preview-registry`, `SettingsSheet`, `NewTripWizard`,
  whose comments each asserted the literal). `@tc/domain` needed no production
  change — `equality.ts` already compared `role`, and `detail.ts`/`hydrate.ts`
  pass `members` through whole rather than field-by-field, so the M18 PR 1
  hand-enumeration trap did NOT recur here. It is now tested rather than
  assumed: `equality.test.ts` asserts two states differing only by role are
  unequal, and `hydrate.property.test.ts` generates mixed-role member lists
  with a measured witness floor
- Not generated by `packages/domain/test/support/tripGenerator.ts`: that
  generator builds states by replaying commands, and no command adds a member
  or changes a role, so a non-owner member is unreachable there by
  construction. Non-owner roles are therefore asserted directly instead
- Breaking? no — `z.enum` widening accepts every `role: "owner"` already
  persisted in the `trip_summaries` / `trip_details` `members` jsonb. No
  migration, no event payload carries a role, and the projection rebuild is
  unaffected

## 2026-08-27 — M18: activity kind & tags
- Added: `ActivityKind` (`booked|hold|idea|transit|planned`) and `ActivityTag`
  (`meal|lodging|ticketed|outdoors`) enums
- Added: `kind`/`tags` on `AddActivity` and `UpdateActivity` (both `.optional()`,
  neither nullable — a kind is cleared by setting `planned`, tags by `[]`;
  `tags` replaces the whole array, matching `anchors`)
- Added: `kind: ActivityKind.default("planned")` and
  `tags: z.array(ActivityTag).default([])` on the `ActivityAddedV1` and
  `ActivityUpdatedV1` payloads — still **version 1**, no V2 event
- Added: `ActivityView.kind`, `.tags` (both required — the projection always
  produces them, so no consumer has to ask what absence means)
- Why: M18 — a stop had no kind, so the Calendar's travel-day split, `N to book`,
  the home hero's "not booked" tile and `act.badge` were all blocked, and the
  seed encoded the kind as `(transit)` prose inside a note a user can edit (KI-47)
- Note: the design handoff lists SIX tags; `considering` and `travel` are
  deliberately omitted because `ActivityKind` already carries `idea` and
  `transit`. Two fields that can disagree about one fact is a bug generator — a
  stop tagged `considering` while its kind says `booked` would render dashed
  under a "Booked" badge with its cost outside the committed total, and no
  surface would own the contradiction. Mitchell's call, 2026-08-27
- Consumers updated: `@tc/domain` (state/evolve/decide/equality/diff/hydrate/
  detail), `@tc/pages`, `@tc/factories`, `apps/web` (MSW handlers,
  duplicateTrip, japanTripImporter, db-seed, test fixtures) — same PR.
  `equality.ts` mattered most: without it `okUnlessNoOp` rejects a kind-only
  `UpdateActivity` as a no-op. The shared property generator
  (`packages/domain/test/support/tripGenerator.ts`) gained both fields too, or
  `diff.property.test.ts` would keep passing while never generating either
- Breaking? no — event payload additions default (`kind` → `"planned"`,
  `tags` → `[]`), so `TripEvent.parse` accepts all previously stored events
  unchanged. **There is no migration and no event rewrite.** DTO additions are
  new required fields produced only by the updated projection

## 2026-07-28 — M8: trip lifecycle
- Added commands: `SetTripName`, `SetTripDates`, `DeleteTrip`, `RestoreTrip`
- Added events: `TripNameSetV1`, `TripDeletedV1`, `TripRestoredV1`
- Added: `TripStatus` enum; `status` on `TripSummary` and `TripDetail`
- `SetTripName`/`SetTripDates` joined `BatchableCommand` (AI-reachable);
  `DeleteTrip`/`RestoreTrip` deliberately did NOT — destructive and
  stream-level operations stay out of the derived tool surface
- `SetTripDates` carries `newDayIds` because the domain may not mint UUIDs
  (Invariant 4); it supersedes `SetTripStartDate`, which is left in place —
  deprecation plan deferred (see known-issues KI-15)
- Why: M8 — a trip could not be renamed or deleted by anyone
- Consumers updated: `packages/domain`, `apps/web` (routes, projections, AI
  tools, UI)
- Breaking? no — additive

## 2026-07-20 — M7: add page & macro contracts
- Added: `Page`, `PageContext`, `DayRef`, `MacroNode`, `PageContent`, `MacroKind`,
  `PageSummary`, `CreatePageInput`, `UpdatePageInput`
- Why: M7 Solo delight — dynamic macro pages, CRUD operations, Yjs collaboration support
- Consumers updated: `@tc/pages`, `apps/web` pages routes + UI
- Breaking? no — additive

## 2026-07-19 — M6 command endpoints return authoritative state
- Changed: `POST /api/trips/:id/commands` success response now includes
  `{ detail: TripDetail, history: TripHistory }` (was `{ ok, tripId }`)
- Added: `POST /api/trips/:id/commands/batch` with body `{ commands: BatchableCommand[] }`,
  same response shape
- Why: M6 optimistic updates reconcile from the response instead of refetching
- Consumers updated: apps/web apiClient + TripProvider
- Breaking? no — response fields added; new endpoint is additive

## 2026-07-19 — M6 atomic changes + optimistic updates
- Added: `BatchableCommand` (discriminated union — TripCommand minus CreateTrip
  and the history commands) for the batch endpoint
- Why: M6 — submit a series of commands as one atomic batch (one history entry)
- Consumers updated: packages/domain (predict), apps/web (batch route, apiClient)
- Breaking? no — additive

## 2026-07-10 — M4 money & lenses schemas
- Added: `Money` (integer minor units + ISO-4217 currency)
- Added: `cost` on `AddActivity` (optional) / `UpdateActivity` (nullable, optional)
  and on `ActivityAddedV1`/`ActivityUpdatedV1` payloads (`Money.nullable().default(null)`)
- Added: commands `SetTripCurrency`, `SetTripBudget`; events `TripCurrencySetV1`,
  `TripBudgetSetV1` (joined `TripCommand`/`TripEvent`)
- Added: `ActivityView.cost`; `TripDetail.currency`, `.budget`, `.tripCostTotal`,
  `.unscheduledCostSubtotal`, `.budgetRemaining`, `days[].costSubtotal`
- Why: M4 — costs on activities, derived cost rollups, trip currency & budget,
  over-budget conflict (ADR-008, ADR-009)
- Consumers updated: `@tc/domain` (state/evolve/equality/diff/decide/costs/
  conflicts/detail), `apps/web` (projection wiring, mocks, money editors, lenses)
  — same PR
- Breaking? no — event payload additions default (`cost` → null), so
  `TripEvent.parse` accepts all previously stored events unchanged; DTO additions
  are new required fields produced only by the updated projection

## 2026-07-09 — M3 place & time schemas
- Added: `Weekday`, `Anchor` (union: dayOfWeek | dateRange | timeOfDay | publicHoliday)
- Added: `anchors` on `AddActivity`/`UpdateActivity` (optional) and on
  `ActivityAddedV1`/`ActivityUpdatedV1` payloads (`z.array(Anchor).default([])`)
- Added: `Location.countryCode` (optional, ISO-3166 alpha-2)
- Added: `ActivityView.anchors`; `TripDetail.days[].date` (nullable derived date)
- Why: M3 — date-anchored activities, derived day dates, geocoded locations
- Consumers updated: `@tc/domain` (state/evolve/decide/diff/equality/conflicts/
  detail), `apps/web` (projection wiring, mocks, lens UI) — same PR
- Breaking? no — event payload additions default, so `TripEvent.parse` accepts
  all previously stored events unchanged; DTO additions are new required fields
  produced only by the updated projection

## 2026-07-08 — M2 history & time travel schemas
- Added: `Origin`; `EventEnvelope` gains required `batchId` + `origin`
- Added: commands `UndoLastChange`, `RedoChange`, `RevertToState`,
  `DismissConflict` (joined `TripCommand`)
- Added: events `ConflictDismissedV1`, `ConflictUndismissedV1` (joined `TripEvent`)
- Added: DTOs `HistoryEntry`, `TripHistory`; `TripDetail` gains `dismissedConflictIds`
- Why: M2 — undo/redo/revert via compensating events (ADR-005), history UI,
  persistent conflict dismissal
- Consumers updated: `@tc/domain`, `apps/web` (pipeline, event store + column
  migration with backfill, routes, UI) — in this same PR
- Breaking? yes, envelope only — stored events need the Task 5 backfill
  migration (batch_id = own uuid, origin = user); event payloads unchanged,
  `TripEvent.parse` accepts all previously stored events

## 2026-07-08 — M1 planning-core schemas
- Added: commands `AddDay`, `RemoveDay`, `SetTripStartDate`, `AddActivity`,
  `UpdateActivity`, `MoveActivity`, `RemoveActivity`; command union `TripCommand`
- Added: events `DayAddedV1`, `DayRemovedV1`, `TripStartDateSetV1`,
  `ActivityAddedV1`, `ActivityUpdatedV1`, `ActivityMovedV1`, `ActivityRemovedV1`;
  `TripEvent` grew from a single schema into a discriminated union
- Added: value objects `TimeWindow`, `Location`; DTOs `ActivityView`, `TripDetail`
- Why: M1 planning core — days, backlog, activities, board moves, conflicts read model
- Consumers updated: `@tc/domain` (decide/evolve/projections), `apps/web` (pipeline, routes, UI) — in this same PR
- Breaking? no — `TripEvent.parse` accepts all previously stored events unchanged

## 2026-07-08 — backfill: M0 initial schemas (created 2026-07-07)
- Added (in M0): `CreateTrip`, `TripCreatedV1`, `TripEvent`, `TripMember`,
  `TripSummary`, `EventEnvelope`, `Conflict`
- Why: recorded retroactively — M0 created the package without a changelog entry
- Consumers: `@tc/domain`, `apps/web`
- Breaking? no

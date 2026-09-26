# ADR-052: External data enters a widget as a server-fetched input, never as a fetch

**Status:** **Accepted — 2026-09-24, on Mitchell's delegation** (*"go with your own best
judgement … I'll review in the morning"*); **pending his review.** Every choice below is
made rather than left open, each with its reason and the alternative it beat. The ones
most worth a second look are listed at the end under *Review points for Mitchell*. M14's
gate box *"the external-data ADR is accepted before any external-data code lands"* stays
unticked until that review.
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-007** (the `Geocoder` seam this copies), **ADR-037** (a widget is a module;
decision 5 fixed previews, decision 6 every state renders), **ADR-044** (a widget edits
without reflowing), **ADR-046** (the client read cache), Invariant 1 (the log is for
planning), Invariant 4 (time is passed in)
Spec: `docs/specs/2026-09-24-widget-brainstorm.md` §4 (weather's four modes) and §5 (the
seven points this answers). Milestone: `docs/milestones/M14-rich-layer.md` link 11.

## Context

Weather is the first widget whose data the trip does not hold. Four facts about the tree
decide most of the answer:

- **Resolvers are pure and synchronous.** `resolve(ctx: WidgetContext, params, item?)`
  (`packages/pages/src/registry-types.ts`) reads what it is handed. `registry.property.test.ts`
  holds every registered widget to *"never throws, always ok|empty|unbound"*, and ADR-037
  decision 5 holds insert-sheet previews to fixed strings.
- **Only `apps/web/src/server` does network I/O.** ADR-007 put the geocoder behind a
  server-internal port (`server/geocoding/geocoder.ts`, one wiring line in `index.ts`), and
  the browser CSP is `connect-src 'self' https://tiles.openfreemap.org`
  (`apps/web/next.config.ts`).
- **The context is built in one place.** `MacroView` assembles `{ trip, page, user, globals,
  today }` from props that `PageScreen` supplies through `MacroEditorContext`. `globals` is
  already the pattern for "a second request the notebook needs": its own route
  (`/api/trips/[tripId]/globals`), fetched by `PageScreen`, `null` until it lands, and a
  widget that says so rather than a page that will not open.
- **Serverless has no shared memory.** Vercel runs many short-lived instances. The two
  things this app already keeps across requests outside the log are Postgres tables:
  `rate_limit_counters` (`server/quota.ts`) and `api_idempotency_keys` (ADR-051). There is no
  Redis, no KV and no use of Next's data cache (`unstable_cache` / `"use cache"`) anywhere in
  `apps/web`.

Mitchell's calls on 2026-09-24: weather from **MET Norway**, not Open-Meteo; sending a
stop's **rounded** location to an outside service is **accepted**; the four date-driven
modes stay, with **after the trip shown as "typical", labelled**; Reading keeps today's
quiet placeholder and ghosts are Editing-only (M14, *Decided 2026-09-24* item 2).

### The sources, and what is verified

| Source | Used for | Terms | State |
|---|---|---|---|
| MET Norway Locationforecast 2.0, `GET https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=…&lon=…` (`compact` until the implementation notes below) | forecast, on the day | Free incl. commercial, NLOD 2.0 / CC BY 4.0, credit *"The Norwegian Meteorological Institute"*; an identifying `User-Agent` with contact; honour `Expires` / `Last-Modified` (conditional `If-Modified-Since`); at most 4 decimals; contact them before 20 req/s | **verified** 2026-09-24 ([licence](https://api.met.no/doc/License), [terms](https://api.met.no/doc/TermsOfService)) |
| NASA POWER Climatology API, `GET https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR&community=AG&latitude=…&longitude=…&format=JSON` | typical, after the trip | Keyless. NASA open data: use for any purpose, commercial included. NASA **requests** the acknowledgement *"data obtained from the NASA Langley Research Center POWER Project…"* and asks to be told of uses (larc-power-project@mail.nasa.gov). The API throttles "repetitive and rapid requests" with no published number | **partly verified**: the acknowledgement wording and the parameter names are confirmed by web search (the POWER docs pages and the `nasapower` R client). The open-data licence comes from secondary sources. **To verify, by reading the POWER docs directly:** the exact endpoint path, the averaging period (believed 2001–2020 for meteorology, 1984-onward for solar), and whether a rate figure is published. This container cannot reach `power.larc.nasa.gov` |

**If NASA POWER fails verification** (commercial terms, or the endpoint does not give
monthly normals for a point), the fallback is **Open-Meteo's paid plan** for "typical" only,
behind the same port, as the brainstorm §4 already allows. Nothing else in this ADR changes.

## Decision

### 1. One server-side port per capability, the ADR-007 shape

`apps/web/src/server/external/weather/` holds two ports and their adapters:

```ts
interface Forecast { forecast(at: RoundedPoint, prior?: CacheValidators): Promise<Fetched<ForecastSeries>>; }
interface Climate  { normals(at: RoundedPoint): Promise<Fetched<MonthlyNormals>>; }
// adapters: met-norway.ts (Forecast), nasa-power.ts (Climate); index.ts picks them, one line each
```

**Two ports, not one `Weather` port**, because the two sources differ in everything that
matters (terms, cache lifetime, credit) and the Open-Meteo fallback above replaces only one
of them. A later capability (`ExchangeRates`, …) is a sibling folder under `server/external/`.
Each adapter owns its vendor's URL, its `User-Agent`, its response mapping and its credit id,
and returns **normalized** data, never a vendor payload (ADR-007's rule, so a vendor swap is
zero migration). `RoundedPoint` is a branded type that only `roundForExport()` (decision 6)
can construct, so an adapter cannot be handed a raw coordinate.

*Rejected: fetching in the browser.* It needs a CSP hole per vendor, it sends the reader's
IP to MET Norway, and **a browser cannot set `User-Agent`**, so MET's first condition is
unmeetable from the client at all.

### 2. The cache is a Postgres table, keyed by source and rounded point

```
external_data_cache
  key            text primary key   -- "met:forecast:59.91,10.75" | "power:normals:59.91,10.75"
  payload        jsonb              -- the normalized value, not the vendor body
  fetched_at     timestamptz        -- when we got it
  expires_at     timestamptz        -- MET: its Expires header; POWER: fetched_at + 30 days
  last_modified  text null          -- MET's Last-Modified, sent back as If-Modified-Since
  source_updated_at timestamptz null -- MET's meta.updated_at: the as-of the reader sees (d7)
```

**Keyed by point, not by point and date.** The brainstorm said "rounded coordinates plus
date"; the sources say otherwise. One MET call returns the whole ~9-day series for a point
and one POWER call returns all twelve months, so a date in the key would multiply calls by
the trip's length for the same bytes. The date is applied when the slot is built (decision
3), not when data is fetched.

Read path: a fresh row (`now < expires_at`) is served without a call. An expired row is
revalidated with `If-Modified-Since`; a `304` moves `expires_at` to the new `Expires` and
keeps the payload. A failed call **serves the expired row** if one exists, with its own
older as-of (decision 7 makes that honest), and only answers `unavailable` when there is no
row at all. Rows are overwritten, never swept: the count is bounded by distinct rounded
points across all trips. Two instances missing the same key at once both fetch; at this
scale that is cheaper than a lease. **Not event-sourced** — Invariant 1 scopes the log to
planning.

*Rejected: Next's data cache.* It cannot send `If-Modified-Since`, it cannot key its lifetime
to a per-response `Expires` in a way a test can see, it has no "serve stale on error" we
control, and it is used nowhere in this app. *Rejected: Vercel KV / Upstash.* A new vendor
and dependency for one table's worth of rows. *Rejected: in-memory.* Per instance, so it
caps nothing on serverless — the argument `rate_limit_counters`' header already makes.

### 3. The data reaches `resolve` as a pre-fetched slot on `WidgetContext`

```ts
type Slot<T> = { state: "pending" } | { state: "failed" } | { state: "ready"; value: T };
interface WidgetContext { /* …existing… */ external: { weather: Slot<TripWeather> } }
```

`TripWeather` is a contract in `@tc/contracts` (Invariant 5: its own changelog entry):

```ts
{ points: Array<{
    date: string;            // the day's yyyy-mm-dd
    city: string | null;     // from citiesOfDay; one point per (day, city)
    forecast: ForecastDay | { unavailable: "source" | "not-in-horizon" };
    typical:  TypicalMonth | { unavailable: "source" };
}> }
```

**How the client obtains it.** `GET /api/trips/[tripId]/weather`, its own route for the same
reason `globals` has one (only the Notebook pays for it), with the **same guard**
(`requireTripAccess(tripId, "viewer", { allowDemo, inviteToken })`): anyone who may read the
trip may read its weather. **The client sends only the trip id.** The server derives the
points from `TripDetail`: for each dated day, for each city of that day, the first stop (in
time order) in that city with coordinates, rounded. A day with no located stop has no point,
and the widget answers `empty("no place on this day")` — that is trip data missing, which
the author can fix, not the source failing. The server fetches a forecast only for points
whose date falls within `[UTC today − 1, UTC today + 11]` (the horizon with a day's slack
either side for time zones) and normals for every point.

**When.** `PageScreen` requests it once the document is loaded **and contains a weather
widget**, and again when one is inserted — never for a notebook without one, so no location
leaves the building for a page that does not show weather. It goes through `cachedRead` with
`DEDUPE.DOCUMENT` (ADR-046) under `tripKeys.weather(id)`. No polling: the as-of time says how
old it is, and reopening refreshes. `OverviewLens` follows the same rule when it mounts a
read-only notebook.

> **Since 2026-09-26 (PR #243) that rule fires by default.** The seeded Overview carries
> `day.weather`, so every Overview view requests it: every new trip's, the Japan demo an
> anonymous visitor lands on, and an invitee's look before accepting. The rule itself is
> unchanged — a notebook without a weather widget still sends nothing — but "only when a page
> shows weather" now describes the default page. Mitchell accepted this on 2026-09-26:
> *"It's ok to send a users data to weather"*. A trip with no located stop still sends no
> point (the route answers zero points with no upstream call).

**Loading.** The slot starts `pending`; the widget answers `unavailable("pending")` (decision
4) and its block reserves its full fixed height, so the answer landing does not reflow the
page (ADR-044). A non-2xx or network error sets `failed`.

**The mode is chosen in the resolver, from `ctx.today`,** not by the server: the reader's date
is only knowable on the client (see `WidgetContext.today`'s own header), and a pure choice is
one a unit test can pin. For each point:

| The day's date vs `today` | Mode, and its words | Data |
|---|---|---|
| after the forecast's last full local day (≈ 9–10 days out) | **typical** — *"typical for November"* | normals |
| inside the horizon | **forecast** | MET |
| equal | **today** — now and the rest of the day | MET |
| before | **typical**, labelled *"typical for November — not what it was"* (Mitchell, 2026-09-24) | normals |
| `today` is `null` | `unavailable("pending")` — the mode cannot be chosen yet | — |

The horizon is **read from the data** (the last local day the series fully covers), not a
constant, so it tracks MET's model rather than a guess. Inside the horizon, if the forecast is
`unavailable` but normals are not, the widget shows **typical, in words**: a labelled typical
is true; a missing forecast is not a reason to show nothing. Local days are cut in the place's
time zone from the bundled tz-boundary lookup that link 11's *time difference from home*
brings first.

Resolvers stay pure and synchronous, and the preview stays a fixed string: *"The weather for
each day — the forecast when there is one, what's typical when there isn't."* Server-side
resolvers (the assistant) pass `{ state: "pending" }` and never trigger a fetch, so the
assistant is not a second route by which locations leave.

*Rejected: an async `resolve`.* It breaks the property test, the fixed preview and every
synchronous caller. *Rejected: one endpoint per widget.* A page with five weather blocks
would make five requests for one trip's points.

### 4. A new result state, `unavailable`

```ts
| { status: "unavailable"; reason: "pending" | "source" }   // packages/pages/src/result.ts
export const unavailable = (reason: "pending" | "source") => …
```

It is not `unbound`: nothing is missing that the author can set, so it is **not** a ghost,
is **not** counted in `unsetUpWidgets`, and offers no bind action. It is not `empty`: the
trip has what is needed; the world did not answer. `renderMacro` passes it through, and
`MacroView` gains one branch:

- **Reading:** the quiet `EmptyChip`-style placeholder Mitchell kept for Reading, at the
  block's fixed height — *"loading weather"* (`pending`) or *"weather unavailable"*
  (`source`). No error tone, no retry control.
- **Editing:** the same placeholder, and the settings panel (SPEC §26) adds one line saying
  which source did not answer and that the page will try again when it is next opened. No
  ghost: the ghost means "set me up", which would be a lie here.

`registry.property.test.ts` widens to *ok | empty | unbound | unavailable*, and its generator
produces all three slot states so `render` is exercised over each (ADR-037 decision 6b).

### 5. Attribution is rendered by the block, from a source id

Adapters return a `source` id (`"met-norway"`, `"nasa-power"`); the weather widget module in
`packages/pages` maps it to credit text, and the block component renders it as a footer line
under every block that shows the data. The author cannot remove it, and no URL comes from
fetched data:

- *"Forecast: The Norwegian Meteorological Institute (MET Norway), CC BY 4.0"*, linked to
  `https://api.met.no/doc/License`.
- *"Typical: NASA Langley Research Center POWER Project"* — a courtesy NASA requests, not a
  licence condition (to verify with the terms above).

*Amended 2026-09-24 (Mitchell, #221 preview: "I dont understand what this section is?
Typical lines? are they needed?").* The credits, the as-of and the averaging period are now
**one line**, each source labelled by what its data is on the block: *"Forecast: Norwegian
Meteorological Institute, CC BY 4.0 (updated 9:10 am) · Monthly averages: NASA POWER,
2001–2020"*, the MET part still linked to its licence. Only sources whose data is on the
block appear, as before. The table's typical rows say *"November average"* rather than
*"Typical for November"*, so the word needs no footer to explain it.

**Weather ships as a block only.** The brainstorm's inline chip (`18° · rain likely`) has
nowhere to carry a credit line, and CC BY needs one wherever the value appears. The chip
waits for a page-level credit footer, which is its own small decision.

### 6. What leaves the building: two decimals, one User-Agent, nothing else

`roundForExport(lat, lng)` rounds to **2 decimals** (≈ 1.1 km north–south) and is the only
constructor of `RoundedPoint`. That is coarser than MET's 4-decimal ceiling and finer than
"city level":

- **Why not city level (~1 decimal, ≈ 11 km):** on a coast or in mountains an 11 km shift
  moves the point into the sea or up a valley, and MET's grid is far finer than that in the
  places it models best.
- **Why not MET's 4 (≈ 11 m):** that is a building, it says which hotel, and it makes every
  stop its own cache row. At 2 decimals a hotel and the museum next to it share a row and a
  call.

Sent to MET: `lat`, `lon` (2 dp) and a `User-Agent` of
`travel-collab/<version> +https://<app host> <contact>`, where the contact is a new required
env `EXTERNAL_DATA_CONTACT` (an ops address, **never** a user's); `getForecast()` throws when
it is unset, as `getGeocoder()` does without its key. Sent to NASA POWER: `latitude`,
`longitude` (2 dp) and the fixed parameter list. **Never sent:** altitude, dates, trip or
user ids, names of places, the reader's IP (the call is server-side). The cache key holds
only the rounded point, so the table cannot say whose trip asked.

### 7. The as-of time is visible

The block's footer states it before the credit: *"Forecast as of 09:10"* from MET's
`meta.updated_at` (the model run, not our fetch time; falling back to `Last-Modified`), and
*"Typical: 2001–2020 averages"* for normals (period to verify). The payload carries ISO
strings; the one block component formats them in the reader's own time zone and adds the
date when it is not today. A stale row served after a failed revalidation shows its true,
older as-of, which is what makes serving it honest.

### 8. Rate limits and failure

- **Our own ceiling:** a `weatherQuota()` policy beside `geocodeQuota()` in `server/quota.ts`
  (`weather-daily`, per user and global, env-overridable), charged **only on a cache miss**.
  A refusal makes those points `unavailable: "source"`, not a 429 to the page.
- **Theirs:** calls per request are deduped by rounded point and run at most 4 at a time, so
  one page load stays far under MET's 20 req/s. A `429` records a back-off on the row and no
  call is made for that key until it passes. A `403` from MET means our request is wrong (a
  missing User-Agent, too many decimals) and is logged as an error, not retried. A `203`
  (deprecated product) is logged as a warning.
- **Time:** each upstream call has a 4 s timeout; the route answers with whatever has
  arrived, and each missing point is `unavailable`. A slow source never holds the notebook.

### 9. Testing

- **The failing-port stub is the proof of `unavailable`.** A route integration test wires a
  `Forecast` whose call rejects and asserts the point comes back `unavailable`; a component
  test renders that slot and finds the Reading placeholder, not a ghost and not an error
  chip. Seen red by making the adapter's rejection propagate instead (AGENTS.md rule 3).
- **Resolver tests pin the mode table** with fixed `today` values and fixture slots — one
  per row, plus forecast-missing-inside-horizon falling back to labelled typical.
- **Adapter tests stub `fetch`** (the `locationiq.test.ts` pattern) and assert the
  `User-Agent`, that no coordinate has more than 2 decimals, `If-Modified-Since` on
  revalidation, and `304` handling.
- **Cache integration test** against Postgres: fresh row → no call; expired → conditional
  call; call fails → stale row served with its old as-of.
- **No test reaches a real host** — CI has no business spending MET's goodwill, and this
  container's egress is blocked anyway.

## Consequences

- **A contract change and a result-union change.** `WidgetContext.external`, `TripWeather`
  and `MacroResult.unavailable` are Invariant 5 changes: their own PR, a changelog entry,
  consumers in the same PR. Every `switch` over `MacroResult.status` (today only
  `MacroView`'s) must gain the branch; ending those switches in `never` makes a missed one a
  type error.
- **One migration**, for `external_data_cache`, and one new required env var in production.
- **The first feature that sends anything about a trip to a third party.** Bounded to a 2-dp
  point and an ops contact, only when a page shows weather — **which, since 2026-09-26, the
  seeded Overview does, so it is the default on every Overview view** (accepted by Mitchell
  that day; see *When* above). The privacy page needs a line (KI-2026-09-24-o), and the
  `weather-daily` quota now meets ordinary traffic rather than opt-in use: 200 per user and
  5,000 global a day, charged on cache misses only, with demo and invite visitors in one
  shared bucket each — the first ceiling a busy demo would reach.
- **The next external widget costs a port, an adapter and a `Slot` member**, not another
  architecture: currency or holidays would reuse the table, `roundForExport` (if they need a
  place), `unavailable`, the credit footer and the as-of line.
- **No "what it actually was" mode.** After the trip is typical, labelled. Observed history
  would be a third source; nobody has asked for it.

## Alternatives rejected

- **Fetch in the browser.** See decision 1: CSP holes, the reader's IP to the vendor, and no
  way to set `User-Agent`.
- **Open-Meteo's free tier.** **Verified** non-commercial only, and names *"apps with
  subscriptions"* as commercial; M21 sells subscriptions. The paid plan stays the fallback
  for "typical".
- **Store forecasts in the event log.** A forecast is not a planning decision (Invariant 1),
  replaying the log would replay stale weather as if it were current, and every trip's
  history would fill with rows nobody made.
- **Resolve on the server and send rendered weather.** The mode depends on the reader's
  date, which only the client knows; a server-chosen mode is wrong for hours every evening
  west of Greenwich, the same reason `WidgetContext.today` is client-supplied.
- **Keep `unavailable` inside `empty` with a `because`.** It would count and render as the
  author's problem, and a property test could not tell "the world did not answer" from "you
  have no stops".

## Review points for Mitchell

1. **Two decimals (≈ 1 km)** for what leaves the building (decision 6). City level is more
   private and worse on coasts and mountains; MET's 4 is more exact and names a building.
2. **A Postgres cache table** rather than Next's data cache or a KV store (decision 2). It is
   one more table and a migration, bought for conditional requests and stale-on-error.
3. **Weather is a block only at first** (decision 5). The inline chip waits for a page-level
   credit line, because CC BY needs a credit wherever the number appears.
4. **Inside the horizon, a failed forecast falls back to typical, labelled** (decision 3),
   rather than to the `unavailable` placeholder.
5. **"Typical" means monthly averages of high, low and rainfall in mm per day** — NASA
   POWER's climatology is monthly and gives rainfall amount, not a chance of rain, so the
   brainstorm's *"chance of rain"* is not what typical mode will say. NASA POWER's terms and
   endpoint are still **to verify**; Open-Meteo paid is the fallback.
6. **NASA POWER, what the build assumed and nobody has read at the source** (T24; this
   container cannot reach `power.larc.nasa.gov`, so `nasa-power.ts` is written to these
   beliefs and its fixture is constructed, not recorded):
   - the path `/api/temporal/climatology/point` with `parameters=T2M_MAX,T2M_MIN,PRECTOTCORR`,
     `community=AG`, `latitude`, `longitude`, `format=JSON`;
   - the body: `properties.parameter.<NAME>.<JAN…DEC>`, `header.fill_value` (-999) for a
     month with no value, and the period in `header.start` / `header.end` as `YYYYMMDD`
     (falling back to the years in `header.range`, then to 2001–2020);
   - AG's units for these three are °C and mm/day;
   - whether a request-rate figure is published.
   A first real call on a preview settles all four: the route logs a warning naming the key
   when a call fails, and a body of a different shape is refused rather than mis-read.
   The walk that does it, with MET's `complete` field names from the section below, is
   `docs/guidelines/external-data-manual-check.md`. No automated test calls either source:
   the e2e server runs with `EXTERNAL_DATA_OFFLINE=true`, and the unit lane refuses any
   `fetch` to a host other than this machine.

## Implementation notes (T24, 2026-09-24)

Built as written, with these departures — each the closest faithful version of a line
that did not survive contact with the code:

- **`backoff_until` is a column, and `payload` is nullable.** Decision 8 says a 429
  "records a back-off on the row"; the column list in decision 2 had nowhere to record it,
  and a key that has never been fetched has no row to record it on, so such a row holds
  `payload: null` and serves nothing.
- **A quota refusal serves the stale row when there is one**, the same as a failed call,
  rather than going straight to `unavailable: "source"`. The refusal is a failure to
  fetch, and decision 2's stale-on-failure is the more honest answer when a row exists.
- **The route has a start budget of 5 s**: a call not started by then is not made, and
  its point is served from the cache or as `unavailable`. With decision 8's 4 s per call
  this bounds the route at about 9 s — the concrete form of "answers with whatever has
  arrived".
- **A missing `EXTERNAL_DATA_CONTACT` is one source down, not a 500.** `getForecast()`
  throws as decision 6 says; the route catches that throw, logs it as an error, and the
  forecast is `unavailable` — so the reader sees typical, labelled.
- **Today's figures are "now and the rest of the day" from the server's clock**: the
  route drops forecast steps already over when it answers, so the resolver's "now" is the
  first remaining hour and the day's high and low are the rest of the day's.
- **A located day whose stops name no city gets one point**, at its first located stop,
  with `city: null`. Decision 3 speaks only of "each city of that day".
- **A credit appears only for a source whose data is on the block**: a block showing
  only typical carries NASA's line and not MET's. CC BY asks for credit where the data
  appears, and nothing of MET's appears there.
- **The loading placeholder does not reserve the block's full height.** Every row of
  the block is one fixed height, so the block does not move between modes, but
  `unavailable("pending")` renders `MacroView`'s one-line chip, which cannot know how
  many rows the trip will have. Reserving it needs the row count from the trip without
  the slot, which is a change to `MacroView`'s unavailable branch.
- **Editing's settings-panel line (decision 4) is not built.** The placeholder is the
  same quiet chip in both modes, and no panel says which source did not answer.
- **There is no privacy page** to carry the line *Consequences* asks for.

### After the PART 3 self-review (2026-09-24)

- **MET's `complete` product, not `compact`.** `compact`'s `next_6_hours` carries rain
  only, so beyond the ~2.5 hourly days a day's high and low were the extremes of four UTC
  instants — which miss the afternoon peak (New York's 3 pm falls between 18:00 and 00:00
  UTC steps). `complete` documents `next_6_hours.details.air_temperature_max` / `_min`,
  so the adapter reads those for six-hourly steps and the day's high/low include them.
  Chosen over labelling those days "≈": the source has the true figure, and an
  approximation mark would be a caveat on data we could simply fetch. **TO VERIFY**
  against a live `complete` response — the field pair is from MET's documented data
  model and the fixture is written to it; without them a step falls back to its instant,
  i.e. to the old behaviour, never to a wrong number.
- **A 403 and a 5xx record a back-off too**, not only a 429: a day for a 403 (decision 8's
  "not retried" — our request is wrong until a deploy fixes it) and five minutes for a
  5xx. Retried per page load, each was charged to `weather-daily`.
- **An unconfigured forecast is not asked, so not charged.** With `EXTERNAL_DATA_CONTACT`
  unset the route passes no forecast source and no forecast jobs exist; before, a stub
  that always rejected was charged on every load until the shared quota refused the NASA
  normals too, and the reader got "Weather unavailable" instead of typical.

## Amendment — 2026-09-24: units come from the account's `distanceUnit`

**The coordinator's call, pending Mitchell's review.** Mitchell on the #221 preview:
*"Make sure we are respecting the account settings for fahrenheit vs celsius, or metric vs
imperial."* The account has one unit setting, `distanceUnit: "km" | "mi"`
(`packages/contracts/src/identity.ts`), and no temperature preference.

- **Decision: derive, and add no setting.** `mi` reads °F and rain in inches; `km` reads
  °C and mm. An account that asked for miles has asked for US units, and a second
  setting would be one more thing to disagree with the first. Preferences that did not
  load read as metric, the units both sources speak.
- **Where:** in the pure resolver (`day.weather`, `weather.ts`), from
  `WidgetContext.user`, which every widget already receives. The cache and the route
  stay in °C and mm; only the display-ready strings change.
- **Rounding:** °F to whole degrees, as °C already was, never printing `-0°`. Inches to
  two places, since a tenth of an inch is 2.5 mm; a trace that rounds to nothing prints
  `<0.01 in` rather than `0.00 in`, which would read as dry.
- **Rejected:** a separate temperature setting (a contract change and an Account control
  for a preference nobody has yet asked for separately), and reading the reader's
  locale (a notebook would print differently for two readers of the same account).
  If Mitchell wants °C with miles, the derivation becomes a setting, and this is the one
  function that reads it.

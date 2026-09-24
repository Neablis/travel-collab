# Notebook widgets — what is missing, and the ambitious ones

**Status:** Brainstorm, 2026-09-24. **Not accepted scope.** Mitchell asked, while M14's
field widget was being decided: *"look at our existing widgets, and brainstorm different
ways someone might make a travel doc, and see if we are missing any great widgets …
think really ambitious of block widgets that arent using internal data, but instead use
external data or charts or other unique ways of representing the trip."*
Nothing here goes into M14 until Mitchell picks from it. The picks, and the ADR external
data needs (§5), are what turn it into scope.

**Decided 2026-09-24 (answers to §7):** (1) weather comes from **MET Norway**, not
Open-Meteo; (2) sending a stop's rounded location to an outside service is **accepted**;
(3) charts use a **library matched to the aesthetic**, recorded in M14 as **shadcn/ui's
chart component (Recharts)**; (4) **all of §6's first wave goes into M14**, as its link
11. The later-and-ambitious items and the other candidates stay candidates.

Facts about the tree are checked against `main` on 2026-09-24. Facts about third-party
APIs are marked **verified** (terms read on 2026-09-24) or **to verify** (believed, not
read). That matters because the app takes subscriptions (M21), and "free" usually means
"free for non-commercial use".

---

## 1. What exists today

`packages/pages/src/presets.ts` has **20 insertable presets** over **13 primitives**
(`macros/primitives/`: `single`, `attribute`, `block`, `rows`, `open`).

| Group | Presets |
|---|---|
| A single value, inline | `cost`, `count`, `count.booked`, `count.days`, `dates`, `trip.countdown`, `hours`, `city`, `trip.name`, `budget.remaining`, `account.name`, `account.homeAirport` |
| A block | `day.detail`, `day.detail.booked`, `city.detail`, `costs.table` |
| A line for every … | `day.line`, `city.line`, `stop.line`, `booking.line` |
| Other | `open` |

**Every one of them is text or a table over internal trip data.** None draws a picture,
none knows anything the trip does not already store, and none changes with the clock
except `trip.countdown`. That is the gap this document is about.

---

## 2. Nine ways people actually make a travel doc

Each is a real document someone writes, what it has to say, and whether a widget can
say it today.

| # | The document | What it has to say | Covered today? |
|---|---|---|---|
| 1 | **The group handout**: "here is the plan" | When and where each day is, where we sleep, what is booked | ✅ mostly (`day.detail`, `booking.line`) |
| 2 | **Know before you go** | Weather, currency, plugs, time difference, holidays, emergency numbers | ❌ none of it |
| 3 | **The budget sheet** | Spend by day and category, budget left, in my currency | ⚠️ the numbers are there; no chart, no conversion |
| 4 | **The packing list** | What the weather and the activities demand | ❌ |
| 5 | **The day-of phone cheat sheet** | What is next, when, how far, when the sun sets | ⚠️ static only; nothing knows "now" |
| 6 | **The to-do list before leaving** | What still needs booking | ⚠️ the rule exists (`apps/web/src/lib/needsBooking.ts`); no widget uses it |
| 7 | **The research board** | What a place is like, what is on while we are there | ❌ |
| 8 | **The printed emergency / cover sheet** | Hotel addresses, numbers, a way back to the live plan | ⚠️ addresses yes; no cover, no QR |
| 9 | **The recap after the trip** | Where we went, how far, how much, the stats | ❌ |

Documents 2, 4, 7 and 9 are the ones people make most and where the app has nothing,
and they need **external data** or **pictures**, not more tables.

---

## 3. The candidates

Three tiers, sorted by what a widget needs to exist. Tier B is the cheapest win in the
whole list, because it needs no API **and** no new data.

### Tier A: internal data, drawn differently (charts, maps, time)

| Widget | Shape | What it shows | Notes |
|---|---|---|---|
| **Trip strip** | block | One horizontal band, one cell per day, filled with that day's **city accent**, with city names over the runs | Uses `cityAccents`/`dayAccents`, which already reach the notebook. The single most "at a glance" picture of a trip |
| **Route map** | block | A static map of the trip or of one day, with stops and, after M24, real legs drawn by mode | MapLibre + OpenFreeMap are already in the app and the CSP (`connect-src … tiles.openfreemap.org`). Needs a non-interactive, fixed-height embed (ADR-044: a widget edits without reflowing) |
| **Spend by day** | block (chart) | A bar per day, stacked by tag or kind, and a budget line | `costs.table`'s data drawn as a chart. Gets better when M19 adds a cost's kind |
| **Budget burn-down** | block (chart) | Budget left falling across the days against an even pace | Same data as `budget.remaining`, over time |
| **How full is each day** | block (chart) | A day × hour grid, shaded where stops sit (`timeWindow`) | Shows overpacked days and free afternoons at once |
| **Free time** | inline / repeat | "Tue 14:00–18:00 is open" | The gaps between `timeWindow`s |
| **Still to book** | repeat | A line for every stop `needsBooking` flags | The rule is written and decided (2026-08-29) but only the board uses it |
| **Now / next** | block | During the trip: the current stop, the next one, and time until it | The first widget that reads the clock beyond the countdown. Needs a "now" in `WidgetContext`, and a stated answer for Reading a page before or after the trip |
| **Trip in numbers** | block | Days, cities, countries, stops, km covered, spend: the recap card | `countryCode` is on every stop since M12; km is computed (tier B). Document 9 |
| **Distance by mode** | block (chart) | km by walk / train / flight / car | **Needs M24's `mode`** |
| **Cover** | block | Trip name, dates, the strip, the cities: a title page for a printed doc | Composes the widgets above |

### Tier B: computed on our side, no API and no new data

These need only coordinates, dates and a small bundled dataset or algorithm, so they
have no vendor terms, no rate limit and never go down.

| Widget | Shape | How it is computed |
|---|---|---|
| **Sunrise / sunset / golden hour** | inline + block per day | The standard solar-position algorithm from lat/lng and date (the published NOAA equations, or a small MIT library such as SunCalc). The day-of sheet's most-asked question |
| **Time difference from home** | inline | "Tokyo is 16 h ahead of home". The stop's time zone from its coordinates (a bundled tz-boundary lookup) against the account's home airport (M17) |
| **Local time there, now** | inline | Same lookup, with `Intl.DateTimeFormat` |
| **How far** | inline / repeat column | Great-circle distance between stops or cities; an estimate of walking time |
| **Carbon estimate** | inline / block | Distance × a per-mode emission factor from a published government table (e.g. the UK's conversion factors, **to verify** for licence). **Needs M24's `mode`** |
| **Know before you go** | block per country | Plug type and voltage, driving side, emergency number, currency, calling code, tipping norm, from a **bundled** static table keyed by `countryCode`. Bundled rather than fetched: it changes about once a decade and a table we own cannot be wrong at render time |
| **QR back to the live plan** | inline / block | A QR code of the trip's share link, for the printed cover sheet. Generated locally |
| **Moon phase** | inline | An algorithm. Small, but people planning night skies ask for it |

### Tier C: external data

| Widget | Source | Terms |
|---|---|---|
| **Weather** (see §4) | MET Norway Locationforecast 2.0 for the forecast; a climate source for "typical" | MET Norway: **verified** free including commercial use, under NLOD 2.0 / CC BY 4.0 with attribution; needs an identifying User-Agent, respect for cache headers, coordinates to 4 decimals, and contact before 20 req/s. ([api.met.no licence](https://api.met.no/doc/License), [terms](https://api.met.no/doc/TermsOfService)) |
| **Currency** | "¥12,000 ≈ $81 at today's rate", in the reader's currency | ECB reference rates, e.g. via Frankfurter (keyless, open source; **to verify**). Daily rates are enough |
| **Public holidays** | "Mon 3 Nov is a holiday in Japan: expect closures" | Nager.Date (open source; **to verify** terms), or a bundled holiday library so there is no vendor at all |
| **About this place** | A short summary of a city or sight | Wikivoyage / Wikipedia via the Wikimedia REST API. CC BY-SA; wants an identifying User-Agent (**to verify**). Wikivoyage is written as a travel guide, which fits better than Wikipedia |
| **Elevation profile** | A hike's climb, drawn as a chart | OpenTopoData or similar (**to verify**); only meaningful once a leg has a real path (M24) |
| **What's on** | Concerts and events in a city during the trip | Ticketmaster Discovery (keyed, free tier; **to verify**). Most ambitious, patchiest coverage |
| **Travel advisories** (asked for by Mitchell, 2026-09-24; a follow-up, not M14) | Each trip country's US State Department advisory level (1 "Exercise normal precautions" to 4 "Do not travel"), its date, and a link to the full advisory. Never paraphrased | travel.state.gov's public advisory feed (RSS; a JSON data API may also exist). US government work, public domain: no key, attribution only (endpoint and format **to verify** from a network that reaches it). Fetch the whole list and match countries locally, so no trip data leaves the app. Say plainly that it is written for US citizens |

**Not recommended, with the reason:**

- **Open-Meteo on its free tier.** **Verified**: the free API is "for non-commercial use"
  and names *"websites or apps with subscriptions"* as commercial. We have subscriptions.
  Its paid plan is a real option; see §4. ([terms](https://open-meteo.com/en/terms),
  [pricing](https://open-meteo.com/en/pricing))
- **Flight status, visa rules.** No free source worth building on, and a wrong answer
  about a visa is worse than no answer.
- **Air quality.** The good free source is Open-Meteo, so the same problem.

---

## 4. Weather, in depth — the widget worth getting right

Weather is the most requested thing in document 2 and the input to document 4. The trap
is the horizon: **a forecast reaches about 9–10 days, and people plan months ahead.** A
widget that says "no forecast yet" for the whole planning period is useless for the whole
planning period.

So the widget has **four modes, chosen by the date, not by the author**:

| When the reader opens the page | It shows | Needs |
|---|---|---|
| The day is more than ~10 days away | **Typical weather for these dates**: average high and low, chance of rain | Climate normals |
| Within the forecast horizon | **The forecast** | MET Norway |
| On the day | The forecast for now and the rest of the day | MET Norway |
| After the trip | **What it actually was** | Historical observations |

The same inline chip (`18° · rain likely`) and the same block (a small row of days with
icons, highs and lows) serve all four. The mode is shown in words (*"typical for early
November"* vs *"forecast"*), so nobody packs for a normal as if it were a forecast.

**The source decision this needs:**

- **Option 1: pay Open-Meteo.** One vendor covers forecast, historical and climate, with
  one integration. Costs a subscription.
- **Option 2: stay free.** MET Norway for the forecast (**verified** commercial-OK) plus
  a separate free climate-normals source for "typical", e.g. NASA POWER's climatology
  service (**to verify**: keyless, public data). The "after the trip" mode would drop or
  come from the same climate source. Two integrations, no bill.

**The recommendation is to start with option 2's forecast half plus "typical"**, and to
buy Open-Meteo only if the free climate source turns out thin.

---

## 5. What external data needs architecturally — an ADR, before any code

Widgets are currently **pure and synchronous**: `resolve(ctx: WidgetContext, params,
item?)` (`packages/pages/src/registry-types.ts`) reads the trip it is handed and nothing
else. Only `apps/web/src/server` may do network I/O (ADR-007), and the browser CSP allows
`connect-src 'self'` plus the tile host. External data therefore cannot be fetched *by a
widget*. It has to arrive **as an input**. What the ADR has to decide:

1. **Fetched server-side, behind a port.** One port per capability (`Weather`,
   `ExchangeRates`, …) in `apps/web/src/server/`, the same pattern as the `Geocoder` in
   ADR-007, so a vendor is swappable and its terms stay in one file.
2. **Cached, keyed coarsely.** Rounded coordinates plus date, honouring the provider's
   own expiry. That is MET Norway's rule, and it is what keeps a 20-page notebook from
   costing 20 × N calls.
3. **Handed to `resolve` as a pre-fetched slot on `WidgetContext`**, so the resolver stays
   pure and testable and the insert-sheet preview stays a fixed string (ADR-037 d5).
4. **A new result state: `unavailable`.** "The source is down" or "out of range" is
   neither `unbound` (a ghost the author can fix) nor an error. It needs its own quiet
   placeholder, in both Reading and Editing.
5. **Attribution is part of the block.** CC BY data carries a credit line, rendered by the
   block and not left to the author.
6. **What leaves the building.** A weather call sends a stop's coordinates to a third
   party. The ADR states that plainly, and rounds coordinates to what the provider needs
   and no finer (city-level is enough for weather).
7. **The as-of time is visible.** "Forecast as of 09:10": external data goes stale in a
   way trip data does not.

Tier B needs none of this. That is another reason it goes first.

**Charts need one smaller decision.** `apps/web` has no chart library (`maplibre-gl` is
the only graphics dependency). For the three or four charts above, **hand-drawn SVG with
the design system's tokens** is likely cheaper than a dependency and keeps them on-brand.
Either way, a chart is a new block kind with a fixed height, so it cannot reflow the page
around it (ADR-044).

---

## 6. A recommended first wave

Picked for value per unit of work, and so that the first external-data widget lands on
an architecture that was built for it:

1. **Trip strip.** Internal data, one picture that says more than any existing table.
2. **Still to book.** The rule already exists; the widget is a thin `rows` preset.
3. **Sunrise / sunset** and **time difference from home.** Tier B, no vendor.
4. **Know before you go.** Tier B, a bundled table, and on its own it answers most of document 2.
5. **Spend by day.** The first chart, which settles the chart decision.
6. **Weather**, on the §5 ADR. The first external source, and the most asked-for.
7. **Route map block**, after M24, when there are real legs to draw.

**Later and ambitious:** *Trip in numbers* as a shareable recap card; a **packing list**
the assistant drafts from the weather widget, the tags (`outdoors` → boots) and the trip
length; a **Now / next** mode that turns the notebook into the phone's day-of screen.

---

## 7. Questions for Mitchell

1. **Weather source:** stay free (MET Norway + a free climate source), or pay Open-Meteo
   for one vendor that does all four modes?
2. **Is sending a stop's (rounded) location to a weather or place API acceptable?** This
   is the first feature that would.
3. **Charts:** hand-drawn SVG, or adopt a chart library?
4. **Which of §6 goes into M14**, and which becomes its own later milestone? External data
   plus charts is plausibly a milestone of its own ("a notebook knows the world").

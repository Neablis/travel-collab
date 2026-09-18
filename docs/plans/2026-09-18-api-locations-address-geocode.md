# API Locations — structured address, geocode on write, geocode endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public-API caller can give a stop coordinates, a structured postal address, or just a name, and the stop gets a map pin. A caller can also look up coordinates first through a new geocode endpoint.

**Architecture:** `Location` (packages/contracts) gains an optional, structured `address` modelled on the international postal-address model (CLDR / libaddressinput / `google.type.PostalAddress`). The v1 stop endpoints resolve a location before the command runs, as ADR-007 requires: explicit `lat`/`lng` first, then a geocoded address, then a geocoded name. The stop is saved on a miss and flagged. Every lookup is charged to the existing `geocodeQuota`. A new `GET /v1/trips/{tripId}/geocode` exposes the same lookup. Its results are `Location`-shaped, so a candidate can be sent back as a stop's `location` unchanged.

**Tech Stack:** zod contracts, Next.js route handlers via the `route()` wrapper (`apps/web/src/server/public-api/route.ts`), LocationIQ behind the `Geocoder` port (ADR-007), vitest (unit + int against Postgres).

**Spec:** The design was agreed in conversation with Mitchell on 2026-09-18; there is no separate spec file. The decisions are recorded under "Design decisions" below, and executors treat that section as the spec.

## Design decisions (agreed 2026-09-18)

1. **Resolution order on a v1 stop write** (`POST /v1/trips/{tripId}/activities`, `PATCH .../activities/{activityId}`, only when the body carries a `location` object):

   | Location arrives with | Server does | Lookups |
   |---|---|---|
   | `lat` + `lng` | Stores as sent. Also stores the address if one was given. | 0 |
   | `address`, no coordinates | Structured geocode of the address | 1 |
   | `name` only | Geocode of the name, biased to the trip's region | 1 |
   | Lookup misses, quota exhausted, or vendor down | Saves the stop without coordinates and flags it | — |

2. **Flag = response header `Geocode-Outcome`**, with one of `provided | address | name | no-match | quota-exhausted | unavailable`. The response body stays `TripDetail`, so no published contract changes shape. A caller can also see the result directly: `location.lat` is absent when nothing resolved.
3. **The assistant is unchanged.** `enrichCommandLocations` and the assistant tools are out of scope; this work is API only.
4. **No UI.** The address is stored and returned by the API. The in-app picker (`LocationInput.tsx`) does not write it and the board does not render it. MapLibre only draws coordinates, so the address is never needed for the map.
5. **No DB migration.** A location lives inside `events.payload` / `trip_details.doc` jsonb. The "DB change" is the zod contract, and old documents must keep parsing (an optional field with no backfill).
6. **Address model: structured, never one string.** See Task 1. We **never** build an address from vendor output. Nominatim/LocationIQ return components with no per-country ordering, so turning them into lines would mean formatting rules for each country. A caller's address is stored exactly as the caller wrote it, and geocoding only adds coordinates.
7. **The geocode endpoint is trip-scoped** (`/v1/trips/{tripId}/geocode`, scope `trips:write`, role `editor`). Three reasons: (a) `route()` refuses trip-scoped tokens on endpoints without a trip, and an AI agent is usually holding exactly that kind of token; (b) it gets the trip-region bias for free; (c) its only purpose is writing stops, so a read-only token has no reason to spend the operator's LocationIQ allowance. No new scope.

## Global Constraints

- Contract changes follow AGENTS.md invariant 5: schema + `docs/contracts/CHANGELOG.md` entry + all consumers, landed as their own reviewed step (Task 1) before dependent work.
- Every persisted `Location` field must be compared in `packages/domain/src/trip/equality.ts` (see the comment there, KI-35/KI-54).
- Every new optional field on `Location` must let an old `trip_details.doc` parse. Use the tripwire pattern in `packages/contracts/test/location-precision.test.ts`.
- Geocoding stays behind the `Geocoder` port (`apps/web/src/server/geocoding/`). No vendor URL or param names outside `locationiq.ts`.
- Every LocationIQ call on these paths is charged through `consumeQuota(geocodeQuota(), userId)` **before** the vendor call. The quota fails closed. Do not widen KI-093.
- A geocoding failure never fails a stop write.
- CLAUDE.md rule 3: every new test must be seen failing for its intended reason (break the code, watch it go red, restore it).
- CLAUDE.md rule 4: run scoped checks per task (the `minimal-check-subset` skill). The full `pnpm check` runs once, at final review.

---

### Task 1: Contract — `PostalAddress`, `Location.address`, `GeocodeOutcome`, `GeocodeCandidates`

**Files:**
- Modify: `packages/contracts/src/activity.ts` (add `PostalAddress` above `Location`, around line 50; add `address` to `Location`; add a refine)
- Modify: `packages/contracts/src/publicApi.ts` (append `GeocodeOutcome`, `GEOCODE_OUTCOME_HEADER`, `GeocodeCandidates`)
- Modify: `packages/domain/src/trip/equality.ts:56-62`
- Test: `packages/contracts/test/location-address.test.ts` (create)
- Test: `packages/domain/test/location-address-equality.test.ts` (create)
- Modify: `docs/contracts/CHANGELOG.md` (new top entry)

**Interfaces:**
- Produces: `PostalAddress` (zod + type), `Location.address?: PostalAddress`, `GeocodeOutcome` (zod enum + type), `GEOCODE_OUTCOME_HEADER = "Geocode-Outcome"`, `GeocodeCandidates` (zod `{ results: Location[] }`). All are exported from `@tc/contracts` (check `packages/contracts/src/index.ts` re-exports `activity.ts` and `publicApi.ts` with `export *`; add the export if not).

**Why these address fields.** This is the international postal-address model shared by CLDR, Google's libaddressinput and `google.type.PostalAddress`, cut down to what a travel stop needs:

| Field | Why it is shaped this way |
|---|---|
| `countryCode` (required, ISO 3166-1 alpha-2) | The country decides how every other field is read. It is the one field that is never optional. |
| `lines: string[]` (1–4) | The street-level part, **in the local order**. "221B Baker Street", "Hauptstraße 5" and "1-2-3 Nishi-Azabu" (Japanese block numbering, no street name) all fit. Splitting it into `street` + `houseNumber` breaks in exactly those countries. |
| `locality` | City/town/post town. |
| `dependentLocality` | District, neighbourhood or suburb when it is part of the postal address (UK dependent locality, Chinese district, Korean dong). |
| `administrativeArea` | State, province, prefecture, region, emirate. |
| `postalCode` | A **string**: leading zeros (US 02134), letters (UK SW1A 1AA, CA K1A 0B1). Optional because many countries have none. |

Left out on purpose (addable later, and they don't change existing fields): `sortingCode` (FR CEDEX), `languageCode`/script (we store romanised text; see the `accept-language=en` rationale in `locationiq.ts`), recipient and organisation (a stop has a `title`).

- [x] **Step 1: Write the failing contract tests**

Create `packages/contracts/test/location-address.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Location, PostalAddress, TripDetail, GeocodeOutcome, GeocodeCandidates } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000c";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000c1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000f";

// A `trip_details.doc` written before Location grew `address`. The read route
// runs `TripDetail.parse` on raw jsonb, so this must keep parsing (M18 lesson;
// see location-precision.test.ts).
const PRE_ADDRESS_DOC = {
  tripId: TRIP,
  name: "Korea",
  status: "active",
  startDate: "2026-10-01",
  currency: "USD",
  budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-01", costSubtotal: 0 }],
  backlog: [],
  activities: {
    [A1]: {
      activityId: A1,
      title: "Makgeolli alley evening",
      timeWindow: null,
      location: { name: "Makgeolli alley", lat: 35.8, lng: 127.1, city: "Jeonju-si", countryCode: "KR", precision: "venue" },
      notes: null,
      anchors: [],
      kind: "planned",
      tags: [],
      cost: null,
    },
  },
  conflicts: [],
  dismissedConflictIds: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  unscheduledCostSubtotal: 0,
};

describe("Location.address", () => {
  it("a document written before `address` existed still parses", () => {
    // Copy any fields TripDetail requires that are missing here from
    // PRE_PRECISION_DOC in location-precision.test.ts — that doc is known-good.
    expect(TripDetail.safeParse(PRE_ADDRESS_DOC).success).toBe(true);
  });

  it("accepts addresses shaped the way three different countries write them", () => {
    const uk = { countryCode: "GB", lines: ["221B Baker Street"], locality: "London", postalCode: "NW1 6XE" };
    const de = { countryCode: "DE", lines: ["Hauptstraße 5"], locality: "Heidelberg", postalCode: "69117" };
    const jp = {
      countryCode: "JP",
      lines: ["1-2-3 Nishi-Azabu"],
      dependentLocality: "Minato-ku",
      locality: "Tokyo",
      postalCode: "106-0031",
    };
    for (const a of [uk, de, jp]) expect(PostalAddress.safeParse(a).success).toBe(true);
  });

  it("keeps a postal code's leading zero because it is a string", () => {
    const parsed = PostalAddress.parse({ countryCode: "US", lines: ["1 Main St"], postalCode: "02134" });
    expect(parsed.postalCode).toBe("02134");
  });

  it("refuses an address with no street-level line", () => {
    expect(PostalAddress.safeParse({ countryCode: "FR", lines: [], locality: "Paris" }).success).toBe(false);
  });

  it("refuses a lowercase or three-letter country code", () => {
    expect(PostalAddress.safeParse({ countryCode: "fr", lines: ["1 rue X"] }).success).toBe(false);
    expect(PostalAddress.safeParse({ countryCode: "FRA", lines: ["1 rue X"] }).success).toBe(false);
  });

  it("allows an address with no coordinates, and an address with coordinates", () => {
    const address = { countryCode: "GB", lines: ["221B Baker Street"] };
    expect(Location.safeParse({ name: "Sherlock Holmes Museum", address }).success).toBe(true);
    expect(Location.safeParse({ name: "Sherlock Holmes Museum", lat: 51.5238, lng: -0.1586, address }).success).toBe(true);
  });

  it("refuses a location whose countryCode disagrees with its address's", () => {
    const r = Location.safeParse({
      name: "X",
      countryCode: "FR",
      address: { countryCode: "GB", lines: ["221B Baker Street"] },
    });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join("."))).toContain("address.countryCode");
  });
});

describe("public API geocode vocabulary", () => {
  it("names every outcome the Geocode-Outcome header can carry", () => {
    expect(GeocodeOutcome.options).toEqual(["provided", "address", "name", "no-match", "quota-exhausted", "unavailable"]);
  });

  it("geocode results are Locations, so a candidate is a valid stop location as-is", () => {
    const body = { results: [{ name: "Colosseum, Rome, Italy", lat: 41.89, lng: 12.49, countryCode: "IT", city: "Rome" }] };
    const parsed = GeocodeCandidates.parse(body);
    expect(Location.safeParse(parsed.results[0]).success).toBe(true);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @tc/contracts test -- location-address`
Expected: FAIL, because `PostalAddress`, `GeocodeOutcome` and `GeocodeCandidates` are not exported (an import error or undefined).

- [x] **Step 3: Implement the contract**

In `packages/contracts/src/activity.ts`, directly above `export const Location`:

```ts
// **A postal address, structured the way the world actually writes them** —
// the model CLDR, libaddressinput and google.type.PostalAddress share, cut to
// what a travel stop needs. Never one free-text string, and never
// `street` + `houseNumber`: "Hauptstraße 5" puts the number after the street,
// and a Japanese address has block numbers and often no street name at all.
// `lines` holds the street-level part in the country's own order.
//
// **Caller-authored, never vendor-built.** Nominatim-family geocoders return
// address components with no per-country ordering, so assembling `lines` from
// them would mean shipping a formatter for each country. An address is stored
// exactly as its author wrote it; geocoding only ADDS coordinates to it.
//
// Optional on Location and on every field but `countryCode`/`lines`, because
// `trip_details.doc` is raw jsonb parsed on read (see location-address.test.ts).
// Deliberately absent, addable later without changing existing fields:
// sortingCode (FR CEDEX), languageCode/script, recipient, organisation.
export const PostalAddress = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/).describe("ISO 3166-1 alpha-2, uppercase. Decides how the other fields are read."),
  lines: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(4)
    .describe("Street-level part, in the country's own order, e.g. [\"Hauptstraße 5\"] or [\"1-2-3 Nishi-Azabu\"]."),
  dependentLocality: z.string().trim().min(1).max(200).optional().describe("District, neighbourhood or suburb when it is part of the postal address."),
  locality: z.string().trim().min(1).max(200).optional().describe("City, town or post town."),
  administrativeArea: z.string().trim().min(1).max(200).optional().describe("State, province, prefecture or region."),
  postalCode: z.string().trim().min(1).max(20).optional().describe("A string: keeps leading zeros and letters."),
});
export type PostalAddress = z.infer<typeof PostalAddress>;
```

Inside the `Location` object, after `precision: LocationPrecision.optional(),`:

```ts
    // A structured postal address (see PostalAddress). Independent of
    // `city`/`area`, which are the geocoder's display/grouping fields: a post
    // town and the city a stop groups under legitimately differ. Only
    // `countryCode` is checked against it (refine below), because two country
    // fields that can disagree is a bug generator (activity.ts, ActivityTag).
    address: PostalAddress.optional(),
```

Append a third refine after the `precision` refine:

```ts
  .refine((l) => l.address === undefined || l.countryCode === undefined || l.countryCode === l.address.countryCode, {
    message: "countryCode must match address.countryCode",
    path: ["address", "countryCode"],
  });
```

(Move the final `;` so the chain ends after this refine.)

Also add a `.describe()` to `lat`, because `zodToJsonSchema` does not carry refines into `openapi.json` and callers read the spec:

```ts
    lat: z.number().min(-90).max(90).optional().describe("Send with lng, or omit both. When omitted on a v1 write, the server geocodes `address`, then `name`."),
    lng: z.number().min(-180).max(180).optional().describe("Send with lat, or omit both."),
```

Append to `packages/contracts/src/publicApi.ts` (add `import { Location } from "./activity";` at the top if it is not imported yet):

```ts
/**
 * What happened to a stop's location on a v1 write, sent as the
 * `Geocode-Outcome` response header whenever the body carried a `location`.
 *
 * A header rather than a body field so `TripDetail`, the published response,
 * does not change shape. The body also shows the result directly:
 * `location.lat` is absent when nothing resolved.
 */
export const GeocodeOutcome = z.enum([
  "provided",        // the caller sent lat/lng; nothing was looked up
  "address",         // coordinates came from geocoding `location.address`
  "name",            // coordinates came from geocoding `location.name`
  "no-match",        // looked up, vendor found nothing; saved without coordinates
  "quota-exhausted", // the owner's daily geocode allowance is spent; saved without coordinates
  "unavailable",     // geocoder unconfigured, erroring, or quota store down; saved without coordinates
]);
export type GeocodeOutcome = z.infer<typeof GeocodeOutcome>;
export const GEOCODE_OUTCOME_HEADER = "Geocode-Outcome";

/** `GET /v1/trips/{tripId}/geocode` — each result is a `Location` a caller can send back as a stop's `location` unchanged. */
export const GeocodeCandidates = z.object({ results: z.array(Location) });
export type GeocodeCandidates = z.infer<typeof GeocodeCandidates>;
```

- [x] **Step 4: Run to verify it passes, then prove it can fail**

Run: `pnpm --filter @tc/contracts test -- location-address`
Expected: PASS.
Prove it: temporarily delete the countryCode refine and confirm "refuses a location whose countryCode disagrees" goes red. Temporarily change `postalCode` to `z.coerce.number()` and confirm the leading-zero test goes red. Restore both.

Then run the whole contracts suite: `pnpm --filter @tc/contracts test`. `activity-payload-parity.test.ts` must still pass.

- [x] **Step 5: Write the failing equality test**

Create `packages/domain/test/location-address-equality.test.ts`. First open `packages/domain/test/ki35-location-area.test.ts` and copy how it builds an `ActivityState` and imports `activityStatesEqual`. Then:

```ts
// Same import and ActivityState builder as ki35-location-area.test.ts.
it("a stop whose only change is its address is NOT equal (else undo/revert keeps the old address)", () => {
  const base = { name: "Museum", lat: 51.5, lng: -0.15 };
  const a = activity({ location: { ...base, address: { countryCode: "GB", lines: ["221B Baker Street"] } } });
  const b = activity({ location: { ...base, address: { countryCode: "GB", lines: ["221 Baker Street"] } } });
  expect(activityStatesEqual(a, b)).toBe(false);
});

it("identical addresses compare equal, including absent vs absent", () => {
  const address = { countryCode: "JP", lines: ["1-2-3 Nishi-Azabu"], locality: "Tokyo", postalCode: "106-0031" };
  expect(activityStatesEqual(activity({ location: { name: "X", address } }), activity({ location: { name: "X", address: { ...address, lines: [...address.lines] } } }))).toBe(true);
  expect(activityStatesEqual(activity({ location: { name: "X" } }), activity({ location: { name: "X" } }))).toBe(true);
});

it("absent vs present address is not equal", () => {
  expect(activityStatesEqual(activity({ location: { name: "X" } }), activity({ location: { name: "X", address: { countryCode: "GB", lines: ["1 A St"] } } }))).toBe(false);
});
```

Run: `pnpm --filter @tc/domain test -- location-address-equality`
Expected: the first and third tests FAIL, because equality ignores `address` today.

- [x] **Step 6: Implement equality**

In `packages/domain/src/trip/equality.ts`, add a helper above `activityStatesEqual`:

```ts
function sameAddress(a: PostalAddress | undefined, b: PostalAddress | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.countryCode === b.countryCode &&
    sameList(a.lines, b.lines) &&
    a.dependentLocality === b.dependentLocality &&
    a.locality === b.locality &&
    a.administrativeArea === b.administrativeArea &&
    a.postalCode === b.postalCode
  );
}
```

(Import `type PostalAddress` from `@tc/contracts`. `sameList` already exists in this file; check its signature accepts `readonly string[]`.) Add `&& sameAddress(a.location.address, b.location!.address)` after the `precision` comparison, and add "`address` (compared by `sameAddress`)" to the comment's field list.

Run: `pnpm --filter @tc/domain test`. Expected: PASS. Prove it: remove the `sameAddress` call, watch test 1 go red, restore.

- [x] **Step 7: CHANGELOG entry**

Add at the top of `docs/contracts/CHANGELOG.md` (below the format block):

```md
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
```

- [x] **Step 8: Typecheck and commit**

Run: `pnpm --filter @tc/contracts typecheck && pnpm --filter @tc/domain typecheck && pnpm --filter web typecheck`
Expected: clean. (A consumer that builds `Location` by listing fields one by one still compiles because the field is optional. Grep `apps/web/src` for `precision:` to find such places and confirm none needs `address`: the assistant read tool, `LocationInput`, and enrichment are out of scope per decision 3/4.)

```bash
git add packages/contracts packages/domain docs/contracts/CHANGELOG.md
git commit -m "contracts: structured PostalAddress on Location, and v1 geocode vocabulary"
```

---

### Task 2: Geocoder port — structured address lookup and a country filter

**Files:**
- Modify: `apps/web/src/server/geocoding/geocoder.ts`
- Modify: `apps/web/src/server/geocoding/locationiq.ts`
- Modify: `apps/web/src/server/geocoding/index.ts` (re-export nothing new unless needed)
- Test: `apps/web/src/server/geocoding/locationiq.test.ts`
- Modify: every test fake typed as `Geocoder`. Find them with `pnpm --filter web typecheck` after Step 3. Known candidates: `server/ai/geocodeEnrichment.test.ts`, `server/ai/writeTools.test.ts`, `app/api/trips/[tripId]/ask/apply/route.int.test.ts`.

**Interfaces:**
- Consumes: `PostalAddress` (Task 1).
- Produces:
  ```ts
  interface GeocodeOptions { limit?: number; viewbox?: BoundingBox; countryCode?: string /* ISO alpha-2, uppercase; restricts results */ }
  interface Geocoder {
    forward(query: string, opts?: GeocodeOptions): Promise<GeocodeResult[]>;
    forwardAddress(address: PostalAddress, opts?: Omit<GeocodeOptions, "countryCode">): Promise<GeocodeResult[]>;
  }
  ```

- [x] **Step 0: Confirm LocationIQ's structured-search parameter names.** Open https://docs.locationiq.com/reference/search (use WebFetch) and confirm the params this task uses: `street`, `city`, `county`, `state`, `postalcode`, `countrycodes`, and that structured params cannot be combined with `q`. If a name differs, use the documented name and note it in the commit message. Do not guess.

- [x] **Step 1: Write the failing adapter tests** (append to `locationiq.test.ts`, same fetch-stub style as the file's first test)

```ts
it("geocodes an address with structured params, never `q`, restricted to its country", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request) =>
    new Response(JSON.stringify([{ lat: "49.41", lon: "8.69", display_name: "Hauptstraße 5, Heidelberg", address: { country_code: "de", city: "Heidelberg" } }]), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const results = await createLocationIQGeocoder("K").forwardAddress(
    { countryCode: "DE", lines: ["Hauptstraße 5"], dependentLocality: "Altstadt", locality: "Heidelberg", administrativeArea: "Baden-Württemberg", postalCode: "69117" },
    { limit: 1 },
  );

  expect(results[0]).toMatchObject({ lat: 49.41, lng: 8.69, countryCode: "DE", city: "Heidelberg" });
  const url = new URL(fetchMock.mock.calls[0]![0] as string);
  expect(url.searchParams.get("q")).toBeNull();
  expect(url.searchParams.get("street")).toBe("Hauptstraße 5");
  expect(url.searchParams.get("city")).toBe("Heidelberg");
  expect(url.searchParams.get("state")).toBe("Baden-Württemberg");
  expect(url.searchParams.get("postalcode")).toBe("69117");
  expect(url.searchParams.get("countrycodes")).toBe("de");
  expect(url.searchParams.get("limit")).toBe("1");
  expect(url.searchParams.get("accept-language")).toBe("en");
});

it("joins multiple address lines into one street param, in the caller's order", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await createLocationIQGeocoder("K").forwardAddress({ countryCode: "GB", lines: ["Flat 4", "221B Baker Street"] });
  const url = new URL(fetchMock.mock.calls[0]![0] as string);
  expect(url.searchParams.get("street")).toBe("Flat 4, 221B Baker Street");
});

it("restricts a free-text lookup to a country when asked", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await createLocationIQGeocoder("K").forward("Blue Bottle", { countryCode: "JP" });
  const url = new URL(fetchMock.mock.calls[0]![0] as string);
  expect(url.searchParams.get("q")).toBe("Blue Bottle");
  expect(url.searchParams.get("countrycodes")).toBe("jp");
});

it("treats LocationIQ's 404 'Unable to geocode' as no results, not an error", async () => {
  // LocationIQ answers a miss with HTTP 404 {"error":"Unable to geocode"}.
  // Confirm this against the docs in Step 0; if confirmed, a miss must be [] so
  // the caller can tell "no-match" from "unavailable".
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unable to geocode" }), { status: 404 })));
  await expect(createLocationIQGeocoder("K").forward("zzzz")).resolves.toEqual([]);
});
```

Run: `pnpm --filter web test -- src/server/geocoding/locationiq.test.ts`
Expected: FAIL (`forwardAddress is not a function`, and `countrycodes` is null).

- [x] **Step 2: Implement**

`geocoder.ts`: add `countryCode?: string` to `GeocodeOptions` with the comment "Restricts results to one country (ISO alpha-2). A filter, unlike `viewbox`." Add `forwardAddress` to `Geocoder` with the comment "Structured lookup of a caller-authored address (Location.address). Never free-text: a structured query cannot match a same-named place in another country."

`locationiq.ts`: split the current body into a shared `search(params: Record<string,string>, opts)` helper that sets `key`, `format`, `addressdetails`, `accept-language`, `limit`, `viewbox` and `countrycodes`, fetches, maps rows, and returns `[]` on a 404 whose body is `{ error: "Unable to geocode" }`. Then:

```ts
async forward(query, opts) {
  return search({ q: query }, opts);
},
async forwardAddress(address, opts) {
  const params: Record<string, string> = { street: address.lines.join(", ") };
  if (address.locality) params.city = address.locality;
  if (address.administrativeArea) params.state = address.administrativeArea;
  if (address.postalCode) params.postalcode = address.postalCode;
  // dependentLocality has no structured param in the Nominatim family; it is
  // dropped from the query (still stored on the Location) rather than
  // concatenated into `street`, where it would make a house-level match fail.
  return search(params, { ...opts, countryCode: address.countryCode });
},
```

In `search`: `if (opts?.countryCode) url.searchParams.set("countrycodes", opts.countryCode.toLowerCase());`

- [x] **Step 3: Fix fakes, run, prove**

Run: `pnpm --filter web typecheck`. Every `Geocoder` fake missing `forwardAddress` fails here. Add `forwardAddress: async () => []` (or `vi.fn(async () => [])`) to each.
Run: `pnpm --filter web test -- src/server/geocoding src/server/ai/geocodeEnrichment.test.ts src/server/ai/writeTools.test.ts`
Expected: PASS. Prove it: make `forwardAddress` send `q` instead of `street`, watch the first test go red, restore.

- [x] **Step 4: Commit**

```bash
git add apps/web/src/server/geocoding apps/web/src/server/ai apps/web/src/app/api/trips
git commit -m "geocoding: structured address lookup and country filter behind the Geocoder port"
```

---

### Task 3: `resolveStopLocation` — the resolution order, quota-charged

**Files:**
- Create: `apps/web/src/server/public-api/locations.ts`
- Test: `apps/web/src/server/public-api/locations.test.ts` (unit, no DB, dependencies injected)

**Interfaces:**
- Consumes: `Location`, `GeocodeOutcome` (Task 1); `Geocoder.forward/forwardAddress`, `GeocodeOptions.countryCode` (Task 2); `getGeocoder` (`@/server/geocoding`); `consumeQuota`, `geocodeQuota` (`@/server/quota`); `BoundingBox` (`@/server/geocoding`).
- Produces:
  ```ts
  export interface LocationResolution { location: Location; outcome: GeocodeOutcome }
  export interface ResolveDeps {
    geocoder: () => Geocoder;                                // may throw (no API key) → "unavailable"
    charge: (userId: string) => Promise<{ allowed: true } | { allowed: false; reason: string }>;
  }
  export const defaultResolveDeps: ResolveDeps;
  export function resolveStopLocation(
    input: Location, ctx: { userId: string; region: BoundingBox | null }, deps?: ResolveDeps,
  ): Promise<LocationResolution>;
  ```

Before writing, open `apps/web/src/server/quota.ts` and read the exact return type of `consumeQuota`. It has `allowed`, and `reason: "unavailable"` when the counter store fails (see `route.ts` `decision.reason === "unavailable"`). Make `charge`'s type match it exactly and adjust the snippet below if the refusal carries more fields.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import type { Geocoder } from "@/server/geocoding";
import { resolveStopLocation, type ResolveDeps } from "./locations";

const HIT = { lat: 49.41, lng: 8.69, canonicalName: "Hauptstraße 5, 69117 Heidelberg, Germany", countryCode: "DE", city: "Heidelberg", area: "Altstadt" };
const ctx = { userId: "u1", region: null };

function deps(overrides: Partial<Geocoder> = {}, allowed = true, reason = "limit"): ResolveDeps & { g: Geocoder; charge: ReturnType<typeof vi.fn> } {
  const g: Geocoder = { forward: vi.fn(async () => [HIT]), forwardAddress: vi.fn(async () => [HIT]), ...overrides };
  const charge = vi.fn(async () => (allowed ? { allowed: true as const } : { allowed: false as const, reason }));
  return { geocoder: () => g, charge, g };
}

describe("resolveStopLocation", () => {
  it("explicit coordinates win: no lookup, no quota charge, address kept", async () => {
    const d = deps();
    const input = { name: "Museum", lat: 1, lng: 2, address: { countryCode: "DE", lines: ["Hauptstraße 5"] } };
    const r = await resolveStopLocation(input, ctx, d);
    expect(r).toEqual({ location: input, outcome: "provided" });
    expect(d.charge).not.toHaveBeenCalled();
    expect(d.g.forward).not.toHaveBeenCalled();
    expect(d.g.forwardAddress).not.toHaveBeenCalled();
  });

  it("an address beats a name, and the caller's name and address are kept verbatim", async () => {
    const d = deps();
    const address = { countryCode: "DE", lines: ["Hauptstraße 5"], locality: "Heidelberg" };
    const r = await resolveStopLocation({ name: "Dinner", address }, ctx, d);
    expect(r.outcome).toBe("address");
    expect(d.g.forwardAddress).toHaveBeenCalledWith(address, { limit: 1 });
    expect(d.g.forward).not.toHaveBeenCalled();
    expect(r.location).toEqual({ name: "Dinner", address, lat: 49.41, lng: 8.69, countryCode: "DE", city: "Heidelberg", area: "Altstadt" });
    expect(r.location.precision).toBeUndefined(); // absent = unknown; we did not verify granularity
  });

  it("a name alone is geocoded, biased to the trip region and the caller's country", async () => {
    const d = deps();
    const region = { minLat: 34, maxLat: 36, minLng: 135, maxLng: 136 };
    const r = await resolveStopLocation({ name: "Fushimi Inari", countryCode: "JP" }, { userId: "u1", region }, d);
    expect(r.outcome).toBe("name");
    expect(d.g.forward).toHaveBeenCalledWith("Fushimi Inari", { limit: 1, viewbox: region, countryCode: "JP" });
    expect(r.location.countryCode).toBe("JP"); // the caller's value wins over the vendor's
  });

  it("charges the quota exactly once per lookup, to the token owner", async () => {
    const d = deps();
    await resolveStopLocation({ name: "X" }, ctx, d);
    expect(d.charge).toHaveBeenCalledTimes(1);
    expect(d.charge).toHaveBeenCalledWith("u1");
  });

  it("no match: saved unchanged, flagged no-match", async () => {
    const d = deps({ forward: vi.fn(async () => []) });
    const r = await resolveStopLocation({ name: "Nowhere" }, ctx, d);
    expect(r).toEqual({ location: { name: "Nowhere" }, outcome: "no-match" });
  });

  it("quota spent: no vendor call, flagged quota-exhausted", async () => {
    const d = deps({}, false, "limit");
    const r = await resolveStopLocation({ name: "X" }, ctx, d);
    expect(r.outcome).toBe("quota-exhausted");
    expect(d.g.forward).not.toHaveBeenCalled();
  });

  it("quota store down: fails closed as unavailable, no vendor call", async () => {
    const d = deps({}, false, "unavailable");
    const r = await resolveStopLocation({ name: "X" }, ctx, d);
    expect(r.outcome).toBe("unavailable");
    expect(d.g.forward).not.toHaveBeenCalled();
  });

  it("vendor throws or geocoder unconfigured: saved unchanged, flagged unavailable, never throws", async () => {
    const throwing = deps({ forward: vi.fn(async () => { throw new Error("geocode failed: 500"); }) });
    await expect(resolveStopLocation({ name: "X" }, ctx, throwing)).resolves.toEqual({ location: { name: "X" }, outcome: "unavailable" });
    const unconfigured: ResolveDeps = { geocoder: () => { throw new Error("LOCATIONIQ_API_KEY is not set"); }, charge: vi.fn(async () => ({ allowed: true as const })) };
    await expect(resolveStopLocation({ name: "X" }, ctx, unconfigured)).resolves.toEqual({ location: { name: "X" }, outcome: "unavailable" });
  });
});
```

Run: `pnpm --filter web test -- src/server/public-api/locations.test.ts`
Expected: FAIL (module not found).

- [x] **Step 2: Implement `locations.ts`**

```ts
import type { GeocodeOutcome, Location } from "@tc/contracts";
import { getGeocoder, type BoundingBox, type Geocoder, type GeocodeResult } from "@/server/geocoding";
import { consumeQuota, geocodeQuota } from "@/server/quota";

// **The v1 stop-write resolution order** (decided with Mitchell, 2026-09-18):
// explicit coordinates → a geocoded address → a geocoded name → saved without
// coordinates and flagged. This is ADR-007's "pre-command enrichment": the
// domain only ever stores coordinates it is handed.
//
// **Never throws, never fails the write.** A stop an agent meant to create is
// worth more saved without a pin than refused because a vendor was down.
//
// **Charged before the vendor is called**, against the same per-user and global
// daily ceilings as the in-app search (`geocodeQuota`), so v1 cannot spend the
// LocationIQ allowance past them (unlike the assistant path, KI-093).
//
// **The caller's words win.** `name` and `address` are kept as sent; geocoding
// only adds lat/lng and fills country/city/area the caller left empty.
// `precision` stays absent (= unknown): nothing here checks what granularity
// the vendor's point describes.

export interface LocationResolution {
  location: Location;
  outcome: GeocodeOutcome;
}

export interface ResolveDeps {
  geocoder: () => Geocoder;
  charge: (userId: string) => Promise<{ allowed: boolean; reason?: string }>;
}

export const defaultResolveDeps: ResolveDeps = {
  geocoder: getGeocoder,
  charge: (userId) => consumeQuota(geocodeQuota(), userId),
};

export async function resolveStopLocation(
  input: Location,
  ctx: { userId: string; region: BoundingBox | null },
  deps: ResolveDeps = defaultResolveDeps,
): Promise<LocationResolution> {
  if (input.lat !== undefined) return { location: input, outcome: "provided" };

  let decision;
  try {
    decision = await deps.charge(ctx.userId);
  } catch {
    return { location: input, outcome: "unavailable" };
  }
  if (!decision.allowed) {
    return { location: input, outcome: decision.reason === "unavailable" ? "unavailable" : "quota-exhausted" };
  }

  let match: GeocodeResult | undefined;
  const outcome: GeocodeOutcome = input.address ? "address" : "name";
  try {
    const geocoder = deps.geocoder();
    [match] = input.address
      ? await geocoder.forwardAddress(input.address, { limit: 1 })
      : await geocoder.forward(input.name, {
          limit: 1,
          ...(ctx.region ? { viewbox: ctx.region } : {}),
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        });
  } catch {
    return { location: input, outcome: "unavailable" };
  }
  if (!match) return { location: input, outcome: "no-match" };

  const countryCode = input.countryCode ?? input.address?.countryCode ?? match.countryCode;
  const city = input.city ?? match.city;
  const area = input.area ?? match.area;
  return {
    location: {
      ...input,
      lat: match.lat,
      lng: match.lng,
      ...(countryCode ? { countryCode } : {}),
      ...(city ? { city } : {}),
      ...(area ? { area } : {}),
    },
    outcome,
  };
}
```

If `quota.ts`'s refusal reason for an exceeded limit is something other than a non-`"unavailable"` string, adjust the `reason` comparison to the real values, and make the test's `reason` argument match them.

- [x] **Step 3: Run, prove, commit**

Run: `pnpm --filter web test -- src/server/public-api/locations.test.ts`. Expected: PASS.
Prove it: swap the order so `name` is tried before `address`, and confirm "an address beats a name" goes red. Move `charge` after the vendor call, and confirm "quota spent: no vendor call" goes red. Restore both.

```bash
git add apps/web/src/server/public-api/locations.ts apps/web/src/server/public-api/locations.test.ts
git commit -m "public-api: resolveStopLocation — coords, then address, then name; quota-charged, never fails a write"
```

---

### Task 4: Response headers through `route()`, and the stop endpoints resolve locations

**Files:**
- Modify: `apps/web/src/server/public-api/route.ts` (`BaseDef`, `HandlerContext`, `declare()`)
- Modify: `apps/web/src/server/public-api/openapi.ts` (success response `headers`)
- Modify: `apps/web/src/app/api/v1/trips/[tripId]/activities/route.ts`
- Modify: `apps/web/src/app/api/v1/trips/[tripId]/activities/[activityId]/route.ts`
- Test: `apps/web/src/server/public-api/locations.int.test.ts` (create; real Postgres, geocoder mocked)

**Interfaces:**
- Consumes: `resolveStopLocation` (Task 3), `GEOCODE_OUTCOME_HEADER`, `GeocodeOutcome` (Task 1), `tripRegionOf` (`@/server/ai/geocodeRegion`).
- Produces:
  - `HandlerContext.responseHeaders: Headers`. The handler may set headers, and the wrapper sends them on success **and** on a `PublicApiError` refusal (Task 5 uses that for `Retry-After`).
  - `BaseDef.responseHeaders?: Readonly<Record<string, string>>`, a header name → description map published in `openapi.json`.

- [x] **Step 1: Write the failing integration test**

Create `locations.int.test.ts`. Copy the setup verbatim from `surface.int.test.ts` lines 1–90 (the `auth` mock, `entitled()`, `tokenFor()`, `req()`, `P()`, and `seed()` minus its stop). Add a geocoder mock **before** the route imports:

```ts
const forward = vi.fn(async () => [] as unknown[]);
const forwardAddress = vi.fn(async () => [] as unknown[]);
vi.mock("@/server/geocoding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/geocoding")>()),
  getGeocoder: () => ({ forward, forwardAddress }),
}));
```

Tests (each seeds its own trip + day through v1, with a `trips:write` + `trips:read` token):

```ts
const HEIDELBERG = { lat: 49.41, lng: 8.69, canonicalName: "Hauptstraße 5, Heidelberg", countryCode: "DE", city: "Heidelberg" };

it("POST with an address and no coordinates stores geocoded coordinates and the address, and says so", async () => {
  forwardAddress.mockResolvedValueOnce([HEIDELBERG]);
  const address = { countryCode: "DE", lines: ["Hauptstraße 5"], locality: "Heidelberg", postalCode: "69117" };
  const res = await ADD_STOP(req(secret, { title: "Dinner", dayId, location: { name: "Dinner", address } }, "POST"), P({ tripId }));
  expect(res.status).toBe(201);
  expect(res.headers.get("Geocode-Outcome")).toBe("address");
  const detail = await res.json();
  const stop = Object.values(detail.activities)[0] as { location: Record<string, unknown> };
  expect(stop.location).toMatchObject({ name: "Dinner", lat: 49.41, lng: 8.69, address });
});

it("POST with coordinates never calls the geocoder", async () => {
  const res = await ADD_STOP(req(secret, { title: "Pin", location: { name: "Pin", lat: 35, lng: 135 } }, "POST"), P({ tripId }));
  expect(res.headers.get("Geocode-Outcome")).toBe("provided");
  expect(forward).not.toHaveBeenCalled();
  expect(forwardAddress).not.toHaveBeenCalled();
});

it("a geocode miss still creates the stop, without coordinates, flagged no-match", async () => {
  forward.mockResolvedValueOnce([]);
  const res = await ADD_STOP(req(secret, { title: "Mystery", location: { name: "Nowhere-at-all" } }, "POST"), P({ tripId }));
  expect(res.status).toBe(201);
  expect(res.headers.get("Geocode-Outcome")).toBe("no-match");
  const stop = Object.values((await res.json()).activities)[0] as { location: Record<string, unknown> };
  expect(stop.location.lat).toBeUndefined();
});

it("a stop with no location sends no Geocode-Outcome header and spends nothing", async () => {
  const res = await ADD_STOP(req(secret, { title: "Free time" }, "POST"), P({ tripId }));
  expect(res.headers.get("Geocode-Outcome")).toBeNull();
  expect(forward).not.toHaveBeenCalled();
});

it("PATCH with a new name-only location geocodes it; PATCH location:null clears without a lookup", async () => {
  // create a stop without location first, then:
  forward.mockResolvedValueOnce([HEIDELBERG]);
  const patched = await PATCH_STOP(req(secret, { location: { name: "Heidelberg Castle" } }, "PATCH"), P({ tripId, activityId }));
  expect(patched.status).toBe(200);
  expect(patched.headers.get("Geocode-Outcome")).toBe("name");
  const cleared = await PATCH_STOP(req(secret, { location: null }, "PATCH"), P({ tripId, activityId }));
  expect(cleared.headers.get("Geocode-Outcome")).toBeNull();
  expect(forward).toHaveBeenCalledTimes(1);
});

it("a mismatched countryCode/address is a 400 before any lookup", async () => {
  const res = await ADD_STOP(
    req(secret, { title: "X", location: { name: "X", countryCode: "FR", address: { countryCode: "GB", lines: ["1 A St"] } } }, "POST"),
    P({ tripId }),
  );
  expect(res.status).toBe(400);
  expect(forwardAddress).not.toHaveBeenCalled();
});
```

Add `beforeEach(() => { forward.mockReset(); forwardAddress.mockReset(); forward.mockResolvedValue([]); forwardAddress.mockResolvedValue([]); })`.

Run: `pnpm --filter web test:int -- src/server/public-api/locations.int.test.ts` (needs local Postgres; check with `docker ps` first, per the repo memory. Fresh worktrees also need `.env.local`.)
Expected: FAIL (header is null, and coordinates are absent).

- [x] **Step 2: Implement headers in `route()`**

In `route.ts`:
- `BaseDef`: add
  ```ts
  /** Response headers this endpoint may set, name → description, published in openapi.json. */
  readonly responseHeaders?: Readonly<Record<string, string>>;
  ```
- `HandlerContext`: add
  ```ts
  /**
   * Headers the handler wants on its response. Sent on success and on a
   * deliberate `PublicApiError` refusal (e.g. `Retry-After` on a 429), never on
   * a 500 — a crashed handler's half-set headers describe nothing.
   */
  readonly responseHeaders: Headers;
  ```
- In `declare()`: `const responseHeaders = new Headers();` and pass it into `base`. In the `PublicApiError` branch, pass `headers: Object.fromEntries(responseHeaders)` into `fail(...)`. In the final `Response.json(...)`, add `headers: responseHeaders`.

In `openapi.ts`, inside the success response object:
```ts
...(def.responseHeaders === undefined
  ? {}
  : {
      headers: Object.fromEntries(
        Object.entries(def.responseHeaders).map(([name, description]) => [name, { description, schema: { type: "string" } }]),
      ),
    }),
```

- [x] **Step 3: Wire the stop routes**

Shared description string, defined once in `locations.ts` (Task 3's file) and exported:

```ts
export const GEOCODE_OUTCOME_DOC =
  "Present when the body carried a `location`. One of: provided (you sent lat/lng), address, name " +
  "(coordinates were geocoded from that field), no-match, quota-exhausted, unavailable (the stop was " +
  "saved without coordinates — send lat/lng, or look them up with GET /v1/trips/{tripId}/geocode).";
```

`activities/route.ts`: add `responseHeaders: { [GEOCODE_OUTCOME_HEADER]: GEOCODE_OUTCOME_DOC }`, and in `handle`:

```ts
handle: async ({ actor, params, body, trip, responseHeaders }) => {
  const b = body as { location?: Location } & Record<string, unknown>;
  let location = b.location;
  if (location) {
    const resolved = await resolveStopLocation(location, { userId: actor.userId, region: tripRegionOf(trip!) });
    location = resolved.location;
    responseHeaders.set(GEOCODE_OUTCOME_HEADER, resolved.outcome);
  }
  return orThrow(
    await runCommand(actor, {
      ...b,
      ...(location ? { location } : {}),
      type: "AddActivity",
      tripId: params["tripId"]!,
      activityId: randomUUID(),
    } as Parameters<typeof runCommand>[1]),
  );
},
```

`[activityId]/route.ts` PATCH: before the `fields` → `UpdateActivity` push, do the same when `fields.location` is a non-null object (`typeof fields.location === "object" && fields.location !== null`), replacing `fields.location` with the resolved one. Leave `location: null` and absent untouched. Add the same `responseHeaders` declaration to PATCH only (not DELETE).

Note: the header is set even if the command is then refused (a 400 from the domain), because the lookup already happened and was charged. That is accurate, since the header describes the location, not the write.

- [x] **Step 4: Run, prove, commit**

Run: `pnpm --filter web test:int -- src/server/public-api/locations.int.test.ts src/server/public-api/surface.int.test.ts src/server/public-api/route.int.test.ts`
Expected: PASS.
Run: `pnpm --filter web test -- src/server/public-api/openapi.test.ts`. Expected: FAIL, because the committed spec is stale. That is correct; Task 6 regenerates it. (Or run `pnpm --filter web openapi:generate` now and commit the spec with this task. Either works, but do it before the branch leaves draft.)
Prove it: remove `responseHeaders.set(...)` in the POST route, watch the "address" test go red on the header assertion, restore.

```bash
git add apps/web/src/server/public-api apps/web/src/app/api/v1/trips
git commit -m "v1: stop writes resolve locations (coords → address → name) and report Geocode-Outcome"
```

---

### Task 5: `GET /v1/trips/{tripId}/geocode`

**Files:**
- Create: `apps/web/src/app/api/v1/trips/[tripId]/geocode/route.ts`
- Test: append to `apps/web/src/server/public-api/locations.int.test.ts`

**Interfaces:**
- Consumes: `GeocodeCandidates` (Task 1), `Geocoder.forward` with `countryCode` (Task 2), `defaultResolveDeps.charge` (Task 3), `responseHeaders` (Task 4), `tripRegionOf`, `PublicApiError`.
- Produces: `GET /v1/trips/{tripId}/geocode?q=<1..200 chars>&countryCode=<XX>` → `200 { results: Location[] }` (up to 5). `429` + `Retry-After` when the geocode quota is spent. `503` when the geocoder is unconfigured, the vendor fails, or the quota store is down.

- [x] **Step 1: Write the failing tests** (in `locations.int.test.ts`; import `{ GET: GEOCODE }` from the new route)

```ts
it("returns Location-shaped candidates that POST /activities accepts unchanged", async () => {
  forward.mockResolvedValueOnce([HEIDELBERG]);
  const res = await GEOCODE(new Request("http://localhost/x?q=Heidelberg&countryCode=DE", { headers: { authorization: `Bearer ${secret}` } }), P({ tripId }));
  expect(res.status).toBe(200);
  const { results } = await res.json();
  expect(results[0]).toEqual({ name: "Hauptstraße 5, Heidelberg", lat: 49.41, lng: 8.69, countryCode: "DE", city: "Heidelberg" });
  expect(forward).toHaveBeenCalledWith("Heidelberg", expect.objectContaining({ limit: 5, countryCode: "DE" }));

  const stop = await ADD_STOP(req(secret, { title: "Castle", location: results[0] }, "POST"), P({ tripId }));
  expect(stop.status).toBe(201);
  expect(stop.headers.get("Geocode-Outcome")).toBe("provided");
});

const geocodeReq = (token: string, qs: string) =>
  new Request(`http://localhost/x?${qs}`, { headers: { authorization: `Bearer ${token}` } });

it("works with a trip-scoped token (the kind an agent is usually handed)", async () => {
  const minted = await mintToken(owner, { name: "agent", scopes: ["trips:write"], tripIds: [tripId], expiresInDays: 30 });
  expect(minted.ok).toBe(true);
  forward.mockResolvedValueOnce([HEIDELBERG]);
  const res = await GEOCODE(geocodeReq(minted.ok ? minted.created.secret : "", "q=Heidelberg"), P({ tripId }));
  expect(res.status).toBe(200);
});

it("a read-only token is refused: looking up spends the operator's allowance", async () => {
  const readOnly = await tokenFor(owner, ["trips:read"]);
  const res = await GEOCODE(geocodeReq(readOnly, "q=Heidelberg"), P({ tripId }));
  expect(res.status).toBe(403);
  expect((await res.json()).error.code).toBe("insufficient-scope");
  expect(forward).not.toHaveBeenCalled();
});

it("empty q is a 400 and spends nothing", async () => {
  const res = await GEOCODE(geocodeReq(secret, "q="), P({ tripId }));
  expect(res.status).toBe(400);
  expect(forward).not.toHaveBeenCalled();
});

it("a spent geocode quota is a 429 with Retry-After", async () => {
  // Read envCeiling in quota.ts first: it must read the env per call (not cache
  // at import), and "1" must mean one allowed request. Adjust if either is false.
  vi.stubEnv("GEOCODE_RATE_LIMIT_PER_USER_DAILY", "1");
  const fresh = await entitled(); // a fresh user, so earlier tests' charges don't count
  const freshTrip = await seedTripFor(fresh); // same as seed(): CREATE_TRIP with that user's token
  const token = await tokenFor(fresh, ["trips:write", "trips:read"]);
  forward.mockResolvedValue([HEIDELBERG]);
  expect((await GEOCODE(geocodeReq(token, "q=Heidelberg"), P({ tripId: freshTrip }))).status).toBe(200);
  const res = await GEOCODE(geocodeReq(token, "q=Heidelberg"), P({ tripId: freshTrip }));
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).not.toBeNull();
  expect(forward).toHaveBeenCalledTimes(1);
  vi.unstubAllEnvs();
});
```

`owner` and `secret` are the `entitled()` user and its `trips:write`+`trips:read` token from the file's `beforeAll`. `seedTripFor(userId)` is a one-line helper: mint a token for the user and `CREATE_TRIP` with it, returning `tripId`.

Run: `pnpm --filter web test:int -- src/server/public-api/locations.int.test.ts`. Expected: FAIL (module not found).

- [x] **Step 2: Implement the route**

```ts
import { z } from "zod";
import { GeocodeCandidates, type Location } from "@tc/contracts";
import { getGeocoder } from "@/server/geocoding";
import { tripRegionOf } from "@/server/ai/geocodeRegion";
import { defaultResolveDeps } from "@/server/public-api/locations";
import { PublicApiError } from "@/server/public-api/commands";
import { route } from "@/server/public-api/route";

// **Name or address text in, coordinates out** — so a caller can check a place
// before writing it, or pick between candidates. Each result is a `Location`,
// so it can be sent back as a stop's `location` unchanged (and then costs no
// second lookup: it carries lat/lng).
//
// **Trip-scoped on purpose.** `route()` refuses a trip-scoped token on an
// endpoint with no trip, and that is the token an agent building one trip holds;
// the trip also gives the lookup a region to prefer. `trips:write` + editor
// because its only use is writing stops, and each call spends the operator's
// LocationIQ allowance (charged to `geocodeQuota`, same ceilings as the in-app
// search) — a read-only token has no business spending it.
//
// Not a collection: vendor results are not pageable, so there is no cursor. The
// top 5 is the whole answer.
const Query = z.object({
  q: z.string().trim().min(1).max(200),
  countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
});

export const { GET } = route({
  GET: {
    scope: "trips:write",
    trip: "path",
    role: "editor",
    query: Query,
    response: GeocodeCandidates,
    responseHeaders: { "Retry-After": "On a 429: seconds until the daily geocode allowance resets." },
    handle: async ({ actor, query, trip, responseHeaders }) => {
      const { q, countryCode } = query as z.infer<typeof Query>;
      const decision = await defaultResolveDeps.charge(actor.userId);
      if (!decision.allowed) {
        if (decision.reason === "unavailable") throw new PublicApiError(503, "Geocoding is unavailable. Try again shortly.", "service-unavailable");
        if ("retryAfterSeconds" in decision) responseHeaders.set("Retry-After", String(decision.retryAfterSeconds));
        throw new PublicApiError(429, "The daily geocoding allowance for this account is used up.", "rate-limited");
      }
      let results;
      try {
        const region = tripRegionOf(trip!);
        results = await getGeocoder().forward(q, {
          limit: 5,
          ...(region ? { viewbox: region } : {}),
          ...(countryCode ? { countryCode } : {}),
        });
      } catch {
        throw new PublicApiError(503, "Geocoding is unavailable. Try again shortly.", "service-unavailable");
      }
      return {
        results: results.map<Location>((r) => ({
          name: r.canonicalName.slice(0, 200), // Location.name max is 200; display_name can be longer
          lat: r.lat,
          lng: r.lng,
          ...(r.countryCode ? { countryCode: r.countryCode } : {}),
          ...(r.city ? { city: r.city } : {}),
          ...(r.area ? { area: r.area } : {}),
        })),
      };
    },
  },
});
```

Make `ResolveDeps.charge`'s return type (Task 3) carry `retryAfterSeconds?: number` if `consumeQuota` returns it, so the `in` check becomes a plain property read.

- [x] **Step 3: Run, prove, commit**

Run: `pnpm --filter web test:int -- src/server/public-api/locations.int.test.ts` and `pnpm --filter web test -- src/server/public-api/conformance.test.ts`. Expected: PASS. The conformance test walks `v1/**`, so it covers the new route automatically.
Prove it: change `scope` to `trips:read`, watch the read-only-token test go red, restore. Remove the `.slice(0, 200)` and feed a 250-char `canonicalName`; the response-schema check answers 500. Add that as a test if it isn't already covered.

```bash
git add apps/web/src/app/api/v1/trips/[tripId]/geocode apps/web/src/server/public-api
git commit -m "v1: GET /trips/{tripId}/geocode — Location-shaped candidates, quota-charged"
```

---

### Task 6: Publish it — OpenAPI, the API guide, status

**Files:**
- Modify: `apps/web/src/app/api/v1/openapi.json` (generated)
- Modify: `docs/guidelines/using-the-api.md` (new section under "## For a caller")
- Modify: `docs/STATUS.md` (one line under M22, if STATUS tracks post-gate follow-ups; follow its existing format)

- [x] **Step 1: Regenerate the spec**

Run: `pnpm --filter web openapi:generate`, then `pnpm --filter web test -- src/server/public-api/openapi.test.ts`. Expected: PASS.
Check the diff of `openapi.json` shows: `address` under both stop bodies, the `lat` description, the `Geocode-Outcome` response header on POST/PATCH activities, and the new `/v1/trips/{tripId}/geocode` path.

- [x] **Step 2: Write the guide section**

Add `### Putting a stop on the map` under "## For a caller" in `using-the-api.md`:

````md
### Putting a stop on the map

A stop's `location` can carry coordinates, a postal address, or just a name.
The map draws coordinates only, so on `POST`/`PATCH …/activities` the server
fills them in when you leave them out, in this order:

1. **`lat` + `lng`** — used as sent. No lookup. Send both or neither.
2. **`address`** — geocoded as a structured address.
3. **`name`** — geocoded as free text, preferring places near the trip's other stops
   (and inside `countryCode`, if you set it).

If the lookup finds nothing, the stop is **still created**, without coordinates.
Every write whose body had a `location` answers with a `Geocode-Outcome` header:
`provided`, `address`, `name`, `no-match`, `quota-exhausted` or `unavailable`.
Lookups count against your account's daily geocoding allowance.

```json
{
  "title": "Dinner",
  "location": {
    "name": "Zum Roten Ochsen",
    "address": {
      "countryCode": "DE",
      "lines": ["Hauptstraße 217"],
      "locality": "Heidelberg",
      "postalCode": "69117"
    }
  }
}
```

**Addresses are structured, not one string.** `lines` is the street-level
part in the country's own order (`["221B Baker Street"]`, `["Hauptstraße 5"]`,
`["1-2-3 Nishi-Azabu"]`); `countryCode` (ISO alpha-2) is required; `locality`,
`dependentLocality`, `administrativeArea` and `postalCode` (a string) are
optional. The address is stored exactly as you send it.

**To check a place before writing it**, `GET /v1/trips/{tripId}/geocode?q=…`
(optionally `&countryCode=JP`) returns up to five candidates. Each is a complete
`location`: send one back as-is and the write costs no second lookup.
Needs `trips:write`.
````

- [x] **Step 3: Final verification (the branch leaves draft here)**

This branch changes code, so per CLAUDE.md rule 4 the full suite runs once here: `pnpm check`. Report the real output. Then dispatch `phase-verifier` against the PR's Vercel preview to call the three write paths and the geocode endpoint over real HTTP with a real token. Local runs have no LocationIQ key (repo memory), so the preview is the first place a real vendor answer is seen. Confirm the Step 0 parameter names from Task 2 against a real response there.

**Done, 2026-09-18.** `pnpm check` passes — 7 typechecks, lint and every wall
script, 2889 unit tests across 210 files, and the 704-test integration lane
against real Postgres.

**The vendor contract is now proven against a live LocationIQ answer**, on PR
189's preview at `1dc2898`, with a real `trips:write` token. Until this ran, no
LocationIQ response had ever been seen by this code — the key is empty locally
and every test mocks the geocoder — so Task 2's two corrections rested on the
vendor's published OpenAPI spec alone (`docs.locationiq.com` is blocked by the
container's egress proxy, so the mirrored spec was the source). Both now hold
against the real thing.

`POST /v1/trips/{id}/activities` with a structured address and no coordinates —
the only call that exercises `forwardAddress()` and therefore
`/v1/search/structured`:

```
geocode-outcome: address
"location": {
  "name": "Zum Roten Ochsen",
  "lat": 49.4128069, "lng": 8.713394,
  "countryCode": "DE", "city": "Heidelberg", "area": "Altstadt",
  "address": { "countryCode": "DE", "lines": ["Hauptstraße 217"],
               "locality": "Heidelberg", "postalCode": "69117" }
}
```

What that one response settles, beyond the header:

- The structured endpoint accepts `street` / `city` / `postalcode` /
  `countrycodes` as the adapter sends them. Had the params been wrong the
  outcome would have read `no-match`, not `address`.
- The point is a street-level match in the Altstadt, distinctly off Heidelberg's
  centroid — so the structured query resolved the building, not the city.
- `city` and `area` came through the `addressdetails=1` settlement and
  sub-settlement chains correctly.
- The caller's `address` came back byte-identical, `ß` intact. Nothing was
  rebuilt from vendor output, which is decision 6's whole point.
- `Location`'s countryCode/address refine held on a real vendor answer, not just
  on fixtures.
- `precision` is absent, as designed: nothing here verified granularity, so
  nothing claims it.

**Also observed, not a defect:** four identical POSTs created four separate
stops, each spending its own geocode charge. Correct — POST is not idempotent
and each mints its own `activityId` — but there is no dedupe or cache on this
path, so an agent retrying a write burns quota per attempt. Worth knowing before
anyone builds a retry loop on it.

**Not walked, and not needed to call this done:** the name-only, no-match,
no-location, 400-mismatch, geocode-endpoint and round-trip cases. Each is
covered by `locations.int.test.ts` against real Postgres, and each exercises
`forward()` — the pre-existing free-text path the in-app search has used since
ADR-007. `forwardAddress()` was the only genuinely unproven vendor interaction,
and it is the one that ran.

- [x] **Step 4: Commit**

```bash
git add apps/web/src/app/api/v1/openapi.json docs/guidelines/using-the-api.md docs/STATUS.md
git commit -m "docs(api): putting a stop on the map — resolution order, address shape, geocode endpoint"
```

---

## Out of scope (recorded so nobody "helpfully" adds it)

- Rendering or editing the address in the app (decision 4). A follow-up needs a mockup first (Mitchell's rule: show UI decisions visually).
- Assistant enrichment reading `address` (decision 3).
- Building `address` from vendor output, i.e. reverse geocoding into `lines` (decision 6).
- A `geocode` scope. It would need `SCOPE_CATALOGUE` copy and token-UI changes; reuse `trips:write` until someone asks.

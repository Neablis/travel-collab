# KI-15 Geocode Enrichment Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `enrichCommandLocations` from silently relocating correctly-placed
activities to the wrong continent and from silently dropping most lookups to a
rate limit — before PR #21 merges.

**Architecture:** Three independent defects, three independent fixes, all inside
the existing ADR-007 geocoder seam. (1) **Bias + accept:** the geocoder is given
a viewbox drawn from trip context, and its answer is *accepted only if it agrees
with what we already believed* — enrichment may refine a location, never
relocate it. (2) **Throttle:** the `Promise.all` burst becomes a sequential
runner spaced to LocationIQ's real 2 req/sec limit. (3) **Surface:** enrichment
returns a report of what it verified, could not verify, and failed to look up,
and `handleAiRequest` folds that into the same `withNotices` channel the
`skipped`/`truncated` notices already use.

This does **not** implement M9's "Grounding" (`SearchPlaces` + `placeRef`).
KI-15 stays open, downgraded: the architecture still launders a model guess into
a stored fact — it just can no longer do so confidently, silently, or 5,500 km
off. Task 6 rewrites the KI-15 entry to say exactly that.

**Tech Stack:** TypeScript, Next.js (App Router), Zod contracts, Vitest.

## Global Constraints

- **Invariant 4 / module map (AGENTS.md):** `apps/web/src/server/geocoding/`
  stays a pure vendor seam. Batch-shaped AI pipeline policy (dedupe, throttling,
  acceptance, reporting) lives under `apps/web/src/server/ai/`. The only change
  permitted in `geocoding/` is widening the `Geocoder.forward` options — that is
  a vendor capability, not policy.
- **No new dependencies.** The throttle and the distance math are ~40 lines
  each; do not add `p-limit`, `bottleneck`, `geolib`, or similar.
- **Enrichment stays best-effort.** No geocoding failure may ever fail the whole
  AI request. Every fallback path returns a valid `Location` (at minimum
  `{ name }`).
- **`Location` contract is unchanged.** `lat`/`lng` are optional but must be
  provided together (`packages/contracts/src/activity.ts:32`). No new field is
  added to the persisted contract — verification status is reported in the API
  response envelope only, never stored.
- **Definition of Done applies:** `pnpm check` green (typecheck + lint + unit),
  `pnpm test:int` green. `geocodeEnrichment.ts` shipped in PR #21 with **zero
  tests**; this plan closes that gap as a side effect and that is not optional.
- **Commit trailer:** every commit ends with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Branch:** all of this lands on `m8-wave-a`, before it merges to `main`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/web/src/server/ai/geocodeRegion.ts` | create | Pure geo predicates: plausibility, haversine distance, bounding boxes. No I/O. |
| `apps/web/src/server/ai/geocodeRegion.test.ts` | create | Unit tests for the above. |
| `apps/web/src/server/ai/rateLimit.ts` | create | `mapRateLimited` — sequential map with a minimum gap between calls. |
| `apps/web/src/server/ai/rateLimit.test.ts` | create | Unit tests, injected `sleep`, no real timers. |
| `apps/web/src/server/geocoding/geocoder.ts` | modify | Widen `forward` opts with an optional `viewbox`. |
| `apps/web/src/server/geocoding/locationiq.ts` | modify | Serialize `viewbox` into the vendor query. |
| `apps/web/src/server/geocoding/locationiq.test.ts` | modify | Assert the viewbox param is sent. |
| `apps/web/src/server/ai/geocodeEnrichment.ts` | modify | Orchestration: bias, throttle, accept/reject, report. |
| `apps/web/src/server/ai/geocodeEnrichment.test.ts` | create | The missing test file. Covers all of KI-15's reproductions. |
| `apps/web/src/server/ai/handleAiRequest.ts` | modify | Derive the trip region, thread the report into the user-facing notice. |
| `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts` | modify | Integration coverage for the notice. |
| `docs/known-issues.md` | modify | Rewrite KI-15 to what remains open. |
| `docs/STATUS.md` | modify | Wave A is done; record what shipped. |

---

### Task 1: Pure geo predicates

Everything that decides *whether a geocode result is believable* is arithmetic
with no I/O, so it goes in its own file and gets tested exhaustively without
mocks.

**Files:**
- Modify: `apps/web/src/server/geocoding/geocoder.ts` (add the two geo types)
- Modify: `apps/web/src/server/geocoding/index.ts` (re-export them)
- Create: `apps/web/src/server/ai/geocodeRegion.ts`
- Test: `apps/web/src/server/ai/geocodeRegion.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LatLng` and `BoundingBox` — **defined in
  `geocoding/geocoder.ts`**, re-exported from `geocodeRegion.ts` so callers can
  take everything from one import; plus `plausibleCoords(value)`,
  `distanceKm(a, b)`, `boundingBoxAround(points, marginKm)`,
  `withinBox(box, point)`.

> **Why the types live in `geocoding/`:** they are the vocabulary the geocoder
> seam itself speaks — Task 3 puts a `viewbox: BoundingBox` on
> `Geocoder.forward`. Defining them there and importing *upward* keeps every
> arrow pointing `ai/ → geocoding/`, which is what this plan's Global
> Constraint about the vendor seam requires. Do **not** define them in
> `geocodeRegion.ts` and import them downward into `geocoding/`.

Add to `apps/web/src/server/geocoding/geocoder.ts`, above `GeocodeResult`:

```ts
export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
```

and widen the re-export in `apps/web/src/server/geocoding/index.ts`:

```ts
export type { Geocoder, GeocodeResult, LatLng, BoundingBox } from "./geocoder";
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/server/ai/geocodeRegion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  boundingBoxAround,
  distanceKm,
  plausibleCoords,
  withinBox,
} from "./geocodeRegion";

describe("plausibleCoords", () => {
  it("accepts a real coordinate pair", () => {
    expect(plausibleCoords({ lat: 43.0866, lng: -79.0628 })).toEqual({ lat: 43.0866, lng: -79.0628 });
  });

  // The model's observed failure mode when it does not know a coordinate
  // (KI-15's predecessor run: lat 0, lng 0). Null Island is not a destination.
  it("rejects null island and its immediate neighborhood", () => {
    expect(plausibleCoords({ lat: 0, lng: 0 })).toBeNull();
    expect(plausibleCoords({ lat: 0.2, lng: -0.3 })).toBeNull();
  });

  it("rejects a partial or absent pair", () => {
    expect(plausibleCoords({ lat: 43.1 })).toBeNull();
    expect(plausibleCoords({ lng: -79.1 })).toBeNull();
    expect(plausibleCoords({})).toBeNull();
  });

  it("rejects non-finite values", () => {
    expect(plausibleCoords({ lat: Number.NaN, lng: 12 })).toBeNull();
    expect(plausibleCoords({ lat: 12, lng: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe("distanceKm", () => {
  it("is zero for the same point", () => {
    expect(distanceKm({ lat: 43.09, lng: -79.06 }, { lat: 43.09, lng: -79.06 })).toBe(0);
  });

  // The exact KI-15 failure: Niagara Falls NY vs. the Shropshire coaching inn.
  it("measures the Niagara-to-Shropshire mismatch in thousands of km", () => {
    const km = distanceKm({ lat: 43.0866, lng: -79.0628 }, { lat: 52.907918, lng: -2.8901 });
    expect(km).toBeGreaterThan(5000);
    expect(km).toBeLessThan(6000);
  });

  it("measures a same-metro refinement in tens of km", () => {
    const km = distanceKm({ lat: 43.0866, lng: -79.0628 }, { lat: 43.1566, lng: -77.6088 });
    expect(km).toBeGreaterThan(100);
    expect(km).toBeLessThan(130);
  });
});

describe("boundingBoxAround", () => {
  it("returns null with no points", () => {
    expect(boundingBoxAround([], 100)).toBeNull();
  });

  it("pads a single point by the margin", () => {
    const box = boundingBoxAround([{ lat: 43, lng: -79 }], 111)!;
    expect(box.minLat).toBeCloseTo(42, 1);
    expect(box.maxLat).toBeCloseTo(44, 1);
    // Longitude degrees shrink with latitude, so the lng margin is wider.
    expect(box.maxLng - box.minLng).toBeGreaterThan(box.maxLat - box.minLat);
  });

  it("spans every point plus the margin", () => {
    const box = boundingBoxAround(
      [
        { lat: 43.09, lng: -79.06 },
        { lat: 43.16, lng: -77.61 },
      ],
      50,
    )!;
    expect(box.minLat).toBeLessThan(43.09);
    expect(box.maxLat).toBeGreaterThan(43.16);
    expect(box.minLng).toBeLessThan(-79.06);
    expect(box.maxLng).toBeGreaterThan(-77.61);
  });

  it("clamps to the poles", () => {
    const box = boundingBoxAround([{ lat: 89.9, lng: 0 }], 500)!;
    expect(box.maxLat).toBe(90);
  });
});

describe("withinBox", () => {
  const box = { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 };

  it("accepts an interior point", () => {
    expect(withinBox(box, { lat: 43.09, lng: -79.06 })).toBe(true);
  });

  it("rejects an exterior point", () => {
    expect(withinBox(box, { lat: 52.9, lng: -2.89 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/ai/geocodeRegion.test.ts
```

Expected: FAIL — `Failed to resolve import "./geocodeRegion"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/server/ai/geocodeRegion.ts`:

```ts
// Pure geometry for deciding whether a geocode result is believable (KI-15).
// No I/O and no vendor knowledge — `geocoding/` stays the vendor seam, this is
// AI-pipeline policy. Everything here is plain arithmetic so it can be tested
// exhaustively without mocks.

// The geo vocabulary lives on the geocoder seam (it appears in
// `Geocoder.forward`'s options), and is re-exported here so callers of these
// predicates need only one import.
import type { BoundingBox, LatLng } from "@/server/geocoding";
export type { BoundingBox, LatLng };

// Half a degree around 0,0 — roughly 55 km of open water in the Gulf of Guinea.
// Nothing we plan a trip to is in there, and "lat 0, lng 0" is precisely what
// the model emits when it does not know a coordinate. Treating that band as
// "no answer" is what lets a real model-supplied coordinate be trusted as a
// hint further down.
const NULL_ISLAND_DEGREES = 0.5;

// Returns the pair only if BOTH halves are present, finite, and not the
// model's "I don't know" sentinel. Narrowing to `LatLng | null` (rather than a
// boolean predicate) means callers cannot forget to check.
export function plausibleCoords(value: { lat?: number | null; lng?: number | null }): LatLng | null {
  const { lat, lng } = value;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) < NULL_ISLAND_DEGREES && Math.abs(lng) < NULL_ISLAND_DEGREES) return null;
  return { lat, lng };
}

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE_LAT = 111;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Great-circle distance. Precision well beyond what an acceptance threshold
// measured in tens of km needs — the point is only ever "same place or not".
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Smallest lat/lng box containing every point, padded by `marginKm`.
//
// KNOWN LIMITATION: this does not handle the antimeridian — a trip spanning
// ±180° longitude (Fiji, NZ-to-Hawaii) produces a box covering the whole globe
// the long way round. That degrades to "no useful bias", which is the current
// behavior for every trip anyway, so it fails safe rather than wrong. Left
// unfixed deliberately; revisit with M9's grounding work.
export function boundingBoxAround(points: readonly LatLng[], marginKm: number): BoundingBox | null {
  if (points.length === 0) return null;

  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  const latMargin = marginKm / KM_PER_DEGREE_LAT;
  // A degree of longitude shrinks toward the poles; the floor keeps the
  // division from exploding at very high latitudes.
  const midLat = (minLat + maxLat) / 2;
  const kmPerDegreeLng = Math.max(1, KM_PER_DEGREE_LAT * Math.cos(toRadians(midLat)));
  const lngMargin = marginKm / kmPerDegreeLng;

  return {
    minLat: clamp(minLat - latMargin, -90, 90),
    maxLat: clamp(maxLat + latMargin, -90, 90),
    minLng: clamp(minLng - lngMargin, -180, 180),
    maxLng: clamp(maxLng + lngMargin, -180, 180),
  };
}

export function withinBox(box: BoundingBox, point: LatLng): boolean {
  return (
    point.lat >= box.minLat &&
    point.lat <= box.maxLat &&
    point.lng >= box.minLng &&
    point.lng <= box.maxLng
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/ai/geocodeRegion.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ai/geocodeRegion.ts apps/web/src/server/ai/geocodeRegion.test.ts
git commit -m "$(cat <<'EOF'
feat(ai): pure geo predicates for geocode acceptance (KI-15)

Plausibility (rejects the model's lat 0/lng 0 sentinel), haversine
distance, and margin-padded bounding boxes. No I/O — these are the
arithmetic half of "enrichment may refine a location, never relocate it".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: A rate-limited sequential map

`enrichCommandLocations` fires every unique name concurrently via `Promise.all`.
LocationIQ's free tier is **2 requests/second**, so a 9-name batch 429s on most
of them. This task builds the replacement runner in isolation.

**Files:**
- Create: `apps/web/src/server/ai/rateLimit.ts`
- Test: `apps/web/src/server/ai/rateLimit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mapRateLimited<T, R>(items, minIntervalMs, task, sleep?) => Promise<R[]>`,
  where `sleep` defaults to a real `setTimeout` and is injected in tests.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/server/ai/rateLimit.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mapRateLimited } from "./rateLimit";

describe("mapRateLimited", () => {
  it("maps in order and preserves results", async () => {
    const sleep = vi.fn(async () => {});
    const out = await mapRateLimited([1, 2, 3], 500, async (n) => n * 2, sleep);
    expect(out).toEqual([2, 4, 6]);
  });

  it("sleeps between calls but not before the first", async () => {
    const sleep = vi.fn(async () => {});
    await mapRateLimited(["a", "b", "c"], 500, async (s) => s, sleep);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("never sleeps for a single item", async () => {
    const sleep = vi.fn(async () => {});
    await mapRateLimited(["only"], 500, async (s) => s, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does no work and never sleeps for an empty list", async () => {
    const sleep = vi.fn(async () => {});
    const task = vi.fn(async (n: number) => n);
    expect(await mapRateLimited([], 500, task, sleep)).toEqual([]);
    expect(task).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  // The whole point: no two tasks may be in flight at once, or the vendor's
  // per-second limit is breached regardless of how long we slept.
  it("runs tasks strictly sequentially, never concurrently", async () => {
    const sleep = vi.fn(async () => {});
    let inFlight = 0;
    let maxInFlight = 0;
    await mapRateLimited([1, 2, 3, 4], 500, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return n;
    }, sleep);
    expect(maxInFlight).toBe(1);
  });

  it("propagates a task rejection", async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      mapRateLimited([1], 500, async () => { throw new Error("boom"); }, sleep),
    ).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/ai/rateLimit.test.ts
```

Expected: FAIL — `Failed to resolve import "./rateLimit"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/server/ai/rateLimit.ts`:

```ts
// Sequential map with a minimum gap between calls (KI-15).
//
// Deliberately simpler than a token-bucket limiter: it sleeps `minIntervalMs`
// BETWEEN calls rather than tracking a wall clock, so the real spacing is
// `minIntervalMs + taskDuration` — slightly more conservative than the vendor
// requires. That conservatism is free here (we are already inside a
// multi-second AI request) and it buys a runner with no clock to inject, no
// drift, and no timer left pending if a task throws.
//
// `sleep` is injected so tests neither wait nor need fake timers.

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function mapRateLimited<T, R>(
  items: readonly T[],
  minIntervalMs: number,
  task: (item: T) => Promise<R>,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<R[]> {
  const results: R[] = [];
  for (const [index, item] of items.entries()) {
    if (index > 0) await sleep(minIntervalMs);
    results.push(await task(item));
  }
  return results;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/ai/rateLimit.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ai/rateLimit.ts apps/web/src/server/ai/rateLimit.test.ts
git commit -m "$(cat <<'EOF'
feat(ai): sequential rate-limited map for vendor-throttled lookups (KI-15)

Replaces the Promise.all burst pattern. Sleeps between calls rather than
tracking a clock — conservative by design, no timer to leak, and `sleep`
is injected so tests neither wait nor need fake timers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Teach the geocoder seam about a viewbox

A viewbox is a **vendor capability**, not pipeline policy, so it belongs on the
`Geocoder` interface. LocationIQ takes `viewbox=west,south,east,north`. We send
it *without* `bounded=1`: a soft bias that prefers in-box results but still
returns something for a place just outside, with our own acceptance test
(Task 4) as the actual guard.

**Files:**
- Modify: `apps/web/src/server/geocoding/geocoder.ts`
- Modify: `apps/web/src/server/geocoding/locationiq.ts`
- Test: `apps/web/src/server/geocoding/locationiq.test.ts` (modify)

**Interfaces:**
- Consumes: `BoundingBox`, already defined in `geocoding/geocoder.ts` by Task 1.
- Produces: `Geocoder.forward(query, { limit?, viewbox? })`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/server/geocoding/locationiq.test.ts`, inside the existing
`describe("LocationIQ geocoder adapter", ...)` block:

```ts
  it("sends a viewbox as west,south,east,north and omits it when absent", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const geocoder = createLocationIQGeocoder("KEY123");
    await geocoder.forward("Red Coach Inn", {
      limit: 1,
      viewbox: { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 },
    });
    const withBox = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(withBox.searchParams.get("viewbox")).toBe("-80,42,-77,44");
    // Soft bias only — a hard `bounded=1` would return nothing for a place
    // just outside the box. The acceptance test in geocodeEnrichment guards.
    expect(withBox.searchParams.get("bounded")).toBeNull();

    await geocoder.forward("Red Coach Inn", { limit: 1 });
    const withoutBox = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(withoutBox.searchParams.get("viewbox")).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/geocoding/locationiq.test.ts
```

Expected: FAIL — a TypeScript error that `viewbox` is not in the options type,
and the assertion `expected null to be "-80,42,-77,44"`.

- [ ] **Step 3: Write the implementation**

In `apps/web/src/server/geocoding/geocoder.ts`, replace the `Geocoder`
interface with (`BoundingBox` is already declared in this file from Task 1 —
no import needed):

```ts
export interface GeocodeOptions {
  limit?: number;
  // Soft geographic bias (KI-15). Prefers results inside the box without
  // excluding everything outside it — the caller applies its own acceptance
  // test to the answer.
  viewbox?: BoundingBox;
}

// The swappable seam (ADR-007). Callers depend only on this; each adapter hides
// its vendor. We persist normalized GeocodeResults, never raw vendor payloads.
export interface Geocoder {
  forward(query: string, opts?: GeocodeOptions): Promise<GeocodeResult[]>;
}
```

In `apps/web/src/server/geocoding/index.ts`, widen the re-export again (Task 1
already added `LatLng`/`BoundingBox` here):

```ts
export type { Geocoder, GeocodeResult, GeocodeOptions, LatLng, BoundingBox } from "./geocoder";
```

In `apps/web/src/server/geocoding/locationiq.ts`, add the parameter inside
`forward`, immediately after the existing `limit` line:

```ts
      url.searchParams.set("limit", String(opts?.limit ?? 5));
      // LocationIQ orders viewbox as west,south,east,north. No `bounded=1`:
      // this biases ranking rather than filtering the result set (KI-15).
      if (opts?.viewbox) {
        const { minLng, minLat, maxLng, maxLat } = opts.viewbox;
        url.searchParams.set("viewbox", `${minLng},${minLat},${maxLng},${maxLat}`);
      }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/geocoding/locationiq.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/geocoding
git commit -m "$(cat <<'EOF'
feat(geocoding): accept an optional viewbox on the Geocoder seam (KI-15)

A viewbox is a vendor capability, so it belongs on the interface rather
than being assembled by the caller. Sent as a soft bias (no bounded=1) —
filtering is the caller's acceptance test, not the vendor's.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Enrichment that refines but never relocates

The core of the fix, and the module's **first ever test file**. Three behavior
changes to `enrichCommandLocations`:

1. **Hint + bias.** Each name's lookup is biased by a viewbox: around the
   model's own coordinates when they are plausible, else around the trip's
   existing geocoded activities.
2. **Acceptance test.** A result is accepted only if it agrees with the hint
   (within `MAX_REFINE_KM`) or falls inside the trip region. A rejected result
   is discarded and the model's coordinates are kept — the Shropshire case.
3. **Report.** Returns `{ commands, report }` instead of bare commands.

Plus one thing the plan's first draft got wrong, caught in pre-flight and
**decided by Mitchell on 2026-08-05**: a brand-new trip has no existing
activities, so it has no region. If the model also gave no coordinate hint,
there is nothing to check the answer against — and calling that `unverified`
would fire the user-facing warning on *every* location of *every* freshly
planned trip, which is exactly the Rochester scenario KI-15 came from. Two
consequences, both binding:

- **A fourth outcome, `unchecked`:** accepted because we had nothing to check
  it against. Reported in the API payload, but it does **not** produce a user
  notice. Only `unverified` (we checked and it disagreed), `failed`, and
  `skipped` do.
- **Region bootstrapping:** lookups run sequentially, so once one produces a
  plausible coordinate the batch knows roughly where the trip is. When there is
  no trip region, the region for each lookup is derived from the coordinates
  accepted so far. On the Rochester run the first resolved place anchors the
  rest, so the Shropshire match gets rejected on region even with no model hint.
  Only the first lookup of a fresh trip can be `unchecked`.

**Files:**
- Modify: `apps/web/src/server/ai/geocodeEnrichment.ts`
- Test: `apps/web/src/server/ai/geocodeEnrichment.test.ts` (create)

**Interfaces:**
- Consumes: `plausibleCoords`, `distanceKm`, `boundingBoxAround`, `withinBox`,
  `BoundingBox`, `LatLng` (Task 1); `mapRateLimited` (Task 2);
  `GeocodeOptions.viewbox` (Task 3).
- Produces:
  ```ts
  interface LocationEnrichmentReport {
    verified: string[];   // geocoder agreed with what we believed
    unverified: string[]; // no match, or a match we rejected as implausible
    unchecked: string[];  // accepted, but there was nothing to check it against
    failed: string[];     // the lookup threw (rate limit, vendor error, no key)
    skipped: string[];    // over MAX_LOOKUPS_PER_BATCH, never attempted
  }
  async function enrichCommandLocations(
    commands: BatchableCommand[],
    getGeocoder: () => Geocoder,
    tripRegion?: BoundingBox | null,
    sleep?: (ms: number) => Promise<void>,
  ): Promise<{ commands: BatchableCommand[]; report: LocationEnrichmentReport }>
  ```

> **Amended post-review (2026-08-06), Mitchell's call:** the review that ran
> against this task's first implementation (commit `11832d4`) found that the
> code below, as originally written, called `mapRateLimited` with no `sleep`
> argument — so every multi-lookup test paid real 500ms wall-clock delays
> (measured: ~9.5s total across this file, one test needing a 10s timeout
> override). `mapRateLimited` (Task 2) was built with an injectable `sleep`
> for exactly this reason; this task just never threaded it through. Fixed by
> adding the fourth `sleep` parameter above, passed straight into the
> `mapRateLimited` call in Step 3's implementation, defaulting to nothing
> (i.e. `mapRateLimited`'s own real-timer default) so every production
> caller is unaffected — only tests inject a no-op. The code block below has
> **not** been rewritten to show this inline; implementers should add the
> parameter and one line (`sleep` threaded into the `mapRateLimited` call)
> on top of what's shown, and tests should pass `async () => {}` as the
> fourth argument wherever more than one lookup fires in the same test.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/server/ai/geocodeEnrichment.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { BatchableCommand } from "@tc/contracts";
import type { GeocodeResult, Geocoder } from "@/server/geocoding";
import { enrichCommandLocations } from "./geocodeEnrichment";

const TRIP = "11111111-1111-4111-8111-111111111111";

function addActivity(
  title: string,
  location?: { name: string; lat?: number; lng?: number },
): BatchableCommand {
  return {
    type: "AddActivity",
    tripId: TRIP,
    activityId: "22222222-2222-4222-8222-222222222222",
    title,
    ...(location ? { location } : {}),
  } as BatchableCommand;
}

// A geocoder whose answers are looked up by query string; anything not in the
// map returns no results. `calls` records every query for throttle assertions.
function fakeGeocoder(answers: Record<string, GeocodeResult[] | Error>) {
  const calls: string[] = [];
  const geocoder: Geocoder = {
    async forward(query) {
      calls.push(query);
      const answer = answers[query];
      if (answer instanceof Error) throw answer;
      return answer ?? [];
    },
  };
  return { geocoder, calls };
}

const NIAGARA = { lat: 43.0866, lng: -79.0628 };

describe("enrichCommandLocations", () => {
  it("leaves a batch with no locations completely alone and never builds a geocoder", async () => {
    const getGeocoder = vi.fn(() => { throw new Error("must not construct"); });
    const commands = [addActivity("Rest day")];
    const { commands: out, report } = await enrichCommandLocations(commands, getGeocoder);
    expect(out).toEqual(commands);
    expect(getGeocoder).not.toHaveBeenCalled();
    expect(report).toEqual({ verified: [], unverified: [], unchecked: [], failed: [], skipped: [] });
  });

  // No hint and no trip region: the answer is taken, but reported `unchecked`
  // rather than `verified` — we had nothing to check it against.
  it("fills in coordinates when the model supplied none, reporting them unchecked", async () => {
    const { geocoder } = fakeGeocoder({
      "Niagara Falls State Park": [
        { lat: 43.0866, lng: -79.0628, canonicalName: "Niagara Falls State Park, NY, USA", countryCode: "US" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Falls", { name: "Niagara Falls State Park" })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({
      location: {
        name: "Niagara Falls State Park, NY, USA",
        lat: 43.0866,
        lng: -79.0628,
        countryCode: "US",
      },
    });
    expect(report.unchecked).toEqual(["Niagara Falls State Park"]);
    expect(report.verified).toEqual([]);
  });

  // KI-15's headline failure, verbatim: the model had the RIGHT coordinates and
  // enrichment replaced them with a coaching inn 5,500 km away.
  it("rejects a match that contradicts the model's plausible coordinates", async () => {
    const { geocoder } = fakeGeocoder({
      "The Red Coach Inn": [
        { lat: 52.907918, lng: -2.8901, canonicalName: "The Red Lion Coaching Inn, Shropshire, England", countryCode: "GB" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Dinner", { name: "The Red Coach Inn", ...NIAGARA })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({
      location: { name: "The Red Coach Inn", lat: NIAGARA.lat, lng: NIAGARA.lng },
    });
    expect(report.unverified).toEqual(["The Red Coach Inn"]);
    expect(report.verified).toEqual([]);
  });

  it("accepts a match that refines the model's coordinates within the same metro", async () => {
    const { geocoder } = fakeGeocoder({
      "The Red Coach Inn": [
        { lat: 43.0812, lng: -79.0665, canonicalName: "The Red Coach Inn, Niagara Falls, NY, USA", countryCode: "US" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Dinner", { name: "The Red Coach Inn", ...NIAGARA })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({
      location: { name: "The Red Coach Inn, Niagara Falls, NY, USA", lat: 43.0812, lng: -79.0665 },
    });
    expect(report.verified).toEqual(["The Red Coach Inn"]);
  });

  it("treats lat 0/lng 0 as no coordinates, not as a hint", async () => {
    const { geocoder } = fakeGeocoder({
      "Strong Museum of Play": [
        { lat: 43.1548, lng: -77.695, canonicalName: "The Strong, Rochester, NY, USA", countryCode: "US" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Museum", { name: "Strong Museum of Play", lat: 0, lng: 0 })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({ location: { lat: 43.1548, lng: -77.695 } });
    // Accepted, but unchecked — 0,0 is not a hint, and there is no trip region.
    expect(report.unchecked).toEqual(["Strong Museum of Play"]);
  });

  // Mitchell's pre-flight decision: lookups are sequential, so the first
  // accepted coordinate tells the batch where the trip is. Without this, every
  // location on a freshly planned trip would be unchecked.
  it("bootstraps a region from accepted results and checks later lookups against it", async () => {
    const { geocoder } = fakeGeocoder({
      "Niagara Falls State Park": [
        { lat: 43.0866, lng: -79.0628, canonicalName: "Niagara Falls State Park, NY, USA", countryCode: "US" },
      ],
      "The Red Coach Inn": [
        { lat: 52.907918, lng: -2.8901, canonicalName: "The Red Lion Coaching Inn, Shropshire, England", countryCode: "GB" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [
        addActivity("Falls", { name: "Niagara Falls State Park" }),
        addActivity("Dinner", { name: "The Red Coach Inn" }),
      ],
      () => geocoder,
    );

    // First lookup: nothing to check against, so accepted as unchecked.
    expect(report.unchecked).toEqual(["Niagara Falls State Park"]);
    // Second: now checked against a region seeded by the first — and rejected,
    // even though the model gave no hint of its own.
    expect(report.unverified).toEqual(["The Red Coach Inn"]);
    expect(commands[1]).toMatchObject({ location: { name: "The Red Coach Inn" } });
    expect((commands[1] as { location: { lat?: number } }).location.lat).toBeUndefined();
  });

  it("accepts a later lookup that falls inside the bootstrapped region", async () => {
    const { geocoder } = fakeGeocoder({
      "Niagara Falls State Park": [
        { lat: 43.0866, lng: -79.0628, canonicalName: "Niagara Falls State Park, NY, USA", countryCode: "US" },
      ],
      "Strong Museum of Play": [
        { lat: 43.1548, lng: -77.695, canonicalName: "The Strong, Rochester, NY, USA", countryCode: "US" },
      ],
    });
    const { report } = await enrichCommandLocations(
      [
        addActivity("Falls", { name: "Niagara Falls State Park" }),
        addActivity("Museum", { name: "Strong Museum of Play" }),
      ],
      () => geocoder,
    );
    expect(report.unchecked).toEqual(["Niagara Falls State Park"]);
    expect(report.verified).toEqual(["Strong Museum of Play"]);
  });

  it("rejects a match outside the trip region when the model gave no hint", async () => {
    const { geocoder } = fakeGeocoder({
      "The Red Coach Inn": [
        { lat: 52.907918, lng: -2.8901, canonicalName: "Shropshire, England", countryCode: "GB" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Dinner", { name: "The Red Coach Inn" })],
      () => geocoder,
      { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 },
    );
    expect(commands[0]).toMatchObject({ location: { name: "The Red Coach Inn" } });
    expect((commands[0] as { location: { lat?: number } }).location.lat).toBeUndefined();
    expect(report.unverified).toEqual(["The Red Coach Inn"]);
  });

  it("biases the query with a viewbox drawn from the trip region", async () => {
    const forward = vi.fn(async () => []);
    await enrichCommandLocations(
      [addActivity("Dinner", { name: "Somewhere" })],
      () => ({ forward }),
      { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 },
    );
    expect(forward).toHaveBeenCalledWith("Somewhere", {
      limit: 1,
      viewbox: { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 },
    });
  });

  it("reports a thrown lookup as failed and keeps the model's location", async () => {
    const { geocoder } = fakeGeocoder({ "Rate Limited Place": new Error("geocode failed: 429") });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Lunch", { name: "Rate Limited Place", ...NIAGARA })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({ location: { name: "Rate Limited Place", ...NIAGARA } });
    expect(report.failed).toEqual(["Rate Limited Place"]);
  });

  it("reports an empty match as unverified", async () => {
    const { geocoder } = fakeGeocoder({});
    const { report } = await enrichCommandLocations(
      [addActivity("Lunch", { name: "Nowhere At All" })],
      () => geocoder,
    );
    expect(report.unverified).toEqual(["Nowhere At All"]);
  });

  it("never lets a geocoder failure reject the whole batch", async () => {
    const geocoder: Geocoder = { async forward() { throw new Error("vendor down"); } };
    await expect(
      enrichCommandLocations([addActivity("Lunch", { name: "X" })], () => geocoder),
    ).resolves.toBeDefined();
  });

  it("dedupes repeated names to a single lookup and applies it everywhere", async () => {
    const { geocoder, calls } = fakeGeocoder({
      "Lunch in Rochester, NY": [
        { lat: 43.1566, lng: -77.6088, canonicalName: "Rochester, NY, USA", countryCode: "US" },
      ],
    });
    const { commands } = await enrichCommandLocations(
      [
        addActivity("Day 1 lunch", { name: "Lunch in Rochester, NY" }),
        addActivity("Day 2 lunch", { name: "lunch in rochester, ny  " }),
      ],
      () => geocoder,
    );
    expect(calls).toEqual(["Lunch in Rochester, NY"]);
    expect(commands[0]).toMatchObject({ location: { lat: 43.1566 } });
    expect(commands[1]).toMatchObject({ location: { lat: 43.1566 } });
  });

  it("runs lookups sequentially, never concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const geocoder: Geocoder = {
      async forward() {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return [];
      },
    };
    await enrichCommandLocations(
      ["a", "b", "c", "d"].map((n) => addActivity(n, { name: `place ${n}` })),
      () => geocoder,
    );
    expect(maxInFlight).toBe(1);
  });

  it("caps lookups per batch and reports the remainder as skipped", async () => {
    const { geocoder, calls } = fakeGeocoder({});
    const commands = Array.from({ length: 20 }, (_, i) => addActivity(`a${i}`, { name: `place ${i}` }));
    const { report } = await enrichCommandLocations(commands, () => geocoder);
    expect(calls.length).toBe(15);
    expect(report.skipped.length).toBe(5);
    expect(report.skipped[0]).toBe("place 15");
  });

  it("ignores a cleared location (null) on UpdateActivity", async () => {
    const getGeocoder = vi.fn(() => { throw new Error("must not construct"); });
    const command = {
      type: "UpdateActivity",
      tripId: TRIP,
      activityId: "22222222-2222-4222-8222-222222222222",
      location: null,
    } as unknown as BatchableCommand;
    const { commands, report } = await enrichCommandLocations([command], getGeocoder);
    expect(commands).toEqual([command]);
    expect(getGeocoder).not.toHaveBeenCalled();
    expect(report.verified).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/ai/geocodeEnrichment.test.ts
```

Expected: FAIL — `enrichCommandLocations` currently resolves to a bare array, so
destructuring `{ commands, report }` yields `undefined` on nearly every test.

- [ ] **Step 3: Write the implementation**

Replace the whole of `apps/web/src/server/ai/geocodeEnrichment.ts`:

```ts
// AI-planning-specific enrichment step (ADR-007). The model is not trusted to
// supply real lat/lng, so a resolved batch's locations are looked up against a
// real geocoder before the batch is submitted.
//
// Rewritten for KI-15. The original mirrored the manual "Add a place" flow
// (LocationInput.tsx: a geocode result REPLACES what the user typed) but
// dropped the part that made that flow safe — a human picking from candidates.
// Unsupervised, it relocated a Niagara Falls dinner to Shropshire, England,
// discarding coordinates the model had gotten right, and swallowed seven
// rate-limited lookups into coordinate-less locations. Both silently.
//
// The rule now is: **enrichment may refine a location, never relocate it.**
// Every lookup is biased toward what we already believe (the model's own
// plausible coordinates, else the trip's existing activities) and its answer is
// accepted only if it agrees with that belief. Disagreement means we keep what
// we had and say so in the report.
//
// This is a floor, not the fix. The architecture still launders a model guess
// into a stored fact; M9's "Grounding" (a SearchPlaces read tool and a
// placeRef the model must cite) removes the guess. KI-15 stays open.
//
// Lives here (not under server/geocoding/) because dedupe, throttling,
// acceptance and reporting are batch-shaped AI pipeline policy, not a
// geocoding-provider concern; `geocoding/` stays a pure vendor seam.
import type { BatchableCommand, Location } from "@tc/contracts";
import type { Geocoder } from "@/server/geocoding";
import {
  boundingBoxAround,
  distanceKm,
  plausibleCoords,
  withinBox,
  type BoundingBox,
  type LatLng,
} from "@/server/ai/geocodeRegion";
import { mapRateLimited } from "@/server/ai/rateLimit";

// LocationIQ's free tier is 5,000/day but capped at 2 requests/second, and the
// per-second limit is the one that actually binds on a 9-name itinerary.
const REQUESTS_PER_SECOND = 2;
const MIN_INTERVAL_MS = 1000 / REQUESTS_PER_SECOND;

// Serialized at 500 ms apart, every lookup is wall-clock latency added to an AI
// request that is already slow. 15 caps that at ~7 s, past which the marginal
// pin is not worth the wait; the remainder keep the model's own coordinates and
// are reported as skipped rather than silently left alone.
const MAX_LOOKUPS_PER_BATCH = 15;

// How far a geocode result may sit from the model's own coordinates and still
// count as "the same place, located more precisely". Generous enough for a
// vaguely-placed restaurant inside a metro area, nowhere near enough to cross
// an ocean.
const MAX_REFINE_KM = 50;

// Padding on the box drawn around the trip's existing activities, and around a
// single model-supplied hint. The trip margin is loose because a trip legibly
// spans a region; the hint margin is tight because it describes one place.
const TRIP_REGION_MARGIN_KM = 150;
const HINT_MARGIN_KM = 50;

type LocationCommand = Extract<BatchableCommand, { type: "AddActivity" | "UpdateActivity" }>;

export interface LocationEnrichmentReport {
  // The geocoder returned a match consistent with what we already believed.
  verified: string[];
  // No match, or a match rejected as implausible. The model's own location
  // survives untouched — which may mean no coordinates at all.
  unverified: string[];
  // Accepted, but there was nothing to check it against: no model hint, and no
  // region yet. Only reachable for the FIRST lookup of a trip that has no
  // geocoded activities — after that, bootstrapping supplies a region. Reported
  // for honesty but deliberately NOT surfaced to the user: on a freshly planned
  // trip it would otherwise fire on every location, every time.
  unchecked: string[];
  // The lookup threw: rate limit, vendor outage, missing API key.
  failed: string[];
  // Never attempted — over MAX_LOOKUPS_PER_BATCH.
  skipped: string[];
}

const emptyReport = (): LocationEnrichmentReport => ({
  verified: [],
  unverified: [],
  unchecked: [],
  failed: [],
  skipped: [],
});

// True when the report describes something a user should be told about.
// `unchecked` is excluded by design — see the field's comment.
export function hasUnverifiedLocations(report: LocationEnrichmentReport): boolean {
  return report.unverified.length + report.failed.length + report.skipped.length > 0;
}

// "Needs enrichment" = AddActivity/UpdateActivity with a `location` object
// present. UpdateActivity's `location: null` means "clear it" — nothing to
// geocode there — and `undefined` means "unchanged" on both command types.
function hasLocation(command: BatchableCommand): command is LocationCommand & { location: Location } {
  return (command.type === "AddActivity" || command.type === "UpdateActivity") && command.location != null;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

type Outcome = "verified" | "unverified" | "unchecked" | "failed";

interface Resolution {
  location: Location;
  outcome: Outcome;
}

// One lookup, biased and then judged.
//
// `hint` is the model's own coordinates for this place when they are plausible.
// When present it is BOTH the bias (a tight viewbox) and the acceptance test (a
// distance threshold) — a result that disagrees with it loses, because the
// model naming a place and placing it near where it named it is stronger
// evidence than a fuzzy string match against a global index.
//
// With no hint we fall back to `region` for both roles — the trip's own
// activities, or, on a trip that has none, the coordinates accepted earlier in
// this same batch (see the bootstrapping in `enrichCommandLocations`). With
// neither we accept the top match, because there is nothing to check it
// against, and report it `unchecked` — never `verified`.
async function resolveOne(
  geocoder: Geocoder,
  name: string,
  hint: LatLng | null,
  region: BoundingBox | null,
): Promise<Resolution> {
  const fallback: Location = hint ? { name, lat: hint.lat, lng: hint.lng } : { name };
  const viewbox = hint ? boundingBoxAround([hint], HINT_MARGIN_KM) : region;

  let match;
  try {
    [match] = await geocoder.forward(name, { limit: 1, ...(viewbox ? { viewbox } : {}) });
  } catch {
    // Best-effort by contract: a vendor failure never fails the AI request. It
    // is reported rather than swallowed, which is the half KI-15 was missing.
    return { location: fallback, outcome: "failed" };
  }
  if (!match) return { location: fallback, outcome: "unverified" };

  const found: Location = {
    name: match.canonicalName,
    lat: match.lat,
    lng: match.lng,
    ...(match.countryCode ? { countryCode: match.countryCode } : {}),
  };

  if (hint) {
    return distanceKm(hint, { lat: match.lat, lng: match.lng }) <= MAX_REFINE_KM
      ? { location: found, outcome: "verified" }
      : { location: fallback, outcome: "unverified" };
  }
  if (region) {
    return withinBox(region, { lat: match.lat, lng: match.lng })
      ? { location: found, outcome: "verified" }
      : { location: fallback, outcome: "unverified" };
  }
  // Nothing to check against. Take it, but do not claim it was verified — and
  // do not nag the user about it either (see LocationEnrichmentReport).
  return { location: found, outcome: "unchecked" };
}

export async function enrichCommandLocations(
  commands: BatchableCommand[],
  getGeocoder: () => Geocoder,
  tripRegion: BoundingBox | null = null,
): Promise<{ commands: BatchableCommand[]; report: LocationEnrichmentReport }> {
  // Dedupe by normalized name, keeping the first spelling and the first
  // plausible coordinate hint seen for it.
  const pending = new Map<string, { name: string; hint: LatLng | null }>();
  for (const command of commands) {
    if (!hasLocation(command)) continue;
    const key = normalize(command.location.name);
    const existing = pending.get(key);
    const hint = plausibleCoords(command.location);
    if (!existing) {
      pending.set(key, { name: command.location.name, hint });
    } else if (!existing.hint && hint) {
      existing.hint = hint;
    }
  }

  const report = emptyReport();
  if (pending.size === 0) return { commands, report };

  const entries = Array.from(pending.entries());
  const attempted = entries.slice(0, MAX_LOOKUPS_PER_BATCH);
  for (const [, { name }] of entries.slice(MAX_LOOKUPS_PER_BATCH)) report.skipped.push(name);

  const geocoder = getGeocoder();

  // Region bootstrapping. A brand-new trip has no geocoded activities, so
  // `tripRegion` is null and the first lookup has nothing to check against.
  // Lookups are sequential, though, so every coordinate we settle on tells the
  // rest of the batch where this trip is — the Rochester run anchors on
  // whichever place resolves first, and a Shropshire match for the next name is
  // then rejected on region alone, with no model hint needed. Only the first
  // lookup of a region-less trip can come back `unchecked`.
  const anchors: LatLng[] = [];
  const resolved = await mapRateLimited(attempted, MIN_INTERVAL_MS, async ([key, { name, hint }]) => {
    const region = tripRegion ?? boundingBoxAround(anchors, TRIP_REGION_MARGIN_KM);
    const resolution = await resolveOne(geocoder, name, hint, region);
    report[resolution.outcome].push(name);
    // Anything we settled on is evidence about where the trip is — including a
    // rejected lookup's surviving model hint. A `failed` lookup taught us
    // nothing new, so it contributes nothing.
    if (resolution.outcome !== "failed") {
      const coords = plausibleCoords(resolution.location);
      if (coords) anchors.push(coords);
    }
    return [key, resolution.location] as const;
  });
  const locationByKey = new Map(resolved);

  return {
    commands: commands.map((command) => {
      if (!hasLocation(command)) return command;
      const location = locationByKey.get(normalize(command.location.name));
      return location ? { ...command, location } : command;
    }),
    report,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter web exec vitest run -c vitest.unit.config.ts src/server/ai/geocodeEnrichment.test.ts
```

Expected: PASS, 16 tests. `handleAiRequest.ts` will not typecheck yet — Task 5
fixes the caller.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/ai/geocodeEnrichment.ts apps/web/src/server/ai/geocodeEnrichment.test.ts
git commit -m "$(cat <<'EOF'
fix(ai): enrichment may refine a location, never relocate it (KI-15)

Every lookup is biased toward what we already believe — the model's own
plausible coordinates, else the trip's existing activities — and the
answer is accepted only if it agrees. A Niagara Falls dinner can no
longer be persisted in Shropshire; the model's coordinates survive a
disagreement instead of being overwritten by a fuzzy string match.

Lookups are serialized at LocationIQ's real 2 req/sec instead of a
Promise.all burst that 429'd 7 of 9, capped at 15 per batch, and every
outcome is reported rather than swallowed.

Adds the test file the module shipped without.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Derive the region and tell the user

Wires the new signature into `handleAiRequest`: build the trip region from
already-geocoded activities, and fold the report into the same notice channel
`skipped`/`truncated` already use, so no new UI is needed (`ComposePanel.tsx`
renders `message` verbatim).

**Files:**
- Modify: `apps/web/src/server/ai/handleAiRequest.ts`
- Test: `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts` (modify)

**Interfaces:**
- Consumes: `enrichCommandLocations`, `hasUnverifiedLocations`,
  `LocationEnrichmentReport` (Task 4); `plausibleCoords`, `boundingBoxAround`
  (Task 1).
- Produces: response body gains `locationReport`; `message` gains a notice.

- [ ] **Step 1: Write the failing test**

Work in `apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts`.

**Read the existing file first.** Two things about it that the code sketch
below does not encode, both confirmed during pre-flight:

1. **The real helpers are `seedTrip()`, `req(tripId, body)`,
   `modelWithToolCalls([...])`, `toolCall(name, args)`, and
   `fakeGeocoder(responses)`.** Use those; do not invent new ones. Tests call
   `handleAiRequest(req(...), tripId, model, geocoder)` directly — never `POST`.
   Note `@/server/geocoding` is `vi.mock`'d at module scope in this file (its
   `getGeocoder` throws on purpose), so a `Geocoder` is always injected.
2. **There is already a `describe("AI-planned activity locations are geocoded
   server-side")` block of 5 tests (around line 436) that encodes the OLD
   contract.** They are expected to still pass — the first one feeds the model
   `lat: 0, lng: 0`, which `plausibleCoords` correctly rejects as a hint, so
   with no trip region the top match is accepted exactly as before. **Run that
   whole block and confirm.** If any assertion has legitimately changed
   meaning under the new contract, update it *and say so in your report* —
   do not delete a test or weaken an assertion to make it pass.

The assertions to add (adapt to the real helpers above):

```ts
  it("tells the user which locations it could not verify", async () => {
    // A model that adds one activity whose location the geocoder will reject.
    const model = mockModelAddingActivity({
      title: "Dinner",
      location: { name: "The Red Coach Inn", lat: 43.0866, lng: -79.0628 },
    });
    const geocoder = {
      forward: async () => [
        { lat: 52.907918, lng: -2.8901, canonicalName: "Shropshire, England", countryCode: "GB" },
      ],
    };

    const res = await handleAiRequest(aiRequest("add dinner"), tripId, model, geocoder);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain("couldn't verify");
    expect(body.message).toContain("The Red Coach Inn");
    expect(body.locationReport.unverified).toEqual(["The Red Coach Inn"]);

    // And the coordinates the model got right were persisted, not Shropshire.
    const activity = Object.values(body.detail.activities as Record<string, { location: { lat: number } | null }>)
      .find((a) => a.location !== null)!;
    expect(activity.location.lat).toBeCloseTo(43.0866, 3);
  });

  // A freshly seeded trip has no geocoded activities, so a lone lookup has no
  // region to check against and comes back `unchecked` — accepted, reported in
  // the payload, and deliberately silent in the message.
  it("says nothing extra when a location is accepted", async () => {
    const model = mockModelAddingActivity({
      title: "Falls",
      location: { name: "Niagara Falls State Park" },
    });
    const geocoder = {
      forward: async () => [
        { lat: 43.0866, lng: -79.0628, canonicalName: "Niagara Falls State Park, NY, USA", countryCode: "US" },
      ],
    };

    const res = await handleAiRequest(aiRequest("add the falls"), tripId, model, geocoder);
    const body = await res.json();
    expect(body.message).not.toContain("couldn't verify");
    expect(body.locationReport.unchecked).toEqual(["Niagara Falls State Park"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter web test:int -- src/app/api/trips/\[tripId\]/ai/route.int.test.ts
```

Expected: FAIL — `body.locationReport` is `undefined` and `message` has no
notice. (A typecheck error on the destructured return is also expected until
Step 3.)

- [ ] **Step 3: Write the implementation**

In `apps/web/src/server/ai/handleAiRequest.ts`:

**3a.** Extend the import from `geocodeEnrichment`:

```ts
import {
  enrichCommandLocations,
  hasUnverifiedLocations,
  type LocationEnrichmentReport,
} from "@/server/ai/geocodeEnrichment";
```

and add, next to the other `@/server/ai` imports:

```ts
import { boundingBoxAround, plausibleCoords } from "@/server/ai/geocodeRegion";
```

**3b.** Add these two helpers next to `withNotices` at the bottom of the file:

```ts
// Padding on the region drawn from a trip's existing activities. Matches
// TRIP_REGION_MARGIN_KM in geocodeEnrichment — kept here rather than exported
// because this is the caller's decision about how loosely to read "the trip is
// around here", not the enricher's.
const TRIP_REGION_MARGIN_KM = 150;

// The trip's own already-geocoded activities are the only region signal that
// does not come from the model. A brand-new trip planned in one prompt has
// none — that is expected, and enrichment falls back to per-place hints.
function tripRegionOf(detail: TripDetail) {
  const points = Object.values(detail.activities)
    .map((a) => (a.location ? plausibleCoords(a.location) : null))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  return boundingBoxAround(points, TRIP_REGION_MARGIN_KM);
}

// Turn the enrichment report into one sentence, or nothing. Named places beat
// a bare count: "3 locations" is not actionable, "The Red Coach Inn" is.
//
// `report.unchecked` is deliberately absent: those were accepted with nothing
// to check them against, which on a freshly planned trip is the common case,
// and warning about all of them every time would train the user to ignore the
// warning that matters. They remain in the response payload.
function locationNotice(report: LocationEnrichmentReport): string | null {
  const names = [...report.unverified, ...report.failed, ...report.skipped];
  if (names.length === 0) return null;
  const shown = names.slice(0, 3).join(", ");
  const rest = names.length - Math.min(3, names.length);
  const tail = rest > 0 ? `, and ${rest} more` : "";
  return `I couldn't verify ${names.length === 1 ? "the location" : "locations"} for ${shown}${tail} — worth checking on the map.`;
}
```

`TripDetail` is already imported? Confirm — the file imports
`{ PageContext, type PageContent, type TripHistory }` from `@tc/contracts`; add
`type TripDetail` to that import list.

**3c.** Replace the enrichment call site:

```ts
  const commands = await enrichCommandLocations(resolvedCommands, () => geocoder ?? getGeocoder());
```

with:

```ts
  const { commands, report: locationReport } = await enrichCommandLocations(
    resolvedCommands,
    () => geocoder ?? getGeocoder(),
    tripRegionOf(detail),
  );
```

**3d.** In the success path, add the notice and expose the report. Replace:

```ts
  if (meta.truncated) notices.push(TRUNCATED_NOTICE);
  const message = withNotices(summary, notices);
  return Response.json({
    detail: batch.detail,
    history: batch.history,
    message,
    meta,
    resolvedCommands: commands,
    resolutionErrors,
  });
```

with:

```ts
  if (meta.truncated) notices.push(TRUNCATED_NOTICE);
  // Silence was KI-15's real damage: a wrong pin and a missing pin both read as
  // success. Anything not positively verified gets said out loud.
  const geocodeNotice = locationNotice(locationReport);
  if (geocodeNotice) notices.push(geocodeNotice);
  const message = withNotices(summary, notices);
  return Response.json({
    detail: batch.detail,
    history: batch.history,
    message,
    meta,
    resolvedCommands: commands,
    resolutionErrors,
    locationReport,
  });
```

**3e.** Also thread it through the batch-failure response so a failed submit
still reports what enrichment did:

```ts
      { error: batch.error.message, code: batch.error.code, meta, resolvedCommands: commands, resolutionErrors, locationReport },
```

**3f.** Update the stale comment above the call site — it still describes the
old unconditional-overwrite behavior:

```ts
  // Server-side geocode enrichment (ADR-007). The model is not trusted with
  // real coordinates, but neither is the geocoder trusted to overrule the
  // model: a lookup is biased toward the trip's region and accepted only if it
  // agrees with what we already believe (KI-15). Best-effort — never fails the
  // request — and everything it could not verify comes back in `report` and is
  // said out loud in the message. See geocodeEnrichment.ts.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter web test:int -- src/app/api/trips/\[tripId\]/ai/route.int.test.ts
```

Expected: PASS, including the two new cases.

- [ ] **Step 5: Full gate**

```bash
pnpm check && pnpm test:int
```

Expected: typecheck 5/5 packages, lint clean, all unit suites green, integration
green. Fix anything red before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/ai/handleAiRequest.ts "apps/web/src/app/api/trips/[tripId]/ai/route.int.test.ts"
git commit -m "$(cat <<'EOF'
fix(ai): bias geocoding by trip region and surface what it couldn't verify

Draws a region from the trip's already-geocoded activities and threads it
into enrichment as a bias. The enrichment report joins the existing
notice channel, so a place we could not verify is named in the response
message instead of being presented as a confident success.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Tell the truth in the docs

The PR cannot merge with `STATUS.md` claiming Wave A has not started, and KI-15
must say what is actually still open rather than what it said before the fix.

**Files:**
- Modify: `docs/known-issues.md`
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Rewrite the KI-15 entry**

In `docs/known-issues.md`, replace the KI-15 body. Keep the verbatim prompt and
the observed-run detail — they are M9's regression test. Change the title,
severity, and add a "what changed" block:

```markdown
### KI-15 — AI-planned locations are still model guesses, not cited facts
- **Severity:** correctness (downgraded 2026-08-05 — silent corruption fixed, the guess remains)
- **Area:** `apps/web/src/server/ai/geocodeEnrichment.ts`
- **Fixed on 2026-08-05, before PR #21 merged:** enrichment no longer relocates
  a correctly-placed activity. Every lookup is biased toward what we already
  believe (the model's own plausible coordinates, else a region drawn from the
  trip's existing activities) and accepted only if it agrees — a Shropshire
  match against a Niagara Falls hint is rejected and the model's coordinates
  survive. Lookups are serialized at LocationIQ's real 2 req/sec instead of a
  `Promise.all` burst, and every unverified, failed, or skipped place is named
  in the response message instead of being reported as success.
- **What is still open:** the model still *guesses* the coordinate, and a guess
  that happens to agree with a fuzzy string match is still reported as
  "verified". The acceptance thresholds (`MAX_REFINE_KM` 50, trip margin 150 km)
  are heuristics chosen from one dogfood run, not measured. `boundingBoxAround`
  does not handle the antimeridian — a Pacific-spanning trip gets no useful
  bias (fails safe, not wrong). And the first lookup on a trip with no geocoded
  activities is still unchecked by construction: the batch has no region until
  something resolves, so a wrong first answer both survives and becomes the
  anchor the rest of the batch is checked against. Ordering lookups by how
  reliably they geocode would help; M9's grounding removes the problem.
- **Fix path:** M9, "Grounding". The model cites a `placeRef` from a real
  `SearchPlaces` result, so there is nothing to overwrite and nothing to guess;
  enrichment survives only as a fallback for user-typed text.
```

Leave the existing "The prompt, verbatim", "Symptom (live run…)", "Two
independent causes", and "First noted" bullets in place beneath this — they are
the reproduction and the reasoning, and both outlive the partial fix.

- [ ] **Step 2: Update STATUS.md**

Replace the "In flight" and "Next action" sections of `docs/STATUS.md` to match
reality. Set `**Last updated: 2026-08-05**`, and write:

- **In flight:** M8 Wave A is complete and in review as PR #21 (`m8-wave-a`) —
  Tasks A0–A15, plus dogfooding follow-ups and the KI-15 hardening in this plan.
  Waves B (subtraction), C (ergonomics), and D (first-run/empty states) have not
  started; the plan is `docs/plans/2026-07-28-M8-make-it-real.md`, resume at
  **Task B1** once #21 merges.
- **Blocking / broken:** KI-15 downgraded — the silent-corruption half is fixed
  (see the entry); the architectural half is M9 scope. Nothing blocks Wave B.
- **Next action:** merge PR #21, then execute M8 Wave B starting at Task B1.

Keep the two domain corrections note only if still accurate post-merge; both
landed in Wave A, so replace that block rather than leaving it as a warning
about work already done.

- [ ] **Step 3: Verify nothing else went stale**

```bash
grep -rn "not started\|Start at \*\*Task A1\*\*\|has NOT been" docs/STATUS.md
```

Expected: no hits describing Wave A as unstarted. The Phase 1 gate line ("has
NOT been met") is still true and should remain.

- [ ] **Step 4: Commit**

```bash
git add docs/known-issues.md docs/STATUS.md
git commit -m "$(cat <<'EOF'
docs: downgrade KI-15, record Wave A as complete and in review

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Update the PR body**

Add to PR #21's Summary a bullet for the KI-15 hardening, and to the Test plan a
line recording that `geocodeEnrichment.ts` gained the test file it shipped
without. Remove "Still draft pending Mitchell's review before Wave B" if the
review has happened by then.

```bash
gh pr view 21 --json body -q .body > /tmp/pr21-body.md
# edit /tmp/pr21-body.md, then:
gh pr edit 21 --body-file /tmp/pr21-body.md
```

---

## Verification before merge

Run the whole gate on `m8-wave-a`, not a subset:

```bash
pnpm check && pnpm test:int
```

Then push and confirm CI is green on all four jobs before merging:

```bash
git push origin m8-wave-a && gh pr checks 21 --watch
```

**Live check (optional but recommended, and cheap):** the Vercel preview on #21
rebuilds on push. Re-run KI-15's verbatim prompt against it —

> Plan a 3 day trip to Rochester ny, One day visiting the falls in Niagara, and another visiting the strong museum of place in rochester. Find and add lunch and dinner restaurants for each day near those locations

Expected now: no activity outside New York State, and any place the geocoder
could not confirm named explicitly in the response message rather than passed
off as verified. This is the same run that produced KI-15, so it is the honest
before/after.

## Self-review notes

- **Spec coverage:** KI-15's three "worth doing sooner" items — throttle
  (Task 2 + 4), viewbox bias (Task 3 + 4 + 5), surface the failure (Task 4 + 5).
  Cause 1 (unconditional overwrite) is Task 4's acceptance test. Cause 2
  (parallel burst) is Task 2. The missing test file is Task 4.
- **Deliberately out of scope:** M9 grounding; retry-with-backoff on a 429 (the
  throttle should prevent them, and a retry doubles worst-case latency —
  reconsider if the live run still shows failures); antimeridian handling.
- **Type consistency:** `BoundingBox`/`LatLng` are defined once in Task 1 and
  imported everywhere. `LocationEnrichmentReport` is defined in Task 4 and
  consumed in Task 5. `enrichCommandLocations` returns
  `{ commands, report }` in both the early-return and normal paths.

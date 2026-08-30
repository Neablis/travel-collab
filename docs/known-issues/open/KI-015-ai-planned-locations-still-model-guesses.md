### KI-15 — AI-planned locations are still model guesses, not cited facts
- **Severity:** correctness (downgraded 2026-08-06 — silent corruption fixed, the guess remains)
- **Area:** `apps/web/src/server/ai/geocodeEnrichment.ts`
- **Fixed on 2026-08-06, before PR #21 merged:** `enrichCommandLocations`/`resolveOne`
  no longer relocate a correctly-placed activity. Every lookup is biased with a
  viewbox toward what we already believe — the model's own plausible
  coordinates as a tight (50 km) hint, else a region drawn from the trip's
  existing activities (150 km margin), else, on a brand-new trip with neither,
  the coordinates already accepted earlier in the same batch (`anchors`,
  bootstrapped as lookups resolve) — and a result is kept only if it agrees
  with that belief (within `MAX_REFINE_KM`, 50 km, of a hint, or inside the
  region's box); disagreement means the model's original guess is kept as-is —
  its own coordinates when it had a hint, or just the bare name when it had
  none to begin with — and the place is reported `unverified`, never silently
  overwritten.
  A Shropshire match against a Niagara Falls hint is now rejected on distance
  alone. Lookups are serialized through `mapRateLimited` at LocationIQ's real
  2 req/sec instead of a `Promise.all` burst, so a 9-name batch no longer 429s
  itself into coordinate-less locations. The response carries a
  `locationReport` (`verified`/`unverified`/`unchecked`/`failed`/`skipped`),
  and `handleAiRequest.ts`'s `locationNotice` names up to three unverified,
  failed, or skipped places in the reply message instead of reporting success
  either way — `unchecked` (accepted with nothing yet to check it against,
  which is the common case on the very first lookup of a freshly planned trip)
  is deliberately excluded from the message to avoid training the user to
  ignore it, but stays in the payload.
- **What is still open:** the model still *guesses* the coordinate, and a guess
  that happens to agree with a fuzzy string match is still reported as
  "verified" — enrichment can refine a location, it cannot confirm one is
  real. The acceptance thresholds (`MAX_REFINE_KM` 50 km, trip margin 150 km,
  hint margin 50 km) are heuristics chosen from one dogfood run, not measured
  against a corpus. `boundingBoxAround` does not handle the antimeridian — a
  Pacific-spanning trip degrades to no useful bias (fails safe, not wrong;
  left deliberately unfixed). And the first lookup on a trip with no geocoded
  activities is still `unchecked` by construction: the batch has no region
  until something resolves, so a wrong first answer both survives and becomes
  the anchor the rest of the batch is checked against. Ordering lookups by how
  reliably they geocode would help; M9's grounding removes the problem
  instead.
  A final whole-branch review (2026-08-06, before merge) found and fixed a
  sharper version of the same problem — a model hint was never checked against
  an available trip region at all, so a wrong-but-plausible hint could be
  reported `verified` and permanently widen `tripRegionOf`'s box on every later
  request for that trip (`resolveOne` now requires agreement with *every*
  belief in play, not just the strongest one — see the `hintTrusted` logic and
  its comment in `geocodeEnrichment.ts`) — and a dedupe bug where two commands
  sharing a place name but carrying different coordinates could have one's
  location silently stamped onto the other on the fallback path (fixed:
  `unverified`/`failed` now rebuild each command's location from its own
  input, never a name-sibling's). That second review left three narrower,
  accepted residuals rather than blocking on them:
  1. The dedupe fix only covers the fallback path — on the **`verified`**
     path, one command's hint still drives the shared lookup and its match is
     still applied to every command sharing the name, so a second command's
     own distinct coordinates can still be silently discarded (bounded: the
     shared match must fall inside the trip region if one exists, so it can't
     relocate the second command arbitrarily far, only to the first's place).
  2. A geographically spread trip (e.g. adding a Venice day to a Rome-only
     trip) now costs more `unverified` reports than before: a genuine hint for
     the distant leg is untrusted against the established region, so the
     whole leg's activities lose the `verified` status they'd have gotten
     pre-fix. Fails safe (coordinates kept, user told) but is a real,
     user-visible behavior change worth knowing about before it's rediscovered
     as a support question.
  3. The monotonic-widening guarantee is narrower than "no bad location can
     widen the region" — it only bounds the *silent* (`verified`, no notice)
     path. An `unverified` fallback is still a raw, unvalidated model guess,
     and it still gets persisted and still feeds `tripRegionOf` on the
     next request exactly as much as a verified one would; the fix makes that
     widening *announced* (via `locationNotice`) rather than eliminating it.
- **Fix path:** M9, "Grounding". The model cites a `placeRef` from a real
  `SearchPlaces` result, so there is nothing to overwrite and nothing to
  guess; enrichment survives only as a fallback for user-typed text.
- **The prompt, verbatim** (kept exactly as typed so it can be replayed as M9's grounding regression test):
  > Plan a 3 day trip to Rochester ny, One day visiting the falls in Niagara, and another visiting the strong museum of place in rochester. Find and add lunch and dinner restaurants for each day near those locations
- **Symptom (live run, 2026-08-02, trip `13fc0d33`):** of 9 activity locations, **2 were geocoded, 1 of those wrongly, and 7 came back with no coordinates at all** — including "Niagara Falls State Park", which resolves trivially. "Dinner at The Red Coach Inn" was persisted at **`lat 52.907918, lng -2.8901` — "The Red Lion Coaching Inn, Shropshire, England"**, ~5,500 km from the trip. Nothing in the response distinguishes a verified place from an unverified one.
- **Two independent causes, both in `geocodeOne`/`enrichCommandLocations`:**
  1. **Unconditional top-match overwrite.** `geocodeOne` takes `forward(name, { limit: 1 })[0]` with **no viewbox, no region bias, and no acceptance test**, then the caller replaces the command's `location` with it. In the Red Coach Inn case the model had supplied **correct** coordinates (`43.0866, -79.0628` — Niagara Falls, NY, visible in `meta.toolCalls`); enrichment discarded a right answer for a fuzzy string match on another continent. The "canonical name REPLACES the model's raw name" rule was lifted from the manual `LocationInput.tsx` flow, where **a human picks from candidates** — that human is the part that didn't survive the port.
  2. **Parallel burst against a 2 req/sec vendor.** `enrichCommandLocations` fires every unique name concurrently via `Promise.all`. **LocationIQ's free tier is 5,000/day but rate-limited to 2 requests/second**, so a 9-name batch 429s on most of them; `forward` throws on `!res.ok`, and `geocodeOne`'s bare `catch { return { name } }` swallows every one into a coordinate-less `Location` indistinguishable from "this place does not exist". The dedupe/parallelism was written as a free-tier *saving* (daily cap) and is counterproductive against the *per-second* limit that actually binds.
- **First noted:** 2026-08-02 (Mitchell, M8 dogfooding — trip `13fc0d33`).

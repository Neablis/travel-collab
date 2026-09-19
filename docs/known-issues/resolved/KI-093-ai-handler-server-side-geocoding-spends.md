### KI-93 — The AI handler's server-side geocoding spends the LocationIQ key without consulting the geocode quota at all — RESOLVED
- **Severity:** correctness (a spend gate with a second, unmetered door into the same vendor key)
- **Area:** `apps/web/src/server/ai/writeTools.ts` (the `enrichCommandLocations` call, inside `commitProposal`), `apps/web/src/server/ai/geocodeEnrichment.ts`, `apps/web/src/server/quota.ts` (`geocodeQuota`). Filed against `handleAiRequest.ts`, which ADR-033 Decision 4 deleted; the unmetered call site moved to the approval path with it, and the defect is unchanged.
- **Symptom:** `geocodeQuota()` has exactly one caller — `apps/web/src/app/api/geocode/route.ts`. The AI handler geocodes through a completely separate path: after the model's commands are resolved, `enrichCommandLocations(resolvedCommands, () => geocoder ?? getGeocoder(), …)` performs a LocationIQ lookup **per unverified location in the batch**, and nothing on that path reads or charges the geocode policy. So the daily ceilings that exist to protect `LOCATIONIQ_API_KEY` — per-user 300, global 4000, the global one deliberately set below LocationIQ's 5,000/day free tier — bound the proxy endpoint only.
- **Why it matters more than it looks:** the AI path is the one that geocodes in *bulk*. A single planning request can resolve many new activities, each needing a lookup, and `server/ai/rateLimit.ts` exists precisely because one AI request can otherwise breach LocationIQ's **per-second** limit. That module paces the lookups; nothing counts them. The result is that the endpoint a user drives one button-press at a time is capped at 300 lookups a day, while the endpoint that can emit dozens per call is capped at nothing.
- **Not the same defect as KI-67, which is why it is filed separately.** KI-67 was a wrong *denominator* — the AI request policies metered calls when cost varied per call. This is a missing *call site*: the denominator for geocoding is already right (one request, one lookup), the policy simply is not consulted on the path that spends the most. Fixing KI-67 does not touch this.
- **Fix path, if taken:** charge `geocodeQuota()` for the lookups an AI request actually performs. The count is available — `enrichCommandLocations` already returns a `LocationEnrichmentReport` — so the mechanism KI-67 added (`settleAiSteps`'s post-hoc, never-refusing settlement) generalises to it directly: pre-authorise nothing, settle the real lookup count after enrichment. The open question is the same one KI-67 answered for steps and would want answering again here: enrichment is explicitly best-effort and *never fails the request*, so a geocode ceiling reached mid-batch should almost certainly stop *further lookups* rather than refuse the AI request, which means the check belongs inside the enrichment loop rather than around it.
- **Why not fixed here:** found while fixing KI-67, and outside that change's declared scope. It also needs a decision about mid-batch behaviour that is a product call, not a mechanical one, and `docs/guidelines/` has no stated policy on partial enrichment under a quota ceiling.
- **Cross-reference:** KI-67 (resolved — the AI step metering, and the mechanism this would reuse), ADR-007 (server-side geocode enrichment), KI-15 (the region-agreement rule enrichment applies), KI-24.
- **2026-09-11, M9 Phase 0 P5 — this entry gets a SHAPE to settle into and does not get a count. Read this before assuming the kernel work closed any of it.** ADR-043's `TurnLedger` has a `capacity` field, typed and provably un-summable into `cost` (model tokens are the billable marginal spend; a daily-capped free tier is a capacity limit — M20 link 9's third decision, enforced by a property test). The spec claimed *"a `spend: 'vendor'` tool's lookups are ledger lines"*, and **that is false of this defect**: no tool declares `spend: "vendor"` — all eight declare `"none"` — and **the actual LocationIQ door is `commitProposal`'s geocoder on the APPLY path, which is not a tool and does not run inside a turn at all.** So `capacity` is structurally `[]` on every `/ask` turn today, and `/ask/apply` emits no ledger at all (nothing constructs the `"ask.apply"` variant of `TurnCost`, because that endpoint makes no model call). The fix path in this entry is unchanged and still correct — charge `geocodeQuota()` for the lookups an AI request performs, settle post-hoc from `enrichCommandLocations`'s existing `LocationEnrichmentReport`, and put the check inside the enrichment loop rather than around it so a ceiling reached mid-batch stops further lookups rather than failing a best-effort step. What P5 added is the place to put the count and a type that stops it being mistaken for a bill; what is still missing is the producer and the mid-batch product decision.
- **First noted:** 2026-08-29, while fixing KI-67.

- **Numbering:** filed as 77 on 2026-08-29, when several sibling branches each filed a different KI-77 the same night. Renumbered to 93 on merge. Nothing outside this file references it.
- **Milestone:** **M9 GATE BOX (assigned 2026-09-01)** — a written box in M9's exit gate. Grounding multiplies LocationIQ traffic, so the unmetered door closes with it. Assignment rationale — why three of the twelve AI entries gate M9 and nine are carried — is in `docs/milestones/M9-ai-planning-partner.md`, section "The AI known issues".

- **RESOLVED 2026-09-16, with M9's grounding, which is where this entry always said it belonged** — *"grounding multiplies the traffic through that vendor, so this closes with it, not after it."*

  **What was built, and it is two doors rather than one.** Grounding added a
  second path to `LOCATIONIQ_API_KEY` in the same change that closed the first,
  so the fix had to cover both or it would have swapped one unmetered door for
  another:

  1. **`enrichCommandLocations`** — the door this entry is about — takes a
     `GeocodeCharge` port and charges it once per lookup it actually makes,
     across BOTH passes. The city fallback is metered too, which matters more
     than it reads: KI-2026-08-30-f is why that pass is the common one, so
     metering only the venue pass would have left the busier half uncounted.
     `commitProposal` binds the port to `consumeQuota(geocodeQuota(), actorId)`
     — the approver, which is the same identity `/api/geocode` charges, so one
     person's day is one number wherever they spend it.
  2. **`placeSearchPort`** (`server/ai/assistantPorts.ts`) — the new door, the
     app side of `search_places` — charges the same policy, per query, before
     the vendor is asked.

  **The mid-batch question this entry said was a product call, answered:** a
  ceiling reached mid-batch **stops further lookups and does not fail the
  request**. This entry's own fix path argued for it (*"enrichment is explicitly
  best-effort and never fails the request"*), and the alternative turns a daily
  ceiling into an outage on a path that already degrades. The names past the
  ceiling are reported `skipped` — exactly as the names past
  `MAX_LOOKUPS_PER_BATCH` already are — and the batch commits with those stops
  unpinned. The reasoning is in `docs/plans/2026-09-16-M9-remainder.md` §B.
  `search_places` takes the opposite posture and says why: a refusal there is a
  tool result the model reads and can talk about, which is a recovery path
  enrichment does not have.

  **Charged, not reserved.** One lookup, one charge, settled as it happens —
  the denominator `geocodeQuota`'s own comment says is already right. No
  `reserveAiSteps`-style pre-authorisation, because there is nothing to refund.

  **What P5's note asked for and did not get, now got.** That note is correct
  that no tool declared `spend: "vendor"` and that the real door was on the
  apply path. `search_places` is the first tool to declare it, and
  `grants.test.ts` now measures the set of spending tools as a filter over the
  registry — so a second one is a decision somebody notices rather than a door
  somebody finds later.

  **Proved rather than asserted.** `geocodeEnrichment.test.ts`'s
  *"the geocode quota (KI-93)"* suite drives the charge port directly (seven
  cases: charged per lookup, stops at the ceiling, stops charging after a
  refusal, never constructs a geocoder for a wholly refused batch, charges the
  city pass, does not run the city pass past the ceiling, unmetered by default).
  `assistantPorts.test.ts` does the same for the search door. And because a mock
  is a boundary, `writeTools.test.ts` asserts the WIRE at the one call site that
  binds it: `consumeQuota` called once, with `geocodeQuota()`'s policies, as the
  actor. Every one of those was watched failing for its own reason before it
  counted.

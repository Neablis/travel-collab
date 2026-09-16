# M22 — An account can build on the API

**Status:** **CURRENT MILESTONE as of 2026-09-16, and building.** Placed that
morning on Mitchell's call (*"Im fine making it after M21"*), scoped the same
day, then **moved ahead of M21 by his explicit decision** — offered the choice
between closing M21 first and reordering, with the cost stated, he chose the
reorder. The live order is
`M17 ✓ → M9 [Phase 0 ✓, paused] → M20 ✓ → M21 [OPEN, paused at 11/17] → M22 → M12 → M13 → M14 → M19`.
Both notes: `docs/milestones/README.md`, 2026-09-16.

> **This milestone runs with its stated prerequisite unmet**, which is a
> deliberate decision and not an oversight. M21 is open at 11 of 17 and paused;
> nothing about it is amended. **The one thing that prerequisite was protecting
> has a checkpoint, below** — see *Phase 0 → Phase 1: the checkpoint M21's pause
> creates*, which is a gate on entering Phase 1 rather than a box at the end.

**Every decision is closed as of 2026-09-16**, including the last one flagged
back to Mitchell — `api.tokens` ships on **`premium@v2`** (*"Just do v2 then."*).

**The design is fully decided and is not restated here.**
`docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md` carries 14
numbered decisions, a plain-language inventory of all 46 existing API routes,
and the phasing this file's scope is derived from. **Read it first.** This file
adds the two things a spec is not: what is in and out of the milestone, and
what has to be true before the gate closes.

**M20 built what a plan grants. M21 makes a plan purchasable. This one hands
the account a key to its own data.** A public REST API under
`apps/web/src/app/api/v1/**`, and account-generated tokens scoped to the whole
account or to named trips, with create and revoke.

**It needs one migration** — `api_tokens`. Phase 1's PR body says so and
dispatches `gh workflow run migrate-production.yml -f confirm=migrate` from
`main`.

**Three boundaries fixed by Mitchell at placement, and each is load-bearing
rather than a first cut**: user accounts only, **no admin surface**, **no AI
surface**. A token can never spend model budget, which is also why the AI
quota and entitlement paths need no change at all.

## Why it is a milestone and not a feature

**Because the second endpoint is the one that decides whether there is a
thirty-fifth.** The requirement Mitchell opened with was not "an API" — it was
*"the api to not require infinite maintenance as we add new endpoints"*. That
makes this milestone's deliverable a **seam**, and the endpoints are what
demonstrate it. A feature ships a surface; this ships the thing that decides
what every later surface costs.

Three consequences follow, and they are why the phases below are ordered the
way they are.

1. **Phase 2 is irreversible in practice.** If `route()` is wrong, it is wrong
   35 endpoints later and wrong in the public contract of every one of them.
   So Phase 2 lands at the smallest size that can fail — the wrapper plus two
   read pilots — and Phase 4 is repetition rather than design.
2. **"Registered" has to be enforced or it is decoration.** The design
   deliberately has **no registry file**: the directory is the registry
   (Decision 1), because a hand-maintained list of exposed routes is exactly
   the second copy AGENTS.md invariant 5 and ADR-037 forbid. What makes that
   true rather than merely intended is the conformance test (Decision 11), and
   it is scope, not polish.
3. **A token is a credential with a months-long life.** Every mistake here has
   a longer fuse than a UI bug: a cached entitlement, a plaintext secret, a
   revocation that races. The gate below is weighted accordingly.

## Scope

Five phases, each independently reviewable. Derived from the design's *Phasing*
table; the deviations from it are named where they occur.

### Phase 0 — the vocabulary, before anything depends on it

`ApiScope` (the eight scopes, Decision 4), the `ApiToken` DTO, the error
envelope `{ error: { code, message, details? } }`, and **`Entitlement` gains
`api.tokens`**. Changelog entry in `docs/contracts/CHANGELOG.md`, all consumers
in the same PR, per the contracts protocol.

**This is a `packages/contracts/src` change, so it is not narrowable.** The
`minimal-check-subset` skill says so directly: consumers span packages, so
Phase 0 pays full `pnpm check`. Budget for it rather than discovering it.

**One correction to the design's phasing table, and it matters for
sequencing.** That table puts *"`premium@v2` published"* in Phase 0, while
Decision 12's flagged item says the open question *"is not a blocker for Phase
0, which does not touch the plan file."* Both cannot be true. The resolution is
cheap and is taken here: **Phase 0 is the contracts change only, and publishing
the plan version moves to Phase 1**, alongside the `accountCan` check that is
the first thing to actually read it. Phase 0 then genuinely does not touch
`planVersions.ts`, and the one owed decision (below) stops sitting on the
critical path.

### Phase 0 → Phase 1: the checkpoint M21's pause creates

**Phase 1 may not start until one of two things is true**, and this is the whole
of what M22 owes M21 for running ahead of it.

Publishing `premium@v2` makes it what `livePlanVersion("premium")` returns, and
`startCheckout` buys the live version and nothing else
(`billing/checkout.ts:119`). A version's Stripe Price is created **lazily, at its
first checkout** (`prices.ts:104-160`), and **`premium@v1` has never been
bought** — so its Price does not exist, and after `v2` publishes, nothing the
product offers can ever create it. `checkPriceConsistency` cannot stand in for
the purchase: a version with no Price reports `missing`, not `ok`
(`prices.ts:184-213`).

So M21's second gate box — *every priced version's `stripe_price_id` resolves to
a Stripe Price with a matching amount and currency* — becomes **unclosable as
written for `premium@v1`** the moment Phase 1 lands. Either:

1. **One Premium subscription is bought and refunded first**, which is the
   remedy M21's own box note already names; or
2. **Mitchell amends the box**, which only he may do.

**Phase 0 is unaffected and needs no checkpoint** — it is the contracts change
alone and does not touch `planVersions.ts`. That is why the split exists, and it
now has two independent reasons.

### Phase 1 — storage, the module, and the entitlement it enforces

Migration `api_tokens` (Decision 6's table, with `expires_at notNull` per
Decision 13). `src/server/api-tokens/` — mint, list, revoke, verify. **The
`accountCan(owner, "api.tokens")` check on both mint and verify**, and
**`premium@v2` published** carrying `["ai.ask", "ai.command",
"trip.collaborators", "api.tokens"]`, enumerated in full and never as a spread
of v1. Integration tests against real Postgres. **No routes.**

Proves hashing, the revocation race, resolve-on-read, and that a lapse
disables without revoking.

### Phase 2 — the seam, at the smallest size that can fail

`Actor`, `resolveActor`, the `route()` wrapper, the conformance test, the
actor-accepting sibling of `requireTripAccess` — and **two pilot endpoints**,
`GET /v1/trips` and `GET /v1/trips/:id`.

**All 46 existing `requireTripAccess` call sites keep working against the old
signature** (`trip-access.ts:126` calls `auth()` itself). If this phase's diff
edits call sites, the sibling was built wrong.

### Phase 3 — a person can actually do this by clicking

A **Tokens section in `AccountSettingsSheet`** — the `PlanSection` precedent, a
section rather than a route. Create with one-time reveal, list with **time
remaining** rather than a creation date, revoke. **And what a `free` or `plus`
account sees instead**, which is an upgrade prompt and not a hidden section.
E2E.

This is the phase that satisfies the Definition of Done's reachability rule.
**Phases 0–2 are explicitly not clickable, and their PR bodies say so** rather
than leaving the question unanswered.

### Phase 4 — the rest of the surface, and the proof it was cheap

The remaining v1 endpoints (roughly 35 in total, of which 13 are the planning
writes), `openapi.json` served from `/api/v1/openapi.json` via
`zod-to-json-schema` (zod is **v3**; any tool that assumes v4 is out), and
`docs/guidelines/using-the-api.md`.

**Phase 4 is where the gate's headline box is measured**, because a claim about
endpoint N+1 cannot be tested at endpoint 2.

## What is in v1, and what is not

The design's inventory is authoritative; the two things worth repeating here
are the ones most likely to be re-litigated mid-build.

**The planning-write surface is thirteen REST endpoints**, and the internal
command envelope is **not published**. `POST /api/trips/:id/commands` is
BFF-shaped — it returns the whole refreshed trip plus its history on every
write, because the board re-renders from the mutation response. Publishing it
would freeze both the `TripCommand` union and a response built for our own
re-render as public contract.

**A PATCH is a PATCH** (Decision 14). `PATCH /v1/trips/:id/activities/:id`
updates an activity whatever fields it carries; a patch touching both a stop's
fields and its day composes the existing all-or-nothing
`executeTripCommandBatch`. The API never mirrors the internal command split.

**The existing 46 routes are not migrated.** `v1/` starts empty and is
populated deliberately; the frontend keeps calling `/api/*`. When an endpoint
genuinely belongs to both audiences, the `apiClient.ts` helper switches its
path — one line, opt-in, reversible.

## The cost this milestone does not eliminate, stated before it is discovered

Three, so that no gate box overclaims and no later session is surprised.

1. **Every write endpoint costs one mapping.** REST over an event-sourced
   planning domain means `POST /v1/trips/:id/days` must *become* an `AddDay`.
   That translation is semantic and no wrapper can derive it. Reads are close
   to free — they are projection queries over DTOs that are already contracts.
2. **A v1 endpoint the frontend adopts costs an MSW handler.**
   `apps/web/src/mocks/handlers.ts` is hand-written per route with no
   generator, and that is already true today. The "free forever" claim holds
   for endpoints **only external callers use**; the moment an `apiClient.ts`
   helper switches its path to v1, the handler follows it. The gate box below
   is worded to measure the honest version of the claim rather than the
   flattering one.
3. **Every token-authenticated request resolves entitlements from the
   database** — three queries, once per request, passed down. Never cached on
   the token row and never read from a JWT, because *a downgrade must bite
   before a token refreshes* and a token lives for months.

## Exit gate

The first box is the milestone's thesis. The rest exist because a credential
with a one-year life fails quietly.

- [ ] **Adding endpoint N+1 costs a declaration and nothing else.** With the v1
      surface built, a new endpoint is added and its diff touches **one file
      under `v1/`** plus, at most, a schema in `packages/contracts` if its DTO
      is new. **No auth, no scope plumbing, no validation, no error handling,
      no pagination, no rate limiting, no OpenAPI entry, no client and no MSW
      handler are written by hand.** Measured by doing it and reading the diff,
      not asserted. **Two exceptions are stated in advance and are not
      failures**: a *write* endpoint additionally carries its command mapping,
      and an endpoint the frontend itself adopts additionally carries an MSW
      handler (see *The cost this milestone does not eliminate*). Any third
      exception means the wrapper is incomplete and this box does not tick.
- [ ] **A raw handler under `v1/` fails CI.** `export async function GET` in a
      `v1` route file, or a `route()` declaration missing a scope or a response
      schema, is red — **seen red, for that reason, before this box ticks**
      (CLAUDE.md rule 3). This is the whole of what makes "the directory is the
      registry" true rather than intended.
- [ ] **A route outside `v1/` is unreachable with a token**, and no BFF route
      acquires a bearer path. A valid token against `/api/trips` is refused as
      unauthenticated, and the 46 existing routes behave exactly as they did.
- [ ] **A token can never grant more than its owner holds.** Both gates run, in
      order: scope first, then the unchanged `requireTripAccess` role check.
      Demonstrated by removing the owner's membership on a trip and watching
      every token lose that trip on the next request — **with no write to any
      token row**.
- [ ] **A trip-scoped token is refused on a route with no trip dimension.**
      `POST /v1/trips` and `GET /v1/account` refuse a token restricted to named
      trips, because creating a new trip from such a token is a widening.
- [ ] **A token's secret exists in exactly one place: the screen it was created
      on.** Full table access to `api_tokens` does not reproduce a working
      token — `sha256` at rest, unique index, an 8-character `prefix` for
      display only, `timingSafeEqual` on comparison. The creation response is
      the only time the secret is ever returned.
- [ ] **Revocation is a single guarded `UPDATE … WHERE id = ? AND revoked_at IS
      NULL RETURNING`**, never a read followed by a write, and a test fails if
      that shape is replaced. Revoking an already-revoked token returns ok, not
      404 (matching `revokeShare`); a non-uuid id returns **404, not a Postgres
      `22P02` 500** (KI-2026-09-05-x).
- [ ] **Expiry is mandatory and 365 days is the ceiling.** A request for a
      longer lifetime is a **400, not a silent clamp**; "never expires" is not
      offerable; the default offered is 90 days.
- [ ] **An expired token answers differently from a revoked one.** Both 401,
      distinct error `code`s, so an integrator reading the response learns
      "mint a new one" rather than "you were cut off". An expired token is
      **refused, not deleted** — the row stays listable so a user can see what
      lapsed.
- [ ] **Expiry and revocation are resolved on read and never swept**, and a
      test fails if a cleanup job is ever added — the `grants.retention.test.ts`
      precedent, which exists for exactly this.
- [ ] **A `free` or `plus` account cannot mint a token** — 402, matching the
      existing `AI_NOT_ENTITLED_STATUS` precedent rather than inventing a
      second shape — **and cannot use one either**, checked on every request
      against the owner's live entitlements.
- [ ] **`premium@v1`'s entry is byte-identical after this milestone**, and
      `noExtension.test.ts`'s `V1_AS_PUBLISHED` was never edited. `api.tokens`
      arrived as `premium@v2`, enumerated in full and never as a spread of v1 —
      so M20's ticked *"editing a plan republishes rather than mutates"* box
      stays true, and *"what did `premium` grant on 2026-09-13"* stays
      answerable.
- [ ] **A lapse disables tokens; it does not revoke them.** A `premium` account
      lapses, every token is refused with 402, `revoked_at` stays null — and
      resubscribing restores **every one of them with zero writes**. A billing
      lapse can never destroy a customer's integration.
- [ ] **No entitlement is cached on a token row and none is read from a JWT.** A
      downgrade bites on the next request, not on the next token. A test fails
      if `api_tokens` ever gains an entitlement column.
- [ ] **A person mints, copies and revokes a token by clicking**, sees time
      remaining on each, and a `free` account sees an upgrade prompt where the
      section would be — walked in a browser on the preview, and in
      `pnpm --filter web test:e2e:ci-like`.
- [ ] **The reference docs cannot drift from the implementation.** Changing a
      route's declared response schema changes `/api/v1/openapi.json` in the
      same diff, because it is derived from the declaration at build time and
      is hand-written nowhere. Demonstrated by changing one and reading the
      output.
- [ ] **Token traffic is rate limited and session traffic is not.** Reuses
      `consumeQuota` with bucket `"api:token:<tokenId>"` plus a global — no new
      counter store, the existing 429 with `Retry-After`, and the existing
      fail-closed-to-503 when the counter store itself fails.
- [ ] **A read does not cost a write.** `last_used_at` updates only when the
      stored value is older than five minutes, fire-and-forget, never blocking
      the response — proven by counting writes across a burst of requests, not
      by reading the code.
- [ ] **No admin surface and no AI surface exist.** No scope names them, no
      `v1` file reaches them, and a token cannot reach `/api/admin/**`,
      `/ask` or `/ask/apply`. `/api/admin/**` keeps its 404-on-failure posture
      untouched.

## Prerequisites

**~~M21's gate must close first.~~ Overridden 2026-09-16 by Mitchell's explicit
decision** to run M22 ahead of M21 — offered that choice against closing M21
first, with the cost in front of him. AGENTS.md's rule against building ahead of
the current milestone is what made this his call to make rather than a default
taken quietly.

**The dependency was real rather than procedural, so it did not vanish — it
moved.** Phase 1 publishes `premium@v2`, and what `premium` costs and how it is
sold is M21's to settle. That is now the **Phase 0 → Phase 1 checkpoint** above,
which is a stricter statement of the same constraint: not *"M21 must close"* but
*"one specific purchase must happen, or one box must be amended."*

**Everything underneath already exists.** Entitlements and plan versions (M20),
the trip-access seam, `consumeQuota`, the revocation pattern, the account sheet
and its `PlanSection` precedent. This milestone adds a credential and a seam on
top of them; it needs nothing new underneath.

**Nothing in the design is blocked.** Phases 0–4 are buildable on the 14
decisions as written.

## Nothing is owed — and the cohort that is quietly growing

**`api.tokens` ships on `premium@v2`. Decided by Mitchell, 2026-09-16: *"Just do
v2 then."*** His first answer was *"just assign it to v1, its unused atm"*, and
its premise was right — `premium@v1` has never been purchased — but that makes
**both** options free of stranded users, and between two free options the one
that edits a published entry is the more expensive. Editing `v1` in place
falsifies a **ticked M20 gate box** (*"`v1`'s entry is byte-identical
afterwards"*) and requires rewriting `planVersions.noExtension.test.ts`, whose
`V1_AS_PUBLISHED` pins premium's entitlements field by field for exactly this
reason. Publishing `v2` costs nothing, because `livePlanVersion` returns the
newest entry and never consults a flag (`planVersions.ts:340-345`). Full
argument: the design's Decision 12.

**What Phase 1's diff may therefore not contain**, because this is the shape the
decision dies in if a later session finds it fiddly: no edit to `premium@v1`'s
entry, and no edit to `V1_AS_PUBLISHED`. If either moves, `v2` was reversed by
accident rather than by decision. **`premium@v1` byte-identical after Phase 1 is
a gate box below**, not an assumption.

**What is not owed but is worth watching**: a subscription pins `planId@vN`
forever and **there is deliberately no mechanism to move an existing
subscriber** (M21's 2026-09-02 amendment — *what you bought is what you get*).
So a `premium@v1` subscriber never gets API tokens unless issued an **admin
grant of `premium@v2`**, which needs no new machinery — entitlements resolve as
the union of the held version and every grant's pinned version, and M20's grant
UI already exists. **That cohort grows for every week M21 sells `premium@v1`
before M22 lands**, which is an argument for the two milestones running close
together, not for changing anything here.

## What this milestone deliberately does not do

- **No OAuth, no third-party app authorization, no outbound webhooks.**
  Personal tokens for the account holder, which is what was asked for. Each of
  those is a separate product with its own consent surface.
- **No rotate-in-place.** Creating a replacement and revoking the old one are
  both single actions, so rotation is two clicks rather than a feature. Naming
  it here stops it being assumed.
- **No edge-level token check.** JWT sessions have no adapter and the Edge
  runtime has no database, so a token is verified in the route — where every
  other check in this app already happens.
- **No migration of the existing 46 routes**, and no deprecation of any of
  them. The BFF and `v1` coexist permanently (design question 5).
- **No fix for `KI-2026-09-16-b`**, filed by the design pass rather than fixed:
  `planVersions.ts`'s header cites an immutability test that does not exist.
  Phase 1 republishes a plan version and so runs straight past it. Fixing it is
  cheap and is a fair candidate for Phase 1's PR, but it is **not** a gate box
  here — it is M20's defect, not M22's scope.

## What was built

### Phase 0 — the vocabulary — **landed 2026-09-16**

`packages/contracts/src/publicApi.ts`: `ApiScope` and `API_SCOPES` (eight),
`SCOPE_CATALOGUE`, `ApiErrorCode` and `ApiError`, `ApiToken`, `ApiTokenCreated`,
`ApiTokenCreateInput`, and the four token-format constants.
`packages/contracts/src/entitlement.ts`: `Entitlement` gains `api.tokens`.
Changelog entry in `docs/contracts/CHANGELOG.md`.

**It touched no plan version**, which is what the Phase 0/1 split exists for —
see the checkpoint above. `planVersions.ts` is untouched, `premium@v1` is
byte-identical, and `noExtension.test.ts` was not edited.

**Three decisions taken while writing it, none of which the design had settled:**

1. **`SCOPE_CATALOGUE` ships in Phase 0 rather than with the UI in Phase 3.**
   The design names it in Decision 4 but places it nowhere. Its exhaustiveness is
   the mechanism — a ninth scope cannot compile until someone writes the sentence
   — and deferring it means eight sentences get drafted in a hurry by whoever
   builds the form, long after the person who knew what the scope was for. The
   sentences the design already wrote for Mitchell are the ones that shipped.
2. **`ApiErrorCode` is an enum of twelve**, derived from the behaviours Decision
   10 and Decision 13 already fixed rather than invented — including
   `token-expired` and `token-revoked` as two codes for one status, which is
   Decision 13's requirement stated in the type system.
3. **`ApiToken.scopes` has no `.min(1)` while `ApiTokenCreateInput.scopes`
   does.** Minting a scopeless token is refused; listing one is not. A row that
   somehow has no scopes is the one its owner most needs to find in order to
   revoke it, and a read schema that refused to parse it would hide exactly that
   row.

**Verified.** Full `pnpm check` — a contracts change is not narrowable, because
consumers span packages. Green, including the 2,836-test web suite and the 613
integration tests.

**Every new test was seen to fail first**, per CLAUDE.md rule 3 — ten mutations,
each turning exactly its own test red and nothing else: dropping `sharing:write`,
adding an ordering constant, letting a scopeless token be minted, raising the
365-day ceiling, adding a `secret` to `ApiToken`, caching entitlements on it,
unfreezing the catalogue, making `expiresAt` nullable, removing one scope's
sentence, and removing `api.tokens`. The *compile*-time half of the catalogue
claim was proven separately: a ninth scope with no sentence errors `TS2741`.

**Nothing reads any of it yet, and no gate box ticks.** Phase 0 is not clickable
and its PR body says so — the reachability rule is Phase 3's to answer.

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
> nothing about it is amended. **Nothing in M22 waits on M21** — see *What M22
> owes M21, which is less than it first appeared*.

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

### What M22 owes M21, which is less than it first appeared

**Nothing. No phase of this milestone waits on anything in M21.**

This section exists because the first version of it said the opposite, and the
correction is worth keeping rather than deleting.

**Building and proving M22 needs no purchase and no Stripe.** An admin grant of
`premium` pins `livePlanVersion("premium")` (`api/admin/grants/route.ts:29`) and
`resolveEntitlements` unions the held plan version with every grant's pinned
version (`resolver.ts:149-174`). So granting an account `api.tokens` — to test
with, or to hand a real user when the feature is ready — is one operator action
against a UI that already exists. That is M20's stated design, in the grant
route's own words: grants are *"the entire reason this milestone is provable
without Stripe."*

**What publishing `premium@v2` actually changes**, stated accurately: after it
lands, `livePlanVersion("premium")` returns v2, so a Premium purchase creates and
verifies **v2's** Stripe Price rather than v1's — and `premium@v1`, which has
never been bought, keeps a Price that was never created. M21's second gate box
notes that buying and refunding one Premium subscription would close it.

**That is a footnote, not a blocker, and it was wrong to treat it as one.**
Once `v2` is live, `premium@v1` is unsellable, unheld and ungrantable — grants
pin the live version too — so verifying the Stripe Price of a version nobody can
ever buy or hold verifies nothing. `checkPriceConsistency` reports such a version
`missing`, which its own documentation calls *"an ordinary state"* rather than a
finding; `mismatch` is the verdict that matters and it cannot arise for a Price
that does not exist. A Premium purchase made after Phase 1 proves the version
that is actually live, which is the more useful proof.

**So M21's box is M21's to close, on M21's schedule**, and if its wording needs
to account for a superseded version that is an amendment for Mitchell — not
something M22 pays for in advance.

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

**No box here may be closed by a production observation, and the entitlement
boxes least of all.** Mitchell, 2026-09-16: *"if we built a feature that gates
functionality on a tier, and we need to see it actively work in prod once, than
it's not a good feature or tested well."* That is this repo's own named defect
class — an invariant asserted by a demonstration rather than by a test (KI-1,
KI-14) — and it has a standing answer: **M20 proved its entire tier system in
CI**, because a grant is account state and needs no vendor. Every `api.tokens`
gate below is provable the same way, against a seeded account and a grant, with
no Stripe and no deploy.

**The single exception is not an entitlement box**: the reachability box asks
that a person can do this by clicking, which is the Definition of Done's rule
for every milestone. Its evidence is
`pnpm --filter web test:e2e:ci-like` — a CI lane — and the browser walk on the
preview is a second look, never the proof. If any box below ever comes to rest
on *"we watched it work once"*, the box is wrong and the test behind it is
missing.

- [x] **Adding endpoint N+1 costs a declaration and nothing else.** With the v1
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
- [x] **A raw handler under `v1/` fails CI.** `export async function GET` in a
      `v1` route file, or a `route()` declaration missing a scope or a response
      schema, is red — **seen red, for that reason, before this box ticks**
      (CLAUDE.md rule 3). This is the whole of what makes "the directory is the
      registry" true rather than intended.
- [x] **A route outside `v1/` is unreachable with a token**, and no BFF route
      acquires a bearer path. A valid token against `/api/trips` is refused as
      unauthenticated, and the 46 existing routes behave exactly as they did.
- [x] **A token can never grant more than its owner holds.** Both gates run, in
      order: scope first, then the unchanged `requireTripAccess` role check.
      Demonstrated by removing the owner's membership on a trip and watching
      every token lose that trip on the next request — **with no write to any
      token row**.
- [x] **A trip-scoped token is refused on a route with no trip dimension.**
      `POST /v1/trips` and `GET /v1/account` refuse a token restricted to named
      trips, because creating a new trip from such a token is a widening.
- [x] **A token's secret exists in exactly one place: the screen it was created
      on.** Full table access to `api_tokens` does not reproduce a working
      token — `sha256` at rest, unique index, an 8-character `prefix` for
      display only, `timingSafeEqual` on comparison. The creation response is
      the only time the secret is ever returned.
- [x] **Revocation is a single guarded `UPDATE … WHERE id = ? AND revoked_at IS
      NULL RETURNING`**, never a read followed by a write, and a test fails if
      that shape is replaced. Revoking an already-revoked token returns ok, not
      404 (matching `revokeShare`); a non-uuid id returns **404, not a Postgres
      `22P02` 500** (KI-2026-09-05-x).
- [x] **Expiry is mandatory and 365 days is the ceiling.** A request for a
      longer lifetime is a **400, not a silent clamp**; "never expires" is not
      offerable; the default offered is 90 days.
- [x] **An expired token answers differently from a revoked one.** Both 401,
      distinct error `code`s, so an integrator reading the response learns
      "mint a new one" rather than "you were cut off". An expired token is
      **refused, not deleted** — the row stays listable so a user can see what
      lapsed.
- [x] **Expiry and revocation are resolved on read and never swept**, and a
      test fails if a cleanup job is ever added — the `grants.retention.test.ts`
      precedent, which exists for exactly this.
- [x] **A `free` or `plus` account cannot mint a token** — 402, matching the
      existing `AI_NOT_ENTITLED_STATUS` precedent rather than inventing a
      second shape — **and cannot use one either**, checked on every request
      against the owner's live entitlements.
- [x] **`premium@v1`'s entry is byte-identical after this milestone**, and
      `noExtension.test.ts`'s `V1_AS_PUBLISHED` was never edited. `api.tokens`
      arrived as `premium@v2`, enumerated in full and never as a spread of v1 —
      so M20's ticked *"editing a plan republishes rather than mutates"* box
      stays true, and *"what did `premium` grant on 2026-09-13"* stays
      answerable.
- [x] **A lapse disables tokens; it does not revoke them.** A `premium` account
      lapses, every token is refused with 402, `revoked_at` stays null — and
      resubscribing restores **every one of them with zero writes**. A billing
      lapse can never destroy a customer's integration.
- [x] **No entitlement is cached on a token row and none is read from a JWT.** A
      downgrade bites on the next request, not on the next token. A test fails
      if `api_tokens` ever gains an entitlement column.
- [ ] **A person mints, copies and revokes a token by clicking**, sees time
      remaining on each, and a `free` account sees an upgrade prompt where the
      section would be — walked in a browser on the preview, and in
      `pnpm --filter web test:e2e:ci-like`.

      **Half proven, and left unticked for the other half.** The CI-like lane is
      green: `m22-api-tokens.spec.ts` walks the locked section, the operator
      grant, the mint with its one-time reveal, the token opening
      `GET /api/v1/trips` as a real bearer header, and the revoke closing it with
      `token-revoked`. **The browser walk on the Vercel preview has not
      happened** — there is no PR yet, so there is no preview — and this box asks
      for both. It closes when someone drives the deployed preview, which also
      needs `API_TOKEN_PEPPER` set there.
- [x] **The reference docs cannot drift from the implementation.** Changing a
      route's declared response schema changes `/api/v1/openapi.json` in the
      same diff, because it is derived from the declaration at build time and
      is hand-written nowhere. Demonstrated by changing one and reading the
      output.
- [x] **Token traffic is rate limited and session traffic is not.** Reuses
      `consumeQuota` with bucket `"api:token:<tokenId>"` plus a global — no new
      counter store, the existing 429 with `Retry-After`, and the existing
      fail-closed-to-503 when the counter store itself fails.
- [x] **A read does not cost a write.** `last_used_at` updates only when the
      stored value is older than five minutes, fire-and-forget, never blocking
      the response — proven by counting writes across a burst of requests, not
      by reading the code.
- [x] **No admin surface and no AI surface exist.** No scope names them, no
      `v1` file reaches them, and a token cannot reach `/api/admin/**`,
      `/ask` or `/ask/apply`. `/api/admin/**` keeps its 404-on-failure posture
      untouched.

## Prerequisites

**~~M21's gate must close first.~~ Overridden 2026-09-16 by Mitchell's explicit
decision** to run M22 ahead of M21 — offered that choice against closing M21
first, with the cost in front of him. AGENTS.md's rule against building ahead of
the current milestone is what made this his call to make rather than a default
taken quietly.

**The dependency looked real and was not.** Phase 1 publishes `premium@v2`, and
the worry was that what `premium` costs and how it is sold is M21's to settle
first. But M22 never needed a *sale* — it needs an account that holds
`api.tokens`, and M20 built the grant path precisely so that does not require
Stripe. See *What M22 owes M21* above for the accurate version, and for the
footnote that a previous draft of this file inflated into a blocker.

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

### Phase 1 — storage, the module, the entitlement — **landed 2026-09-16**

Migration `0023_api_tokens`. `apps/web/src/server/api-tokens/` — `mintToken`,
`listTokens`, `verifyToken`, `touchLastUsed`, `revokeToken`, `expiredTokensFor`
— with `accountCan(owner, "api.tokens")` on **both** mint and verify.
**`premium@v2` published**, enumerating all four entitlements in full.
19 integration tests against real Postgres, plus `apiTokens.retention.test.ts`.
**No routes.**

**`premium@v1` is byte-identical and `noExtension.test.ts` was not edited** — the
gate box for that is below, and it is now provable by diff as well as by test.
Two tests that hardcoded `1` were changed to *derive* the live version
(`admin.int.test.ts`, `planVersions.test.ts`); they were asserting "the version a
grant pins", and the literal was a coincidence of `premium` having had exactly
one version.

**Every entitlement gate here is proven in CI with no Stripe**, which is the rule
this milestone's gate now states: the test fixture entitles an account with an
**admin grant**, exactly as an operator would. A lapse is modelled by an expiring
grant and time passing, so *"disables without revoking"* is asserted as a
byte-identical row rather than watched in production.

#### The founder cohort — a real gap, found by Mitchell asking

**Migration 0019 backfilled every pre-M20 account with a permanent `founder`
grant hardcoded at `'premium', 1`.** A grant confers the version it pinned,
forever (M20 rule 4). `premium@v1` does not grant `api.tokens`.

**So every founder keeps permanent premium-equivalent access and does not get API
tokens.** That is M20's pinning rule working correctly, not a defect in it — but
it is a product decision nobody has made, and it is larger than the subscriber
cohort this file already noted, because founders **exist today** while
`premium@v1` subscribers do not.

Two tests state it as current behaviour rather than leaving it to be discovered:
one proves a founder is refused, the other proves the remedy is **an additive
`premium@v2` grant** that leaves the pinned v1 grant untouched — so *"what did
this account hold on 2026-09-14"* stays answerable. No new machinery either way;
what is missing is only the decision about who should have tokens.

**Decided 2026-09-16 by Mitchell: leave it.** *"thats fine, lets just keep with
this work, no need to do the founder grant Vs Premium 1 or 2 issue."* **No
backfill migration.** A founder who wants API tokens gets an additive
`premium@v2` grant from an operator, through the UI M20 already shipped — the
second test above is what proves that path works and leaves the pinned v1 grant
alone.

**The two tests stay exactly as written.** They assert current behaviour, and
current behaviour is now decided behaviour rather than an unexamined default —
which is the difference between a gap and a choice. If the decision is ever
reversed, the backfill is one migration shaped like 0019 and those tests change
in the same diff.

### The token digest is keyed — **CodeQL alert 5, fixed 2026-09-16**

`github-advanced-security` raised `js/insufficient-password-hash` against
`hashOf`'s bare `sha256`. **Fixed as `HMAC-SHA256(API_TOKEN_PEPPER, secret)`.**

**Not by adding a slow KDF, and the distinction matters.** bcrypt, argon2 and
scrypt exist to make *guessing* expensive, which is the right answer for a
human-chosen password drawn from a small, skewed space. This secret is 32 bytes
of `randomBytes` — there is no space to guess through, so a KDF defends against
nothing here and charges roughly 100ms of CPU on **every API request** to do it.
For a surface a customer's integration calls on a schedule that is a real cost
bought with no benefit, and it is why GitHub, Stripe and AWS all store
high-entropy API credentials with fast digests.

**What the key buys, which the bare hash genuinely did not**, so the alert was
worth acting on even though its stated reason does not apply: a bare digest is
reproducible by anyone holding the database, so a leaked backup lets every row be
checked against a guess and lets anyone who learns a token's plaintext confirm
which row it is. Keyed, the digest cannot be computed without a value that does
not live in Postgres. **A stolen database is no longer enough to verify a
token**, and that costs nothing measurable.

**`API_TOKEN_PEPPER` is required and fails closed.** Unset, minting and verifying
both throw — an empty pepper still produces a stable digest, so a fallback would
leave tokens working while the property the key exists for silently did not hold,
which is the worst way for a credential store to be wrong because nothing errors.
Its own variable rather than a reuse of `AUTH_SECRET`: rotating sessions and
rotating API credentials are different emergencies and should not share a lever.
Rotating it invalidates every token, deliberately and with no migration path.

**No data migration was needed** — no token row exists anywhere. Migration 0023
has not been dispatched to production and `v1` has never served a request.

Two tests, both seen to fail first: one asserts the stored digest is **not** the
unkeyed `sha256` an attacker holding only the table would compute and that a
rotated pepper stops resolving the same secret; the other asserts the fail-closed
throw. Reverting `hashOf` to the bare hash turns both red.

### Phase 2 — the seam — **landed 2026-09-16**

`src/server/public-api/actor.ts` (`Actor`, `resolveActor`, `actorHasScope`,
`actorMayReachTrip`), `src/server/public-api/route.ts` (the wrapper),
`conformance.test.ts`, and **two pilot endpoints**: `GET /v1/trips` and
`GET /v1/trips/:tripId`.

**`requireTripAccess` gained its actor-accepting sibling and all 46 call sites
are untouched.** `tripAccessFor(userId, tripId, minimum)` is now the
implementation and `requireTripAccess` a thin session-resolving wrapper over it,
so exactly one place decides whether somebody may read a trip. It returns a
*reason* rather than a `Response`, which is what lets the BFF keep its bare-string
wire shapes while `v1` answers the same denial in its own envelope. Proven by the
full integration suite passing unchanged.

**Three decisions the design did not settle:**

1. **One `HandlerContext`, not a `PageContext` that extends it.** The split reads
   better and costs the thing the wrapper exists for: TypeScript cannot
   contextually type a parameter through a union of two function types whose
   parameters differ, so every declaration's `({ actor, trip })` became an
   implicit `any` and each route had to annotate its own context. One shape keeps
   a declaration a declaration.
2. **The response/handler correspondence is enforced at runtime, not by the
   compiler.** Typing `handle`'s return against `response`'s output is
   expressible and turns the declaration object into eight inference sites. The
   runtime check is also the stronger one for a public API: a compiler cannot
   prove the row the database actually returned matches the schema, and the
   wrapper's out-bound validation can.
3. **`GET /v1/trips` keeps the member overlay**, against the design's call for
   *"a reshaped"* collection. The design was right that the overlay's *motive* is
   the Home avatar stack, and that is not a reason to publish a members list that
   omits real members — this query returns trips reached through a
   `trip_memberships` row, and answering those with an owner-only array is a
   wrong answer rather than a lean one. One batched read for the page.

**One deviation worth naming**: the design specified a rate-limit bucket
`"api:token:<tokenId>"`; `consumeQuota` composes its own names as
`"<policy>:user:<id>"`, so passing the token id as the identity gives
`api:user:<tokenId>` and `api:global`. The global is exactly as designed; the
first differs in spelling only, and forking the quota module over a substring
would have been the more expensive mistake.

**Verified.** Full `pnpm check` green. 15 integration tests drive the pilots as
real HTTP, plus 5 conformance tests. Nine mutations against the wrapper, each
turning exactly the tests that describe it red and nothing else. **The
conformance test was proven both ways**: a raw `export async function GET` under
`v1/` fails with *"exports a raw GET"*, and a `route()` declaration that names a
trip without a role fails with *"is about a trip and names no role"*.

**Still not clickable.** Phase 3 is the Tokens section, and the reachability rule
is its to answer.

### Phase 3 — a person can actually do this by clicking — **landed 2026-09-16**

`TokensSection` in `AccountSettingsSheet`, a section rather than a route
(`PlanSection`'s precedent). The three BFF endpoints behind it:
`GET`/`POST /api/account/tokens` and `DELETE /api/account/tokens/:tokenId`.
A new design-system primitive, `components/ui/checkbox.tsx`.

**Token management is session-only, and that is a security decision rather than
a gap in the API.** These routes live under `/api/*`, not `v1/`, so no token can
reach them and no scope names one. A token that could mint tokens could grant
itself scopes its owner never approved; a token that could revoke tokens could
lock its owner out of their own credentials. The API can change your trips — only
you, signed in, decide what may hold that power. An integration test asserts it
directly, with a token holding **all eight scopes** refused.

**Listing and revoking are deliberately NOT gated on the entitlement.** Only
minting is. Refusing a lapsed account its list would leave live credentials the
owner can no longer reach, and taking away someone's ability to switch off a
credential because they stopped paying is indefensible.

**The three obligations mandatory expiry put on this screen are each a test**:
time remaining rather than a creation date; an expired token reading differently
from a revoked one; and rotation named as two actions rather than promised as a
feature.

**The design system gained a checkbox.** Nothing in the product had previously
asked a person to pick several things from a fixed list, so no primitive existed
— and the lint wall refused the raw `<input type="checkbox">`, correctly. The
rule surfaced a real gap, so the primitive got written rather than the rule
bypassed. `CheckboxField` carries the description beside the label because every
caller so far is asking someone to grant a capability, and a checkbox whose whole
meaning is a two-word title is one people tick without deciding anything.

**Two real defects, both caught by the tests that were written to find them:**

1. **Every scope checkbox would have thrown.** `e.currentTarget.checked` was read
   *inside* the `setScopes` updater, which runs during the next render — by which
   point React has released the synthetic event and `currentTarget` is null.
   Found by this component's own unit test, not by a person failing to tick a
   box. The fix is hoisted into `CheckboxField` so no future caller can repeat it.
2. **The screen blamed the person for our misconfiguration.** With
   `API_TOKEN_PEPPER` unset the route threw, and the error copy said *"Check the
   name and the number of days"*. Found by the e2e going red against a server
   that did not have the variable. There are now three messages because there are
   three different actions: your plan, your input, and ours.

**Verified.** Full `pnpm check` green, and the e2e in
`pnpm --filter web test:e2e:ci-like` — the only lane that counts. It walks
further than Phase 3 owns, deliberately: a free account sees the locked section,
an operator grant entitles it, a token is minted **by clicking**, that token is
then sent as a real `Authorization: Bearer` header to `GET /api/v1/trips` and
returns this account's trip, revoking by clicking makes the same call **401 with
`token-revoked` and `WWW-Authenticate: Bearer`**, and the dead token stays
listed. Removing the revocation check from `verifyToken` turns it red on exactly
that assertion (*"a revoked token must stop working at once"*, 200 where 401 was
expected). **No Stripe anywhere in it** — the entitlement arrives through the
operator console's own grant endpoint.

> **DEPLOYMENT: `API_TOKEN_PEPPER` must be set in Vercel for preview and
> production before this ships.** Unset, minting and verifying both throw and the
> Tokens section says so. `openssl rand -base64 32`. It is in `.env.example` and
> in CI; the hosted environments are the two nobody in this repo can set.

### Phase 4 — the surface, the reference, the guideline — **landed 2026-09-16**

**37 endpoints across 25 route files.** Account, trips (list, create, read,
patch, delete, restore), days, activities, conflicts, history (read, at a
revision, undo, redo, revert), Notebook pages, the saved-days library, share
links, invites, trip members, and city search. Plus `/api/v1/openapi`.

`docs/guidelines/using-the-api.md` — written for two audiences, a caller and
somebody in this repo adding an endpoint. Indexed in `CLAUDE.md` and the
guidelines README.

#### The headline claim, measured

**Endpoint N+1 was added and its cost counted**: `GET /v1/trips/:id/members`.

- **One new file, 18 lines.** Nothing else was edited.
- It typechecks, passes the conformance sweep, and appears in `openapi.json`
  with its scope, its required role and its `limit`/`cursor` parameters — all
  derived from the declaration.
- The only other file that changed is `openapi.json` itself, which is a
  **generated artifact one command rewrites**, not work anybody does.

No auth, no scope plumbing, no validation, no error handling, no pagination, no
rate limiting, no OpenAPI entry, no client and no MSW handler were written by
hand. The two exceptions the box names in advance — a write carries its command
mapping, and a frontend-adopted endpoint carries an MSW handler — did not apply
to this one, and no third exception appeared.

#### The reference is generated by its own check

`openapi.test.ts` is **both the generator and the guard**, deliberately: two
walks, one in a script and one in a test, would be two chances to disagree —
which is the exact failure the derived-docs claim exists to rule out.
`pnpm --filter web openapi:generate` sets `UPDATE_OPENAPI=1` and rewrites the
file; every other run compares. A schema changed without regenerating fails CI
**in the same diff that changed it**.

`zod-to-json-schema` with `target: "openApi3"`, because zod here is **v3** and
the default emitter produces draft-07 spellings OpenAPI 3.0 rejects.

#### The one exemption in the conformance sweep, and why it is one file

`/api/v1/openapi` is a raw handler under `v1/`, which the sweep otherwise
refuses. It serves the reference: no token, no scope, no rate limit, because it
is the same bytes for everybody and is public the moment one caller has it.
**The exemption is an allowlist of exactly one path, not a pattern** — a rule
like *"files named `openapi` are exempt"* is one somebody satisfies by naming a
file well. Proven still to bite: a `sneaky/route.ts` with a raw `GET` fails with
*"exports a raw GET"*.

#### Three decisions the design did not settle

1. **A v1 write answers with the affected resource, not the command result.**
   The BFF's command routes return the whole refreshed trip *and* its history
   because the board re-renders from the response. Publishing that would hand a
   third party a payload they did not ask for and freeze a React re-render's
   needs as public contract.
2. **`POST /v1/library` checks its trip by hand**, because its trip is in the
   body rather than the path and the wrapper only guards the path. That is the
   honest cost of putting the library outside `/trips/:id` — where it belongs,
   since days saved from a trip you later leave are still yours — and it calls
   the same seam rather than inventing a weaker check.
3. **`runCommand` takes the command schema's INPUT type**, not its output.
   `CreateTrip.forkedFrom` and `SetTripDates.newDayIds` carry `.default()`s, so
   the output type demands fields a handler has no opinion about.

#### Verified

Full `pnpm check` green — 2,865 unit tests, 208 files, plus the integration
suite. `surface.int.test.ts` drives the planning writes as real HTTP: a trip,
day and stop built entirely through v1; a four-field `PATCH` landing as **one**
history entry that undo unwinds as a unit; a stop patched in both its fields and
its day in one call; delete and restore. `rateLimit.int.test.ts` proves the
wrapper charges a token's bucket and **not** a session's, and renders both the
429 and the fail-closed 503 with their headers — removing the rate limit turns
all four red.

**Three fixtures of mine were wrong before the endpoints were**, and the
contracts caught every one: a page with no `content`, a `PageContext.kind` of
`"trip"` (the field is the literal `"overview"` or absent), and a `CreateTrip`
missing a defaulted field. That is the validation working at the boundary it was
put there for.

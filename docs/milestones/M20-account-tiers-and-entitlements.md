# M20 — An account knows what it may do

**Status:** Scoped and placed 2026-09-01. Runs **after M9**, before M21, in the
order set the same day: `M17 → M9 → M20 → M21 → M12 → M13 → M14 → M19`.
Placement is Mitchell's call and the reason is M9: `ai-live` defaults off and
grounding is what would let it be turned on, so selling AI access before M9
would sell a feature that is dark.

**This is the first commercial milestone in the product.** Nothing in the repo
has ever described a paid tier, a plan, a price or a payment — verified by
sweep, not assumed. That makes it a structural addition, not a feature: it
introduces a module to `AGENTS.md`'s module map, which is structural law.

**It takes no money.** Stripe, checkout, webhooks and the subscription
lifecycle are **M21**. This milestone builds what a subscription would *grant*,
and an operator surface that grants it by hand — which is exactly what makes it
provable end to end with no external dependency, no test-mode/live-mode split
and no PCI surface.

**It needs one migration** — `entitlement_grants`, plus `plan` and `is_admin`
on `users`. Merging does not apply it; dispatch with
`gh workflow run migrate-production.yml -f confirm=migrate` from `main`, and say
so in the PR body. Highest migration in `main` today is `0014`.

**A design handoff now covers three of the four billing surfaces**
(2026-09-02): `.design-sync/handoff/SPEC.md` §17 is the design,
`DRIFT.md` §2c is what it needs. Two of them are this milestone's — the
operator console (§17.2, and see link 7's split note: the revenue strip on it
is M21's) and the collaboration gate in Trip settings (§17.3). Read both before
estimating this milestone. **Every number on those screens is fixture data and
the two prices are placeholders.**

**The handoff cost this milestone scope, by Mitchell's decision of 2026-09-02.**
The design removed publishing and migrating plan versions from the UI; the
decision went further and removed the `plan_versions` **table**, making plan
versions a static file committed to the repo, with the admin UI showing what is
currently live rather than editing it. It is threaded through *The shape*
(amendment box), link 1, link 7 and three exit-gate boxes — one of which is
amended out. **A price change now costs a deploy**, which is the property the
2026-09-01 requirement was written to avoid, and that trade is accepted on the
record rather than overlooked.

Two rules the design states that this milestone's own text does not, both
cheap to keep and expensive to lose:

- **The ladder is presentation only.** The pricing page and the in-app chooser
  nest in copy ("Everything in Plus") because that is what a buyer
  understands. Nothing in the design asserts that the *data* nests, no screen
  compares plans, and no screen reads a display order as authority. This is
  *a plan is a set, not a rank* meeting the surface most likely to lose it
  quietly — which the gate box below already anticipates.
- **The account's meters show the pinned version's per-user ceilings, and the
  environment's global ceiling is deliberately never shown**, because it was
  never sold to anyone. That is the display half of the two-ceiling gate box.

## Why this exists

**The seam was built for this and has been waiting since M16.**

`apps/web/src/server/ai/modelSelection.ts:88` declares `AiEntitlementCheck`.
Line 89 stubs it `EVERYONE_IS_ENTITLED`. Line 47 says why:

> *"the day a pro-tier check exists it lands inside `isEntitled` below, not as
> a signature change."*

Everything downstream is already built and already unreachable. `AiActor`
carries `userId` (`modelSelection.ts:51-54`). The `denied` outcome exists
(`:70`), the wire code `AI_NOT_ENTITLED_CODE = "ai-not-entitled"` exists
(`:76`), `deniedResponse()` exists (`:78-80`), and **both** LLM endpoints
already render it — `handleAiRequest.ts:258,268` and
`handleAskRequest.ts:287,294`. The branch is reachable only from a vitest mock
(`ask/route.int.test.ts:22-24`). ADR-019 is explicit that entitlement is
deliberately **not** a feature flag (lines 125, 169-186), which is why wiring
it to `ai-live` would be wrong rather than merely lazy.

`modelSelection.ts:82-87` names the absence in one line: *"No entitlement
source exists yet — there is no account tier anywhere in the product."* This
milestone is that source.

Three more absences, all verified against `main`:

1. **`users` has six columns and none of them is a role.** `id`, `email`,
   `name`, `image`, `created_at`, `updated_at` (`schema.ts:33-40`). The only
   roles in the product are per-trip (`TripRole`, `contracts/src/trip.ts:274`).
   There is no global role concept, so there is no operator.
2. **There is no admin surface of any kind.** A sweep for any path, directory,
   route or component containing "admin" returns nothing. The three source hits
   are all comments saying so, most pointedly
   `e2e/m11a-invite-gate.spec.ts:67` — *"deliberately ships no administration
   UI and no endpoint"* — and `schema.ts:363`, *"invite-code administration is
   explicitly out of M11a's scope (codes are minted by hand)."*
3. **No per-account spend is queryable.** `ai.ask` records go to
   `console.info` (`askAnalytics.ts:349`) and Sentry metrics deliberately drop
   `userId` for cardinality (`aiMetrics.ts:25-31`). Nothing is persisted. Today
   that is a reporting gap; once an account has a plan it is a billing gap.

## The shape

Four rules, stated once here because every link below depends on them.

**A plan is a set, not a rank.** `accessPolicy.ts:11` has
`RANK = { viewer: 0, editor: 1, owner: 2 }`, and copying that pattern is the
obvious move and the wrong one. Mitchell's requirement is explicit: tiers are
*"not necessarily subsets — each have their own access and functionality."* So
a plan is a **named set of entitlement strings** plus quota numbers, and code
asks `can(ent, "ai.ask")`, never `plan >= "paid"`. A comparison operator
anywhere near a plan is the defect this rule exists to prevent; once one ships,
every later tier is forced to be a superset of an earlier one forever.

**Effective entitlements = base plan ∪ active grants.** Trials, referral
rewards and admin boosts are not three features. They are one time-bounded
grant with three values in a `source` column, resolved by one function. That
collapse is the whole reason this milestone is small enough to be one.

**A plan's contents are versioned data, not code, and a purchase pins a
version.** Mitchell's requirement, 2026-09-01: prices have to be tweakable —
*"especially in the early days"* — while what someone already bought is
honoured, *"so we should know what features what tier unlocked when bought,
but we should be able to change that pricing and next time someone buys that
tier it reflects in the config."* Two consequences:

- **Plan versions are immutable and append-only.** Changing a price, a quota or
  an entitlement **publishes a new version**; it never edits an existing one.
  So "what did `premium` grant on 2026-10-01" stays answerable forever, and a
  price change cannot retroactively rewrite what anyone was sold.
- **What you bought is exactly what you get, until someone explicitly moves
  you.** No implicit union with the newest version, no "highest wins" rule.
  The alternative — a floor-not-cap union — makes "what does this account have"
  unanswerable without replaying every version.

> **AMENDED 2026-09-02 by Mitchell's explicit decision, on the design handoff's
> §17.2: plan versions are a static file committed to the repo, not a
> `plan_versions` table, and the admin UI shows what is currently live rather
> than editing it.** *"Lets keep entitlements being a static file thats
> commited to change with versioning, but the admin ui just shows whats
> currently live."* Everything above survives the move — immutability,
> append-only, pinning, no union — but three things change and are threaded
> through the links and the gate below:
>
> 1. **The audit trail is git**, not an insert. An append-only file under
>    review is a stronger immutability guarantee than a table with a
>    convention, because mutating a published entry shows up in a diff.
> 2. **A price change now costs a deploy**, and that is accepted rather than
>    overlooked. It is the one property of the 2026-09-01 requirement this
>    amendment gives up — versions became *data* specifically so publishing
>    would not need one. What it keeps in exchange is the whole publish path,
>    its authorisation and its validation surface, none of which now exist.
> 3. **Migrating existing accounts to a newer version leaves M20.** It was the
>    named mechanism for the *"until someone explicitly moves you"* half above,
>    and with no publish UI there is nothing to move accounts from. The rule it
>    served is unchanged — nothing implicitly re-reads the newest version — so
>    what M20 ships is the half that never moves anyone. If widening a plan for
>    existing subscribers is ever wanted, it returns as its own decision.

The **entitlement vocabulary stays in code** — `packages/contracts` — because
a capability no code checks is meaningless and a check for a capability that
does not exist must fail to compile. What the plan file adds is which
entitlements and which numbers a plan bundles. The split is: **contracts own
the words, the plan file owns the offers.** Both are now code, so both are
typed: an entitlement string outside the enum cannot reach a published version,
because it does not compile.

This strengthens *a plan is a set, not a rank* rather than weakening it: an
entry lists its entitlements explicitly, and there is no way to write
`premium = plus + …` in it without a spread that review would catch — and in a
file, review is guaranteed to see it.

**Entitlements resolve per request, from the database.** Not from the JWT and
not in the proxy. Sessions are JWT-only (ADR-025) and carry an id and nothing
else (`authConfig.ts:124-138`); the Edge proxy has no database (ADR-024) and
its matcher covers no `/api` path (`proxy.ts:131-133`). More decisively, a
revoked grant or a lapsed subscription must bite **now** — a plan claim baked
into a token would let a downgraded account keep paid access until the token
refreshed, which is an entitlement bug that reads as a billing bug.

## Scope

Nine links. Links 1-3 are the substrate; 4-6 are the gates; 7-8 are the
operator and the reward loop; link 9 is the cost ledger the prices will be
set from.

1. **The entitlement vocabulary and the three launch plans, in contracts.**
   `Entitlement` as a Zod enum of capability strings — `ai.ask`,
   `ai.command`, `trip.collaborators` — and `PlanId` as `free | plus |
   premium`. Both in `packages/contracts`, both with a
   `docs/contracts/CHANGELOG.md` entry. **These are the only two things about
   plans that live in code**: the vocabulary and the stable identity. What a
   plan *contains* is a plan-version entry (rule 4), and the table below is
   therefore the **v1** of each plan as first committed, not a constant.

   | | `free` | `plus` | `premium` |
   |---|---|---|---|
   | Trips, days, stops, lenses, costs, saved days, publish | yes | yes | yes |
   | `ai.ask` | — | yes | yes |
   | `ai.command` | — | yes | yes |
   | `trip.collaborators` | — | — | yes |
   | AI requests · steps per day | 0 · 0 | *link 5* | *link 5* |

   **`free` entitles trip planning in full**, per Mitchell — trips, days,
   activities, map, timeline, calendar, cost, saved days and publishing to
   Discover. It entitles no `ai.*` and no `trip.collaborators`.

   **Plans are defined by enumeration, never by extension. This is the
   milestone's single most load-bearing rule and it is the easiest to lose.**
   Mitchell's decision, 2026-09-01: *"To an end user it should look like a
   nested ladder, but for future functionality and architecting guidance, it
   should look like split access, where they can own different things that
   aren't inherited from the previous tier."* So the three launch plans happen
   to nest, and **nothing in code may know that.** `premium` lists its own
   entitlements in full; it is never `[...PLUS, "trip.collaborators"]`. A
   spread, an `extends`, a base-plan constant or a rank comparison each bakes
   the ladder into the data, and the first non-nested plan then cannot be
   expressed without unpicking every one of them.

   The ladder is **presentation only**: plans carry a display order for the
   pricing page and upgrade prompts, and that order is never read by
   `can()` or by any authorisation path. Ordering is metadata about how to
   render a plan, not a fact about what it grants.

   ~~**`plan_versions`** — immutable, append-only, one row per published
   version~~ **AMENDED 2026-09-02 (see *The shape*): plan versions are a
   **static file committed to the repo**, not a table.** One entry per
   published version, carrying the same fields it would have carried as a row:
   `plan_id`, `version`, the granted `entitlements`, the per-user quota
   ceilings, a display order, and `published_at`. `published_by` is git
   authorship and is no longer a field. Prices are M21's addition to the same
   entry (with the Stripe price id), so M20 publishes versions that are free by
   construction and M21 gives them a number.

   **Every entitlement string is validated against the contracts enum**, and
   the move makes that stronger rather than weaker: with the file typed against
   `Entitlement`, a typo **fails to compile** instead of being rejected at
   publish time, so it can never reach a deploy. The consequence it prevents is
   unchanged — a typo silently grants nothing and the account looks downgraded
   for reasons nobody can see.

   The file ships `v1` of all three; ~~the migration seeds them~~ there is
   nothing to seed. **No update path to a published entry exists anywhere in
   the code**, and the enforcement is now two-layer: a code invariant with a
   test behind it, plus review — editing a published entry is a diff on a
   committed file, which is the one place an immutability convention is
   actually visible.

   **The migration carries no plan data at all.** It is `entitlement_grants`
   plus the two `users` columns, exactly as the header says — there is no table
   to create and no `v1` to seed, because the plan file ships with the deploy.
2. **The grant table and the two `users` columns.** `entitlement_grants` —
   grant id, user id, the entitlements granted, `source` of
   `trial | referral | admin | founder`, `granted_by`, `created_at`,
   `expires_at` nullable, `revoked_at` nullable, **and the `(plan_id,
   version)` it granted** — a grant is an offer someone was given, so it pins
   a version exactly as a purchase does. Plus **`users.plan_id`** (defaulting
   to `free`), **`users.plan_version`** — the version this account holds, which
   M21's webhook keeps in sync — and `users.is_admin`. **No foreign keys** —
   the schema has none
   anywhere and every user reference is a bare `text` upheld at the sign-in
   seam (`schema.ts:51-58`); this table follows that convention rather than
   introducing the repo's first FK. **Not event-sourced**: invariant 1 scopes
   the log to planning, and this is Identity-adjacent CRUD — the same reasoning
   ADR-003 and ADR-029 applied.
3. **The resolver.** One function, `entitlementsFor(userId)`, returning the
   union of **the plan version the account holds** and every unexpired
   unrevoked grant **at the version each was granted at** — never the newest
   version of anything (rule 4). Pure over its
   inputs and unit-tested against clock boundaries; one I/O wrapper. Resolved
   once per request and passed down — never re-queried per check.
4. **AI gating: fill the stub, and change 403 to 402.**
   `EVERYONE_IS_ENTITLED` is replaced by a real `AiEntitlementCheck`. The
   status code changes with it: `modelSelection.ts:75` records that **402 was
   rejected because no payment relationship existed yet**, and this milestone
   creates one. 402 Payment Required is now the honest answer, and the
   client renders an upgrade path rather than a permission error.
5. **Tiered quotas as a parameter, not a mechanism.** `aiQuotas()`
   (`quota.ts:117`) and `aiStepQuotas()` (`:178`) take entitlements and return
   different ceilings. **The bucket `name` must not vary by tier.**
   `QuotaPolicy.name` is documented *"Bucket namespace. Must be stable —
   changing it resets everyone's count"*; a tier-suffixed bucket would zero an
   account's usage on upgrade and let anyone farm free calls by toggling. Only
   the numbers move.

   **Per-user ceilings come from the account's pinned plan version; global
   ceilings stay in the environment.** The split is the point: a per-user
   ceiling is a term that was sold, so it belongs on the immutable row and
   changes only when someone buys or is migrated. A global ceiling is a
   deployment-wide abuse bound that protects the operator's bill and was never
   sold to anyone, so `envCeiling` (`quota.ts:96`) keeps owning it and stays
   tunable by redeploy without republishing a plan.

   **Today's ceilings are already affordable, and the numbers below are the
   reason this link tunes them rather than cutting them.**

   **Read the models from the environment, not from `config.ts`.**
   `DEFAULT_AI_MODEL` is `anthropic/claude-haiku-4-5` (`config.ts:15`) and
   **that is not what runs**. Production sets `AI_MODEL` to
   `deepseek/deepseek-v4-flash-0731` and `AI_CLASSIFIER_MODEL` to
   `zai/glm-4.7-flash` (Mitchell, 2026-09-01; the former is corroborated in
   `KI-088` and in the live record quoted in `M16-assistant-read-agent.md`).
   Costing the compiled default instead of the configured model overstates
   the bill by roughly an order of magnitude, and this note exists because
   that mistake was made once already while scoping this milestone.

   List prices, which are also the billed prices — **Vercel AI Gateway
   "charges no markup and no platform fee on tokens. You pay the provider's
   list price"**:

   | | input / MTok | output / MTok |
   |---|---|---|
   | `deepseek/deepseek-v4-flash-0731` | $0.22 | $0.66 |
   | `zai/glm-4.7-flash` (classifier) | $0.06 | $0.40 |

   **The one live `ai.ask` record** (`M16-assistant-read-agent.md`, preview,
   2026-08-30, `simulated: false`) is a two-step trip opener: **3,363 input
   and 512 output tokens** on the turn, plus **198 / 49** on the classifier.
   That request cost **about $0.0011 — a ninth of a cent.**

   At the ceiling, the binding cap is **800 steps a day** (`quota.ts:178`,
   `AVERAGE_STEPS` 8). Input accumulates across the steps of one request —
   the record shows 1,332 then 2,031 — so an eight-step request is on the
   order of 30,000 input and 2,400 output tokens, about **$0.008**. A hundred
   of those a day is **≈$0.83, or ~$25 a month**; if turns stay as short as
   the observed one, the request cap binds first at **~$3.40 a month.**

   **So a maxed-out account costs single-digit to low-double-digit dollars a
   month, not the ~$70-170 an earlier draft of this link claimed.** The
   ceilings are an abuse bound, not a margin problem, and they do not need to
   be cut for cost. What this link still owes is a *tier split* — `plus` and
   `premium` cannot both sit at the same ceiling — and the two numbers are a
   product decision about what each tier feels like, not a spend defence.

   **Three caveats, because one record is one record.** It is the cheapest
   realistic shape (two steps, one tool call); the eight-step extrapolation
   above is arithmetic, not observation; and `M16-assistant-read-agent.md`
   already records why there is only one — Vercel held a single `ai.ask`
   entry across seven days, because local runs log to the local console and
   never reach it. M21's prerequisite is where this gets re-derived from
   volume.
6. **The collaboration gate, applied on read.** Inviting anyone requires
   `trip.collaborators`; creating and planning a trip alone never does.
   Enforced at `POST /api/trips/:tripId/invites`
   (`invites/route.ts:9`, already owner-only). **On lapse, granted memberships
   cap at `viewer`** (Mitchell's call, 2026-09-01) — and the cap is applied in
   `effectiveMembers` (`members.ts:116-122`), **never written to
   `trip_memberships.role`**. Three things follow, and they are the reason for
   the read-boundary form: resubscribing restores every collaborator with zero
   writes and no re-invite; a billing lapse cannot corrupt membership data;
   and `members.ts:148`'s standing rule — *"Changing a role stays the owner's
   operation — revoke and re-invite"* — is not violated, because nothing
   changes a role, the read caps it. The cap keys on the **trip owner's**
   entitlements (the billing subject, `members[0].userId`, derived from the log
   per `schema.ts:115-119`), not the reader's, and it applies only to *granted*
   memberships — so the owner is untouched by construction and solo planning
   stays free without a special case.

   **The design gives this gate its UI form** (`SPEC.md` §17.3, 2026-09-02):
   it lives in **Trip settings**, and for a `free` or `plus` owner the *Invite
   someone* button is **not rendered at all** — a named-tier block takes its
   place, naming Premium and saying what is behind it. On lapse a banner states
   the read-boundary cap in the same words this link uses: everyone except the
   owner is capped at reading, nothing is removed, no role is rewritten, and
   paying again restores all of them with no re-invites.

   **One consequence for the gate box below.** *"A free owner cannot create a
   trip invite; the refusal names the tier, not a permission"* was written
   against a surface that refuses. If the button is never rendered there is no
   in-app refusal to read, and the box is satisfiable by the server alone —
   which is the reading that makes it pass without anyone seeing the copy the
   design wrote. The box wants splitting in two (the endpoint refuses with the
   tier named; the client renders the named-tier block in place of the button),
   and that is Mitchell's edit to make, not this note's.
7. **The admin surface.** A route group behind `users.is_admin`: the list of
   accounts with plan, effective entitlements and grant history; grant a plan's
   entitlements to an account with an expiry; revoke a grant. ~~**It also owns
   the two plan-version operations** — *publish a new version* of a plan
   (entitlements and ceilings now; M21 adds the price) and *migrate named
   accounts to a version*, which is the only way an existing account's terms
   ever change. Publishing is what makes prices tweakable **without a deploy**,
   which is the whole of Mitchell's early-days requirement~~; the version
   history is shown beside each plan, because a pricing change you cannot see
   the history of is one you cannot reason about. This is net-new
   including its own authorisation, and it is **how this milestone is proven
   without Stripe.** It is an operator tool, not a product surface: ~~no design
   handoff covers it~~ and it should look like the repo's plainest primitives
   rather than acquire a visual language of its own.

   **A design now covers it** (2026-09-02 handoff, `SPEC.md` §17.2, route
   `admin`) and it agrees on the character of the surface without being asked
   to: plainest primitives, no accent language, the assistant bubble gated off
   the route, and **not on the phone at all, entry point included**. It adds
   two states this link did not name — `webhooks-behind` (revenue numbers
   stamped stale; grants still apply, because they do not go through Stripe)
   and `version-conflict` — and no empty state, because the surface cannot be
   empty.

   **AMENDED 2026-09-02, Mitchell's explicit decision: the two plan-version
   operations are out of M20's scope entirely, and this link no longer owns
   them.** *"Out of scope for M20, lets keep entitlements being a static file
   thats commited to change with versioning, but the admin ui just shows whats
   currently live."* This supersedes the struck sentences above, agrees with
   the design (`SPEC.md` §17.2, `DRIFT.md` §2c) and goes one step further than
   it: the design removed the operations from the UI, and this removes the
   `plan_versions` table with them. See the amendment box in *The shape*.

   **What the console owns after the amendment:**

   - **Read, over plans:** the tier panel shows what is **currently live** —
     each plan, its live version, its entitlements and ceilings, its version
     history and hold counts, and per-tier stats (accounts per tier; the MRR
     and median-margin columns are M21's, see the split note below). It has no
     write path to any of it.
   - **Read, over accounts:** the accounts list with plan, effective
     entitlements and grant history, plus the reporting in link 9.
   - **Write — granting, and only granting.** Grant a plan's entitlements to an
     account at a version with an expiry and a reason; revoke a grant. **This
     is not touched by the amendment and must not be**: the grant path is the
     entire reason this milestone is provable without Stripe, and M21 keeps it
     permanently for comps, trial extensions and billing disputes. "The admin
     UI just shows what's currently live" is about **plans**, which nobody
     edits from a browser any more; grants are account state, not plan
     definition, and there is nowhere else for them to live.

   **Two things fall away with the operations, and neither is a loss to
   replace.** The console's `version-conflict` state (*"someone published while
   you were here"*) has no referent once no one publishes from a browser — a
   git conflict is where that collision now happens, and it is better handled
   there. And publish-time validation becomes **compile-time**: an entitlement
   string outside the contracts enum cannot reach a committed plan file,
   because the file is typed against the enum.

   **`webhooks-behind` stays** — it is M21's, and it is about revenue going
   stale, not about versions.

   **The console the design draws is not all M20's**, and the screen does not
   say which half is which. Its four-number strip (MRR and its movement, ARPU
   twice and labelled, median margin per paying account over a trailing 30 days)
   is **M21 link 7** — *Deliberately not here* already says revenue, ARPU and
   margin all need a subscription to exist. Same for the MRR and median-margin
   columns of the per-tier panel, and for `webhooks-behind`. M20 builds the
   console **without** the strip; M21 adds it. An implementer working from the
   finished screen will build the strip inside M20 and break the split in the
   direction `DRIFT.md` §2c only warns about in reverse.
8. **Self-serve invite codes, and the referral reward.** The reward keys on
   platform admission — *someone I invited got an account* — which
   `invite_codes.redeemed_by` already records (`schema.ts:367`). The data is
   there; what is missing is that **codes are minted by hand**
   (`schema.ts:349-351`), so nobody can earn a referral they cannot issue.
   This link gives an account a way to mint its own codes, and mints a
   `source: "referral"` grant when one is redeemed.

   **The reward is one month of the tier the referrer already holds**
   (Mitchell, 2026-09-01). Three consequences, all deliberate:

   - **A `free` account earns nothing**, and neither does an account whose
     only entitlement is its trial — a trial is a grant, not a held plan.
     This narrows the brief's *"inviting new users gets more paid or
     premium"* to paying users only, and it is the narrowing that makes the
     link safe: **most of the anti-abuse surface disappears**, because there
     is no reward a throwaway account could farm. Self-referral still earns
     nothing (the minter and the redeemer must be distinct accounts) and the
     per-account reward is still capped, but neither is now load-bearing.
   - **The grant is minted at redemption, for the tier held at that moment,
     and expires independently of the subscription.** Cancelling afterwards
     does not claw it back — the month was earned.
   - **A `premium` referrer who later downgrades to `plus` holds both**, and
     the resolver's union gives them premium entitlements until the grant
     expires. That is the resolver behaving correctly, not an edge case to
     special-case.

**The trial grants `plus`, not `premium`, and starts at signup** (Mitchell,
2026-09-01): `source: "trial"`, one week, `expires_at` set when the `users` row
is created. It needs no ninth link — it is link 2's table and link 3's
resolver with a different `source`, which is the test of whether the collapse
in **The shape** actually held.

One consequence is accepted rather than overlooked: **nobody experiences
collaboration before paying for it**, since `trip.collaborators` is never
trialled. That makes link 6's refusal copy carry more weight than it otherwise
would — a free owner meets the collaboration gate cold, with no prior
experience of what is behind it, which is why the gate box below requires the
refusal to name the tier rather than read as a permission error.

9. **The usage ledger — what an account costs.** One row per AI request in a
   new `ai_usage` table: user id, endpoint, model, classifier model, input and
   output tokens (turn and classifier separately), step count, outcome, and
   `created_at`. Written at the end of every AI request **including the ones
   that fail partway**, because the round-trips already made were already
   paid for. CRUD, not evented (invariant 1). No question text and no trip
   content — `askAnalytics` already logs the question to the console, and a
   durable table is the wrong place for it.

   **This link moved here from M21 on 2026-09-01**, when Mitchell asked for
   the financial metrics. It belongs before the money rather than after it:
   M21 has to choose prices, M20's own link 5 has to choose per-tier
   ceilings, and both are guesses without it. It is also the one link here
   with no dependency on Stripe at all.

   Four decisions, each of which is a defect if taken the other way:

   - **Store tokens and models, never dollars.** Prices move — DeepSeek's
     rates for the configured model changed on 2026-08-16, mid-scoping. A
     stored dollar figure freezes one price into history, cannot be
     re-derived, and silently corrupts the series the day the model changes.
     Tokens plus a dated price table re-prices history correctly and survives
     a model swap. **The rate table is the mirror image of the plan-version
     file**, and deliberately the same shape: two dated, append-only price
     records — one for what the operator **pays** (model rates) and one for
     what the operator **charges** (plan versions) — so margin is a join across
     both *as at a point in time* rather than a number computed once and
     frozen. Neither history is ever rewritten when a price moves.
     *(**2026-09-02**: the charge half is now a committed file rather than a
     table, so the two halves no longer live in the same place. The join is
     unaffected — both are dated, append-only and readable at a point in
     time — but the model rate table should be a committed file too, for the
     same reasons and to keep the pair symmetrical. Rates are operator facts
     that change a handful of times a year, nobody edits them from a browser,
     and a rate change that silently re-prices history is exactly the diff
     review should see.)*
   - **`Money` must not be used for this.** ADR-008 defines
     `Money = { amountMinor, currency }` in **integer minor units** — whole
     cents for USD. A live request costs **$0.0011**, which is a ninth of a
     cent and rounds to **zero**. Every request would record as free. That is
     precisely the KI-1 / KI-14 / `budgetPerPerson` defect class — a field
     asserting a semantic its arithmetic does not have — and this repo has
     now been caught by it three times. If a number must be stored, store
     integer micro-dollars; better, store nothing and derive.
   - **Attribute marginal cost only.** Model tokens are the per-account
     marginal cost. Vercel, Postgres and LocationIQ are not: the geocoder is
     a **daily-capped free tier**, which is a capacity limit rather than a
     per-call charge, and the rest is fixed cost. Allocating fixed cost per
     account makes the number arbitrary and the comparison in M21 link 7
     meaningless.
   - **The log is not a ledger.** `console.info("ai.ask", …)`
     (`askAnalytics.ts:349`) already carries every field this table needs,
     and it is still not sufficient: Vercel's runtime logs are retained
     briefly and are not queryable as a series — `M16-assistant-read-agent.md`
     records finding exactly **one** `ai.ask` entry across seven days. The
     table exists because the log cannot answer a question about last month.

   **`/ask` must also account for what it spends**, which it currently does
   not: `handleAskRequest.ts:306` charges `aiQuotas()` and never
   `aiStepQuotas()` or `settleAiSteps`, so the read agent's round-trips are
   unbounded while the command endpoint's are capped. Recording cost without
   bounding it is half a job, so the fix lands here rather than being filed.

   **What the admin surface (link 7) then shows**, all from this one table plus
   the plan-version file, `users.plan` and `entitlement_grants`: accounts per plan; accounts per
   active grant source; cost per account over a trailing window; the
   distribution of cost per request and per turn; and the top spenders.
   Revenue, ARPU and margin are M21's — they need a subscription to exist.

## Exit gate

- [ ] A `free` account is refused `/ask` and `/ai` with **402** and the wire
      code `ai-not-entitled`, and the client offers an upgrade path rather than
      rendering a permission error.
- [ ] The same account creates a trip, adds days, stops, costs and a saved day,
      and publishes it — **all of it, with no gate anywhere.** Trip planning is
      free and a test proves it stays free.
- [ ] An admin grants that account premium **with an expiry**, and `/ask`
      answers on the next request with **no sign-out and no token refresh** —
      the JWT is unchanged and the entitlement still took effect.
- [ ] The grant expires; the next request is refused again. Nothing was
      revoked by hand and no job ran — expiry is resolved, not swept.
- [ ] **No plan is defined in terms of another.** `premium` enumerates its own
      entitlements; a test fails if any plan definition spreads, extends or
      otherwise references another plan, and if any authorisation path reads a
      plan's display order. This is the requirement the design most easily
      loses, and losing it silently is what makes the ladder permanent.
- [ ] **Changing a plan republishes rather than mutates.** Editing `premium`'s
      entitlements or ceilings creates `v2`; `v1`'s entry is byte-identical
      afterwards, and a test fails if any code path can update a published
      entry. *(**Amended 2026-09-02**: "row" reads "entry" — versions are a
      committed file, not a table. The box is otherwise unchanged, and the
      file makes it easier to prove, not harder: a mutated `v1` is a diff.)*
- [ ] **An account on `v1` is unaffected by `v2` being published** — same
      entitlements, same ceilings, same behaviour on the next request — and
      **a new account gets `v2`**. This is the whole of the requirement: tweak
      freely, honour what was sold.
- [ ] ~~**Migrating that account to `v2` is one explicit admin action**, is
      recorded with who did it, and is the *only* way its terms changed.~~
      **Amended OUT of the gate 2026-09-02 by Mitchell's explicit decision**
      (`docs/milestones/README.md`: a gate definition changes only that way).
      The two plan-version operations left M20 with the `plan_versions` table —
      see link 7 and *The shape*. **The rule the box protected is not dropped**:
      nothing implicitly re-reads the newest version, and the box above (*"an
      account on `v1` is unaffected by `v2`"*) is what now proves it. What is
      gone is the mechanism for deliberately moving someone, which M20 no
      longer ships. If widening a plan for existing subscribers is ever wanted,
      it returns as its own decision with its own box.
- [ ] Publishing a version whose entitlement list contains a string outside the
      contracts enum **cannot compile**, so it never reaches a deploy — a typo
      must not silently grant nothing. *(**Amended 2026-09-02**: was "refused
      at publish time, not stored". With versions in a committed file typed
      against the contracts enum, the check moves from runtime to the type
      checker, which is strictly earlier and strictly harder to bypass. The
      failure this box exists to prevent is unchanged.)*
- [ ] **A per-user ceiling comes from the pinned plan version and a global
      ceiling comes from the environment.** Republishing a plan does not move
      a global ceiling; changing an env ceiling does not alter what any
      account was sold.
- [ ] **A grant pins the version it was granted at**, so a founder grant issued
      against `v1` still confers `v1` after `v3` is published.
- [ ] **A fourth plan that is not a subset of any other can be added by
      editing one file**, granting `trip.collaborators` without `ai.command`.
      It ships disabled — the point is that adding it costs one definition and
      no change to any gate. This is the proof the split architecture is real
      rather than asserted.
- [ ] A new account carries a one-week `plus` trial from signup, sees the
      assistant work, and is refused after seven days with no job having run.
- [ ] **Upgrading a tier does not reset a quota counter.** A test asserts the
      bucket name is tier-independent while the ceiling is not. Naming the trap
      is not evidence it was avoided.
- [ ] A free owner cannot create a trip invite; the refusal names the tier, not
      a permission.
- [ ] **A premium owner with three collaborators lapses: all three drop to
      `viewer`, `trip_memberships` rows are byte-identical before and after,
      and re-granting restores all three to `editor` with zero writes to that
      table.** The owner keeps editing throughout.
- [ ] Every account existing at migration time carries a **permanent
      `founder` grant** and loses no capability it had the day before. A test
      fails if the migration leaves any pre-existing account on bare `free`.
- [ ] **A referral earns one month of the tier the referrer holds**; a `free`
      referrer and a trial-only referrer each earn nothing, a code redeemed by
      its own minter earns nothing, and the per-account cap holds under
      repeated redemption.
- [ ] A referrer who earns a `premium` month and then downgrades to `plus`
      keeps premium entitlements until the grant expires — the resolver's
      union, with no special case anywhere.
- [ ] **Every AI request writes one `ai_usage` row, including a request that
      fails partway** — the round-trips were still paid for. A test asserts the
      failure path writes.
- [ ] **No dollar amount is stored in `ai_usage`, and `Money` is not used
      anywhere in it.** A test fails if either appears. A request costing
      $0.0011 rounds to zero in `amountMinor`, which would record every call
      as free — the KI-1 / KI-14 / `budgetPerPerson` defect class, third
      recurrence.
- [ ] **Re-pricing history works**: changing a model's rate in the price table
      changes what past usage cost, without touching a stored row. Proven by
      re-deriving a known month at two different rates.
- [ ] `/ask` charges `aiStepQuotas()` and settles its real step count, so both
      AI endpoints bound their round-trips rather than only one.
- [ ] The admin surface answers, from real data: **accounts per plan**,
      **accounts per active grant source**, **cost per account over a trailing
      window**, and **the top spenders**. Each is walked, not just queried.
- [ ] `ai_usage` carries no question text and no trip content.
- [ ] A non-admin reaches no admin route and no admin endpoint — checked
      server-side, and a test proves the route group is not merely hidden.
- [ ] **The migration is written, applied locally, and its production dispatch
      is called out in the PR body.** An undispatched migration is schema
      drift.
- [ ] The contracts changelog carries the entitlement vocabulary entry, and
      the 403→402 change is recorded as the breaking wire change it is.
- [ ] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — not `test:e2e`.
- [ ] Retro appended at gate close.

## Deliberately not here

- **Stripe, prices, checkout, webhooks, invoices, dunning, proration, tax.**
  All M21. This milestone never learns what a plan costs — only what it grants.
  If a price string appears in this milestone's diff, the split has failed.
- **Revenue, ARPU and margin.** All M21 — every one of them needs a
  subscription to exist. Link 9 deliberately builds only the **cost** half of
  the unit economics, which is the half that has no dependency on Stripe and
  the half both milestones' pricing decisions rest on.
- **Allocating fixed infrastructure cost per account.** See link 9: Vercel,
  Postgres and the daily-capped geocoder are not per-account marginal costs,
  and pretending otherwise makes the M21 comparison arbitrary.
- **Team or organisation accounts.** A plan belongs to one account. Shared
  billing is a different subject and nobody has asked for it.
- **Publishing a plan version from a browser, and migrating existing accounts
  onto a newer one.** Both left this milestone on **2026-09-02** by Mitchell's
  decision — versions are a committed file and the console is read-only over
  plans. Publishing is now a commit and a deploy. Migrating is not built at
  all: nothing here moves an account off the version it holds, which is the
  *"until someone explicitly moves you"* rule with nobody able to move you.
  Granting is unaffected and stays — it is account state, not plan definition,
  and it is what proves this milestone without Stripe.
- **Changing the invite gate.** M11a decides who gets an account; this
  milestone decides what an account may do. Two questions, two mechanisms,
  and link 8 adds to `invite_codes` without touching admission.

## Prerequisites

**An ADR, due before the milestone opens — not written mid-build.**
`AGENTS.md`'s module map is structural law and this adds a module to it:
**Entitlements** — owns plans, grants and capability resolution; CRUD with
audit fields; and, like Identity, **explicitly does not know what a trip is.**

**The 2026-09-02 amendment is an input to that ADR, not a substitute for it.**
Entitlements now reads its plan definitions from a committed file and its
grants from a table, which is a module that owns two stores of different kinds
— the thing a module map exists to be explicit about. The ADR should say which
is authoritative for what (the file for *what a plan is*, the table for *who
holds what*), that the resolver reads both on every request, and that a version
string in a grant or a `users` row is a reference into the file that must
resolve or fail loudly — a pinned version whose entry was deleted is the one
failure mode the move introduces.
It answers `can(account, capability)`; the *caller* knows that
`trip.collaborators` is about invites. That is what keeps link 6 from becoming
the boundary violation it would otherwise be, and it is the decision the ADR
exists to record. Same standing as M13's transport ADR and M14's repeaters ADR.

**M9, and it must be closed.** Not a code dependency — a product one. M9
grounds the assistant and is what allows `ai-live` to be turned on. Charging
for a dark feature is the reason this milestone is not placed earlier.

**M11a, and it is closed.** Link 8 builds on `invite_codes` and on
`created_by`/`redeemed_by` already being recorded.

**M11, and it is closed.** Link 6 gates `trip_invites` and caps
`trip_memberships`, both of which M11 shipped.

**Not blocked on M17.** M17 adds preference columns to `users`; this adds
`plan` and `is_admin`. Two migrations touching one table in sequence, no
conflict — but whichever lands second rebases onto the other's migration
number.

# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues/`.

**This file is live instruction only, and it is kept short on purpose.** It hit
1,779 lines on 2026-08-28, ~88% of it history, in the one file every session is
told to read first — so a first-read file became a file people skim. The rule
now: **at gate close, a phase's narrative moves to its milestone file or a retro
in the same commit, and this file keeps the pointer.** Everything that was here
before 2026-08-28 is in `docs/retros/2026-08-28-status-archive.md`, verbatim and
in order, with an index mapping each part to its durable home. Nothing was
deleted.

**It drifted back and was cut a second time, 2026-09-11** — to 1,418 lines, with
a `## Next action` section still naming M17 as the current work on the day M17's
gate closed. Length was the symptom; **the stale section was the defect**, and it
is the reason to distrust a long first-read file rather than merely resent it.
Lines 243-1188 are now `docs/retros/2026-09-11-status-archive.md`, same rule,
same verbatim treatment. If this file is over ~300 lines again, that is the
signal, not a style preference.

**Local dev recipe:** `AGENTS.md` points here for it; it is not restated here,
because two copies drift. `docs/guidelines/cloud-agent-sessions.md` is the one
to read in a container (native Postgres on :5433, Playwright's browsers, what is
different from a laptop), and `docs/guidelines/building-the-parts.md` is the
general setup.

## Where the work is right now

**M22 — AN ACCOUNT CAN BUILD ON THE API — IS THE CURRENT MILESTONE AS OF 2026-09-16**, by
**Mitchell's decision and not by a gate closing**. Order:
`M17 ✓ → M9 [Phase 0 ✓, paused] → M20 ✓ → M21 [OPEN, paused at 11/17] → M22 → M25 → M23 → M13 → M12 → M24 → M14 → M19`.
**The tail of that order changed 2026-09-18** — three milestones minted (**M23**
multi-day playbooks, **M24** travel legs, **M25** trip export/import) and **M13
moved ahead of M12**, all by Mitchell in a design conversation. The reasoning is
**not here**: `docs/milestones/README.md`'s *2026-09-18* note carries it, the
Phase 3 table carries each milestone's decisions, and each new file carries its
own scope and exit gate. Two things placed the same day are **not** milestones
and are easy to lose for that reason: the activity-field descriptor refactor
(`KI-20260905-o`) runs **once, before M13**, and is a gate box there; and a
generated, drift-checked architecture map is designed in
`docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md` and approved
in principle.
Scope and the gate — **18 of 19 ticked**, the last one blocked on a deployment rather than on code (`KI-2026-09-16-d`) — are in `docs/milestones/M22-public-api-and-tokens.md`; the fully decided
design behind it: `docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`.

**Post-gate follow-up, SHIPPED and live in production 2026-09-18** (#189, merged as
`c42be58`): a v1 caller can give a stop coordinates, a structured postal address, or just a
name, and the stop gets a pin — `Location.address` (the CLDR / libaddressinput model),
resolution on the stop writes reported through a `Geocode-Outcome` header, and
`GET /v1/trips/{tripId}/geocode` for looking coordinates up first. No new scope and no
migration, so nothing was owed after the merge. How to call it:
`docs/guidelines/using-the-api.md` → *Putting a stop on the map*; the decisions and task
breakdown: `docs/plans/2026-09-18-api-locations-address-geocode.md`.
**Not gate work** — M22's 19 boxes are unchanged by it.

**M21 IS OPEN AND PAUSED, NOT FINISHED — 11 of 17 boxes.** Its file, scope and every box
stand unamended, and the six open ones are still owed. Its state is recorded below rather
than deleted, because a paused milestone that stops being described is one nobody returns to.

**The reorder costs M21 nothing, and an earlier version of this file said otherwise.**
M22 needs an account holding `api.tokens`, not a sale — an admin grant pins
`livePlanVersion(planId)` (`api/admin/grants/route.ts:29`) and `resolveEntitlements` unions the
held plan with every grant's pinned version, which is what M20 built the grant path for.
Publishing `premium@v2` does mean a later Premium purchase verifies v2's Stripe Price rather
than v1's, leaving v1 — unsellable, unheld and ungrantable once superseded — with a Price that
was never created; `checkPriceConsistency` calls that `missing`, *"an ordinary state"*, not a
finding. **That is M21's footnote to settle on M21's schedule, not a gate on M22.**

**All four phases are written and merged** (#177, then #180 and #181) — the subscription
table and priced plan versions, hosted checkout and the webhook, the `plans` route with the
account sheet's billing surface, and the revenue half of the operator console.
**Eleven of seventeen gate boxes are ticked with evidence.**

**A real purchase and a real downgrade were walked in production on 2026-09-16**, and the
database is the evidence rather than the screen: four `billing_events` rows, every one with
`applied_at` set, in the order `customer.subscription.created` →
`checkout.session.completed` → `invoice.payment_succeeded` →
`customer.subscription.updated`; and one `subscriptions` row that after the downgrade reads
`status: active`, `cancel_at_period_end: true`, `current_period_end: 2026-10-16` — access
running to the end of the paid period rather than ending at the click. That closes the
hosted-checkout box, the Stripe-driven half of the cancel box, and the migration box, whose
dispatch was confirmed against the database (`subscriptions`, `billing_events.applied_at`
and `users.stripe_customer_id` all present) rather than against `TODO.md`.

**The walk was only possible because it found a defect first, and that is the part worth
keeping.** Every paid path — first checkout and plan change alike — answered 500 in
production: `findPriceByLookupKey` sent Stripe's `lookup_keys` ARRAY parameter as a scalar,
so Stripe refused with `400: Invalid array`. Nothing caught it because `prices.test.ts`
mocks that function wholesale, and `stripeApi.ts` — the module that builds every outbound
Stripe request — **had no test file at all**. The bug lived below the mock line. #181 fixes
the two brackets and adds `stripeApi.test.ts`, which stubs `fetch` and asserts the URL that
actually leaves the process. **A mock is a boundary, and the code on the far side of it is
untested until something asserts the wire.**

**What the gate still wants** is the failure half: a `past_due` account through its
three-day grace window, and a lapse walking M20's collaborator cap. Neither costs money —
a Test Clock and card `4000 0000 0000 0341` walk both locally, per
`docs/guidelines/billing-without-spending-money.md`. Also open: one Premium purchase (to
resolve that version's Price the way the live `plus` purchase resolved its own), the
network-log observation for the no-card-data box, and the retro. The milestone file's *What was
built* has the five deviations from its own scope, each with its reason; **ADR-047** carries
the three decisions that are one-way doors.

**PR #177 collected three reviews and they found sixteen defects in code that passed every
local lane** — four of them expensive: an existing subscriber could be charged twice, a failed
webhook delivery lost its event permanently, the confirm step promised a payment it did not
collect, and the pending screen claimed a payment had happened on a forged URL. All fixed;
the milestone file's *What review found* has the list and the lesson. **The lesson in one
line: every one of the four had a passing test over it — asserting presence, or state, or a
substring, on the exact path where the defect lived.**

**Then a fourth review arrived, on the preview itself** (2026-09-15) — five Vercel toolbar
threads, a surface with its own mechanics that `docs/guidelines/working-a-review.md` covers
and that no GitHub check surfaces as a review. **Four were design decisions this build had
got wrong, not bugs**, and two of them reverse M20's §17.3 in the same words: a gated
affordance now STAYS on screen, disabled, under a CTA to `plans`, rather than not rendering
at all. M20's reasoning ("a control that can never work") was right when there was nowhere
to send anybody; §29 gave plans a route, so the premise expired. The assistant's gate also
moved EARLIER than the server's 402 — `useAiEntitled` asks the plan before anything is
typed. The fifth is a design question with a wrong premise, answered on the thread and filed
in `TODO.md` → *Candidate ideas* rather than guessed at. **The threads stay unresolved until
Mitchell resolves them** — that check is a human gate, and clearing it from this side would
be defeating a control rather than passing it.

**What is left is a walk against a real Stripe test-mode key**, which no lane in this repo
has — exactly what the milestone's *Why it is separate* predicted. **Nothing about it costs
money, and the recipe is `docs/guidelines/billing-without-spending-money.md`**: test cards,
`stripe listen`, and Test Clocks for walking the three-day grace window without waiting three
days. Read the one rule at the top of it before opening a Stripe dashboard.

**Migration `0021_subscriptions_and_billing` is written and applied locally, and is NOT
dispatched to production.** Merging does not apply it — see the standing rule below.

**Three things this work leaves live, all of them instruction rather than history:**

- **A lapse is a derivation, not a write** (ADR-047 decision 3). The subscription row keeps
  saying what Stripe last said and the resolver computes what it MEANS against the clock, so
  nothing runs on a schedule and there is no second downgrade path. The tempting change —
  writing `free` when a grace window closes — is the one that would need a scheduler, and it
  would break link 4's sole writer to get it.
- **The webhook is the only thing that writes `subscriptions` or `users.plan_id`**, and
  `soleWriter.test.ts` sweeps for a second. The second writer is never called "grant the plan
  from the redirect": it is a helpful success route that updates the row so the page has
  something to show.
- **`GRACE_WINDOW_DAYS = 3` has one definition and three readers** — the resolver, the copy a
  person reads, and the test. It is a guess that first contact with real declines will want to
  revise, which is the whole reason it is one constant.

**M20's gate closed 2026-09-14** — 32 of 32 live boxes, built as #174 and #175, migrations
0019 and 0020 dispatched to production (`migrate-production` run 20) and checked against the
database, the operator console walked on production and the account surfaces on a preview.
**The narrative is not here**: what it cost, the two findings a browser produced that no test
could, and the two boxes ticked with a caveat named are the retro in
`docs/milestones/M20-account-tiers-and-entitlements.md`.

**Four things M20 leaves live, which is why they are here rather than in its retro:**

- **A plan is a set, not a rank.** Code asks `can(ent, "ai.ask")` and nothing compares plans.
  `accessPolicy.ts:11`'s `RANK` is the right shape for roles inside a trip and the wrong shape
  here; copying it is the obvious move and it is a one-way door. The buyer's ladder is
  presentation only.
- **The console has no revenue half, and a test keeps it that way.** The four-number strip and
  the per-tier MRR and median-margin columns are M21 link 7's; `admin.console.test.ts` sweeps
  the admin files for that vocabulary. M21 link 7 also replaces one function body,
  `startPlanChange` in `PlanSection.tsx`. **A price string in M20's files means the split
  failed, in either direction.**
- **The first operator exists and the path is not obvious**: `ADMIN_USER_IDS` takes `users.id`
  verbatim (`google-<sub>`, never an email), comma-separated and not a JSON array, injected at
  deploy time so it needs a redeploy, and written to `users.is_admin` on that account's next
  sign-in. It fails closed on every one of those, which is why a mistake looks like silence.
  The `admin-console` flag is the same promotion with no deploy.
- **`ai_usage` is best-effort on the abort and error paths** — `KI-2026-09-14-b`. The ledger
  M21 prices against is complete for every turn that finishes and eventual for the rest.

**M9 is paused, not cancelled**, and keeps its place immediately after M21. Its Phase 0 is
below, unchanged, because it is what M9's three real pieces of work are still built on.

**M9 PHASE 0 — THE ASSISTANT KERNEL — IS COMPLETE, 2026-09-11.** Two PRs, both merged:
P0-P5 as `bbc5bdb` (#162) and P6 as `845fc48` (#163). It closed **KI-2026-09-05-t** and
**KI-22**, and ticked **no gate box**, by design — it is what M9's three real pieces of work
are built on.

**The narrative is not here.** What landed phase by phase, what it cost, the squash-merge
hazard that cost the most, and the three open questions it raised for Mitchell are in
`docs/milestones/M9-ai-planning-partner.md` under "Phase 0". Decision and the five rules:
**ADR-043**. Design, corrections and measurements:
`docs/specs/2026-09-10-assistant-kernel-design.md`.

**The one-line version, because it is the thing to know before touching the assistant:**
`handleAskRequest()` went **455 -> 105 non-comment lines** while the comment record grew
**634 -> 996**; a tool is now a module with a required output schema and declared
dependencies, a scope is a grant of (domain, effect) pairs and the tool set is a *filter*,
admission is a nine-stage array whose order a test asserts, tool-returned user content is
fenced in `⟦…⟧` inside the system instruction, and a turn returns a `TurnLedger` shaped as
M20 link 9's `ai_usage` row — with **model identity and cost as variable inputs**.

**Four known issues were filed by doing the work** and are open: `KI-2026-09-11-a` (a
`userId` in Sentry breadcrumbs), `-b` (`simulatedModel`'s unchecked cast), `-c` (two
`modelSelection` tests read `serverConfig` at module load), `-d` (`TurnMeter.toolCalls()`
hands back its live array).

**Two fixture trips are still on the preview database** from #162's browser walk: `Kyoto
pass 162` and `Blank slate 162`. **M20's gate walk (2026-09-14) left three more things
there**: the account `dev-gatewalk314819` (created through `/signup` with a real referral
code, so it carries the signup trial), its trip `GateWalk Kyoto 9583`, and an unredeemed
referral code minted by `dev-alice`. None is load-bearing; all four dev accounts on preview
also carry `0019`'s permanent `founder` premium grant, which is why a preview account cannot
demonstrate the free tier's refusals — that negative belongs to the e2e lane, which controls
its own grant state.

## Live rules that the code cannot enforce

Three standing facts, kept here because each is instruction rather than history and
nothing in CI will tell you when one is broken. The narrative each came from is in
`docs/retros/2026-09-11-status-archive.md`.

- **Merging does not apply a migration. Production is at `0020` and nothing pending.**
  `gh workflow run migrate-production.yml -f confirm=migrate`, from `main`, is the only thing
  that applies one, and the answer is checkable rather than remembered: 21 rows in
  `drizzle.__drizzle_migrations` on the production branch, which is `0000`-`0020`. *(This
  entry used to say `0018` was NOT applied; it was dispatched as run 19 on 2026-09-13 and the
  rule outlived its example. `0019`/`0020` went out as run 20 on 2026-09-14.)* Runbook:
  `docs/guidelines/content-bundles.md` for what `0018` unblocks (`--prune` against a bundle
  that has stopped declaring content).
- **The `ai-live` flag's dashboard fallthrough stays "Simulated" until release, then flips
  to "Live"** — ADR-019's **2026-09-13 amendment**, which reverses the 2026-09-08 rule that
  it must stay Simulated forever. Until the flip the old reasoning holds exactly: targeting
  only ever *widens*, a caller no rule matches falls through to the default, and that default
  is the only thing keeping anyone off. **The flip is safe only after M20's entitlement gate
  is live in production** — `selectAiModel` checks entitlement *before* the flag
  (`modelSelection.ts:215-218`), so a paid-account check becomes the spend control and the
  flag goes back to being an emergency disable. Flipping it early leaves an interval with no
  spend control at all. **That precondition was met 2026-09-14**: the gate is live in
  production and migrated, so the flip is now a decision rather than a dependency — and
  Mitchell's, not a session's. Note what it would expose today: every account that predates
  0019 holds a permanent `founder` grant, so the spend control binds on new accounts and not
  on those. After the flip, keep Production's rule list empty: a widening rule
  would make *the rule* load-bearing, and disabling in a hurry must stay one action. It lives
  in the Vercel dashboard and no test can assert any of it.
- **e2e refuses to start unless `AI_LIVE=false`.** `/api/health/ai-mode` reports
  `{ live, source }` and `e2e/global.setup.ts` requires `source: "env"` — an anonymous
  `live: false` from a *targetable* flag stopped being evidence about the signed-in user the
  specs sign in as, which had quietly broken what KI-25 bought. `.env.example` ships it; CI
  sets it in the workflow env.

## Blocking / broken right now

**1. The Map lens's tiles have still never been confirmed to paint — KI-49.**
From a cloud session the egress proxy blocks the tile host outright, so the
map's chrome can be walked and its tiles cannot. From a laptop the transport
verifies (M11's gate loaded the style, tilejson, sprites and glyphs from
`tiles.openfreemap.org` on the preview, and WebGL is real) and the **pixels
still do not**: the WebGL canvas captures blank in the screenshot pipeline, and
MapLibre fetches its data tiles from a worker the main thread cannot observe.
So neither environment has produced a picture of a rendered map. Nothing on the
roadmap is blocked by it; it bounds what a browser walk is allowed to claim,
from anywhere. A blank canvas is not a pass.

**Retired from this list at M11's gate, 2026-08-28** — all three were on it and
none of them is live any more:

- **Migrations 0006-0010 are dispatched to production.** The gate's blocker, and
  the preview walk signed in and wrote as two users against the migrated schema,
  which is exactly the `recordSignIn` upsert into `users` this entry warned
  would throw. The standing rule is unchanged: merging does not apply a
  migration — dispatch it (`gh workflow run migrate-production.yml -f
  confirm=migrate`, from `main`) and say so in the PR body.
- **`/s/featured`'s dead end is gone — KI-61.** PR #79 replaced it with `/demo`;
  see the `/demo` paragraph above. Walked on the preview: 14 days, 68 stops,
  read-only, 2 conflicts rather than the pre-KI-60 twelve.
- **The CSP's last unwalked environment, the Vercel preview, is walked —
  KI-66.** The entry's "never executed by a browser" half was already closed
  earlier the same day by a local production-build walk; the preview was the
  named remainder, and M11's gate covered it — as did a cloud session on
  2026-08-29, independently, finding the same violation. One preview-only
  behaviour is still worth knowing before it is mistaken for a defect: a
  Deployment Protection re-challenge of an in-flight XHR reaches the app as a
  bare "Failed to fetch". The other one M11's gate recorded — the CSP blocking
  Vercel's feedback script on every preview page — was **not** "no app impact",
  and is fixed rather than documented; see the next section.

**A preview deployment is walkable from a cloud session, and the CSP defect that
found is fixed.** `pnpm --filter web walk:preview <url> [path ...]` —
`docs/guidelines/cloud-agent-sessions.md` carries the diagnosis, and that file's
old "the preview is NOT reachable from here" paragraph is gone; it was wrong and
it cost several runs. Three obstacles stacked: Deployment Protection, Chromium
not trusting the egress CA, and a TLS 1.3 ClientHello the `*.vercel.app` tunnel
cannot carry.

What the walk found is the point: **the CSP refused the Vercel Toolbar's loader
on every preview page**, which breaks the Flags Explorer — the documented way to
flip `ai-live` for one reviewer's session. M11's gate saw the same refusal and
filed it as harmless preview noise; it was not. The policy now admits the
Toolbar's origins on preview only, gated on `VERCEL_ENV`, with a test asserting
production's policy is untouched.

**One thing is still Mitchell's to do, and nothing unattended can test a preview
until it is done:** generate **Protection Bypass for Automation** (Vercel → the
project → Settings → Deployment Protection) and copy the value into a
`VERCEL_AUTOMATION_BYPASS_SECRET` repo secret.

**The `_vercel_share` fallback was tested on 2026-08-30 and is not a substitute
— tried while looking for M18b's gate evidence.** A freshly minted link gets
*past* Deployment Protection and is then stopped by `429 Vercel Security
Checkpoint` at the redeem step, twice, five minutes apart, before any app
response. That is Vercel's anti-bot interstitial challenging the client —
headless Chromium on a datacenter IP — not rate limiting and not the protection
layer. It suits a person in a browser; it does not reliably suit the automated
walk. The bypass secret is honoured before the checkpoint renders, which is why
it is the only dependable route. `docs/guidelines/cloud-agent-sessions.md`
carries the detail. Treat the secret like `FLAGS_SECRET`:
it unlocks every protected deployment this project has.

**Not blocking:** KI-15 stays downgraded — the silent-corruption half (an
unbiased top match overwriting correct model coordinates; rate-limit failures
swallowed into coordinate-less locations) is fixed. The remaining architectural
half, the model guessing a coordinate rather than citing one, is M9 scope.

## Next action

**M21 is open and nothing of it is built.** Read
`docs/milestones/M21-subscriptions-and-billing.md` before planning anything: seven links, the
prices already decided (`free` $0, `plus` $9, `premium` $19) and living in that file alone,
and a gate whose hard parts are signature verification, idempotency under Stripe's retries,
out-of-order tolerance, and *no card number ever reaches this application*. **It adds no
entitlement and no gate** — a diff touching `modelSelection.ts`, `quota.ts` or `members.ts`
means the split from M20 failed.

**Two things are waiting rather than blocked, and both are Mitchell's.** Whether to flip
`ai-live` now that its precondition is met (above, with what it would expose), and whether
the three open questions M9 Phase 0 raised get answered before M21 prices anything — the
second of them, *which quota window a sold ceiling binds*, is the one M21 pays for if it is
left: it is implemented per-day and stated in no contract.

*(This section named M9 as the current work until 2026-09-14, on the day M20 was already
built and merged — the second time this file's most-read section went stale while its length
stayed respectable. The section above is where the work is; this one is what happens next.)*

**M9 stays paused behind M21**, and its three real pieces of work are unchanged, per the
2026-09-01 audit (`docs/reviews/2026-09-01-milestone-audit.md`):

- **Grounding** — a `SearchPlaces` read tool, with `AddActivity`/`UpdateActivity` citing a
  `placeRef: N` against that turn's search cache instead of a free-text `location`. This is
  what makes the model *structurally incapable* of naming a place it did not search for, and
  it is the reason `ai-live` is still dark. Closes KI-81/KI-15.
- **Conversation durability** — no conversation table exists, so a reload loses the thread.
- **An eval/replay harness** — KI-11, inherited from M16's gate.

**Phase 0 raised three questions that are Mitchell's, not a build's.** None blocks starting
the above, and the second is the one that costs if it is left: whether the usage row carries a
`planVersionRef`; **which quota window a *sold* ceiling binds** (implemented per-day, stated
nowhere — M20 pays for this if it is not settled); whether the tier map is a Vercel Flag or an
env var.

## Landed in the last week

Compressed on 2026-08-28 and again on 2026-09-11. Each line names the durable
record; the long-form narrative is in `docs/retros/2026-08-28-status-archive.md`
and `docs/retros/2026-09-11-status-archive.md`.

- **The assistant became a kernel, 2026-09-11.** M9 Phase 0, `bbc5bdb` (#162) and
  `845fc48` (#163). ADR-043 and `docs/milestones/M9-ai-planning-partner.md`'s
  Phase 0 section carry it; KI-2026-09-05-t and KI-22 are resolved.
- **M17's gate closed 2026-09-11**, nine days after the code shipped — the retro
  on *that* gap is in `docs/milestones/M17-account-customization.md`, and it is
  the more useful half of the entry.

- **A binding operating contract for dispatched subagents, 2026-08-28.**
  `.claude/protocol/` — lifecycle, three exit states, a two-strike handback
  rule, a run-scoped board and a mechanically checked report shape, enforced by
  four fail-open hooks. `ADAPTER.md` and `adapter.json` hold every
  travel-collab-specific fact and a test enforces that the other three files
  name nothing about this repo. Start a run with `/dispatch`. Design:
  `docs/specs/2026-08-28-subagent-operating-contract-design.md`. Known defects
  consciously left: KI-62, KI-63.
- **A travel day is no longer a false conflict, 2026-08-28 — KI-60.** The Japan
  demo went from 12 conflicts to 2 with no fixture change: `detectConflicts`
  compared every same-day located pair against a flat 150km and never read
  `kind`, so all ten `impossible-geography` warnings sat on the two days the
  trip relocates, each with the day's own shinkansen scheduled *between* the two
  stops. The rule now excuses a distance a transit stop crosses **in time**, on
  time order rather than stored order, and never excuses an untimed stop. Full
  reasoning, including the weaker rule that was rejected with evidence:
  `docs/known-issues/` KI-60.
- **One canonical Japan fixture, 2026-08-28 — ADR-030 (PR #74).**
  `@tc/fixtures` owns the 14-day/68-stop trip; the seed script, the preview
  branch's demo reset and `@tc/factories` all call the same commands, and
  `src/lib/japanTripImporter.ts` is deleted. The two copies that existed were
  identical by luck, and where they differed was live on preview: the reset
  produced a trip with **zero tags** the day before M18's tag chips shipped, and
  coordinates were 72/72 local against 51/72 preview with six wrong venues.
  `pnpm seed:verify` is the thing that keeps it true. Procedure for new
  features: `docs/guidelines/fixtures-and-seed-data.md`. Filed rather than
  fixed: KI-57, KI-58, KI-59.
- **M18's contract PR, 2026-08-27 (PR #63).** See "Where the work is right now".
  The trap worth remembering: `equality.ts`, `diff.ts`, `hydrate.ts` and
  `detail.ts` each hand-enumerate activity fields, so adding a contract field
  without touching all four compiles cleanly and is wrong at runtime — and
  because `decide.ts` gates `UpdateActivity` on `okUnlessNoOp`, a kind-only
  update was rejected as a no-op until equality learned the field. The shared
  property generator needed both fields too, or the diff property test would
  have kept passing while never generating either. The project review found the
  same class again in `Location.city`/`countryCode` (KI-54, since resolved), and
  §6.1's descriptor refactor is the standing fix.
- **M10's Wave-2 gate closed 2026-08-27, and M15's closed 2026-08-26 (PR #56).**
  Evidence, retros and the rules promoted out of the deleted phase plans:
  `docs/milestones/M10-visual-craft.md`, `docs/milestones/M15-front-door.md`.
- **Two full reviews, 2026-08-28.** `docs/reviews/2026-08-28-project-review.md`
  (seven dimensions, six parallel agents) and
  `docs/reviews/2026-08-28-m11-pr71-review.md`. Both are being worked through on
  the current branch; read the remediation plan for what is in scope and what
  was deferred with a reason.

## Where the history went

| What | Where it is now |
|---|---|
| Everything this file said before 2026-08-28, verbatim and in order | `docs/retros/2026-08-28-status-archive.md` |
| This file's lines 243-1188 as of `845fc48` — the phone assistant (2026-09-05), M14's builder half, the 2026-08-30 three-PR stack | `docs/retros/2026-09-11-status-archive.md` |
| M9 Phase 0 — what each phase landed, the squash-merge hazard, the open questions | `docs/milestones/M9-ai-planning-partner.md`, ADR-043, and the design spec |
| M10 Wave 2, per phase — what each shipped, what it deliberately did not, the landing gaps that cost time | that archive, plus `docs/milestones/M10-visual-craft.md`'s scope, exit gate and Wave-2 retro |
| M15's gate and its two resolved open questions | `docs/milestones/M15-front-door.md` |
| Every roadmap reorder and its reasoning | `docs/milestones/README.md`'s reorder notes, and ADR-018 / ADR-021 / ADR-022 |
| The 2026-08-23 design sync, its routing, and the 2026-08-26 UI audit | `docs/design-feedback/` |
| The feature-flag / AI-kill-switch insert (PR #24) | ADR-019 and `docs/specs/2026-08-19-feature-flags-and-ai-kill-switch-design.md` |
| The test-suite overhaul, Phases 0-4 | `docs/plans/2026-08-23-test-suite-overhaul.md`, `docs/testing-baseline.md`, `docs/testing-inventory.md` |
| Which known issues are open, and which were closed when | `docs/known-issues/` — authoritative, and the only place that list should be kept |

# M47 plan — tiers over time, and Stripe test mode beside live

Milestone: `docs/milestones/M47-the-business-over-time.md` (decisions 1–4, answered 2026-10-17).
ADR: `docs/architecture/ADR-076-stripe-test-mode-runs-beside-live.md` (amends ADR-047).
Part 0 is the prose-only tracking PR on `claude/m47-the-business-over-time`; it merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/`, `docs/`,
`scripts/` or a dot. Line numbers are from `main` at `97caeb0`. Treat them as a starting point,
not as fact. **New** marks a file that does not exist yet.

## Order

| Part | Branch | Depends on | Can run beside |
|---|---|---|---|
| 1 Mode-keyed data | `claude/m47-part1-mode-keyed-data` | — | — |
| 2 Dual-secret webhook | `claude/m47-part2-dual-secret-webhook` | 1 merged | 4 |
| 4 Tier rollup | `claude/m47-part4-tier-rollup` | 1 merged | 2, 3 |
| 3 Admin test-mode switch | `claude/m47-part3-admin-test-mode-switch` | 1 and 2 merged | 4 |

Every part targets `main`. A part that depends on another branches from `main` after that part
has merged. Parts 2 and 3 both edit `server/billing/stripeApi.ts`, `prices.ts` and `config.ts`;
part 3 starts after part 2 merges, so it builds on the mode-taking signatures part 2 adds. Parts 3
and 4 both edit `server/db/schema.ts` and `drizzle/meta/_journal.json` and may be in flight
together; see *Migrations*.

## Facts the parts share (the survey, 2026-10-17)

- **Migrations.** `main` ends at `0054_rag_day_embeddings`, so **part 1 takes `0055`**. Parts 3
  and 4 each take the next free number **on `main` when they branch**. If both branch while
  `0055` is the newest, both would pick `0056`. **The one that merges second takes `main` and
  regenerates** (`pnpm --filter web db:generate` after deleting its own SQL, journal entry and
  snapshot), so its migration gets a fresh number *and* a fresh `when`. Renumbering by hand is not
  enough: `scripts/check-migration-journal.mjs` refuses a branch migration that does not sort
  after every migration on `main`, because Drizzle's migrator skips, forever, an entry older than
  the newest one applied (that file's header). Each migration adds its SQL,
  `drizzle/meta/_journal.json` and `drizzle/meta/<n>_snapshot.json`. Production migrations are
  dispatched by hand (ADR-004); a preview applies them itself.
- **Money reads today.** `subscriptionsWithStatus` (`server/billing/subscriptions.ts:56-60`) feeds
  `conferringNow` (`server/billing/revenue.ts:187-188`), which feeds `revenueSummary` (`:204`,
  plus its own `subscriptionsWithStatus` at `:212`), `underwaterReport` (`:302`, `:308`) and
  `revenueByPlan` (`:401`, `:405`). The console calls them at `server/entitlements/admin.ts:224`,
  `:838-839`, `:856`, `:864`, `:879`, and the account page at
  `server/entitlements/adminAccount.ts:136`.
- **Two money reads do not go through `subscriptionsWithStatus`.** The survey missed them. The tier
  panel counts `users.plan_id` (`planPanel`, `admin.ts:199`, the group-by at `:211-219`;
  `costByPlan`'s holders at `:276`). The accounts table's `accountsMatching`
  (`admin.ts:560-593`) lateral-joins `subscriptions` in raw SQL for its *paying* and *past due*
  columns. Both need the filter.
- **The customer id.** `users.stripe_customer_id` (`server/db/schema.ts:131`) has one reader and
  writer, `stripeCustomerFor` (`server/billing/checkout.ts:42-77`, conditional write at `:64-68`),
  called at `checkout.ts:159`, `:218` and `server/billing/planChange.ts:150`. `createCustomer` is
  `server/billing/stripeApi.ts:286`. `subscriptions.stripe_customer_id` (`schema.ts:1499`) is a
  per-row copy and is unaffected.
- **The webhook.** One secret, `billingConfig().webhookSecret` (`app/api/stripe/webhook/route.ts:37`),
  the raw body (`:51`), `constructStripeEvent` (`:55-59`), `applyStripeEvent` (`:72`). HMAC in
  `verifyStripeSignature` (`server/billing/signature.ts:100-127`). The envelope `StripeEvent`
  (`:133-139`) has no `livemode`. The claim is `claimEvent` (`server/billing/webhook.ts:113`), the
  subscription write is `writeFrom` (`:241`) into `applySubscriptionFacts`
  (`server/billing/subscriptions.ts:102-145`), and the held plan is `syncHeldPlan`
  (`webhook.ts:295-311`). `writeFrom` re-fetches the subscription from Stripe, so **that call has
  to use the verified mode's key**, or a test event on production 404s against the live key.
- **The key.** `billingConfig` (`server/billing/config.ts:81-93`) reads `STRIPE_SECRET_KEY` and
  `STRIPE_WEBHOOK_SECRET`, with the mode from the key's prefix (`modeOfSecretKey`, `:63-72`).
  Every Stripe call goes through `stripeRequest` (`stripeApi.ts:152-157`), which reads that one
  key. Prices are found by lookup key (`stripePriceFor`, `server/billing/prices.ts:122`,
  `findPriceByLookupKey` at `:139`).
- **Admin.** `users.is_admin` (`schema.ts:111`); `requireAdminApi`
  (`server/entitlements/requireAdmin.ts:20-26`) answers 404 for anyone else. The per-account admin
  write precedent is `app/api/admin/grants/route.ts` (body parsed by a `@tc/contracts` schema) with
  `components/admin/GrantDialog.tsx` and `AccountGrants.tsx`, drawn on `AccountPage`
  (`components/admin/AccountPage.tsx:83`, `AccountGrants` at `:210`), opened from
  `app/admin/page.tsx:134-146`.
- **Cron.** `apps/web/vercel.json` has one cron, `/api/cron/embed-days` at `0 4 * * *`. Its route
  (`app/api/cron/embed-days/route.ts:21-26`) checks `isCronRequestAuthorized`
  (`server/cronAuth.ts:19-26`, Bearer `CRON_SECRET`, fail closed) and answers 401 otherwise.
  CI sets no `CRON_SECRET`, so no e2e can call a cron route.
- **Exposure.** Every new internal route needs a line in `server/public-api/exposure.ts`
  (`exposure.test.ts` fails CI without it). The admin routes are all
  `PLANNED("Undecided — admin scope if ever")` (`:78-79`), so the test-mode route follows them.
  The cron route follows `cron/embed-days`'s precedent: `never`, with `reaches` naming
  `@/server/cronAuth` and the rollup module. Mitchell decides `never` lines, and that precedent is
  his.
- **KI-2026-10-17-a has no blast radius here.** `server/billing/**`, `server/entitlements/**`,
  `app/api/stripe/**`, `app/api/admin/**` and `app/admin/**` import neither `server/commands.ts`
  nor `server/ai/`. The cron folder is the one overlap: `embed-days/route.ts:8` imports
  `@/server/ai/sweep`. **The tier rollup is its own route and imports nothing from `server/ai/`.**
  Do not add a step to the embed route.
- **Contracts.** The console's read models (`AdminUsers`, `admin.ts:772`) are server types, not
  `@tc/contracts`, so parts 1 and 4 change no contract. Part 3's PUT body is a contract
  (`AdminTestModeInput`, on `AdminGrantInput`'s model) and gets a `docs/contracts/CHANGELOG.md`
  entry.
- **Charts.** recharts' `AreaChart` inside `ChartContainer` (`components/ui/chart.tsx`), as
  `components/admin/AiModelsCharts.tsx:60-89` does. Colours come from tokens (`tokenColor`), and
  `scripts/check-color-wall.mjs` rejects a raw hex.

## Part 1 — mode-keyed data (~16 files)

**Theme.** Decision 2 and ADR-076 §1–4, live only. Nothing yet writes `livemode = false`; this
part makes every row able to say it, and every money read refuse to count it.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/db/schema.ts` | `users` :131, `subscriptions` :1492, `billingEvents` :1571 | `subscriptions.livemode`, `billingEvents.livemode` (`boolean NOT NULL`), `users.planLivemode` (`NOT NULL DEFAULT true`), new `stripeCustomers` (`user_id`, `livemode`, `customer_id`, `created_at`; unique `(user_id, livemode)`); the `users.stripeCustomerId` comment says it is no longer read | `server/billing/revenue.int.test.ts` |
| new `drizzle/0055_<generated>.sql`, `drizzle/meta/_journal.json`, new `drizzle/meta/0055_snapshot.json` | — | add the columns with a `DEFAULT true` that back-fills, then drop the default on the two Stripe tables so a new row must name its mode; create `stripe_customers`; `INSERT … SELECT id, true, stripe_customer_id FROM users WHERE stripe_customer_id IS NOT NULL` | `scripts/check-migration-journal.mjs` |
| `server/billing/checkout.ts` | `stripeCustomerFor` :42-77 | read and write `stripe_customers` for `(userId, livemode)`, insert-if-absent (`ON CONFLICT DO NOTHING`, then re-read), always `livemode = true` in this part; callers :159, :218 unchanged | new `server/billing/checkout.int.test.ts` (no checkout or plan-change test exists today; Stripe is stubbed at `stripeRequest`) |
| `server/billing/planChange.ts` | :150 | unchanged call; compiles against the new signature | — |
| `server/billing/subscriptions.ts` | `SubscriptionFacts` :79, `applySubscriptionFacts` :102-145, `subscriptionsWithStatus` :56-60 | `livemode` on the facts and the insert (the webhook passes `true` until part 2); `subscriptionsWithStatus` adds `eq(subscriptions.livemode, true)` | `server/billing/revenue.int.test.ts` |
| `server/billing/webhook.ts` | `claimEvent` :113, `writeFrom` :241, `syncHeldPlan` :295 | `billing_events.livemode = true`, facts `livemode: true`, `planLivemode: true` written beside `planId` (part 2 makes all three the verified mode) | `server/billing/webhook.int.test.ts` |
| `server/billing/revenue.ts` | `conferringNow` :187 | none if the filter is in `subscriptionsWithStatus`; its header says money is live only (ADR-076 §4) | `server/billing/revenue.int.test.ts` |
| `server/entitlements/admin.ts` | `planPanel` :199 (group-by :211-219), `costByPlan` :275, `accountsMatching` :560-593 | count `users.plan_livemode = true` only; the lateral join's `paying` and `past_due` read `s.livemode` | `server/entitlements/admin.int.test.ts` |
| `server/entitlements/adminAccount.ts` | history loop :191 | a test subscription reads *"Bought … (test mode)"* | `server/admin/accountDetail.int.test.ts` |
| `server/billing/soleWriter.test.ts` | the customer id case :139 | it now lets checkout write `stripe_customers`; `users.planLivemode` joins `planId` and `planVersion` in the held-plan sweep | itself |
| `server/billing/storeBoundary.test.ts` | — | unchanged unless the new table needs listing | itself |
| `docs/architecture/SYSTEM-DESIGN.md` | §5.4, the table row at :401 | the stated exception is now `stripe_customers`; money reads are live only (ADR-076) | — |

**Tests seen red** (rule 3). In `revenue.int.test.ts`: insert one live and one test subscription,
both `active`; MRR, `underwaterReport` and `revenueByPlan` count only the live one. Delete the
`livemode` filter from `subscriptionsWithStatus` and watch MRR double; restore. In
`admin.int.test.ts`: an account with `plan_livemode = false` holding `premium` adds nothing to
`planPanel`'s premium count, and a test subscription does not make its account *paying*. Remove
each filter in turn and see that case go red for that reason. In `webhook.int.test.ts`: existing
cases still pass with `livemode = true` on every row, and one asserts the column is written. A
migration int case (or `users.int.test.ts`): a pre-existing `stripe_customer_id` reads back from
`stripe_customers` as live.

**Gate box served:** *A test-mode subscription adds nothing to MRR or the tier panels* (the
revenue and tier panel half).

**Preview walk:** nothing changes. Open the console's **Financial** tab: MRR, the tier panel and
the underwater panel show the numbers they did on `main`. Open **Users**: the counts on each
filter are the same, and an account page's history reads as before.

## Part 2 — the dual-secret webhook (~14 files)

**Theme.** Decision 3 and ADR-076 §5 and §7: two key pairs, the verifying secret decides the
mode, a disagreement is refused, the webhook writes the mode it verified.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/billing/config.ts` | `billingConfig` :81-93, `modeOfSecretKey` :63-72 | `billingConfig()` returns the configured pairs by mode (`{ live?, test? }`, each `{ secretKey, webhookSecret }`); the primary pair's mode is still read from `STRIPE_SECRET_KEY`'s prefix; `STRIPE_TEST_SECRET_KEY` must be `sk_test_` and `STRIPE_TEST_WEBHOOK_SECRET` `whsec_`; two pairs of one mode are refused; `billingConfigured()` keeps meaning "the primary pair is set" | `server/billing/config.test.ts` |
| `server/billing/signature.ts` | `verifyStripeSignature` :100-127, `StripeEvent` :133-139, `constructStripeEvent` | take `secrets: { mode, secret }[]`, return the event **and the mode whose secret verified**; still verify before any parse; `StripeEvent.livemode: boolean`; a verified event whose `livemode` is missing or disagrees throws `WebhookModeMismatchError` | `server/billing/signature.test.ts` |
| `app/api/stripe/webhook/route.ts` | :37, :55-59, :72 | pass every configured secret; `WebhookModeMismatchError` answers **400 `mode-mismatch`** before `applyStripeEvent`, so nothing is claimed or written | `server/billing/webhook.int.test.ts` |
| `server/billing/webhook.ts` | `applyStripeEvent` :328, `claimEvent` :113, `writeFrom` :241, `syncHeldPlan` :295 | take the verified mode; `billing_events.livemode`, the facts' `livemode` and `users.plan_livemode` (from the conferring subscription's `livemode`, `true` on a fall to `free`) come from it; the re-fetch uses that mode's key | `server/billing/webhook.int.test.ts` |
| `server/billing/stripeApi.ts` | `stripeRequest` :152-157, `createCustomer` :286, `findPriceByLookupKey` :329, `retrieveSubscription` :373 and the rest | a `mode` on every request, picking that pair's key; the customer idempotency key includes the mode | `server/billing/stripeApi.test.ts` |
| `server/billing/prices.ts` | `stripePriceFor` :122, `checkPriceConsistency` :203 | take the mode; the console's price check stays live | `server/billing/prices.test.ts` |
| `server/billing/checkout.ts`, `planChange.ts` | callers of the above | pass `live` (part 3 makes it the switch's) | `checkout.int.test.ts` (part 1) |
| `.env.example` | the Stripe block :110-137 | `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, with what each must begin | — |
| `docs/guidelines/billing-without-spending-money.md` | *The one rule* :16-42, new *Testing on production* | per ADR-076 *What changes in the billing guideline* | — |

**Tests seen red.** In `signature.test.ts`: a body signed with the test secret verifies as `test`;
one signed with the live secret verifies as `live`; one signed with neither is
`WebhookSignatureError`, with an unparseable body still giving the signature's error; a body
signed with the test secret that says `"livemode": true` throws the mismatch. Make the mode come
from the payload and watch the mismatch case go green wrongly, then red once restored. In
`webhook.int.test.ts`: the route answers 400 `mode-mismatch` for that delivery, and
`billing_events` and `subscriptions` have **no row** for it. A test-signed
`checkout.session.completed` writes `livemode = false` and `plan_livemode = false`, and the
account's entitlements now include the plan. In `config.test.ts`: `sk_live_` in
`STRIPE_TEST_SECRET_KEY` is refused, and so are two test pairs.

**Gate box served:** *An event signed with the test secret but claiming `livemode: true` is
refused.*

**Preview walk:** nothing on screen. With test keys in the preview's scope, forward a test event
(`stripe listen --forward-to <preview>/api/stripe/webhook --headers "x-vercel-protection-bypass:
…"`, the guideline's way 2) and see 200. Resend it with the body edited to `"livemode": true` and
re-signed with the test secret (a script, not the CLI) and see 400 `mode-mismatch`.

## Part 3 — the admin test-mode switch (~15 files)

**Theme.** Decision 4 and ADR-076 §6: the switch, the route that is its only door, the toggle,
and checkout, portal and plan change choosing the mode from it.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/db/schema.ts` | `users` | `stripeTestMode boolean NOT NULL DEFAULT false`, with a comment that it is server-only | — |
| new `drizzle/<next>_<generated>.sql`, `drizzle/meta/_journal.json`, new snapshot | — | the column (number: next free on `main`, see *Migrations*) | `scripts/check-migration-journal.mjs` |
| `packages/contracts/src/entitlement.ts`, beside `AdminGrantInput` :163 | — | `AdminTestModeInput { enabled: boolean }`, `AdminTestMode { enabled, available }` | `packages/contracts/test/` (a new case file) |
| `docs/contracts/CHANGELOG.md` | — | entry (`entitlement.ts` is already exported) | — |
| new `server/billing/testMode.ts` | — | `billingModeFor(userId)` (`test` when the switch is on **and** a test pair is configured, else `live`), `setTestMode(userId, enabled)` | new `server/billing/testMode.int.test.ts` |
| new `app/api/admin/accounts/[accountId]/test-mode/route.ts` | `GET`, `PUT` | `requireAdminApi` first; PUT parses `AdminTestModeInput`; 409 `test-mode-unavailable` when turning it on with no test pair; 404 for an unknown account | new `app/api/admin/accounts/[accountId]/test-mode/route.test.ts` |
| `server/public-api/exposure.ts` | admin lines :78-79 | `"admin/accounts/[accountId]/test-mode": PLANNED("Undecided — admin scope if ever")` | `server/public-api/exposure.test.ts` |
| `server/billing/checkout.ts` | `startCheckout` :114, `portalUrlFor` :214 | the mode from `billingModeFor`; that mode's customer (`stripeCustomerFor(userId, mode)`), Price and key | `server/billing/checkout.int.test.ts` |
| `server/billing/planChange.ts` | `previewPlanChange` :106, `applyPlanChange` :238 | the existing subscription's own `livemode` picks the key and Price (ADR-076 §6) | new `server/billing/planChange.int.test.ts` |
| `server/admin/accountDetail.ts` | `adminAccountDetail` :50 | `testMode: AdminTestMode` on the detail (admin-only page) | `server/admin/accountDetail.int.test.ts` |
| new `components/admin/AccountTestMode.tsx` | — | the toggle, PUT then `router.refresh()`; says *"Checkouts from this account use Stripe test mode. Nothing it buys counts as revenue."*; disabled with a reason when unavailable | new `components/admin/AccountTestMode.test.tsx` |
| `components/admin/AccountPage.tsx` | beside `AccountGrants` :210 | draw it | `components/admin/AccountPage.test.tsx` |
| `server/entitlements/accountPlanWireShape.test.ts` | — | `/api/account/plan`'s payload carries no test-mode key | itself |

**Tests seen red.** The route test covers both directions of the gate box: a signed-in non-admin's
GET **and** PUT answer 404, and the PUT leaves the column unchanged. An admin's PUT sets it and
GET reads it back. Delete `requireAdminApi` from one handler and watch that case go red for that
reason; restore. In `testMode.int.test.ts`: with the switch on and a test pair configured, the
mode is `test`, and without the pair it is `live`. In `checkout.int.test.ts`: a switched account's
checkout uses its test customer, and a live customer row is left untouched.

**Gate box served:** *The switch cannot be read or set by a non-admin*, and with parts 1 and 2 it
makes the **[walk]** possible.

**Preview walk:** as an admin, open **Users**, open an account, and flip *Stripe test mode*. As
that account, open **Change plan**, buy `plus` with `4242 4242 4242 4242`, and land on `/plans` with
the plan held. Back in the console, **Financial**'s MRR and the tier panel have not moved, and the
account's history reads *"Bought plus (test mode)"*. Sign in as a non-admin and GET
`/api/admin/accounts/<id>/test-mode`: 404.

**The production walk (Mitchell)** needs, once: a **test-mode** webhook endpoint in Stripe's
dashboard pointing at production's `/api/stripe/webhook`; `STRIPE_TEST_SECRET_KEY` and
`STRIPE_TEST_WEBHOOK_SECRET` in the Production scope, then a redeploy; and parts 1–3's migrations
dispatched (ADR-004).

## Part 4 — the tier rollup (~14 files)

**Theme.** Decision 1: the weekly table, the cron that writes it, and the Users tab's per-tier
charts (`.design-sync/handoff/specs/operator-console.md:40-50`).

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/db/schema.ts` | beside `subscriptions` | `tierWeekly` (`week_start date`, `plan_id`, `accounts int`, `updated_at`), unique `(week_start, plan_id)` | `server/entitlements/tierRollup.int.test.ts` |
| new `drizzle/<next>_<generated>.sql`, journal, snapshot | — | the table (number: next free on `main`) | `scripts/check-migration-journal.mjs` |
| new `server/entitlements/tierRollup.ts` | — | `rollupTiers(now)`: `week_start` is the Monday (UTC) of `now`'s week; counts `users` by `plan_id` where `plan_livemode = true`, the same population as `planPanel`; one upsert per plan `ON CONFLICT (week_start, plan_id) DO UPDATE`; a plan with no holders writes 0. `tierSeries(weeks = 26)` reads it back | `server/entitlements/tierRollup.int.test.ts` |
| new `app/api/cron/tier-rollup/route.ts` | `GET` | `isCronRequestAuthorized` or 401, then `rollupTiers`; **imports nothing from `server/ai/`** | new `app/api/cron/tier-rollup/route.test.ts` |
| `apps/web/vercel.json` | `crons` | `{ "path": "/api/cron/tier-rollup", "schedule": "30 4 * * *" }`: daily, so the week's row ends the week holding its last day's count and a missed day heals itself | — |
| `server/public-api/exposure.ts` | beside `cron/embed-days` | `never`, `why` "The weekly tier rollup — runs on Vercel Cron's secret, never on an API token", `reaches` `@/server/entitlements/tierRollup` and `@/server/cronAuth` | `server/public-api/exposure.test.ts` |
| `server/entitlements/admin.ts` | `AdminUsers` :772, `adminUsers` :851 | `tiers: TierSeries` (per plan: weekly points, current count, since date) | `server/entitlements/admin.int.test.ts` |
| new `components/admin/TierGrowthCharts.tsx` | — | one card per tier, each with its own y-scale; the count; a 72px area; x labels first week · `peak N` · `now`; *"since <date>"*; an empty state before the first run | new `components/admin/TierGrowthCharts.test.tsx` |
| `app/admin/page.tsx` | Users tab :148-170 | a `Panel` *"Accounts by tier"* above *Accounts* | `app/admin/admin.console.test.ts` |
| `apps/web/e2e/m36-operator-console.spec.ts` | the walk at :66 | the Users tab shows the panel (on CI's fresh database, its empty state) | itself, via `test:e2e:ci-like` |

**The handoff's *+N added / −N lost*** needs per-account movement, and a table of counts does not
hold it. Part 4 draws the **net change over the last four rows**, labelled as net, unless Mitchell
asks for gross figures. Gross figures need a per-account snapshot, which would be a second table
and a decision.

**Tests seen red.** In `tierRollup.int.test.ts`: `rollupTiers` run twice for one week leaves **one
row per plan**, with the second run's count. Swap the upsert for a plain insert and see the
uniqueness error, or remove the unique index and see two rows. An account with
`plan_livemode = false` is not counted; drop the filter and see the count rise. A new week starts a
new row. In the route test: no header and a wrong secret both answer 401 and write nothing.

**Gate boxes served:** *The rollup job is idempotent per week*, and the rollup half of *A test-mode
subscription adds nothing to MRR or the tier panels*.

**Preview walk:** call the cron route on the preview with the Preview scope's `CRON_SECRET`
(`curl -H "Authorization: Bearer $CRON_SECRET" <preview>/api/cron/tier-rollup`, with the bypass
header). Open the console's **Users** tab: one card per tier, *"since <this week>"*, a count that
matches **Financial**'s tier panel. Call it again: the cards do not change.

## Gate close

Part 0 ticks each box with its evidence (`close-a-milestone`): the int tests by name and their
seen-red edits, the route test, and Mitchell's production walk. It then deletes the two absorbed
candidates from `docs/candidates.md`, files a follow-up to drop `users.stripe_customer_id`
(ADR-076 §2), writes the retro, and deletes this plan.

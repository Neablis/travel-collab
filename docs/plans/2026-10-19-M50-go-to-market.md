# M50 plan — a stranger can find a day, make it their trip, and bring people in

Milestone: `docs/milestones/M50-strangers-find-a-day.md` (decisions there; this file is the build
plan). ADR-079. Paths are under `apps/web/src/` unless they start with `apps/`, `docs/`,
`scripts/` or `.design-sync/`. Every part targets `main`, branches `claude/m50-part<K>-<slug>`,
and merges on its own. Deleted at gate close (git history keeps it).

Migrations: part 2 takes `0060`. No other part needs one; if one turns out to, it takes the next
free number after rebasing on `main`.

## Part 1 — copy fixes, end to end · `claude/m50-part1-copy`

Decisions 3, 9–13.

| Change | Entry point | Tests |
|---|---|---|
| H1 → *"Plan the trip together."* | `components/front/LandingScreen.tsx:228`, `components/front/PhoneFrontDoor.tsx:493` | `LandingScreen.test.tsx:54`, `PhoneFrontDoor.test.tsx:231`, `LandingHeroArt.failed.test.tsx:79`; e2e `apps/web/e2e/m15-front-door.spec.ts:24,119`, `m42-demo-trips.spec.ts:152`, `responsive.spec.ts:897,983`, `seo.spec.ts:13` (`HEADLINE`) |
| Site description, OG alt, OG PNG | `lib/siteMetadata.ts:22,37`, `app/opengraph-image.alt.txt`, regenerate with `apps/web/scripts/generate-og-assets.mjs` | `seo.spec.ts` |
| `/developers` description: *how to sign up, make an API token, and find the OpenAPI reference.* | `app/(front)/developers/page.tsx:10` | `seo.spec.ts:60,101` (presence only) |
| Footnote → *"By continuing you agree to the terms and the privacy notice."* | `components/front/authCopy.ts:60` (verbatim handoff text: also edit `.design-sync/handoff/design/Trip Planner Redesign.dc.html:5415`) | `AuthScreen.test.tsx:548`; add a no-"open source" assertion to the auth copy test |
| Admission messages reworded (decision 12), em dashes out of INVALID/SPENT | `components/front/authCopy.ts:127-138` (keep `Record<AdmissionRefusal,…>` keys) | `AuthScreen.test.tsx:223-264,283` |
| Four prose em dashes | `components/front/DevelopersScreen.tsx:120,130,140,157` | `DevelopersScreen.test.tsx` (add one assertion) |
| Assistant tone line | `server/ai/handleAskRequest.ts` `instructionsFor` (:1793) / `instructionBlocks` (:1885). Put it in a stable block: the cached prefix must stay byte-identical across steps (:1803, :724-740) | `server/ai/contextBudget.test.ts` + regenerate `contextBudget.baseline.json` with `UPDATE_CONTEXT_BUDGET=1`; `server/assistant/prompt.test.ts`; offline eval set in `server/ai/eval/` (numbers pasted in the PR; **no live eval**) |
| "Relived 214 times" gets a *Sample* treatment | `components/front/PhoneFrontDoor.tsx:147`, `components/front/LandingFeatureBlocks.tsx:172` | the two components' tests |

Traps: SPEC §14 copy-rule test (`LandingScreen.test.tsx:160-181`); the tone line's own em dash
must go (use a comma). CLAUDE.md rule 5 on `#` digits.

Preview: `/` and the phone width; `/signup` footnote; `/signin?error=INVITE_REQUIRED` (or the
code the map uses); `/developers` source view for the meta tag; ask the assistant on a trip.

## Part 2 — first-touch attribution and the report · `claude/m50-part2-signup-ref`

Decisions 6, 14; ADR-079.

| Change | Entry point | Tests |
|---|---|---|
| Proxy matcher entry with `has: query ref`; ref branch sets `caesura_ref` (validate, first touch, 30 days) and nothing else | `proxy.ts:181` (matcher), pattern at `:116-125`; new `lib/signupRef.ts` (name, validate, max age) | `proxy.test.ts`; new `lib/signupRef.test.ts` |
| `users.signup_ref` column | `server/db/schema.ts:55-127`; `apps/web/drizzle/0060_users_signup_ref.sql` + journal | `scripts/check-migration-journal.mjs`, `apps/web/scripts/check-migration-state.mjs` |
| Copy on user creation only, clear the cookie | `server/users.ts:371` `recordSignIn` (beside `rewardReferrer` at :455-470); cookie read the way `server/admission.ts:78` reads `pending_admission` | new `server/users.signupRef.int.test.ts` (or extend the existing users int test): new user gets ref, existing user unchanged, bad ref dropped |
| Report | `server/entitlements/admin.ts` (`adminUsers`) or a sibling query; `app/admin/page.tsx:156` Users tab; new `scripts/signups-by-ref.mjs` + root `package.json` script | an int test for the query; the Users tab component test |

Traps: ADR-078 — `/` must stay static for requests without `ref` (paste `curl -I` of `/` and
`/?ref=x` from the preview in the PR); the ref response must not be CDN-cached with its
`Set-Cookie`. `migrate-production` is Mitchell's.

Preview: open `/?ref=showhn`, check the cookie; open `/?ref=other`, it stays `showhn`; sign up a
new account; the Users tab shows `showhn: 1`.

## Part 3 — `ItemList` JSON-LD on place pages · `claude/m50-part3-place-jsonld`

| Change | Entry point | Tests |
|---|---|---|
| `placeItemListJsonLd(days, origin)` | `lib/jsonLd.ts` (beside `dayJsonLd` :47, `serializeJsonLd` :84); URLs from `lib/playbookUrls` (`dayPath`) and `lib/deploymentOrigin` | `lib/jsonLd.test.ts` |
| Render it | `app/playbooks/live/city/[slug]/page.tsx`, `app/playbooks/live/country/[slug]/page.tsx` via `components/JsonLd.tsx`, data from `server/placePage.ts:54` `placeListing`; copy the day page's `indexable` guard (`live/day/[savedDayId]/page.tsx:110-135`). `[copy]` twins re-export; keep them session-free | `apps/web/e2e/seo.spec.ts:415` (city), add country; `:118` parse helper |

Preview: view source on a city and a country page; paste into Google's Rich Results Test.

## Part 4 — one step from a day to a new trip · `claude/m50-part4-day-to-new-trip`

Decision 5.

| Change | Entry point | Tests |
|---|---|---|
| Remember the intent as "new trip" | `lib/pendingPlaybookAdd.ts:40,60,95` (`rememberPlaybookAdd`), `components/playbooks/SignInToAddDialog.tsx:28-46` (also send the slugged path, not the 308 one) | `lib/pendingPlaybookAdd.test.ts` |
| On return, run the new-trip add with no dialog | `components/playbooks/SharedDayScreen.tsx:293-311` (`takePlaybookAdd` effect); extract `AddToTripDialog.tsx:147-206`'s new-trip path (`createTrip` → `insertSavedDay` → `router.push`) into a shared function both call | `SharedDayScreen.test.tsx`, `AddToTripDialog.test.tsx` |
| Lost-callback fallback | `components/home/HomeScreen.tsx:355-364` | `HomeScreen.test.tsx` |
| Button label for signed-out readers: *Make this your trip* | `SharedDayScreen.tsx:850-868` | `SharedDayScreen.test.tsx` |
| e2e | `apps/web/e2e/public-playbooks.spec.ts:41-105` now ends on `/trips/<id>` holding the day | ci-like for that spec only |

Preview: signed out, open a city page → a day → *Make this your trip* → sign up → the trip.

## Part 5 — the landing becomes editorial · `claude/m50-part5-landing-editorial`

| Change | Entry point | Tests |
|---|---|---|
| Break the 2×2: alternate full-bleed spreads and widths, leave a slot for a real photo | `components/front/LandingFeatureBlocks.tsx:323,331` | `LandingFeatureBlocks.test.tsx:31` (order), `.failed.test.tsx` |
| Replace the closing band with an editorial moment (a quote from a trip notebook page, CTA *Start the plan, then bring everyone.*) | `components/front/LandingScreen.tsx:283-300`, phone `PhoneFrontDoor.tsx:543`; handoff `dc.html:5371` | `LandingScreen.test.tsx`, `PhoneFrontDoor.test.tsx`, `responsive.spec.ts` |
| Paper grain on landing surfaces | `app/globals.css` (`@layer components` :488; tokens :35-42); must work under `html[data-look="ledger"]` (:375-472); respect `prefers-reduced-transparency`/print | colour wall `scripts/check-color-wall.mjs` (raw colours only in globals.css), `scripts/__tests__/check-color-wall.test.mjs` |

Traps: `.design-sync/**` is a build input, not prose; `docs/guidelines/design-system.md` radii;
token classes only (`.design-sync/conventions.md:14-16`).

Preview: `/` desktop and phone, both looks.

## Part 6 — empty states and an editorial Discover · `claude/m50-part6-empty-states-discover`

| Change | Entry point | Tests |
|---|---|---|
| Copy per surface; an optional `art` slot on `EmptyState` for a later illustration | `components/ui/empty-state.tsx:13` (+ `.design-sync/docs-stubs/EmptyState.md`); callers `components/lenses/MapLens`, `components/playbooks/{SharedDayScreen,SharedDayMap,LeaderboardScreen,DiscoverScreen:789,ProfileScreen}`, `components/pages/NotebookScreen.tsx:639`. Admin callers untouched | each caller's test pins its new line |
| Discover: varied card sizes, human-written collection titles | `components/playbooks/DiscoverScreen.tsx`, `DiscoverCard.tsx` | `DiscoverCard.test.tsx`, `DiscoverScreen` test |

Preview: Discover; an empty notebook; an empty profile; the map lens with no stops.

## Part 7 — publish a lived trip · `claude/m50-part7-publish-lived-trip`

Decision 7.

| Change | Entry point | Tests |
|---|---|---|
| "Has ended" from `TripSummary.endDate` | `packages/contracts/src/trip.ts:431`; helper beside `lib/homeTripOrder.ts:32` | unit test for the helper (today, timezone edge) |
| Offer on Home's card and the trip page top | `components/home/TripCard.tsx` / `NextTripHero.tsx:231-245`; the trip page header beside `board/Board.tsx:1110` | `TripCard.test.tsx`, a trip-page component test |
| Open `KeepDayDialog` with every day ticked, trip name as title, *Save & publish* | `components/trip/KeepDayDialog.tsx:228,342` (`createSavedDay`), then `publishSavedDay` (`lib/apiClient.ts:1373`), then route to the playbook | `KeepDayDialog.test.tsx` |
| Dismissal per person per trip | the account preferences route `app/api/account/preferences/route.ts` (no migration if a JSON preference fits; otherwise the next free number) | route test |

Preview: a trip with dates in the past → Home card offer → publish → the public page; dismiss on
another ended trip and reload.

## Part 8 — the referral nudge · `claude/m50-part8-referral-nudge`

Decision 8.

| Change | Entry point | Tests |
|---|---|---|
| A one-line nudge with a copyable link, only when the referrals GET answers `earnsReward: true` (not the plan view's `canRefer`: `earnsReward` is the read `rewardReferrer` makes, so the line never promises a month the reward would refuse; `useReferralLink.ts:47-51`) | `components/trip/ShareButton.tsx:32`, `components/trip/people/InviteDialog.tsx`; data from `app/api/account/referrals/route.ts` (GET `earnsReward`, POST mints, 409 at cap); link built like `components/account/PlanSection.tsx:160` `referralLink` (extracted as PR 498 shipped it: `components/account/useReferralLink.ts`, `components/account/ReferralNudge.tsx`) | `ShareButton.test.tsx`, InviteDialog test, `useReferralLink.test.tsx`, `PlanSection.test.tsx` |

Preview: a paid account's Share dialog shows the nudge; a free account's does not.

## Order and merging

Built in order 1 → 8; each merges when ready (Mitchell's call). Part 2 must merge and
`0060` be applied before the Week 3 posts. Part 0 (this plan, the milestone file, ADR-079 and the
order changes) is the session branch's draft PR and merges last.

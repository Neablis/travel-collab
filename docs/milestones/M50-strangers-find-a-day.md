# M50 — A stranger can find a day, make it their trip, and bring people in

**Status:** **Proposed and scoped 2026-10-19 with Mitchell; current from 2026-10-19.** M48 is
parked, not closed: its remaining gate boxes wait on plan-turn traffic, which this milestone's
launch is meant to bring (`docs/milestones/README.md`, *2026-10-19 — minted: M50, M48 parked*).
Plan: `docs/plans/2026-10-19-M50-go-to-market.md`. ADR-079 (first-touch signup attribution).

## Why this exists

Mitchell's go-to-market plan (2026-10-18; a launch on r/SideProject, Indie Hackers, Show HN,
Product Hunt, then SEO and creators) says *"do nothing [on distribution] until Phase 1 + P0 are
done. A launch post that lands on a page with no conversion path is wasted."* This milestone is
that precondition, plus the two loops that make the launch compound:

- **The front door still reads, in places, like a product that no longer exists**: an invite-only
  meta description on `/developers`, dead invite-gate errors, an "open source" footnote that
  breaks SPEC §14, a cryptic H1 that disagrees with the page title.
- **Nothing records where a signup came from**, so "signups per channel" — the plan's only
  measure — cannot be answered.
- **A stranger who lands on a playbook day from search** can add it to a trip, but it takes a
  sign-up, a return to the page, and a second choice in a dialog.
- **City and country pages ship no structured data**, though the day pages do.
- **The landing's shape is template-shaped** (2×2 feature cards, a SaaS CTA band) and empty
  states are generic dashed boxes.
- **A lived trip never becomes library content**, and **the referral reward is invisible**
  outside Account › Plan.

Verified against the code on 2026-10-19 (the survey is summarised in the plan). Two of the GTM
doc's claims were corrected: the signed-out day page *does* have an "Add to a trip" button
(`SignInToAddDialog`), and there is no in-app account export or delete, so the footnote may not
promise one.

## Decisions

**Answered by Mitchell, 2026-10-19:**

1. **M50 is current now; M48 is parked** until plan-turn traffic arrives. Its no-traffic items
   (the ledger example count, the baseline paste, PR 470's red text) resume after M50.
2. **Scope is the whole plan, P1 included**: copy, attribution, JSON-LD, the one-step CTA,
   code-only design, publish-a-lived-trip, the referral nudge.
3. **The signup footnote drops the export/delete promise.** It reads *"By continuing you agree to
   the terms and the privacy notice."* Account export/delete is not built here.
4. **Order:** copy → attribution → JSON-LD → one-step CTA → design → publish → referral.
5. **After signing up from a playbook day, the person lands on a new trip with the day already
   in it**: named for the day, no dates, no extra choice. `AddToTripDialog`'s *Start a new trip*
   path is reused; the dialog is not shown on that return.
6. **Attribution is first touch, in a 30-day first-party cookie** (ADR-079): the first `?ref=`
   seen is kept, a later one does not overwrite it, and signup copies it to the account.
7. **Publish a lived trip:** once a trip's end date has passed, its Home card and the top of the
   trip page offer *"Turn these days into a playbook?"*. It opens `KeepDayDialog` with every day
   ticked and the trip's name as the title; *Save & publish* lands on the new public playbook
   page. Dismissing hides the offer for that trip, for that person.
8. **Referral nudge:** one line in the Share and Invite dialogs, *"Bring someone in, get a
   month"*, with a ready referral link, shown **only** to accounts that can earn the reward
   (`earnsReward`, a paid plan). Free and trial accounts see nothing new; who earns is unchanged.
9. **The copy fixes carry through everywhere the text lives**: the site meta description, the OG
   image's alt text and its regenerated PNG, and the design handoff in `.design-sync/` so a sync
   does not revert them.
10. **The assistant's tone line ships**, with the context-budget baseline regenerated and the
    offline eval set run. No live eval unless Mitchell asks.

**Settled at scoping on the recommendation (Mitchell may overrule at the walk):**

11. **New H1:** *"Plan the trip together."*, matching the `<title>`; the "Days worth reliving"
    eyebrow stays.
12. **Dead admission messages are reworded, not removed**, so the `AdmissionRefusal` contract does
    not change: they say invite codes are no longer required, and a code is only for referral
    credit.
13. **The "Relived 214 times" fixture** gets a visible *Sample* treatment rather than a new number.
14. **Signups per channel** is a table on the operator console's Users tab (channel, signups in
    the last 7 and 30 days, all time), plus a `pnpm signups-by-ref` script for the terminal.

**Settled by Mitchell during the build (2026-10-19):**

15. **Only a new sign-up goes straight to a new trip.** An existing account that signs in from a
    playbook day returns to the day with the add-to-trip dialog open (an existing trip, or start a
    new one). Part 4, PR 497.
16. **The tone line reaches every assistant prompt**: trip turns, the account-wide assistant and
    the playbook page, with the context-budget baseline regenerated and offline evals only.
    Part 1, PR 494.
17. **The tone line's wording stays as is**: *"Talk like a friend who has been there, plain,
    specific, no filler."* Mitchell chose it over the guarded alternative (*"a well-travelled
    friend… never claim you went somewhere yourself"*), knowing it may invite invented first-person
    visits. No eval case for that unless he asks.
18. **Migration 0060 ships inside PR 496, not in a PR of its own.** Mitchell dispatches
    `migrate-production` right after 496 merges and accepts that sign-in is down from that deploy
    until the migration finishes. Part 7's migration renumbers to 0061 after 496 merges.

**Settled by Mitchell at his production walk of `/` (2026-10-19), adding part 9:**

19. **Part 9 exists because of the walk.** Two defects on the landing: the playbooks spread held an
    empty grained mat (`PhotoSlot`), and the notebook spread was a thin strip and two paragraphs.
    The empty slot becomes a second real playbook card; the notebook becomes a lived-in diary page
    built from the notebook's real read-only widgets (`ItineraryDayBlock` between the diary's
    prose, `TripPeopleBlock`, `SunBlock`). Part 9, PR 503.
20. **The second card is Railay** (`content/playbooks/thailand-beaches.json`), credited to Nadia,
    with no *Sample* badge and no invented rating: it reads *"No reviews yet"*. The section's copy
    is unchanged.
21. **Part 9 merges as a stopgap.** The landing gets a fuller redesign after M50, its own milestone
    starting from a design review (`docs/candidates.md`, *The front door tells the story*).

## Scope

Nine parts, each its own PR on `main` (the plan has the files; part 9 came from the walk):

1. Copy fixes, end to end (decisions 3, 9–13), including the assistant's tone line.
2. First-touch `?ref=` attribution and the signups-per-channel report (6, 14). Migration `0060`.
3. `ItemList` JSON-LD on city and country pages.
4. One step from a playbook day, through signup, to a new trip holding it (5).
5. The landing becomes editorial: the feature grid broken up, the closing band replaced, a paper
   grain on landing surfaces (under both looks, `paper` and `ledger`).
6. Empty states with their own words, and Discover with editorial sizing and collection titles.
7. Publish a lived trip as a playbook (7).
8. The referral nudge in Share and Invite (8).
9. The landing's playbook shelf and a lived-in notebook page, from Mitchell's walk (19–21).

## Out of scope

- **Hero photography, a custom icon set and spot illustrations.** They need Mitchell's photos or
  drawings; the layouts in parts 5–6 leave a place for them. A follow-up once the assets exist.
- **Account export and delete** (decision 3).
- **The playbook seeding worker's prompt** (title variety, no year anchoring) lives outside this
  repo. The Chiang Mai summary row (`e86f19a9-…`) is a one-off production data edit for
  Mitchell to approve separately.
- **Creator embeds, oEmbed, affiliate booking fields, settle-up**: the GTM plan's P2.
- **Posting the launch** itself (drafts can be written outside the gate).

## Exit gate

- [ ] **Copy:** the landing and phone H1 read *"Plan the trip together."*; `/developers`'
      description says *sign up*; the signup footnote has no "open source" and no export/delete
      claim; no admission message says Caesura is invite-only; the four `DevelopersScreen` prose
      em dashes are gone; meta description, OG alt and OG PNG agree with the page; the handoff
      carries the same text. Unit and e2e assertions pin the new text, each seen red.
      *Open (2026-10-19):* PR 494 (merged `ad08627`) did all of it, with CI green on its head
      `11d26c5` (run 39258086972). The unit pins were seen red (PR 494's red-first table). The e2e
      pins (`seo.spec.ts:13`, `m15-front-door.spec.ts:24`, `responsive.spec.ts:922`) ran green
      via ci-like, but no e2e red is recorded.
- [x] **Assistant tone:** the line is in the instruction, the context-budget baseline is
      regenerated in the same PR, and the offline eval set's numbers are pasted in the PR.
      *Evidence:* `VOICE_RULE`, `apps/web/src/server/ai/handleAskRequest.ts:2066`, used at
      2054, 2086 and 2125. PR 494's red-first table has the baseline red (`trip · viewer: 4150 →
      4217 chars`), and its body has the offline evals (`grade.test.ts` 36/36, `replay.int`
      70/70). Merged `ad08627`, CI green on `11d26c5` (run 39258086972). The account and playbook
      prompts are outside the budget: KI-2026-10-19-e.
- [ ] **Attribution:** a visit to `/?ref=showhn` followed by a signup within 30 days stores
      `showhn` on the account; a second `?ref=` does not overwrite the first; a malformed ref is
      dropped; `/` stays static (its response headers in the PR). Integration test seen red.
      *Open (2026-10-19):* PR 496 (merged `494d964`, CI green on `cc90957`, run 39237229216)
      has the first-touch, no-overwrite and malformed-ref tests seen red. No response headers for
      `/` are in the PR, and that check needs the preview walk (ADR-079).
- [x] **Report:** the console's Users tab and `pnpm signups-by-ref` show signups per channel.
      *Evidence:* PR 496 (merged `494d964`, CI green on `cc90957`, run 39237229216). Its
      red-first table covers `SignupsByRefTable` ("null reads direct") and the 7/30-day
      `signupsByRef` windows (int). `scripts/signups-by-ref.mjs` ran against the test DB.
- [x] **JSON-LD:** every indexable city and country page (`placeIndexable`; thinner ones are
      `noindex` and emit none) carries one `ItemList` of the days it shows, with
      absolute URLs, validated by the seo spec; the cached `[copy]` twins carry it too.
      *Evidence:* PR 495 (merged `278791b`, CI green on `fd1efe1`, run 39214986837).
      `seo.spec.ts` (city, country, and a thin page emitting none) was seen red. The guard is at
      `app/playbooks/live/city/[slug]/page.tsx:24` and `live/country/[slug]/page.tsx:22`. The
      `[copy]` twins re-export the live pages (`[copy]/city/[slug]/page.tsx:3`).
- [x] **One step:** signed out, *Add to a trip* → sign up → lands on `/trips/<new>` with the day
      in it, no dialog. The existing `public-playbooks.spec.ts` path is updated and green in CI.
      *Evidence:* PR 497 (merged `b815890`). The `public-playbooks.spec.ts` path was seen red
      (`Expected pattern: /\/trips\/[0-9a-f-]{36}$/`) and green via ci-like. CI is green on
      `c4d91dd` (run 39264057976).
- [ ] **Landing and empty states:** the feature section no longer has four equal cards; the
      closing band is replaced; grain shows under both looks; every `EmptyState` caller outside
      the admin console has its own copy; the colour wall passes.
      *Open (2026-10-19):* PR 500 (merged `aeea6ce`, CI green on `d29c620`, run 39274224019)
      and PR 501 (merged `8b3abed`, CI green on `c6d4f41`, run 39271108575) cover the layout,
      the closing moment and the empty-state copy with tests seen red. Grain under both looks,
      at its lowered opacity (0.12 / 0.08), has not been seen in a browser yet: that is for the
      walk.
- [ ] **Publish:** an ended trip offers the prompt on Home and on the trip page; publishing lands
      on a public playbook holding every day; dismissing hides it for that person and trip.
      *Open (2026-10-19):* PR 499 (merged `879fc87`, CI green on `508d57b`, run 39281259693)
      has unit and int tests for each clause, seen red. Still open: the walk (the note after
      Dismiss), and production, where `0061` is not applied yet (`migrate-production`).
- [x] **Referral:** the nudge shows in Share and Invite for a paid account and not for a free one.
      *Evidence:* PR 498 (merged `da1a7b7`, CI green on `e73d70a`, run 39237964347).
      `ShareButton.test.tsx` and `InviteDialog.test.tsx` each test both cases, red-first in PR
      498. It gates on `earnsReward`, not `canRefer` (`useReferralLink.ts:47-51`). The browser
      check is in the walk box.
- [ ] **[walk]** Mitchell walks the preview: signed out from a city page to a new trip; the
      landing on desktop and phone; an ended trip to a published playbook; a paid account's
      Share dialog.
- [x] `migrate-production` has applied `0060` (Mitchell's).
      *Evidence:* run 39269884761, 2026-10-19T14:32Z, on `b815890`, which contains
      `0060_users_signup_ref`: success. `0061_users_dismissed_publish_offers` (PR 499) is on
      `main` but not applied in production. No run was later than 39269884761 when re-read on
      2026-10-19.

A retro is appended at gate close.

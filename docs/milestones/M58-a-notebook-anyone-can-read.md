# M58 — A notebook anyone can read, and a poll for the people going

**Status (2026-11-04): proposed, not scoped.** Minted by Mitchell the same day: *"Add a new
milestone, allowing publicly sharable notebooks, so people can make trip overviews they can share
with people who aren't members of the app, and include a call to action on the bottom of the page
to have them create their own account to create their own trip. Anonymous traffic can't join the
trip from public pages."* Later the same day he added: *"a new poll widget for polling those
going."* He named five questions to settle. They are decisions 1 to 5 below, and the poll is
decision 8. **Placed ahead of M53 the same day, so it is current** (*"Can we make this the next
milestone, not last"*; see `docs/milestones/README.md`, *2026-11-04 — minted: M58, public
notebooks and a poll*). **Scoped 2026-11-04 with Mitchell: all eight decisions answered**
(*Answered* below; it overrides *As proposed* wherever they differ), with the mechanisms in
ADR-088. The plan was deleted at the gate close.

## Why this exists

Today a trip can reach a stranger three ways, and none of them is a notebook someone wrote:

- **A pinned share link** (`/s/<token>`, ADR-027) shows the whole trip at one point in its history.
  It goes through the explicit field list in `toSharedView` (`server/access/sharedView.ts`), and
  that list **includes no pages**.
- **A published playbook day** (ADR-061) is a copy taken out of the trip, written for the library.
- **The demo** (`/demo/<slug>`, ADR-031) is a fixture, not anyone's trip.

The thing people actually want to send is the Overview they wrote themselves: *"here's the plan,
here's where we are each day."* The group chat or the family that isn't on Caesura should be able
to read it without an account. The page then ends in an invitation to plan a trip of their own.
That makes it a growth loop. It is not a way into the trip.

### What already exists, and is reused

| Piece | Where | Reused for |
|---|---|---|
| A 256-bit bearer token, revocable | `mintToken` in `server/access/shares.ts:19`, the same as `invites.ts:46` | the public URL (decision 2) |
| Revoke a share; revoke is idempotent | `revokeShare`, `shares.ts:87` | unpublish (decision 3) |
| Read without a session, `NOINDEX`, left out of the `proxy.ts` matcher | `(front)/s/[token]/page.tsx` | the public route |
| An explicit field list, so the public read can't grow by accident | `toSharedView`, and ADR-027's 2026-10-08 amendment | the public trip view (decision 5) |
| Booking redaction for no seat (`null`) | `redactBookingFor`, `server/access/bookingRedaction.ts` (ADR-086) | stops on the public page |
| A widget that is absent, not disabled, when the reader lacks a capability | `MacroDef.requires` / `ReaderCapability`, `packages/pages/src/registry-types.ts:642-663,774` (SPEC §27) | the widget allow-list (decision 5) |
| Links stored as targets, never URLs, and turned into hrefs at render | `LinkTarget`, `packages/pages/src/linkTarget.ts:23`; `linkHref.ts:19` | links on a public page (decision 1) |
| First-touch `?ref=` attribution | `caesura_ref`, `lib/signupRef.ts:10` (ADR-079) | the call to action (decision 7) |

## Decisions

### Answered (2026-11-04, Mitchell, in session)

| # | Asked | Answer |
|---|---|---|
| 1 | Links to other pages | **A link to a public notebook opens its `/n/` URL. Every other target (a private notebook, a seed that resolves to a private page, a day, a view) renders as plain text: its label, with no link.** Not as proposed: a private notebook's title does reach the page. So the publish dialog lists those titles under *Shown as plain text* before anything goes live, and keeps the unticked *Also make public* boxes. |
| 2 | The URL | **As proposed:** `/n/<mintToken()>`, no ids or slug, `noindex`, not in the sitemap, `Referrer-Policy: no-referrer`, an OG card with only the title and cover, and no people's names on the page. |
| 3 | Public, then private | **As proposed:** live, not pinned; `page_shares` is a CRUD access row, not a trip event; *Make private* works on the next request; a revoked URL is a plain 404; re-publishing mints a new token; deleting the notebook or trip revokes. |
| 4 | Who publishes | **As proposed:** editors and the owner publish, and any of them can make it private; viewers and suggesters see a *Public* chip and can copy the link; the Share panel lists every public notebook; no tier gate. The seeded *Bookings & confirmations*, *Money* and *During the trip* notebooks can't be published. |
| 5 | Which widgets | **Not as proposed. Every widget shows by default, and every widget instance has a *Hide when public* setting** (*"Default allow all, but have a setting in all widgets to hide/turn off when public. Leverage a new default state like the no data state"*). A hidden widget draws, for a stranger, **a new quiet *Not shared* state styled like the widget's no-data state**, and its data is not sent to the page. In edit mode, members see a *Hidden when public* badge on it. **Three floors stay whatever a setting says** (asked and answered: *"Keep all three"*): booking confirmation codes and links are stripped for a reader without a seat (ADR-086), `chat.recent` needs `canChat` so it never draws for a stranger, and stops carry no `addedBy` names. Everything else shows its data, a lodging stop's address included, unless the widget is hidden. |
| 6 | Signed-in visitors | **Not as proposed. Everyone sees the stranger's page**, members included: no *Open in the trip*, and no join, request-access or invite control for anyone. |
| 7 | The call to action | **As proposed:** one shared `PublicCta` band, *Start planning — free* to `/signup?ref=public-notebook`, landing in New trip, used on `/n/`, `/s/` and `/demo/<slug>`. Mitchell approves the words on the preview. |
| 8 | The poll | **As proposed for members** (named votes in their own `poll_votes` store, every seat votes, one vote changeable until closed, single choice with a *pick more than one* setting, an optional close date, editors close). **On a public page, following 5, it shows by default as read-only: the question and each option's count, with no names, no *not voted yet* list and no vote control** (*"Read-only counts"*). It can be hidden like any widget. |

### As proposed (2026-11-04, before the answers)

1. **Links to other pages.** A notebook's `link.internal` targets are `notebook`, `seed`, `day`
   and `view` (`linkTarget.ts:23-31`). *Recommendation:* the link is resolved for the public
   reader. A link only exists if its target is public:
   - **A `notebook` or `seed` target that is itself public** links to *its* public URL.
     Following it never needs an account.
   - **A target that is not public is absent.** The block is not rendered at all: no greyed-out
     link and no title. A notebook's title is something the publisher never chose to share
     (*"Sam's surprise — don't tell"*), and a dead link tells the reader something is hidden.
   - **`day` and `view` targets (Plan, Calendar, Map) are absent.** The board is never public in
     this milestone.
   - **`link.external`** renders with `rel="noopener noreferrer nofollow ugc"`.
   - **The publish dialog tells the publisher what will be missing**, for example *"2 links to
     notebooks that aren't public won't show"*. It also offers each linked notebook as an
     unticked *Also make public* box. Nothing becomes public through a link that nobody ticked.
   - The resolution runs **on the server** before the content reaches the client, so a private
     page's id never appears in the public HTML or RSC payload.

2. **A URL that leaks nothing.** *Recommendation:* `/n/<token>`, where the token is a fresh
   `mintToken()` (32 random bytes, base64url, 43 characters). The rules:
   - **No trip id, page id, title slug or user name in the URL.** A slug reads well but repeats
     the title into chat previews, browser history and server logs, and a renamed notebook would
     either break it or keep a stale one.
   - **Not guessable, and not derived from anything.** One token belongs to one publish of one
     notebook, and it is not the trip's invite or share token.
   - **`Referrer-Policy: no-referrer`** on the page, so following an external link doesn't hand
     the token to another site.
   - **`noindex`, and not in the sitemap.** The page is for the people the link was sent to.
     Being found by search is out of scope. M53's crawl must not reach these pages.
   - **The OG card shows the notebook's title and the trip's cover, and nothing else**: no member
     names or avatars, no dates. The preview a chat app unfurls is public before anyone clicks.
   - **Requests aren't logged with the token in analytics.** The path is recorded as `/n/[token]`,
     the way `/s/` is.
   - **The page shows no names of people.** That covers `addedBy` on stops (M51), avatars and the
     publisher. A reader is told *"Shared from Caesura"*, not who shared it.

3. **Making it public, then private again.** *Recommendation:* a public link is an access row, so
   it is CRUD (ADR-026). It is not a trip event, so undo, revert and history can never bring a
   link back to life. The rules:
   - **A new table, `page_shares`**, with `token`, `page_id`, `trip_id`, `created_by`,
     `created_at` and `revoked_at`. It follows `trip_shares`. Revoking sets `revoked_at`.
     Nothing is deleted, so the Share panel can say *"was public from … to …"*.
   - **Unpublishing works at once.** The page is served with `private, no-store`, or from a cache
     tag that is revalidated in the same request as the revoke. A revoked link must not show
     from a cache.
   - **A revoked link answers 404.** The 404 page has no title and no trip in it, but it does
     have the call to action. *"This notebook was made private"* was considered and rejected,
     because it confirms the notebook exists.
   - **Making it public again mints a new token.** The old link stays dead, as ADR-027's re-pin
     does, so a link someone was cut off from can't quietly come back.
   - **Deleting the notebook, or the trip, revokes its link.** A removed member's links stay
     until someone revokes them, since they belong to the trip and not to the person.
   - **The link is live, not pinned.** It shows the notebook as it is now. Pinning was considered:
     ADR-027 pins share links to a `seq` so they can't change under the holder. But an overview
     is useful because it keeps up with the plan, and decision 5 fails closed, so a later edit
     can't make a private widget public.

4. **Who can make a notebook public.** *Recommendation:*
   - **Editors and the owner publish**, as with `createShare` (`api/trips/[tripId]/shares/route.ts:12`).
     An editor can already put the whole trip on a link. Requiring the owner for a smaller thing
     would be the odd one out.
   - **Any editor or the owner can make it private again.** Making it private is always safe.
   - **Viewers and suggesters can see that a notebook is public** (a *Public* chip) and copy its
     link. They can't create a link or revoke one.
   - **Every public notebook is listed in the trip's Share panel**, with who made it public and
     when, so nothing is public without the group knowing.
   - **No tier gate.** This is a way in for new accounts, so a free account can publish.
   - **The seeded *Bookings & confirmations* and *Money* notebooks, and *During the trip*
     (M52), can't be made public.** The control is absent. They are made of widgets that decision 5
     leaves out, so they would publish empty.

5. **Which widgets a public notebook may show.** *Recommendation:* an **allow-list that fails
   closed**. Every `MacroDef` gets a required `publicRead: "show" | "absent"`, and the registry
   test fails if any entry has no answer. A widget added later is private until someone decides
   otherwise. On a public page, an `absent` widget is not rendered, with no placeholder (SPEC §27).
   The public trip read is built by a new explicit list beside `toSharedView`, so data for an
   absent widget never leaves the server.

   | Show | Absent, and why |
   |---|---|
   | `trip.description`, `trip.strip`, `dates`, `hours`, `count`, `city` | `cost`, `cost.rows`, `cost.chart`, `cost.breakdown`: money is the group's business |
   | `day.detail`, `day.rows`, `city.detail`, `city.rows`, `stop.rows` | `cost.balances`, `person.share`: money, and names who owes it |
   | `country.facts`, `day.sun`, `day.weather` | `trip.people`: the names of the people going |
   | `tag.breakdown`, `tag.byDay` | `chat.recent`: the group's chat |
   | `link.external`; `link.internal` under decision 1 | `trip.flights`: flight numbers and times identify people on a plane |
   | `attribute`, and `field` for anything except booking fields | `trip.now`, `stop.directions`: where the group is right now |
   | | `day.fromHome`: says where the group lives |
   | | `open`: conflicts and backlog are planning noise, not an overview |
   | | `poll` (decision 8): votes are for members |

   **Inside the shown widgets:**
   - A stop's `booking` is **absent**, not just redacted to its provider.
   - A lodging stop shows its name and city but **no street address and no map pin**. Combined
     with the dates, an address says where the group is sleeping and when their home is empty.
   - Stop notes are shown, since the publisher chose this notebook.
   - The publish dialog's preview renders the page **exactly as a stranger will see it** before
     anything goes live.

6. **What a signed-in visitor sees.** *Recommendation:* a **member** of the trip gets *Open in
   the trip* in place of the call to action. **Anyone else**, signed in or not, gets the same
   page as a stranger. Nobody gets *Join*, *Request access* or an invite form. Anonymous traffic
   can't join the trip from a public page, and nor can a signed-in non-member: the only way in is
   an invite (ADR-026), as today.

7. **The call to action.** *Recommendation:* one band at the foot of the page: *"Plan your own
   trip with Caesura"*, with a *Start planning — free* button to `/signup?ref=public-notebook`.
   After sign-up it lands in New trip (M56's picker), never in the shared trip. The ref is a
   source, not the publisher's referral code. A personal code would tie the page to a named
   person (decision 2), and paying the publisher back is a candidate if Mitchell wants it. The
   band is the first shared `PublicCta` component. `SharedTripScreen` and `DemoTripScreen` take it
   in place of their inline `/signup` links, so every public page asks the same way. Mitchell
   approves the words, as he did the landing's copy in M50.

8. **The poll widget.** *Recommendation:* a new block widget, `poll`, for the people going:
   - **The question and options are the widget's params**, stored in the page's content like
     any other widget, so writing a poll is a notebook edit by an editor or the owner.
   - **Votes are their own store**: a CRUD table `poll_votes` with `poll_id`, `user_id`,
     `option_ids` and `voted_at`, like the trip chat's own store in M46. They are not trip
     events. A vote isn't a change to the plan, and it shouldn't show in History or be undone by
     a revert.
   - **Every member with a seat votes**: viewer, suggester, editor and owner. Each person has one
     vote and can change it until the poll closes.
   - **Single choice by default, with a *Let people pick more than one* setting.** It also takes
     an optional closing date. An editor can close a poll by hand.
   - **Votes are named.** It's a group of people who know each other, and *who hasn't voted* is
     the useful part. Anonymous polls are a candidate.
   - **Editing after votes are in:** renaming an option keeps its votes. Removing an option
     deletes its votes, and asks first.
   - **It is absent from public notebooks** (decision 5). Strangers can't vote, and the results
     carry names. Showing only the counts was considered, but it publishes the group's decisions
     without a reason.
   - **The first cut stops there.** Polls whose options are stops (*"which restaurant on day
     2"*), a nudge to people who haven't voted, and letting the assistant read results are
     candidates.

### The ADR

Decisions 2, 3 and 5 make one rule: *a public notebook is a revocable bearer link to a live
page, read through one server-side public view. Every widget shows unless its instance is hidden,
and three floors hold whatever a setting says.* It is **ADR-088**, which amends ADR-027. Decision
8's own store for votes is recorded beside it.

## Scope

Five parts, as one stack. The files are in the plan.

1. **The public read** (decisions 1 and 5): a `hideWhenPublic` setting on every widget instance;
   the public reader context; the *Not shared* state; the server-side public view with the three
   floors; and link resolution for a public reader (public notebook → `/n/`, anything else →
   plain text).
2. **Public links** (decisions 2–4): `page_shares` and its migration; create, list and revoke
   (editor or owner) on the app API and `api/v1`; revoke on notebook or trip delete; the cache
   revalidation.
3. **The public page** (decisions 2, 6 and 7): `/n/[token]` with `noindex`,
   `Referrer-Policy: no-referrer`, the OG card and a 404 for revoked links; and `PublicCta`,
   shared with `/s/` and `/demo`.
4. **Publishing in the notebook** (decisions 1, 4 and 5): *Make public* with its stranger's-eye
   preview, the *Shown as plain text* list and the *Also make public* boxes; the *Public* chip;
   copy link; make private; the Share panel's list; and *Hide when public* in every widget's menu,
   with its edit-mode badge.
5. **The poll widget** (decision 8): the widget contract, `poll_votes` and its migration, the
   vote and close endpoints, the widget at 390 and 1440, and its public read-only counts.
0. **The gate**: the evidence, ADR-088, the retro.

## Out of scope

- Search engines finding public notebooks: no sitemap entry, and `noindex` stays (decision 2).
- A public board, map or calendar. Only the notebook is public.
- Any way for a stranger, or anyone without an invite, to join, request access to or comment on
  the trip (decision 6).
- *Copy this trip to my account* from a public notebook (ADR-028's clone). That's a candidate.
- A trip-wide *hide when public* default per widget kind. Every hide is per instance (decision 5).
- Poll extras: stop options, reminders, anonymous polls, the assistant reading results.

## Exit gate

- [x] **Hide when public:** every widget in `MACRO_REGISTRY` accepts `hideWhenPublic` (a registry
  test over every entry, seen to fail with the setting removed from one), and a hidden widget
  draws *Not shared* on the public page while members still see it with its badge.
      Evidence: `packages/pages/src/registry.test.ts:803-814` (`it.each(MACRO_NAMES)`, a hidden instance never reaches `resolve`, over every registry entry) and `:822-827`; PR 689 body records it red before the code (33 of 34 entries failed with `expected { status: 'empty' } to deeply equal { status: 'not-shared' }`). The member side: `MacroView.test.tsx` and `editor/MacroNodeView.test.tsx` (the badge) and `apps/web/e2e/m58-public-notebook.spec.ts:203` (hide a widget, member still sees it). CI run 41970724615 (https://github.com/Neablis/travel-collab/actions/runs/41970724615) at f2b7574a7669277b384f021bbe375250f35bf3bd, the head PR 693 merged with as aac7246: e2e 1/2 and 2/2, unit, integration, lint, typecheck, scripts and `ci-ok` all success, CodeQL success. Round 4 made `weather` and `people` `hiddenFromPublic`, so they draw nothing rather than the chip (ADR-088 amendment).
- [x] **Hidden data stays on the server:** with a notebook holding a hidden cost chart, a booked
  stop, a stop with `addedBy` and a `chat.recent`, the public page's HTML and RSC payload contain
  no cost figure from the hidden chart, confirmation code, booking URL, `addedBy` name or chat
  text (an e2e, `test:e2e:ci-like`, or CI on the PR).
      Evidence: `apps/web/e2e/m58-public-notebook.spec.ts:39-160` plants a hidden cost chart, a booked stop, a member `addedBy` and a hidden widget's param, then asserts none of them is in the page's HTML or RSC payload (`wire.html`, `wire.rsc`, :93-103 of the test body); unit half `apps/web/src/server/access/publicView.test.ts` (each floor seen red by editing the source, PR 689 body). CI run 41970724615 (https://github.com/Neablis/travel-collab/actions/runs/41970724615) at f2b7574a7669277b384f021bbe375250f35bf3bd, the head PR 693 merged with as aac7246: e2e 1/2 and 2/2, unit, integration, lint, typecheck, scripts and `ci-ok` all success, CodeQL success.
- [x] **Links:** on a public page, a link to another public notebook opens its `/n/` URL while
  signed out, and links to a private notebook, a day and a view render as their text with no
  `href` (the same e2e).
      Evidence: `apps/web/e2e/m58-public-notebook.spec.ts` (link cards: first has `href=/n/<token>` signed out, the private notebook and the tab render as text with no `href`); `packages/pages/src/macros/primitives/link.test.ts`. CI run 41970724615 (https://github.com/Neablis/travel-collab/actions/runs/41970724615) at f2b7574a7669277b384f021bbe375250f35bf3bd, the head PR 693 merged with as aac7246: e2e 1/2 and 2/2, unit, integration, lint, typecheck, scripts and `ci-ok` all success, CodeQL success.
- [x] **URL:** the token is 43 base64url characters, and the URL contains no trip id, page id or
  title. The page answers with `noindex` and `Referrer-Policy: no-referrer`, and no `/n/` path is
  in the sitemap.
      Evidence: The e2e asserts the 43-character base64url token, no trip id, page id or title in the path, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `<meta name="robots" content="noindex` and no token in `/sitemap.xml` (`m58-public-notebook.spec.ts`); `apps/web/src/app/sitemap.test.ts:44` ("lists no public notebook"); `apps/web/next.config.test.ts:224` region. CI run 41970724615 (https://github.com/Neablis/travel-collab/actions/runs/41970724615) at f2b7574a7669277b384f021bbe375250f35bf3bd, the head PR 693 merged with as aac7246: e2e 1/2 and 2/2, unit, integration, lint, typecheck, scripts and `ci-ok` all success, CodeQL success.
- [x] **Private again:** after *Make private*, the same URL answers 404 on the next request, with
  no title in the response. Making it public again gives a different token, and the old one stays
  404 (an integration test, and once on the preview).
      Evidence: `apps/web/e2e/m58-public-notebook.spec.ts` (after revoke the URL is a 404 with no title; a second publish gives a different token and the old one stays 404; a deleted notebook and an unknown token are the same 404); `apps/web/src/server/access/pageShares.int.test.ts:148`. CI run 41970724615 (https://github.com/Neablis/travel-collab/actions/runs/41970724615) at f2b7574a7669277b384f021bbe375250f35bf3bd, the head PR 693 merged with as aac7246: e2e 1/2 and 2/2, unit, integration, lint, typecheck, scripts and `ci-ok` all success, CodeQL success. The "once on the preview" half rests on the e2e, which runs against a production build; the preview walk was not reported.
- [x] **Undo can't publish:** reverting the trip to before the link was revoked leaves the link
  revoked (an integration test).
      Evidence: `apps/web/src/server/access/pageShares.int.test.ts:162` ("reverting the trip's history to before the revoke leaves the link revoked"). Integration green in CI run 41970724615 at f2b7574.
- [x] **Who:** a viewer and a suggester get 403 creating a link, and an editor gets 201. The
  seeded *Bookings & confirmations*, *Money* and *During the trip* notebooks have no *Make
  public* control.
      Evidence: `apps/web/src/app/api/trips/[tripId]/pages/[pageId]/shares/route.int.test.ts:63` (editor 201), `:73` (viewer and suggester 403, nothing created), `:94` (the three seeded notebooks 422); the control: `apps/web/src/app/api/trips/[tripId]/pages/[pageId]/route.int.test.ts:58` (`publishable` is false for them) and `PageScreen.test.tsx:3340` (an owner on an unpublishable page gets no *Make public*). Integration and unit green in CI run 41970724615 at f2b7574.
- [x] **No way in:** the public page has no join, invite, request-access or *Open in the trip*
  control, signed out or signed in as a member.
      Evidence: `apps/web/e2e/m58-public-notebook.spec.ts` (no `open in the trip` link, no join, request-access or invite button, signed out and as a signed-in member); `PublicNotebookScreen.test.tsx`. CI run 41970724615 (https://github.com/Neablis/travel-collab/actions/runs/41970724615) at f2b7574a7669277b384f021bbe375250f35bf3bd, the head PR 693 merged with as aac7246: e2e 1/2 and 2/2, unit, integration, lint, typecheck, scripts and `ci-ok` all success, CodeQL success.
- [x] **Call to action:** the band is at the foot of `/n/`, `/s/` and `/demo/<slug>`, and its
  sign-up records `ref=public-notebook` and lands in New trip.
      Evidence: `apps/web/src/components/access/SharedTripScreen.test.tsx:190,198` and `DemoTripScreen.test.tsx:51` (the band's link carries `ref=public-notebook`), `PublicCta.test.tsx`, and the `/n/` e2e asserting the band's `href` is `/signup?ref=public-notebook&callbackUrl=%2Fhome%3Fnew%3Dtrip` (`m58-public-notebook.spec.ts`), the `/home?new=trip` New trip landing. CI run 41970724615 (https://github.com/Neablis/travel-collab/actions/runs/41970724615) at f2b7574a7669277b384f021bbe375250f35bf3bd, the head PR 693 merged with as aac7246: e2e 1/2 and 2/2, unit, integration, lint, typecheck, scripts and `ci-ok` all success, CodeQL success. The copy reads "Start planning for free" (ADR-088 amendment, Mitchell 2026-11-05).
- [x] **Poll:** two members vote, one changes their vote, an editor closes the poll and a third
  member can't vote after it closes. On the same notebook's public page the poll shows its
  question and counts with no names and no vote control.
      Evidence: `apps/web/e2e/m58-poll.spec.ts:39-180`: two members vote, one changes theirs, an editor closes (and reopens, round 1), a late vote is 409, and a stranger's page shows the question and counts (`Ramen 2`) with no buttons and no *Not voted yet*, at two widths without overflow; `apps/web/src/server/polls/votes.int.test.ts:51-93`. CI run 41970724615 (https://github.com/Neablis/travel-collab/actions/runs/41970724615) at f2b7574a7669277b384f021bbe375250f35bf3bd, the head PR 693 merged with as aac7246: e2e 1/2 and 2/2, unit, integration, lint, typecheck, scripts and `ci-ok` all success, CodeQL success.
- [x] **[walk]** Mitchell publishes a real trip's Overview, opens the link in a private window
  on his phone, follows a link to a second public notebook, sees a hidden widget's *Not shared*
  state, signs up from the band, then makes the first notebook private and sees the link go dead.
      Ticked on Mitchell's word, 2026-11-06: *"Ive done the real production walk"* (on production, after `migrate-production` run 42255011247 applied `0074_poll_votes` from `main` at `10c44a4`).

## Retro — written 2026-11-05 (10 of 11 boxes ticked; the [walk] ticked 2026-11-06 and the gate closed 11 of 11)

All five code parts are on `main`: PRs 689 to 692 in `2729315`, PR 693 in `aac7246` (merged 2026-11-05 13:02Z from head `f2b7574a7669277b384f021bbe375250f35bf3bd`). The **[walk]** was the last box; Mitchell walked production on 2026-11-06.

**Migrations.** `0073_page_shares` is applied in production (`migrate-production` ran on `2729315`). `0074_poll_votes` (with `poll_closes`) landed with `aac7246` and was applied 2026-11-06 by `migrate-production` run 42255011247 on `10c44a4`. The `migration-pending` check on `aac7246` is red for exactly that reason, which is what the detector (`.github/workflows/migration-pending.yml`) is for, not a defect. Applying it is Mitchell's: dispatch `migrate-production` from `main`.

### What went well

- **The one full CI run was green on the merged head.** `f2b7574` passed lint, typecheck, unit, integration, scripts, e2e 1/2 and 2/2, `ci-ok` and CodeQL (run 41970724615, https://github.com/Neablis/travel-collab/actions/runs/41970724615); ten of eleven gate boxes cite it.
- **Red-first held on the contract that mattered.** The every-widget `hideWhenPublic` test failed 33 of 34 entries before the code, and each floor of the public view was seen red by editing the source (PR 689 body).
- **Five fix rounds after part 5's first approval, each reviewed by a fresh `part-reviewer`**: W1 reopen a closed poll; the CI unit fix (`reopenPoll` added to the `apiClient` `FETCHING_HELPERS`); Mitchell's decisions round; round 4 (hidden widgets render nothing; the e2e name check can fail); round 5 (a stripped `pollId` keeps its stored id only on an unambiguous exact-question match, otherwise a new id is minted: lost votes beat wrong votes). The final review of `a957ccc..f2b7574` found no blockers.
- **Round 4's e2e name check can now fail**, and the public e2e plants a member's name and a hidden widget's param so the "carries no secret" assertions are not vacuous (`apps/web/e2e/m58-public-notebook.spec.ts`).
- **Zero GitHub wakes** in all measured sessions.

### What could be better

- **Part 5 needed five rounds after its first approval.** Most came from decisions that were not settled before the build (reopen, a poll pasted twice, a poll written without an id by the AI, the v1 API or MCP, option removal and the 402 lapse gate). They are now ADR-088 decisions 9 to 14. Asking those at plan time, with an interaction sketch for the poll, would have saved most of the rounds.
- **The orchestrator's share of the spend missed its target in both measured sessions** (21.6% and 43.3%; see the spend block). Session 3 held the orchestrator at 83 calls with a 168k average context across the fix rounds.
- **A CI-only unit failure** (`reopenPoll` missing from `FETCHING_HELPERS`) was found by the full run, not by the part's scoped subset. The subset recipe did not include `apiClient.test.ts`, which enumerates every helper.
- **The walk was never reported.** Mitchell merged PR 693 with no toolbar threads, so the [walk] box cannot be ticked from evidence.

### Leftovers

- **[walk] box (line 273)**: Mitchell's call, tick on his report or amend the gate.
- **`0074` not applied**: Mitchell dispatches `migrate-production` from `main`.
- **KI-20261105-a**: every poll request reads all of the trip's pages.
- **KI-20261105-b**: read-only pages drop bold, italic and links.
- **Accepted minors from the final review**: an invalid carried `pollId` stays unvotable; the same question with edited options keeps its id.
- **Accepted as built**: a published Overview's title (the trip name) shows in `<title>` and the OG card; internal day ids reach the public client.

## Spend

Three sessions worked this milestone. Lines added: 16265 (`3a66fb1..aac7246`, without `docs/`, generated JSON and the lockfile). Dollars are not measurable: no `--cost-usd` was recorded, so units are the comparable figure. **Build session 1 is summary-only** (no generated block) and is excluded from the unit sums below. Sessions 2 and 3 together: 22 agents, 686 calls, 8.27M units.

**Build session 1 (2026-11-04 20:37Z to 22:27Z), summary only:** 86 orchestrator requests, 81 tool calls, cache read 15.4M, cache write 201k, about 27 subagents (14 implementer, 13 reviewer).

**Build session 2 (2026-11-04 22:29Z to 2026-11-05 00:40Z):** 10 agents, 332 API calls, 3.63M units. `phase-implementer` 5 agents, 194 calls, 1.91M (52.5%); orchestrator 1 agent, 49 calls, 798k (22.0%); `part-reviewer` 3 agents, 69 calls, 619k (17.0%); `ci-triage` (haiku) 1 agent, 20 calls, 309k (8.5%).

**Build session 3 (the close and walk-fix rounds, 2026-11-05 00:23Z to 13:22Z), generated:**

<!-- session-metrics:milestone v1 -->

12 agents, 354 API calls, 4.64M units. One call is one assistant `message.id`; units = input + 1.25 x cache write + 0.1 x cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | Share |
|---|---|---|---|---|---|---|
| `orchestrator` | 1 | 83 | 168k | 223k | 2.02M | 43.6% |
| `phase-implementer` | 6 | 191 | 66k | 113k | 1.77M | 38.2% |
| `part-reviewer` | 5 | 80 | 62k | 118k | 845k | 18.2% |

**Orchestrator turns, by what started them:** subagent reports and finishes 80%, human 20%, GitHub / trigger notification 0. One `implementer-brief-check` deny.

### Spend against the last milestone

The last milestone with a full measurement is M44 (orchestrator 37.1% overall, implementer worst peak 52k in its second session, wakes 0).

| Target | Session 2 | Session 3 | M44 |
|---|---|---|---|
| Dollars per 1,000 lines added, under 20 | not measurable | not measurable | $5.04 (close session only) |
| Orchestrator share, under 15% | 21.6%, **missed** | 43.3%, **missed** | 37.1%, missed |
| A builder's average context, none over 250k | met (worst 113k) | met (worst 81k) | met |
| GitHub wakes per merged part, under 5 | 0, met | 0 of 5, met | 0, met |

The orchestrator miss in session 3 is the fix rounds: the orchestrator carried the walk-fix and decision conversation itself while six implementers did the edits, so its context stayed near 170k across 83 calls.

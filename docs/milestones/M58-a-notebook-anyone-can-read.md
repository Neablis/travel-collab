# M58 — A notebook anyone can read, and a poll for the people going

**Status (2026-11-04): proposed, not scoped.** Minted by Mitchell the same day: *"Add a new
milestone, allowing publicly sharable notebooks, so people can make trip overviews they can share
with people who aren't members of the app, and include a call to action on the bottom of the page
to have them create their own account to create their own trip. Anonymous traffic can't join the
trip from public pages."* Later the same day he added: *"a new poll widget for polling those
going."* He named five questions to settle. They are decisions 1 to 5 below, and the poll is
decision 8. **Placed ahead of M53 the same day, so it is current** (*"Can we make this the next
milestone, not last"*; see `docs/milestones/README.md`, *2026-11-04 — minted: M58, public
notebooks and a poll*). Every decision below is a
recommendation. None has been answered.

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

### Open

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

### Decisions that need an ADR at scoping

Decisions 2, 3 and 5 make one rule: *a public notebook is a revocable bearer link to a live page,
read through an allow-list that fails closed*. That rule goes in **ADR-088**, which amends
ADR-027. Decision 8's own store for votes is recorded beside it.

## Scope

A first cut of the parts, for the plan to settle:

1. **The public read contract** (decisions 1 and 5): `publicRead` on every `MacroDef`, with an
   exhaustive registry test; the public `WidgetContext`; the server-side explicit list for the
   public trip view (no members, actors, bookings or lodging addresses); and link resolution
   that drops private targets on the server.
2. **Public links** (decisions 2–4): `page_shares` and its migration; create, list and revoke
   (editor or owner) on the app API and the public API (`api/v1`); revoke on notebook or trip
   delete; the cache revalidation.
3. **The public page** (decisions 2, 6 and 7): `/n/[token]` with `noindex`,
   `Referrer-Policy: no-referrer`, the OG card, a 404 for revoked links, and *Open in the trip*
   for members; and `PublicCta`, shared with `/s/` and `/demo`.
4. **Publishing in the notebook** (decisions 1 and 4): the *Make public* control and its preview
   of what a stranger sees, with the *won't show* list and the *Also make public* boxes; the
   *Public* chip; copy link; make private; and the list in the trip's Share panel.
5. **The poll widget** (decision 8): the widget contract, `poll_votes` and its migration, the vote
   endpoint, the widget at 390 and 1440, closing, and `publicRead: "absent"`.
0. **The gate**: the evidence, ADR-088, the retro.

## Out of scope

- Search engines finding public notebooks: no sitemap entry, and `noindex` stays (decision 2).
- A public board, map or calendar. Only the notebook is public.
- Any way for a stranger or a non-member to join, request access to or comment on the trip.
- *Copy this trip to my account* from a public notebook (ADR-028's clone). That's a candidate,
  once decision 5's list has shown which data may leave.
- Hiding the dates or showing *Day 1, Day 2* in place of them. That's a candidate if publishers
  ask.
- Showing costs publicly, even as an opt-in. That's a candidate.
- Poll extras: stop options, reminders, anonymous polls, the assistant reading results
  (decision 8).

## Exit gate

- [ ] **Allow-list fails closed:** the registry test fails when a `MacroDef` has no
  `publicRead`, and it was seen to fail with one removed.
- [ ] **Nothing private reaches the page:** with a notebook holding one of every `absent` widget,
  a booked stop and a lodging stop with an address, the public page's HTML and RSC payload contain
  no cost, member name, `addedBy`, confirmation code, street address, chat text or private page
  id (an e2e, `test:e2e:ci-like`, or CI on the PR).
- [ ] **Links:** on a public page, a link to another public notebook opens its `/n/` URL while
  signed out, and links to a private notebook, a day and a view are absent (the same e2e).
- [ ] **URL:** the token is 43 base64url characters, and the URL contains no trip id, page id or
  title. The page answers with `noindex` and `Referrer-Policy: no-referrer`, and no `/n/` path is
  in the sitemap.
- [ ] **Private again:** after *Make private*, the same URL answers 404 on the next request, with
  no title in the response. Making it public again gives a different token, and the old one stays
  404 (an integration test, and once on the preview).
- [ ] **Undo can't publish:** reverting the trip to before the link was revoked leaves the link
  revoked (an integration test).
- [ ] **Who:** a viewer and a suggester get 403 creating a link, and an editor gets 201. The
  seeded *Bookings & confirmations*, *Money* and *During the trip* notebooks have no *Make
  public* control.
- [ ] **No way in:** the public page has no join, invite or request-access control for a signed-out
  visitor or a signed-in non-member, and a member sees *Open in the trip*.
- [ ] **Call to action:** the band is at the foot of `/n/`, `/s/` and `/demo/<slug>`, and its
  sign-up records `ref=public-notebook` and lands in New trip.
- [ ] **Poll:** two members vote, one changes their vote, an editor closes the poll and a third
  member can't vote after it closes. The poll is absent on the same notebook's public page.
- [ ] **[walk]** Mitchell publishes a real trip's Overview, opens the link in a private window
  on his phone, follows a link to a second public notebook, signs up from the band, then makes
  the first notebook private and sees the link go dead.

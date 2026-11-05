# ADR-088: A public notebook is a revocable link to a live page, and every widget shows unless hidden

**Status:** **Accepted — 2026-11-04.** Mitchell answered M58's decisions 1–8 in session. Decisions
1, 5 and 6 were not answered as recommended.
**Deciders:** Mitchell (product); Claude — drafted
**Amends:** ADR-027 (share links are pinned and read through an explicit field list).
Related: M58 (`docs/milestones/M58-a-notebook-anyone-can-read.md`), ADR-026 (Access is CRUD, and
a link is a bearer credential), ADR-079 (first-touch `?ref=`), ADR-086 (bookings are for editors),
SPEC §27 (a widget the reader can't use is absent), M46 (the trip chat keeps its own store).

## Context

A trip reaches a stranger today only as a pinned share (`/s/<token>`, ADR-027), a published
playbook day (ADR-061) or the demo (ADR-031). `toSharedView` (`server/access/sharedView.ts`)
carries **no pages**. Mitchell wants the Overview a group wrote to be readable by people without
an account. The page ends in an invitation to plan their own trip, and offers no way into this
one.

## Decision

1. **A public notebook is one row in `page_shares`** (`token`, `page_id`, `trip_id`,
   `created_by`, `created_at`, `revoked_at`), created and revoked by an editor or the owner. The
   rules:
   - It is an access row, CRUD as ADR-026 says, **not a trip event**. Undo, revert and history
     replays never see it, so they can never bring a link back.
   - The token is `mintToken()` (32 random bytes, base64url). The URL is `/n/<token>`, with no
     trip id, page id or slug in it.
   - Revoking sets `revoked_at`. Publishing again mints a new row and a new token, and a revoked
     token never comes back.
   - Deleting the page or the trip revokes its rows.
2. **The link is live, not pinned.** Unlike ADR-027, the public read is the page as it is now.
   ADR-027's reason for pinning, that a link must not change under its holder, is outweighed here
   by an overview's purpose, which is to keep up with the plan. The per-instance hide in 4 is the
   publisher's control over what shows.
3. **One server-side public view.** `/n/[token]` reads the page and its trip without a session,
   through a new explicit builder beside `toSharedView`. ADR-027's 2026-10-08 rule holds: the
   view is a list of fields, not a spread with deletions. The page has these properties:
   - It is `noindex`, left out of the sitemap and of the `proxy.ts` matcher, and sends
     `Referrer-Policy: no-referrer`.
   - It is served `private, no-store`, or from a tag revalidated by the revoke, so a revoked
     link never answers from a cache.
   - A revoked or unknown token answers a 404 that names nothing.
   - It shows no member's name or avatar.
4. **Every widget shows unless its instance is hidden.** This is not an allow-list. Every widget
   instance accepts `hideWhenPublic: boolean` (default `false`) on its attrs, beside its params (the params schemas strip unknown keys), so hiding a widget
   is a notebook edit like any other. For a public reader:
   - A hidden instance draws a new **_Not shared_** state, modelled on the widget's no-data
     state.
   - **Widgets are resolved on the server for a public reader**, and the client receives only
     the resolved output, never `TripDetail` or raw page content. A hidden instance resolves to
     *Not shared* with its params stripped, so neither its data nor its params reach the HTML or
     the RSC payload. (Added 2026-11-04 from part 1's review: hiding on the client left the
     whole trip in the payload.)
   - Members see the widget as usual, with a *Hidden when public* badge in edit mode.
5. **Three floors hold whatever a setting says.** These are in the public view, not in the
   widgets:
   - Bookings go through `redactBookingFor(null)` (ADR-086).
   - The public reader has no `canChat`, so `chat.recent` is absent (SPEC §27).
   - Stops carry no `addedBy`.

   Everything else, a lodging stop's address included, shows unless its widget is hidden.
6. **Links are resolved for the public reader on the server.**
   - A `link.internal` whose target is a notebook with a live `page_shares` row links to that
     row's `/n/` URL.
   - Every other target (a private notebook, a seed that resolves to a private page, a day, a
     view) renders as its label with no `href`.
   - `link.external` gets `rel="noopener noreferrer nofollow ugc"`.
   - A private page's id never reaches the client. Its title does, as text, and the publish
     dialog lists those titles before anything goes live.
7. **No way in, for anyone.** The public page has no join, invite, request-access or
   *Open in the trip* control, signed in or out, members included. Its one call to action is the
   shared `PublicCta`: `/signup?ref=public-notebook` (ADR-079, a source rather than a person),
   which lands in New trip.
8. **A poll's votes are their own store.** The rules:
   - The question and options are widget params, so writing a poll is a page edit.
   - Votes go in `poll_votes` (`poll_id`, `user_id`, `option_ids`, `voted_at`). They are CRUD,
     not trip events, as the trip chat keeps its own store (M46). A vote is not a change to the
     plan.
   - Every seat votes.
   - On a public page, a poll that isn't hidden shows its question and per-option counts, with no
     names and no vote control.

### Amendments (Mitchell, 2026-11-05)

9. **Exposure stays as answered.** Every widget shows by default, each instance has *Hide when
   public*, and the three floors in 5 hold. Money widgets keep that default (re-confirmed).
10. **Weather and people are always absent for a public reader.** A `MacroDef` field,
    `hiddenFromPublic`, makes a widget draw nothing (not the *Not shared* chip), whatever the
    instance's setting. `day.weather` and `trip.people` carry it.
11. **The call to action reads "Start planning for free"** (no em dash), to
    `/signup?ref=public-notebook`, then New trip. This replaces the wording in 7 and the milestone
    file.
12. **Polls have no 402 lapse gate**: voting, closing and reopening work on a lapsed trip.
    Removing an option keeps its votes but stops counting them; adding the same text back brings
    them back. A poll pasted twice in one trip is the same poll, and votes validate against the
    first copy's options. Repeated options are keyed by id plus their nth repeat.
13. **A poll written without a `pollId`** (the AI, the v1 API, MCP) gets one minted in
    `checkPageDocForWrite` through `withPollIds`. A returning poll whose id was stripped keeps its
    stored id only on an unambiguous exact-question match; otherwise a new id is minted, because
    lost votes are better than wrong votes. Accepted: an invalid carried `pollId` stays
    unvotable, and the same question with edited options keeps its id.
14. **Reopen is for an editor or the owner.** Reopening an open poll is an idempotent 200. A
    closing date already past answers 409 asking the editor to move the date; the page is never
    edited by the server.

Accepted as built: a published Overview's title (the trip name) shows in `<title>` and the OG
card, and internal day ids reach the public client.

## Consequences

- A new widget is public the day it ships unless its data falls under a floor. **Anyone adding
  a widget that reads people, money or location must decide whether it needs a floor in the
  public view**. That is a line in the `MacroDef` docstring wall and in the part-reviewer's
  checklist.
- An editor can publish a notebook that shows costs or a lodging address. The *Make public*
  dialog's stranger's-eye preview is the safeguard, not the code.
- A live link changes under its holder. A holder who needs a fixed copy still has ADR-027's
  pinned trip share.
- One more bearer token family. Like invites and shares, it is stored unhashed (ADR-026), and its
  read is not rate-limited. That is the same exposure as `/s/`.

## Alternatives considered

- **Fail-closed allow-list per widget kind** (the recommendation). Mitchell chose default-show
  with a per-instance hide.
- **Pinned to a `seq`, as ADR-027.** Rejected: an overview would go stale.
- **Private link targets absent** (the recommendation). Mitchell chose plain text.
- **Members see *Open in the trip*** (the recommendation). Mitchell chose one page for everyone.

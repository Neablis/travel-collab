# M58 plan — A notebook anyone can read, and a poll for the people going

Milestone: `docs/milestones/M58-a-notebook-anyone-can-read.md` (decisions 1–8, answered 2026-11-04). ADR: `docs/architecture/ADR-088-a-public-notebook-is-a-revocable-link-to-a-live-page.md`.
Part 0 is the prose-only tracking PR on `ccr-de5eacaf-xde6tn` (PR 688). It merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/` or `docs/`.
Line numbers are from `main` at `3a66fb1`, so treat them as a starting point, not as fact.
**New** marks a file that does not exist yet.

## Order

| Part | Branch | Depends on | Can run beside |
|---|---|---|---|
| 1 The public read | `claude/m58-part1-public-read` | — | — |
| 2 Public links | `claude/m58-part2-public-links` | 1 | — |
| 3 The public page | `claude/m58-part3-public-page` | 2 | — |
| 4 Publishing in the notebook | `claude/m58-part4-publish-ui` | 3 | — |
| 5 The poll widget | `claude/m58-part5-poll` | 4 | — |

The parts are one stack. Part 1 branches from `main` and its draft PR targets `main`. Part K+1
branches from part K's head, and its draft PR targets part K's branch. Every part's PR is a
draft and lands through the top part's PR (part 5). Parts 1 and 5 both touch
`packages/pages/src/registry.ts` and `components/pages/MacroView.tsx`, and part 1 lands its
change first.

Facts the parts share (the survey, 2026-11-04):
- **Migrations:** the last one is `0072_ai_turn_outcomes`, and the journal is
  `apps/web/drizzle/meta/_journal.json`, at index 72. Part 2 takes **`0073_page_shares`** and part 5
  takes **`0074_poll_votes`**. Production applies them only after the top merges
  (`migrate-production` is Mitchell's).
- **The precedent for links** is `trip_shares` (`server/db/schema.ts:871`) and
  `server/access/shares.ts`: `mintToken` :19, `createShare` :55, `revokeShare` :87 (idempotent),
  `readShare` :161 (no session). Creating a share needs `editor`
  (`app/api/trips/[tripId]/shares/route.ts:17`).
- **The public view precedent** is `toSharedView` (`server/access/sharedView.ts:22`), which is
  an explicit field list (ADR-027's amendment). Bookings go through `redactBookingFor`
  (`server/access/bookingRedaction.ts:19`). Chat needs `canChat`
  (`packages/pages/src/registry-types.ts:648`, `ReaderCapability` :663).
- **A widget instance's attrs** are `WidgetAttrs` (`packages/contracts/src/pageDoc.ts:67`, strict),
  inside `MacroNode` :52. `hideWhenPublic` goes there, optional and defaulting to `false`, so
  every stored doc still parses.
- **The no-data state** is `EmptyChip` (`components/pages/EmptyChip.tsx:15`), drawn by
  `MacroView` (`components/pages/MacroView.tsx:51`, :89–195). *Not shared* is a new tone of it.
- **Links** are `LinkTarget` (`packages/pages/src/linkTarget.ts:23`). Hrefs are built in
  `linkHref` (`components/pages/blocks/linkHref.ts:19`) and drawn by `LinkCardBlock`
  (`components/pages/blocks/LinkCardBlock.tsx:54`).
- **Seeded notebooks that can't be published:** `seed_key` `bookings-and-confirmations` and
  `money`, and the *During the trip* notebook (M52).
- **No people's names reach the public page** (ADR-088 §3, §5): no `addedBy`, avatars,
  `actor_id` or publisher.
- The `(front)` route group and `/s/` are left out of the `proxy.ts` matcher (`proxy.ts:241`).
  `next.config.ts:224` already overrides Referrer-Policy for `/s/**`.

## Part 1 — The public read (~14 files)

**Theme.** Decisions 1 and 5: the contract and the server view, with no route and no UI
control. Every widget instance gets `hideWhenPublic`. A public reader context makes a hidden
instance draw *Not shared*, and its data is never resolved. The public view keeps the three
floors (bookings redacted for `null`, no `canChat`, no `addedBy`). For a public reader, link
resolution sends a target with a live public link to `/n/<token>` (through an injected lookup;
part 2 supplies it) and renders every other target as plain text with no `href`.

| File | Entry point | Change | Test |
|---|---|---|---|
| `packages/contracts/src/pageDoc.ts` | `WidgetAttrs` :67, `MacroNode` :52 | optional `hideWhenPublic: boolean` | **New** `packages/contracts/src/pageDoc.test.ts` |
| `packages/pages/src/registry-types.ts` | `WidgetContext` :543, `MacroDef` :749 | `reader: "member" \| "public"` on the context; docstring wall line from ADR-088 Consequences | `packages/pages/src/registry.test.ts` |
| `packages/pages/src/registry.ts` | `DEFS` :47, `MACRO_REGISTRY` :98 | hidden-for-public short-circuits `resolve` | `packages/pages/src/registry.test.ts` (over every entry) |
| `packages/pages/src/linkTarget.ts` | `ResolvedLinkTarget` :35 | a `plain` variant (label, no target) | `packages/pages/src/macros/primitives/link.test.ts` |
| `packages/pages/src/macros/primitives/link.ts` | `internalLink` :113, `externalLink` :219 | public resolution; `rel` on external | `packages/pages/src/macros/primitives/link.test.ts` |
| `components/pages/blocks/linkHref.ts` | `linkHref` :19 | `/n/<token>` form | **New** `components/pages/blocks/linkHref.test.ts` |
| `components/pages/blocks/LinkCardBlock.tsx` | `LinkCardBlock` :54 | draws `plain` as text | `components/pages/blocks/LinkCardBlock.test.tsx` |
| `components/pages/EmptyChip.tsx` | `EmptyChipTone` :4 | `not-shared` tone | `components/pages/MacroView.test.tsx` |
| `components/pages/MacroView.tsx` | `MacroView` :51 | *Not shared* for a hidden instance under the public reader | `components/pages/MacroView.test.tsx` |
| `components/pages/readerCapabilities.ts` | `useReaderCapabilities` :14 | public reader: no `canChat` | `components/pages/MacroView.unavailable.test.tsx` |
| **New** `server/access/publicView.ts` | `toPublicNotebookView` | explicit field list; the three floors | **New** `server/access/publicView.test.ts` |
| `server/access/bookingRedaction.ts` | `redactBookingFor` :19 | reused, unchanged unless a seam is needed | `server/access/bookingRedaction.test.ts` |

Gate boxes this part carries: *Hide when public* (the registry test, seen red with the setting
removed from one entry); the unit half of *Hidden data stays on the server* (`publicView.test.ts`
and the floors).

**Preview walk:** nothing on screen. Verify with the unit tests, and check that an existing
notebook still opens unchanged for a member.

## Part 2 — Public links (~14 files)

**Theme.** Decisions 2–4 on the server: `page_shares`, the access functions, the app and `api/v1`
routes, revoke on delete, and the live lookup that part 1's link resolution injects. Only editors
and the owner create or revoke. Creating a link on a seeded *Bookings*, *Money* or *During the
trip* page is refused (422). The table is not event-sourced.

| File | Entry point | Change | Test |
|---|---|---|---|
| **New** `apps/web/drizzle/0073_page_shares.sql` (+ journal, snapshot) | — | the table, a unique token index, an index on `(page_id) where revoked_at is null` | `server/access/pageShares.int.test.ts` |
| `server/db/schema.ts` | `tripShares` :871 | `pageShares` beside it | `server/access/pageShares.int.test.ts` |
| **New** `server/access/pageShares.ts` | `createPageShare`, `listPageShares`, `revokePageShare`, `readPageShare`, `liveShareTokensFor` | modelled on `shares.ts` | **New** `server/access/pageShares.int.test.ts` |
| **New** `app/api/trips/[tripId]/pages/[pageId]/shares/route.ts` | `GET`, `POST` | editor+ | **New** `.../shares/route.int.test.ts` |
| **New** `app/api/trips/[tripId]/pages/[pageId]/shares/[shareId]/route.ts` | `DELETE` | editor+ | same |
| **New** `app/api/v1/trips/[tripId]/pages/[pageId]/shares/route.ts` (+ `[shareId]`) | `GET`, `POST`, `DELETE` | modelled on `api/v1/trips/[tripId]/shares/route.ts:12` | `server/public-api/openapi.test.ts` |
| `server/public-api/openapi.ts` | — | the new paths | `server/public-api/openapi.test.ts` |
| `server/projections.ts` | `applyPageEvents` :101 (`PageDeleted` :138), `applyTripEvents` :32 (`TripDeleted` :63) | revoke live rows | `server/projections.int.test.ts` |
| `app/api/trips/[tripId]/shares/route.ts` | `GET` :10 | the trip's Share panel also lists public notebooks | `app/api/trips/[tripId]/shares/route.int.test.ts` |

Gate boxes: *Who* (403 for a viewer and a suggester, 201 for an editor, 422 for a seeded page),
*Undo can't publish* (revert after revoke leaves it revoked), and the integration half of
*Private again* (a new token on re-publish).

**Preview walk:** nothing on screen. `POST` and `DELETE` with the API from a preview session, or
read the integration tests.

## Part 3 — The public page (~15 files)

**Theme.** Decisions 2, 6 and 7: `/n/[token]` renders the page through part 1's view and part 2's
read. It is `noindex`, outside the proxy matcher and the sitemap, sends
`Referrer-Policy: no-referrer`, and is `no-store` or tag-revalidated. A revoked or unknown token
answers a 404 that names nothing. The OG card is the title and cover. There is no member special
case: everyone sees the stranger's page. `PublicCta` is shared with `/s/` and `/demo`, and goes to
`/signup?ref=public-notebook`, landing in New trip.

| File | Entry point | Change | Test |
|---|---|---|---|
| **New** `app/(front)/n/[token]/page.tsx` (+ `loading.tsx`) | page, `generateMetadata` | read, 404, NOINDEX | **New** `apps/web/e2e/m58-public-notebook.spec.ts` |
| **New** `components/access/PublicNotebookScreen.tsx` | `PublicNotebookScreen` | `ReadOnlyPageDoc` under the public reader, then the band | **New** `components/access/PublicNotebookScreen.test.tsx` |
| `components/pages/editor/ReadOnlyPageDoc.tsx` | `ReadOnlyPageDoc` :184 | accepts the public reader | `components/access/PublicNotebookScreen.test.tsx` |
| **New** `components/access/PublicCta.tsx` | `PublicCta` | the band | **New** `components/access/PublicCta.test.tsx` |
| `components/access/SharedTripScreen.tsx` | :102, :126 | use `PublicCta` | `components/access/SharedTripScreen.test.tsx` |
| `components/demo/DemoTripScreen.tsx` | :51 | use `PublicCta` | `components/demo/DemoTripScreen.test.tsx` |
| `lib/signupRef.ts` | `normalizeSignupRef` :27 | accepts `public-notebook` | `lib/signupRef.test.ts` |
| `proxy.ts` | `config` :241 | `/n/` stays out of the matcher | `proxy.test.ts` |
| `apps/web/next.config.ts` | `headers` :201, :224 | `/n/**` no-referrer | `apps/web/next.config.test.ts` |
| `app/sitemap.ts` | `sitemap` :41 | asserts no `/n/` path | `app/sitemap.test.ts` |
| **New** `app/api/og/notebook/[token]/route.ts`, **New** `server/og/notebook.ts` | `GET` | title and cover only | `app/api/og/routes.int.test.ts` |

Gate boxes: *URL*, *Private again* (the 404 on the next request), *No way in*, *Call to action*,
and the e2e halves of *Hidden data stays on the server* and *Links*. The spec publishes through
part 2's API in its setup, and with JavaScript on reads the HTML and the RSC payload for the
forbidden strings.

**Preview walk:** publish a notebook through the API, then open `/n/<token>` in a private window.
Check that a hidden widget shows *Not shared*, that a private link is plain text, and that the
band is at the foot. Revoke, reload, and see a 404. `/s/<token>` and `/demo/<slug>` show the same
band.

## Part 4 — Publishing in the notebook (~12 files)

**Theme.** Decisions 1, 4 and 5 in the UI:
- An editor or the owner opens *Make public* from the notebook's `⋯` menu, which leads to a
  dialog. It shows a stranger's-eye preview, a *Shown as plain text* list (each private target's
  title), *Also make public* boxes (unticked), and *Make public*. Afterwards the dialog shows the
  link with *Copy link* and *Make private*.
- Viewers and suggesters see a *Public* chip by the title, with *Copy link*.
- The control is absent on the seeded *Bookings*, *Money* and *During the trip* pages.
- Every widget's settings get a *Hide when public* switch, with a *Hidden when public* badge on
  the widget in edit mode.
- The trip's Share panel lists every public notebook, with who made it public and when, and
  *Make private*.

| File | Entry point | Change | Test |
|---|---|---|---|
| `components/pages/PageScreen.tsx` | `PageScreen` :252, `⋯` menu ~:1500 | *Make public* entry; chip | `components/pages/PageScreen.test.tsx` |
| **New** `components/pages/MakePublicDialog.tsx` | `MakePublicDialog` | preview, lists, boxes, copy, make private | **New** `components/pages/MakePublicDialog.test.tsx` |
| `components/pages/PageTitle.tsx` | `PageTitle` :34 | *Public* chip | `components/pages/PageTitle.test.tsx` |
| `components/pages/editor/WidgetSettings.tsx` | `WidgetSettings` :53 | *Hide when public* switch | `components/pages/editor/WidgetSettings.test.tsx` |
| `components/pages/editor/MacroNodeView.tsx` | `MacroNodeView` :66 | the badge | `components/pages/editor/MacroNodeView.test.tsx` |
| `components/trip/ShareButton.tsx` | `ShareButton` :33 | the public notebooks list | `components/trip/ShareButton.test.tsx` |
| `apps/web/e2e/m58-public-notebook.spec.ts` | — | a UI path: hide, publish, copy, private | — |

Gate boxes: *Who* (the control is absent for a viewer and on seeded pages), and the UI half of
*Private again*.

**Preview walk:** on a trip's Overview, open `⋯` › *Make public*. See the preview and the plain
text list, tick one *Also make public* box, and publish. Copy the link and open it in a private
window. Then hide the cost chart in its settings and reload the private window to see *Not
shared*. Open the trip's Share panel to see both notebooks listed, and choose *Make private*. At
390 and 1440.

## Part 5 — The poll widget (~14 files)

**Theme.** Decision 8:
- `poll` is a new block widget. Its params are the question, the options, `multi` and
  `closesAt?`.
- Votes go in `poll_votes` (CRUD, migration `0074`). Every seat votes, a vote can be changed
  until the poll closes, and editors close it.
- Members see named results and a *Not voted yet* list.
- A public reader sees the question and counts only, with no names and no control. *Hide when
  public* works on it like on any other widget.
- It is drawn at 390 and 1440.

| File | Entry point | Change | Test |
|---|---|---|---|
| **New** `packages/pages/src/macros/primitives/poll.ts` | the `MacroDef` | params, resolve (member and public) | **New** `packages/pages/src/macros/primitives/poll.test.ts` |
| `packages/pages/src/registry.ts` | `DEFS` :47 | register `poll` | `packages/pages/src/registry.test.ts` |
| **New** `apps/web/drizzle/0074_poll_votes.sql` (+ journal, snapshot) | — | `poll_votes`, unique `(poll_id, user_id)` | `server/polls/votes.int.test.ts` |
| `server/db/schema.ts` | near `tripMessages` :716 | `pollVotes` | `server/polls/votes.int.test.ts` |
| **New** `server/polls/votes.ts` | `castVote`, `closePoll`, `tallyFor` | modelled on `server/chat/messages.ts` | **New** `server/polls/votes.int.test.ts` |
| **New** `app/api/trips/[tripId]/polls/[pollId]/route.ts` (+ `close`) | `GET`, `PUT`, `POST` | any seat votes, an editor closes | **New** `.../polls/[pollId]/route.int.test.ts` |
| **New** `components/pages/blocks/PollBlock.tsx` | `PollBlock` | the widget | **New** `components/pages/blocks/PollBlock.test.tsx` |
| `components/pages/MacroView.tsx` | `MacroView` :51 | dispatch `poll` | `components/pages/MacroView.test.tsx` |
| `server/access/publicView.ts` | `toPublicNotebookView` | counts only for a poll | `server/access/publicView.test.ts` |
| **New** `apps/web/e2e/m58-poll.spec.ts` | — | the *Poll* gate box | — |

Gate box: *Poll*.

**Preview walk:**
1. Add a poll to a notebook (insert › Poll) with three options.
2. Vote as one member, switch accounts and vote as another, then change that vote.
3. As an editor, *Close poll*.
4. Open the notebook's public link and see the counts with no names.

At 390 and 1440.

## Gate

- The e2e boxes (*Hidden data stays on the server*, *Links*, *No way in*, *Call to action* and
  *Poll*) read from CI on the top part's PR (part 5), retargeted to `main` and marked ready.
- The integration and unit boxes are read on the same run.
- *URL* and *Private again* are also checked once on the top part's preview.
- The [walk] is Mitchell's, on the top part's preview: publish a real trip's Overview, open it
  in a private window on his phone, follow a link to a second public notebook, see a hidden
  widget's *Not shared*, sign up from the band, then make it private and see the link go dead.
- After the top merges, `migrate-production` (`0073`, `0074`) is Mitchell's.

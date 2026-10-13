# M46 — A trip has a conversation, with the people taking it

**Status:** **Proposed 2026-10-06, placed after M45. Current from 2026-10-13, when M45's gate
closed. Scoped 2026-10-13**: every decision below was answered by Mitchell that day, after a code
survey of today's UI (M41's ⌘K palette and M45's assistant rail postdate the proposal). Minted
from `docs/candidates.md` (see `docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).
It is the largest new surface in this set, and the first feature that would generate
notifications. That is why it comes after the persona work (M38) and the phone work (M39), both
of which it uses.

ADR: `docs/architecture/ADR-073-trip-chat-is-its-own-store.md`. Plan:
`docs/plans/2026-10-13-M46-a-trip-has-a-conversation.md` (deleted at the close).

## Why this exists

Mitchell, 2026-10-04: *"a chat for a trip with the others taking the trip"*. Collaborators
coordinate outside the app today, so the conversation that explains a plan is not stored anywhere
near it.

Candidate absorbed (deleted by this gate):
- *A chat for a trip, with the people taking it* (2026-10-04)

## Decisions (answered by Mitchell, 2026-10-13)

1. **Messages are their own store, not trip events.** A table `trip_messages` (migration `0048`),
   off the event log, History, replay and undo. They are conversation, not plan state: the event
   log records what the trip *is* (ADR-001, ADR-003; the proposal cited ADR-012, which is client
   state, in error). The ADR-064 boundary (a suggestion is not planning state until accepted) is
   the precedent. *As recommended, with the ADR reference corrected.* Mitchell added: **a message
   appears on every open page without a refresh**, by the same mechanism that makes an activity's
   change appear (the events poll, decision 4). ADR-073 records the store.
2. **Every member may read and post**, viewers and suggesters included, **while the owner is
   entitled** to collaborators (`trip.collaborators`; the same lapse `capGranted` applies,
   `server/access/members.ts:298`). **After a lapse the chat stays readable and becomes
   read-only** for everyone; the composer says why. The demo trip refuses every chat route
   explicitly (`requireTripAccess` answers the demo as a viewer, `trip-access.ts:123-128`, which
   would otherwise read as "may post"). A removed member is refused from their next request, by
   the same fresh per-request check every trip read makes. KI-2026-10-05-h (a removed member's
   open page never learns) stays open unless its fix is cheap, but **the chat panel shows a clear
   "you no longer have access to this trip" state on a 403** instead of looking live. *As
   recommended, with the lapse and demo rules added.*
3. **A message may link to one day or one stop**, by id. The link renders as a chip that focuses
   the board. The board's `focusDay` / `focusActivity` (`TripBoardScreen.tsx:219-229`, today
   local to the screen and used by ⌘K's *Go to › Day/Stop*) are lifted into a shared focus the
   chips call, and the URL gains `?stop=<id>` beside `?view=Plan&day=<id>`
   (`TripBoardScreen.tsx:427-434`). The composer has *@day* and *@stop* pickers. A deleted target
   renders as plain text. *As recommended, with the URL param added.*
4. **Realtime uses the existing 2 s events poll**, with a `chatRev` counter
   (`app/api/trips/[tripId]/events/route.ts:59-72`, client
   `components/trip/context/broadcast.ts`). It is bumped in the same transaction as every chat
   write and served to every reader, on `accessRev`'s pattern (`trip_access_revs`, ADR-065), not
   `suggestionsRev`'s role-scoped hash (ADR-064). There is no new transport. *As recommended.*
5. **Notifications start in-app**: a per-person read cursor, and an unread count on the trip's
   chat pill in the header and on Home's trip card. Home does not poll; its count is as fresh as
   Home's own load (`app/(app)/page.tsx:239`, `fetchTrips`). Email and push are out of scope (the
   service worker has no push handler). *As recommended.*
6. **Moderation:** authors edit and delete their own messages, and the owner deletes any. A
   delete is soft and renders *"message removed"*. **A report reaches the admin reports panel**
   (M12): `content_reports` (`server/db/schema.ts:1051`) is relaxed by a migration (its
   `saved_day_id` is NOT NULL and its target CHECK knows two kinds), the report contract gains a
   `trip_message` target (`packages/contracts/src/report.ts:21`), and `server/reports.ts` and
   `components/admin/ReportsPanel.tsx` gain hide and restore for it. **A deleted trip hides its
   chat, and restoring the trip restores it.** ADR-016 defines no retention to follow: `TripDeleted`
   is reversible, so the chat is hidden with the trip, never purged. *Replaces "follows ADR-016's
   retention", which named a rule that does not exist.*

**Layout (answered 2026-10-13).** Chat is a **tab in the existing assistant rail and sheet**,
tabs *Chat · Ask*: docked from 1100px, a sheet below (`TripBoardScreen.tsx:345-352`,
`AssistantRail` at `:1464`). The desktop header gets a **💬 pill with the unread count** beside
the ✦ Ask pill (`TripHeader`). On a phone, a 💬 icon in the header opens the sheet on Chat (the
phone tab bar has no free slot). ⌘K gains *Open chat* beside *Ask the assistant*
(`components/palette/commands.ts:67`). A chip focuses the board. M38's personas show on every
message. It is called **Chat** everywhere, so it is never confused with Ask's thread
(`useAskThread`).

## Scope

- A chat store, routes, a trip-level chat panel, links to days and stops, unread counts, and
  report and delete actions.
- Personas from M38 on every message.
- No public API endpoint: the API guideline's *Features ship before their endpoints* applies, so
  each new internal route gets a `planned` line in `server/public-api/exposure.ts` and nothing
  more.

Five parts, each its own PR on `main` (plan: `docs/plans/2026-10-13-M46-a-trip-has-a-conversation.md`):

| Part | Branch | Theme | Depends on |
|---|---|---|---|
| 1 | `claude/m46-part1-store-and-routes` | migration `0048`, contracts, `server/chat/`, the routes, the access rules (lapse, demo, removed, deleted trip), `chatRev` on the poll | — |
| 2 | `claude/m46-part2-chat-tab` | *Chat · Ask* tabs, messages with personas, the composer, the 💬 pill and phone icon, ⌘K *Open chat*, live by `chatRev`, the 403 state | 1 |
| 3 | `claude/m46-part3-day-and-stop-chips` | shared focus, `?stop=`, *@day* / *@stop* pickers, chips | 2 |
| 4 | `claude/m46-part4-unread-on-home` | the unread count on Home's trip cards | 1 |
| 5 | `claude/m46-part5-edit-delete-report` | edit and delete in the panel, *"message removed"*, reports of a message, the admin panel's hide and restore | 2 |

## Out of scope

- Direct messages between two people.
- Attachments and images.
- Email digests and push notifications.

## Exit gate

- [ ] **Decisions 1–6 are answered and recorded here**, with an ADR for the store (ADR-073).
- [ ] **No chat write touches the trip's event log**: an integration test compares the log before
      and after a conversation.
- [ ] **A removed member can neither read nor post from their next request on**, which an
      integration test shows. Their open chat panel shows that they no longer have access.
- [ ] **After the owner's entitlement lapses, the chat is readable and refuses a post**, which an
      integration test shows; the demo trip refuses every chat route.
- [ ] **A second member's open page shows a new message within one poll, without a refresh**, in
      an e2e with two contexts.
- [ ] **A reported message reaches the admin reports panel.**
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`.**
- [ ] **[walk]** Two people on the PR preview, one on a phone.
- [ ] A retro is appended at gate close.

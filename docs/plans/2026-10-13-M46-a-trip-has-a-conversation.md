# M46 plan — a trip has a conversation, with the people taking it

Milestone: `docs/milestones/M46-a-trip-has-a-conversation.md` (decisions D1–D6 and the layout,
answered 2026-10-13). ADR: `docs/architecture/ADR-073-trip-chat-is-its-own-store.md`.
Part 0 is the prose-only tracking PR on `claude/m46-a-trip-has-a-conversation`; it merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/` or `docs/`.
Line numbers are from `main` at `decfad8`, so treat them as a starting point, not as fact.
**New** marks a file that does not exist yet.

## Order

| Part | Branch | Depends on | Can run beside |
|---|---|---|---|
| 1 Store and routes | `claude/m46-part1-store-and-routes` | — | — |
| 2 The Chat tab | `claude/m46-part2-chat-tab` | 1 merged | 4 |
| 4 Unread on Home | `claude/m46-part4-unread-on-home` | 1 merged | 2, 3, 5 |
| 3 Day and stop chips | `claude/m46-part3-day-and-stop-chips` | 2 merged | 4, 5 |
| 5 Edit, delete, report | `claude/m46-part5-edit-delete-report` | 2 merged | 3, 4 |

Every part targets `main`. A part that depends on another branches from `main` after that part
has merged. Parts 3 and 5 both edit `components/chat/ChatPanel.tsx` and `ChatMessage.tsx`; the
second to merge takes `main` first.

Facts the parts share (the survey, 2026-10-13):
- **The next migration is `0048`** (`apps/web/drizzle/0047_ai_usage_classifier_certainty.sql` is
  the last). Part 5 takes the next free one when it is built (expected `0049`). Each migration
  adds its SQL, `drizzle/meta/_journal.json` and a `drizzle/meta/<n>_snapshot.json`;
  `scripts/check-migration-journal.mjs` checks them.
- **The access seam serves a deleted trip.** `requireTripAccess` (`server/access/trip-access.ts:107`)
  does not check `status`, and `GET /api/trips/:id` answers a deleted trip with 200 and
  `status: "deleted"`. So the chat routes check `detail.status` themselves (ADR-073 §5).
- **The demo is answered as a viewer** by the seam when `allowDemo` is set
  (`trip-access.ts:123-128`). Chat routes never pass `allowDemo`, and also refuse
  `isDemoTripId(tripId)` up front with a named code (the assistant's `demo-trip-unsupported` in
  `server/assistant/admission.ts:77` is the precedent).
- **The lapse.** `capGranted` (`server/access/members.ts:298`) caps granted members to viewer when
  the owner is not entitled; `billingSubject` (`:270`) and `capGrantedOnLapse` (`:306`) are
  private. Chat needs the boolean itself: whether the trip's owner `accountCan(owner,
  "trip.collaborators")` (`server/entitlements/resolver.ts:274`). Part 1 exports one helper for it
  from `members.ts`, so the gate stays in Access & Membership (ADR-045 rule 5).
- **`accessRev` is the pattern for `chatRev`**: `trip_access_revs` (`server/db/schema.ts:499`),
  `bumpAccessRev` (`members.ts:215`), `accessRevFor` (`:230`), served at
  `app/api/trips/[tripId]/events/route.ts:59-72`, typed at `packages/contracts/src/envelope.ts:47-52`,
  read at `components/trip/context/broadcast.ts:188-191` and `TripProvider.tsx:638-661`.
- **No `/v1` route.** Each new internal route gets a `planned` line in
  `server/public-api/exposure.ts` (`exposure.test.ts` fails CI without it).
  **`/v1/trips` extends `TripSummary`** (`app/api/v1/trips/route.ts:22`), so a field added to
  `TripSummary` would reach the public API and force an `openapi.json` regeneration
  (`docs/guidelines/using-the-api.md`, *Features ship before their endpoints*, rule 3). Part 4
  therefore does not add the unread count to `TripSummary`.
- **Personas.** `personasOf` (`components/pages/people.tsx:35`) gives `userId → Persona`, and
  `PersonChip` (`components/ui/person-chip.tsx:54`) draws one. Colours are tokens
  (`scripts/check-color-wall.mjs`).
- **The rail.** `AssistantRail` (`components/assistant/AssistantRail.tsx:205`, 1,248 lines) is
  mounted at `components/board/TripBoardScreen.tsx:1464`, opened by `useAssistantVisibility`
  (`:126`); its presentation is `sheet` below 1100px (`:352`). The desktop Ask pill is
  `TripHeader.tsx:570` (`AskPill`). The phone's Ask entry is `usePhoneAskEntry` (`:157`).
- **Two-context e2e** is done in `apps/web/e2e/suggester.spec.ts:45-52` and
  `travellers.spec.ts:25` (`browser.newContext({ storageState: undefined })`); admin in
  `apps/web/e2e/m12-moderation.spec.ts` with `e2e/adminBootstrap.ts`.

## Part 1 — the store, the routes and the access rules (~24 files)

**Theme.** D1, D2, D4 and D6's server half; ADR-073. No UI. The contract carries the optional
day/stop link (D3) and the soft-delete fields now, so later parts change no schema of
`trip_messages`.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/db/schema.ts` | beside `tripAccessRevs` :499 | `tripMessages` (id, trip_id, author_id, body, link_kind/link_id nullable, created_at, edited_at, deleted_at, deleted_by, hidden_at), `tripChatReads` (trip_id, user_id, last_read_at), `tripChatRevs` (trip_id PK, rev) | `server/chat/chat.int.test.ts` |
| new `drizzle/0048_trip_messages.sql`, `drizzle/meta/_journal.json`, new `drizzle/meta/0048_snapshot.json` | — | the migration | `scripts/check-migration-journal.mjs` |
| new `packages/contracts/src/chat.ts` | — | `ChatMessage` (author id, body, `link?: { kind: "day" \| "stop"; id }`, `removed` boolean with no body when removed), `PostChatMessage`, `EditChatMessage`, `ChatPage` (messages, `unread`, `canPost`, `readOnlyReason?`) | new `packages/contracts/test/chat.test.ts` |
| `packages/contracts/src/index.ts` | — | export | — |
| `packages/contracts/src/envelope.ts` | `TripEventsPage` :47 | `chatRev: z.string().min(1).optional()` | `packages/contracts/test/` (existing envelope cases in `access.test.ts`) |
| `docs/contracts/CHANGELOG.md` | — | entry | — |
| new `server/chat/messages.ts` | — | `listMessages`, `postMessage`, `editMessage`, `deleteMessage` (author or owner; soft), `markRead`; each write bumps `chatRev` in its transaction | `server/chat/chat.int.test.ts` |
| new `server/chat/rev.ts` | — | `bumpChatRev(tx, tripId)`, `chatRevFor(tripId)` on `bumpAccessRev`'s model | `server/chat/chat.int.test.ts` |
| new `server/chat/access.ts` | — | `chatAccess(tripId, minimum)`: demo refused, `requireTripAccess`, deleted trip answered as gone, `canPost` from the lapse helper | new `server/chat/access.test.ts` |
| `server/access/members.ts` | `billingSubject` :270, `capGrantedOnLapse` :306 | export `collaboratorsEntitled(tripId)` (the owner's `trip.collaborators` boolean), reused by `capGrantedOnLapse` | `server/access/members.test.ts` |
| new `app/api/trips/[tripId]/chat/route.ts` | `GET`, `POST` | list (any member) and post (member, entitled) | new `app/api/trips/[tripId]/chat/route.int.test.ts` |
| new `app/api/trips/[tripId]/chat/[messageId]/route.ts` | `PATCH`, `DELETE` | edit own; delete own or owner any | new `app/api/trips/[tripId]/chat/[messageId]/route.int.test.ts` |
| new `app/api/trips/[tripId]/chat/read/route.ts` | `POST` | move the caller's read cursor | covered in `chat/route.int.test.ts` |
| `app/api/trips/[tripId]/events/route.ts` | `Promise.all` :59 | `chatRev` beside `accessRev`, every reader, none for the demo, a failure costs one poll | `app/api/trips/[tripId]/events/route.int.test.ts` |
| `server/public-api/exposure.ts` | route table :48-84 | three `planned` lines | `server/public-api/exposure.test.ts` |
| `mocks/handlers.ts` | — | MSW handlers for the chat routes | — |

`server/chat/chat.int.test.ts` carries the gate's three server boxes, each seen red:
**the event log is identical** before and after a conversation (`server/eventStore.ts`'s read of
the stream); **a removed member** (`removeMember`, `members.ts:441`) is refused GET and POST on
their next request; **after a lapse** a member reads and is refused a post with a named code; the
demo and a deleted trip are refused; a restored trip's chat comes back.

**Preview walk:** nothing on screen. With a session cookie, `POST /api/trips/<id>/chat` and see it
in `GET`; watch `/events?after=<seq>` carry a new `chatRev`.

## Part 2 — the Chat tab (~22 files)

**Theme.** D1's "without a refresh", D2's 403 and read-only states, D5's header count, and the
layout. The e2e spec starts here.

| File | Entry point | Change | Test |
|---|---|---|---|
| `lib/apiClient.ts` | beside `fetchTrips` :184 | `fetchChat`, `postChatMessage`, `markChatRead` | `lib/apiClient.test.ts` |
| `components/trip/context/broadcast.ts` | `onAccessChanged` :122, :188-191 | `onChatChanged(rev)` | `components/trip/context/broadcast.test.tsx` |
| `components/trip/context/TripProvider.tsx` | `useTripBroadcast` :958 | expose the latest `chatRev` | `components/trip/context/TripProvider.test.tsx` |
| new `components/chat/useTripChat.ts` | — | load, refetch when `chatRev` moves, post, mark read while the tab is visible; a 403 becomes `noAccess` | new `components/chat/useTripChat.test.tsx` |
| new `components/chat/ChatPanel.tsx` | — | the list (pinned to bottom, `components/assistant/usePinToBottom.ts`), the composer, the read-only lapse line, the *"You no longer have access to this trip"* state with a link home | new `components/chat/ChatPanel.test.tsx` |
| new `components/chat/ChatMessage.tsx` | — | one message with its `PersonChip` (`components/ui/person-chip.tsx`) from `personasOf` | new `components/chat/ChatMessage.test.tsx` |
| `components/assistant/AssistantRail.tsx` | `AssistantRail` :205 | *Chat · Ask* tabs; Chat renders `ChatPanel`; the tab is a prop the board controls | `components/assistant/AssistantRail.test.tsx` |
| new `components/chat/ChatPill.tsx` | — | 💬 with the unread count, on `AskPill`'s model (`components/assistant/AskPill.tsx:57`) | new `components/chat/ChatPill.test.tsx` |
| `components/trip/TripHeader.tsx` | Ask pill :570, phone row :362 | the 💬 pill beside Ask on desktop; a 💬 icon on the phone row | `components/trip/TripHeader.test.tsx` |
| `components/board/TripBoardScreen.tsx` | `assistant` :126, `<AssistantRail` :1464, palette source ~:297 | which tab is open, open-on-Chat, ⌘K *Open chat* | `components/board/TripBoardScreen.test.tsx` |
| `components/palette/commands.ts` | `askCommand` :67 | `chatCommand(openChat)` | `components/palette/commands.test.ts` |
| `mocks/handlers.ts` | — | as needed | — |
| new `apps/web/e2e/m46-trip-chat.spec.ts` | two contexts, on `suggester.spec.ts`'s `signedInAs` | B posts; **A's open page shows it within one poll** without a reload; A's pill counts it; ⌘K *Open chat* | itself (ci-like) |

**Preview walk:** open a shared trip as two people. Click 💬 (or ⌘K › *Open chat*), post, and
watch the other window show it within a couple of seconds and its 💬 count rise. On a phone, the
header's 💬 opens the sheet on Chat. Remove the second person and see their panel say they no
longer have access.

## Part 3 — day and stop chips (~12 files)

**Theme.** D3. UI only: the link field is already in part 1's contract and stored.

| File | Entry point | Change | Test |
|---|---|---|---|
| new `components/trip/context/boardFocus.ts` | on `components/nav/phoneAsk.ts`'s register/use pattern | the board registers `focusDay` / `focusActivity`; chips and ⌘K call it | new `components/trip/context/boardFocus.test.ts` |
| `components/board/TripBoardScreen.tsx` | `focusDay` :219, `focusActivity` :226, `?day=` :427-434 | register the two; read `?stop=<id>` the way `?day=` is read (once per value, by id) | `components/board/TripBoardScreen.test.tsx` |
| `components/palette/commands.ts` | `goToDayCommands` :172, `goToStopCommands` :177, `tripTargets` :134 | unchanged runs; `tripTargets` feeds the pickers | `components/palette/commands.test.ts` |
| new `components/chat/MessageChip.tsx` | — | a day or stop chip that focuses the board; a target gone renders as plain text | new `components/chat/MessageChip.test.tsx` |
| new `components/chat/TargetPicker.tsx` | — | *@day* and *@stop* in the composer, keyboard first | new `components/chat/TargetPicker.test.tsx` |
| `components/chat/ChatPanel.tsx`, `ChatMessage.tsx` | composer, body | the picker and the chip | their tests |
| `apps/web/e2e/m46-trip-chat.spec.ts` | — | post with *@stop*, click the chip, Plan focuses the stop; delete the stop, the chip is text | itself |

**Preview walk:** in Chat, type *@*, pick a stop, send. Click the chip: Plan opens on that stop.
Open `/trips/<id>?view=Plan&stop=<id>` directly and land there. Delete the stop; the message shows
its name as plain text.

## Part 4 — unread on Home (~10 files)

**Theme.** D5's Home half. Home does not poll, so the count is as fresh as Home's load.

| File | Entry point | Change | Test |
|---|---|---|---|
| `packages/contracts/src/trip.ts` | `TripSummary` :409 | **not** on `TripSummary` (it would reach `/v1/trips`); a new app-only `ListedTripSummary = TripSummary.extend({ unreadChat })` | `packages/contracts/test/trip.test.ts` |
| `docs/contracts/CHANGELOG.md` | — | entry | — |
| `server/chat/messages.ts` (from part 1) | — | `unreadByTrip(userId, tripIds)`, one batched read | `server/chat/chat.int.test.ts` |
| `app/api/trips/route.ts` | `GET` :10 | overlay the counts after `withListedMembers` | `app/api/trips/route.int.test.ts` |
| `lib/apiClient.ts` | `fetchTrips` :184 | parse `ListedTripSummary` | `lib/apiClient.test.ts` |
| `app/(app)/page.tsx` | `trips` state :90, `<TripCard` :764 | pass the count | `app/(app)/page.test.tsx` |
| `components/home/TripCard.tsx` | `TripCard` :81 | a 💬 badge with the count | `components/home/TripCard.test.tsx` |
| `components/home/NextTripHero.tsx` | — | the same badge on the hero | `components/home/NextTripHero.test.tsx` |
| `mocks/handlers.ts` | `/api/trips` | the field | — |
| new `apps/web/e2e/m46-chat-unread-home.spec.ts` | two contexts | B posts through the API; A loads Home and sees the count; A opens Chat, returns Home, the count is gone | itself |

**Preview walk:** as B, post two messages. As A, open Home: the trip's card shows 💬 2. Open the
trip's Chat, go back Home, and the badge is gone.

## Part 5 — edit, delete, report (~18 files)

**Theme.** D6's client half and the admin panel. The server's edit and soft delete are part 1's.

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/db/schema.ts` | `contentReports` :1051 | `saved_day_id` nullable, `trip_message_id` (and `trip_id`), the target CHECK and unique over three kinds | `app/api/reports/route.int.test.ts` |
| new `drizzle/<next>_content_reports_trip_messages.sql`, `_journal.json`, new snapshot | — | the migration (number picked at build time, expected `0049`) | `check-migration-journal.mjs` |
| `packages/contracts/src/report.ts` | `ReportTarget` :21 | `{ kind: "trip_message", tripId, messageId }` | new `packages/contracts/test/report.test.ts` |
| `docs/contracts/CHANGELOG.md` | — | entry | — |
| `server/reports.ts` | `targetOf` :39, `createReport` :100, `listReports` :169, `actOnReport` :244 | a reporter must be able to read the trip; the queue shows the message; *hide* sets `hidden_at`, *restore* clears it | `app/api/reports/route.int.test.ts`, new `server/chat/moderation.int.test.ts` |
| `lib/reports.ts` | `AdminReportQueueItem` :21 | the message variant | `components/admin/ReportsPanel.test.tsx` |
| `components/admin/ReportRow.tsx`, `ReportsPanel.tsx` | — | render a message report; hide and restore | `components/admin/ReportsPanel.test.tsx` |
| `components/chat/ChatMessage.tsx` | — | a menu: Edit and Delete (own), Delete (owner), Report (others, via `ReportAction`, `components/playbooks/ReportDialog.tsx:34`); *"message removed"* | `components/chat/ChatMessage.test.tsx` |
| `components/chat/ChatPanel.tsx`, `useTripChat.ts` | — | edit in place; delete with confirm | their tests |
| `lib/apiClient.ts` | — | `editChatMessage`, `deleteChatMessage` | `lib/apiClient.test.ts` |
| `apps/web/e2e/m46-trip-chat.spec.ts` | — | edit own, delete own, owner deletes B's; B reports one and the admin console's Reports shows it (`m12-moderation.spec.ts`'s admin sign-in) | itself |

**Preview walk:** edit a message and see *edited*; delete one and see *message removed* on both
windows. As the second person, report a message; as an admin, open the console's Reports and hide
it, then restore it.

## Gate

The milestone's exit gate. The e2e boxes read CI on each part's head and
`pnpm --filter web test:e2e:ci-like apps/web/e2e/m46-trip-chat.spec.ts`. The **[walk]** is two
people on a preview after part 5 merges, one on a phone.

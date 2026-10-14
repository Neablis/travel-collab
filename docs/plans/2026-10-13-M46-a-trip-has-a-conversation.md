# M46 plan — a trip has a conversation, with the people taking it

Milestone: `docs/milestones/M46-a-trip-has-a-conversation.md` (decisions D1–D7 and the layout,
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
| 5 Edit, delete, report | `claude/m46-part5-edit-delete-report` | 2 merged | 3, 4, 6 |
| 6 Who's online | `claude/m46-part6-whos-online` | 1 merged | 2, 3, 4, 5 |

Every part targets `main`. A part that depends on another branches from `main` after that part
has merged. Parts 3 and 5 both edit `components/chat/ChatPanel.tsx` and `ChatMessage.tsx`; the
second to merge takes `main` first. Parts 1 and 6 both edit the events route and
`envelope.ts`'s `TripEventsPage`, and part 6 starts after part 1 merges, so it builds on `chatRev`.

Facts the parts share (the survey, 2026-10-13):
- **Migrations.** Part 1 ships `0048_trip_messages` and `0049_trip_chat_reads_last_read_id` (the
  read cursor's id; a separate file because previews had already run `0048`). Part 6
  took `0050_trip_presence` (built first; the journal wall refuses gaps), so part 5's `content_reports`
  relaxation is `0051`, regenerated on main once `0050` has merged. Each migration
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
| `server/db/schema.ts` | beside `tripAccessRevs` :499 | `tripMessages` (id, trip_id, author_id, body, link_kind/link_id nullable, created_at, edited_at, deleted_at, deleted_by, hidden_at), `tripChatReads` (trip_id, user_id, last_read_at, last_read_id; the cursor is the pair `(created_at, id)`), `tripChatRevs` (trip_id PK, rev) | `server/chat/chat.int.test.ts` |
| new `drizzle/0048_trip_messages.sql`, new `drizzle/0049_trip_chat_reads_last_read_id.sql`, `drizzle/meta/_journal.json`, new `drizzle/meta/0048_snapshot.json` and `0049_snapshot.json` | — | the two migrations | `scripts/check-migration-journal.mjs` |
| new `packages/contracts/src/chat.ts` | — | `ChatMessage` (author id, body, `link?: { kind: "day" \| "stop"; id }`, `removed` boolean with no body when removed), `PostChatMessage`, `EditChatMessage`, `ChatPage` (messages, `unread`, `canPost`, `readOnlyReason?`) | new `packages/contracts/test/chat.test.ts` |
| `packages/contracts/src/index.ts` | — | export | — |
| `packages/contracts/src/envelope.ts` | `TripEventsPage` :47 | `chatRev: z.string().min(1).optional()` | `packages/contracts/test/` (existing envelope cases in `access.test.ts`) |
| `docs/contracts/CHANGELOG.md` | — | entry | — |
| new `server/chat/messages.ts` | — | `listMessages`, `postMessage`, `editMessage`, `deleteMessage` (author or owner; soft), `markRead` (moves the cursor forward only, comparing `(created_at, id)`); each write bumps `chatRev` in its transaction | `server/chat/chat.int.test.ts` |
| new `server/chat/rev.ts` | — | `bumpChatRev(tx, tripId)`, `chatRevFor(tripId)` on `bumpAccessRev`'s model | `server/chat/chat.int.test.ts` |
| new `server/chat/access.ts` | — | `chatAccess(tripId)`: demo refused, `requireTripAccess`, deleted trip answered as gone, `canPost` from the lapse helper; `chatReadOnly()` is the 402 `collaborators-not-entitled` | new `server/chat/access.test.ts` |
| `server/access/members.ts` | `billingSubject` :270, `capGrantedOnLapse` :306 | export `collaboratorsEntitled(members)` (the owner's `trip.collaborators` boolean), reused by `capGrantedOnLapse` | `server/access/members.test.ts` |
| new `app/api/trips/[tripId]/chat/route.ts` | `GET`, `POST` | list (any member) and post (member, entitled; else 402) | new `app/api/trips/[tripId]/chat/route.int.test.ts` |
| new `app/api/trips/[tripId]/chat/[messageId]/route.ts` | `PATCH`, `DELETE` | edit own (entitled; else 402); delete own or owner any, **also after a lapse** | new `app/api/trips/[tripId]/chat/[messageId]/route.int.test.ts` |
| new `app/api/trips/[tripId]/chat/read/route.ts` | `POST` | move the caller's read cursor, **also after a lapse** | covered in `chat/route.int.test.ts` |
| `app/api/trips/[tripId]/events/route.ts` | `Promise.all` :59 | `chatRev` beside `accessRev`, every reader, none for the demo, a failure costs one poll | `app/api/trips/[tripId]/events/route.int.test.ts` |
| `server/public-api/exposure.ts` | route table :48-84 | three `planned` lines | `server/public-api/exposure.test.ts` |
| `mocks/handlers.ts` | — | MSW handlers for the chat routes | — |

`server/chat/chat.int.test.ts` carries the gate's three server boxes, each seen red:
**the event log is identical** before and after a conversation (`server/eventStore.ts`'s read of
the stream); **a removed member** (`removeMember`, `members.ts:441`) is refused GET and POST on
their next request; **after a lapse** a member reads, is refused a post and an edit with 402
`collaborators-not-entitled`, and may still delete and mark read; the
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

**Note for the build.** Resolve a message's link id **only against the current trip**: look the
day or stop up in this trip's state, never by id alone, so a pasted or crafted id from another
trip renders as plain text and the chip never focuses (or reveals) something outside this trip.

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
| new `drizzle/<next>_content_reports_trip_messages.sql`, `_journal.json`, new snapshot | — | the migration (`0051`, after part 6's `0050`) | `check-migration-journal.mjs` |
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

## Part 6 — who's online (~16 files)

**Theme.** D7. A per-member last-seen written by the events poll at most once every 5 minutes,
the ids of current members seen in the last 6 minutes served on the same poll, and a dot on the
avatars the trip already shows. No new route, so nothing in `server/public-api/exposure.ts`. Not
chat: no `chatRev`, no event. Its migration is `0050_trip_presence` (`0048` and `0049` are part 1's;
part 5 moved to `0051`).

| File | Entry point | Change | Test |
|---|---|---|---|
| `server/db/schema.ts` | beside `tripAccessRevs` :499 | `tripPresence` (trip_id, user_id, seen_at; PK trip_id + user_id) | new `server/presence/presence.int.test.ts` |
| new `drizzle/<next>_trip_presence.sql`, `drizzle/meta/_journal.json`, new `drizzle/meta/<next>_snapshot.json` | — | the migration | `scripts/check-migration-journal.mjs` |
| new `server/presence/presence.ts` | — | `PRESENCE_HEARTBEAT_MS` (5 min), `PRESENCE_WINDOW_MS` (6 min); `touchPresence(tripId, userId)`, one upsert whose `setWhere` is `seen_at <= now() - 5 min`; `onlineMembers(tripId, memberIds)`, the ids seen within the window, filtered to the current members | new `server/presence/presence.int.test.ts` |
| `app/api/trips/[tripId]/events/route.ts` | `Promise.all` :59 (with part 1's `chatRev`) | touch the caller's presence and serve `online` from `access.detail.members`; none for the demo; a failure costs one poll the field | `app/api/trips/[tripId]/events/route.int.test.ts` |
| `packages/contracts/src/envelope.ts` | `TripEventsPage` :47 | `online: z.array(z.string()).optional()` | `packages/contracts/test/access.test.ts` (the `TripEventsPage` cases, :137) |
| `docs/contracts/CHANGELOG.md` | — | entry | — |
| `components/trip/context/broadcast.ts` | `onAccessChanged` :122, :188-191 | `onPresence(ids)`, on every poll that carries `online` | `components/trip/context/broadcast.test.tsx` |
| `components/trip/context/TripProvider.tsx` | `access` :131, `useTripBroadcast` :958 | expose `online: ReadonlySet<string>` from the latest poll (empty until one answers) | `components/trip/context/TripProvider.test.tsx` |
| `components/ui/person-chip.tsx` | `PersonChip` :54 | `online?: boolean`: a dot at the avatar's corner, a colour token (`check-color-wall.mjs`), and *online* in its accessible name | `components/ui/person-chip.test.tsx` |
| `components/trip/TripHeader.tsx` | `TravellerStack` :812 | pass `online` to each face in the stack | `components/trip/TripHeader.test.tsx` |
| `components/trip/people/PersonRow.tsx`, `PeopleSection.tsx` | `PersonRow` :31, `renderMember` :331 | the dot on each member row in Trip settings → People | `components/trip/people/PeopleSection.test.tsx` |
| `mocks/handlers.ts` | `events` :197 | `online` on the default page | — |
| new `apps/web/e2e/m46-whos-online.spec.ts` | two contexts, on `travellers.spec.ts`'s | B opens the trip; A's header stack and People show B's dot within a poll | itself (ci-like) |

`server/presence/presence.int.test.ts` carries the gate's box, seen red: a member who polled is in
`online`; a member whose `seen_at` is older than the window (set back in the test) is not; a
second poll inside 5 minutes leaves `seen_at` unchanged (one write per window); a removed member
is not served even with a fresh row; the demo writes and serves nothing.

**Preview walk:** open a shared trip as A, and as B in a second window. On A, B's face in the
header's traveller stack (640px and up) gains the dot within a couple of seconds, and Trip
settings → People shows it on B's row. Close B's window: B's dot stays for up to about 6 minutes,
then goes. On the demo trip no dot appears.

## Gate

The milestone's exit gate. The e2e boxes read CI on each part's head and
`pnpm --filter web test:e2e:ci-like apps/web/e2e/m46-trip-chat.spec.ts`. The **[walk]** is two
people on a preview after parts 5 and 6 merge, one on a phone.

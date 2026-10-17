# M46 — A trip has a conversation, with the people taking it

**Status:** **Proposed 2026-10-06, placed after M45. Current from 2026-10-13, when M45's gate
closed. Scoped 2026-10-13**: every decision below was answered by Mitchell that day, after a code
survey of today's UI (M41's ⌘K palette and M45's assistant rail postdate the proposal). Minted
from `docs/candidates.md` (see `docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).
It is the largest new surface in this set, and the first feature that would generate
notifications. That is why it comes after the persona work (M38) and the phone work (M39), both
of which it uses.

ADR: `docs/architecture/ADR-073-trip-chat-is-its-own-store.md`. Plan:
`docs/plans/2026-10-13-M46-a-trip-has-a-conversation.md`, deleted with the retro on 2026-10-17
(in git history).

## Why this exists

Mitchell, 2026-10-04: *"a chat for a trip with the others taking the trip"*. Collaborators
coordinate outside the app today, so the conversation that explains a plan is not stored anywhere
near it.

Candidate absorbed (deleted by this gate):
- *A chat for a trip, with the people taking it* (2026-10-04)

## Decisions (answered by Mitchell, 2026-10-13)

1. **Messages are their own store, not trip events.** A table `trip_messages` (migration `0048`;
   `0049` adds the read cursor's `trip_chat_reads.last_read_id`),
   off the event log, History, replay and undo. They are conversation, not plan state: the event
   log records what the trip *is* (ADR-001, ADR-003; the proposal cited ADR-012, which is client
   state, in error). The ADR-064 boundary (a suggestion is not planning state until accepted) is
   the precedent. *As recommended, with the ADR reference corrected.* Mitchell added: **a message
   appears on every open page without a refresh**, by the same mechanism that makes an activity's
   change appear (the events poll, decision 4). ADR-073 records the store.
2. **Every member may read and post**, viewers and suggesters included, **while the owner is
   entitled** to collaborators (`trip.collaborators`; the same lapse `capGranted` applies,
   `server/access/members.ts:298`). **After a lapse the chat stays readable and becomes
   read-only** for everyone; the composer says why. Read-only means **posting and editing are
   refused** (402, `collaborators-not-entitled`, the collaboration gate's own code); **deleting**
   (an author their own, the owner any) **and marking read stay allowed**, because neither is new
   content. The demo trip refuses every chat route
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
5. **Notifications start in-app**: a per-person read cursor (the last message read, compared as
   `(created_at, id)`, the order the list is read in, so a message stamped the same millisecond is
   not lost), and an unread count on the trip's
   chat pill in the header and on Home's trip card. Home does not poll; its count is as fresh as
   Home's own load (`app/(app)/page.tsx:239`, `fetchTrips`). Email and push are out of scope (the
   service worker has no push handler). *As recommended.*
6. **Moderation:** authors edit and delete their own messages, and the owner deletes any. A
   delete is soft and renders *"message removed"*. **A report reaches the admin reports panel**
   (M12): `content_reports` (`server/db/schema.ts:1051`) is relaxed by a migration (its
   `saved_day_id` is NOT NULL and its target CHECK knows two kinds), the report contract gains a
   `trip_message` target (`packages/contracts/src/report.ts:21`), and `server/reports.ts` and
   `components/admin/ReportsPanel.tsx` gain hide and restore for it (migration `0051`; part 6 took
   `0050` first). **A deleted trip hides its
   chat, and restoring the trip restores it.** ADR-016 defines no retention to follow: `TripDeleted`
   is reversible, so the chat is hidden with the trip, never purged. *Replaces "follows ADR-016's
   retention", which named a rule that does not exist.*
7. **Members see who has the trip open right now** (answered by Mitchell, 2026-10-13). A dot on
   a member's avatar where the trip already shows its members: the header's traveller stack
   (`TravellerStack`, `components/trip/TripHeader.tsx:812`, from 640px) and every row of Trip
   settings → People (`PersonRow`, `components/trip/people/PersonRow.tsx:31`, every width).
   *Online* means the trip page is open and visible. It **rides the existing events poll** (2 s,
   visible tab only; `app/api/trips/[tripId]/events/route.ts`, client
   `components/trip/context/broadcast.ts`), with no new transport. The server keeps a per-member
   last-seen for the trip, **written at most once every 5 minutes per member** (Mitchell: *"a 5m
   heartbeat, so kinda live"*), and the poll serves the ids of the members seen within the last
   **6 minutes** (a little over one heartbeat). Presence is therefore coarse, about 5 minutes, on
   purpose: it keeps writes to one per member per 5 minutes. It is not chat: it touches neither
   `chatRev` nor the event log. The demo trip has no presence. A removed member stops appearing
   once their membership row is gone, because the served ids are only ever current members.
   ADR-073 §6 records it.

**Layout (answered 2026-10-13).** Chat is a **tab in the existing assistant rail and sheet**,
tabs *Chat · Ask*: docked from 1100px, a sheet below (`TripBoardScreen.tsx:345-352`,
`AssistantRail` at `:1464`). The desktop header gets a **💬 pill with the unread count** beside
the ✦ Ask pill (`TripHeader`). On a phone, a 💬 icon in the header opens the sheet on Chat (the
phone tab bar has no free slot). ⌘K gains *Open chat* beside *Ask the assistant*
(`components/palette/commands.ts:67`). A chip focuses the board. M38's personas show on every
message. It is called **Chat** everywhere, so it is never confused with Ask's thread
(`useAskThread`).

**Changed on Mitchell's preview walk (2026-10-13 and 14), after the parts merged.** The 💬 pill
and the phone's 💬 icon are gone: one Ask button opens the panel on the tab last open, and its
unread mark is a dot that never resizes it (PRs 442, 443, 447; Home's cards keep the count). A
message may also mention a person or a notebook, and a chip is plain text without the *@* (PR 446,
migration `0052`). Report is a small flag shown on hover (PR 445), a sent message shows at once
(PR 444), and the online dot is smaller (PR 441).

## Scope

- A chat store, routes, a trip-level chat panel, links to days and stops, unread counts, and
  report and delete actions.
- Personas from M38 on every message.
- Who is online (decision 7): a last-seen heartbeat on the events poll and a dot on the avatars
  the trip already shows.
- No public API endpoint: the API guideline's *Features ship before their endpoints* applies, so
  each new internal route gets a `planned` line in `server/public-api/exposure.ts` and nothing
  more.

Six parts, each its own PR on `main` (plan, now deleted: `docs/plans/2026-10-13-M46-a-trip-has-a-conversation.md`):

| Part | Branch | Theme | Depends on |
|---|---|---|---|
| 1 | `claude/m46-part1-store-and-routes` | migrations `0048` and `0049`, contracts, `server/chat/`, the routes, the access rules (lapse, demo, removed, deleted trip), `chatRev` on the poll | — |
| 2 | `claude/m46-part2-chat-tab` | *Chat · Ask* tabs, messages with personas, the composer, the 💬 pill and phone icon, ⌘K *Open chat*, live by `chatRev`, the 403 state | 1 |
| 3 | `claude/m46-part3-day-and-stop-chips` | shared focus, `?stop=`, *@day* / *@stop* pickers, chips | 2 |
| 4 | `claude/m46-part4-unread-on-home` | the unread count on Home's trip cards | 1 |
| 5 | `claude/m46-part5-edit-delete-report` | edit and delete in the panel, *"message removed"*, reports of a message (migration `0051`), the admin panel's hide and restore | 2 |
| 6 | `claude/m46-part6-whos-online` | the last-seen heartbeat on the events poll (migration `0050`), the online ids it serves, the dot on the header's stack and in People | 1 |

## Out of scope

- Direct messages between two people.
- Attachments and images.
- Email digests and push notifications.

## Exit gate

CI runs only on pull requests (`.github/workflows/ci.yml`, `on: pull_request`), so each box's
evidence is the run on a part's head. **PR 444's head `588f0d9` is the whole milestone**: it
merged `main` at `9c5bfd8` (every other M46 PR), was the last M46 PR to merge, and its M46 specs
and its chat and presence code and tests are identical to `main` after it (`git diff 588f0d9
29eacfa` on them is empty). Its
CI run is [38508820543](https://github.com/Neablis/travel-collab/actions/runs/38508820543):
`test / integration`, `test / unit` and both `test / e2e` shards green. Test lines are on `main`
at `97caeb0`. Checked 2026-10-17.

- [x] **Decisions 1–7 are answered and recorded here**, with an ADR for the store (ADR-073).
      *(Decisions 1–7 and the layout above, each answered by Mitchell on 2026-10-13;
      `docs/architecture/ADR-073-trip-chat-is-its-own-store.md`, whose §6 records decision 7.)*
- [x] **No chat write touches the trip's event log**: an integration test compares the log before
      and after a conversation.
      *(`apps/web/src/server/chat/chat.int.test.ts:85`: posts, an edit, a delete and a mark-read,
      then `readStream` equals the stream before. Red with `postMessage` appending a
      `ChatMessagePosted` event (PR 433's body). Green on PR 433's head `85b3062`,
      [run 38407643265](https://github.com/Neablis/travel-collab/actions/runs/38407643265), and on
      run 38508820543.)*
- [x] **A removed member can neither read nor post from their next request on**, which an
      integration test shows. Their open chat panel shows that they no longer have access.
      *(`chat.int.test.ts:117`: after `members.DELETE`, GET and POST answer 403 and nothing they
      sent landed; red with `chatAccess` re-admitting anyone it once admitted (PR 433). The panel:
      `apps/web/src/components/chat/useTripChat.test.tsx:68` (a 403 becomes `no-access`) and
      `ChatPanel.test.tsx:78` (the *"You no longer have access to this trip"* line and a link
      home, no messages); red in PR 436's body. Integration green on run 38407643265, unit on PR
      436's head `bfedeae`, [run 38442519004](https://github.com/Neablis/travel-collab/actions/runs/38442519004),
      both on run 38508820543.)*
- [x] **After the owner's entitlement lapses, the chat is readable and refuses a post and an
      edit** (402 `collaborators-not-entitled`) **while delete and mark-read still work**, which an
      integration test shows; the demo trip refuses every chat route.
      *(`chat.int.test.ts:139` (every member reads, `canPost` false, a post is 402
      `collaborators-not-entitled`), `:161` (an edit is 402; mark-read is 204; the author and the
      owner delete), `:201` (all five chat routes answer 403 `demo-trip-unsupported` on the demo).
      Red in PR 433's body (`canPost: true`; the demo check off). Green on runs 38407643265 and
      38508820543.)*
- [x] **A second member's open page shows a new message within one poll, without a refresh**, in
      an e2e with two contexts.
      *(`apps/web/e2e/m46-trip-chat.spec.ts:58`: a viewer in a second `browser.newContext` posts,
      and the owner's page, never reloaded, names the unread message within 10s and shows it in
      Chat. Red with `chatRev` dropped from the load effect (PR 436's body, dev lane). Green in
      both e2e shards on PR 436's head, run 38442519004, and in its final shape on run
      38508820543.)*
- [x] **A reported message reaches the admin reports panel.**
      *(`m46-trip-chat.spec.ts:122`: the viewer reports a message, and an operator finds it in the
      console's Reports as *Chat message* and hides it (`:198-209`).
      `apps/web/src/server/chat/moderation.int.test.ts:99`: the report is stored and the admin
      queue route shows the message. Red in PR 440's body (the reports route without the
      chat-message target: `expected 404 to be 201`). Green on PR 440's head `fbb8948`,
      [run 38477095539](https://github.com/Neablis/travel-collab/actions/runs/38477095539), and on
      run 38508820543.)*
- [x] **Presence is a coarse heartbeat**: an integration test shows a member who polled is served
      as online and one who has not polled within the window is not, and that the heartbeat writes
      a member's last-seen at most once per window however often they poll.
      *(`apps/web/src/server/presence/presence.int.test.ts:82` (served), `:89` (7 minutes old: not
      served), `:97` (two more polls leave `seen_at` unchanged; past the heartbeat it writes
      again), `:116` (no row lock inside the heartbeat). Red in PR 438's body (the window filter
      removed; `setWhere` commented out). Green on PR 438's head `fcaaa80`,
      [run 38456523715](https://github.com/Neablis/travel-collab/actions/runs/38456523715), and on
      run 38508820543.)*
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`.**
      *(CI's e2e job is what ci-like runs locally: a production build served by `next start`
      (`apps/web/package.json:21`, `.github/workflows/ci.yml:342`). `m46-trip-chat.spec.ts`,
      `m46-whos-online.spec.ts` and `m46-chat-unread-home.spec.ts` were green in both shards on
      run 38508820543, and still on PR 470's head `b01e2f3` on 2026-10-17,
      [run 38991735043](https://github.com/Neablis/travel-collab/actions/runs/38991735043). Locally,
      `test:e2e:ci-like e2e/m46-trip-chat.spec.ts` passed 4 of 4 in PRs 443 to 447's bodies.)*
- [ ] **[walk]** Two people on the PR preview, one on a phone.
      *(NEEDS MITCHELL. Not ticked: nothing records this walk. Mitchell walked the parts' previews
      one at a time, and each note became a fix, PRs 441 to 447, quoted in their bodies. No PR
      body, PR comment or plan records two people at once with one on a phone. The last build
      session ended on 2026-10-14 asking for it: "PR 432 needs your walk and answer". To walk it,
      on a production or preview deploy of `main`: open a shared trip as two people, one on a
      phone. Post from each and watch the other's Ask button gain its unread dot within a couple
      of seconds, without a reload. On the phone, the tab bar's Ask opens the sheet; switch to
      Chat. Link a stop with *@*, then tap the chip. Edit a message, delete one, and report one.
      Then check that the phone's face gains the online dot in the other's header stack and in
      Trip settings → People.)*
- [x] A retro is appended at gate close. *(Below, 2026-10-17.)*

## Retro — written 2026-10-17 (9 of 10 boxes ticked)

*The box left open is the two-person walk, one on a phone, which is Mitchell's. `pnpm milestone
close M46` refuses while it is open, so the milestone is not closed and M46 stays current.*

**What shipped.** Six parts on `main`, all merged on 2026-10-13: part 1, the store, routes and
access rules (PR 433, `a1a5dfd`); part 4, unread on Home (PR 435); part 2, the Chat tab (PR 436);
part 6, who's online (PR 438); part 3, day and stop chips (PR 439); part 5, edit, delete and
report (PR 440). Then seven PRs from Mitchell's walk, merged by 2026-10-14 04:56 UTC: PRs 441 to
447. Migrations `0048` to `0052`. Part 0 (PR 432) merged on 2026-10-14. By the guideline's count
(the PRs' additions without `docs/`, `*.generated.json` and the lockfile) that is 21,828 lines,
of which 15,142 are the five drizzle snapshots (`drizzle/meta/0048_snapshot.json` to
`0052_snapshot.json`) and 6,686 are written by hand.

### What went well

- **The six parts took one day.** They merged between 14:48 and 23:04 UTC on 2026-10-13. Parts
  2 and 4 ran side by side (merged 19:18:17 and 19:18:47), and so did parts 3 and 6 (21:27:00 and
  21:20:37).
- **Every server box has a red-first record.** PR 433's body lists each chat integration test
  with its source edit and failure, and PRs 436, 438 and 440 do the same for the panel, presence
  and moderation. The gate above is read from them and from CI.
- **CI was green on every merged head**, both e2e shards included: runs 38407643265 (PR 433),
  38427768884 (PR 435), 38442519004 (PR 436), 38456523715 (PR 438), 38461770431 (PR 439),
  38477095539 (PR 440) and 38508820543 (PR 444, the whole milestone).
- **The hand-off was automatic, as M45's retro asked.** Two of the four build sessions,
  `011qbNMR` and `014sNNX9` (*"⚡ M46 — continued"*), were started by a scheduled task the
  orchestrator created (`origin: scheduled_trigger`, tag `routine:agent-minted`), not by
  Mitchell.
- **Two parts that both wanted the next migration number did not collide.** Part 6 took `0050`
  first, and part 5 was regenerated as `0051` on `main`, as the plan said it would be
  (`scripts/check-migration-journal.mjs` refuses gaps).
- **The walk changed the product.** Mitchell's notes became seven PRs, each quoting him in its
  body. The biggest was one Ask button for Ask and Chat (PR 442) in place of two.

### What could be better

- **Part 0 merged before its gate.** PR 432 merged on 2026-10-14 17:44 UTC with 0 of 10 boxes
  ticked and no retro, against *"part 0 merges last"*. The session that ran it then reported that
  the merge "closes M46's gate" (`013FKGgh`'s post-turn summary), and the gate sat open for three
  days. The change that would have prevented it: part 0 is marked ready only after `pnpm milestone
  close` has run on it with `--confirm`, which `close-a-milestone` step 6 already orders. Nothing
  enforces it.
- **The walk came after the merges, so its fixes were seven more PRs.** The first walk PR (441)
  merged two hours after its part (438). The seven PRs added 4,439 lines, with a contract change
  and migration `0052` in PR 446, whose body says there is *"no code rollback past PR 446 once
  such a message exists"*. `close-a-milestone` step 2 has each walk fix go on its part's branch
  before that part merges. Walking each preview before merging would have kept them there.
- **No session ran `session-metrics`, for the third milestone in a row.** M45's retro asked for
  it at every hand-off. All four transcripts went with their containers, so the spend block below
  has dollars and tokens but none of the per-agent figures the targets need.
- **Four sessions, against M45's rule of one mid-build hand-off plus one for the close.** The
  orchestrators' last recorded context was 386k, 298k, 269k and 313k (`context_usage.used_tokens`),
  all past the 250k at which a hand-off was meant to happen.
- **Five known issues were filed during the build:** two about chat sends (KI-2026-10-14-a and
  -b), two about how the sessions work (KI-2026-10-13-e and -f), and one about CI
  (KI-2026-10-14-c).

### Leftovers

- **The [walk] box:** Mitchell's call. The steps are in the box.
- **KI-2026-10-14-a** (a send that never answers holds every later line at *Sending…*) and
  **KI-2026-10-14-b** (a send queued behind a failed one comes back joined to it): open.
- **KI-2026-10-05-h**, a removed member's open page: open. Only its chat says access is gone.
- **KI-2026-10-14-c** (CI's `test / unit` red once per PR), **KI-2026-10-13-e** and
  **KI-2026-10-13-f** (hand-offs and CI logs from a cloud session): open, not chat defects.
- **Candidates:** *Trip chat follow-ups from M46's preview walk* (`docs/candidates.md`). Its
  notebook link shipped in PR 446. Grouping a run of messages is still open, and notifying a
  person who is mentioned is added there.
- **The absorbed candidate**, *A chat for a trip*, is deleted by `pnpm milestone close M46`
  when it runs.
- **Production migrations `0048` to `0052`:** read `pnpm state`'s `PROD MIGRATIONS` line. Not
  checked for this retro.
- **From the deleted plan:** the walk steps (now in the [walk] box) and the migration numbers
  (now in the decisions and the parts table). Its file and line pointers were starting points
  only, so none were kept.

## Spend

**Not a generated block.** The four build sessions' transcripts went with their containers
before anyone ran `pnpm -s session-metrics` (above), so it cannot be run. This block has no
`session-metrics:milestone` marker for that reason, and the close has to use `--no-spend`. The
numbers are each session's own recorded usage, `list_sessions` → `external_metadata.usage`
(`get_session` for the three the listing did not include), read on 2026-10-17 with every
session idle. A session is counted if its id is on an M46 PR's commits.

| Session | What it built | Cost | Input | Cache write | Cache read | Output |
|---|---|---|---|---|---|---|
| `013FKGgh` | part 0 (PR 432) and part 1 (PR 433) | $50.52 | 21,745 | 3,606,884 | 89,977,345 | 498,630 |
| `011qbNMR` | parts 4, 2 and 6 (PRs 435, 436, 438) | $44.63 | 13,623 | 2,677,078 | 97,902,009 | 518,563 |
| `014sNNX9` | parts 3 and 5, walk PRs 441 and 442 | $41.79 | 15,396 | 2,365,013 | 89,096,173 | 572,533 |
| `01UoDoRu` | walk PRs 443 to 447 | $39.60 | 1,811 | 2,588,202 | 73,595,835 | 523,513 |
| **Total** | 6 parts and 7 walk PRs | **$176.54** | 52,575 | 11,237,177 | 350,571,362 | 2,113,239 |

What this does not cover. `013FKGgh` ran from 2026-10-13 09:28 to 2026-10-14 17:44 UTC, so it
may include turns that were not M46. The *"M46 handoff prompt"* session (`017LYso7`, a local CLI
session) records no usage and is not counted. Per-agent units, the orchestrator's share, wakes
and cache re-writes need the transcripts, so they are not measured.

### Spend against the last milestone

| Milestone | Parts | Lines added | Cost | Per part | Per 1k lines | Sessions |
|---|---|---|---|---|---|---|
| M46 | 6 + 7 walk PRs | 21,828 (6,686 without snapshots) | $176.54 | $29 | $8 ($26 without snapshots) | 4 |
| M45 | 6 + PR 425 | 10,065 | about $239 | $34 | $24 | 5 |
| M42 | 9 | 9,739 | $334 | $37 | $34 | 1 |

- **Dollars per 1,000 lines added (under 20):** met at $8 by the guideline's count, and **missed at
  $26** without the 15,142 lines of generated drizzle snapshots. M45 had no migration, so $26 is
  the figure that compares (M45: 24). The guideline should leave `drizzle/meta/*_snapshot.json`
  out of the count, as it does `*.generated.json`.
- **Orchestrator's share (under 15%):** not measured. No transcript (M45: 19.8%).
- **A builder's average context (none over 250k):** not measured. The orchestrators' own last
  contexts were 269k to 386k.
- **GitHub wakes per merged part (under 5):** not measured.
- **Cache re-writes after a coordinator message (2 or fewer):** not measured. Total cache writes
  were 11.24M (M45: 13.65M).

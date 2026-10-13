# ADR-073: A trip's chat is its own store, beside the event log and never in it

**Status:** **Accepted — 2026-10-13.** Mitchell, in session on M46's scoping.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-001** (event-sourced modular monolith), **ADR-003** (the history substrate is scoped
to planning), **ADR-064** (a suggestion is not planning state until accepted; the precedent),
**ADR-065** (who is travelling is access data; `accessRev`'s pattern), **ADR-049** (realtime is a
cursor), **ADR-016** (trip soft delete), **ADR-045** (Entitlements is a module), **ADR-031** (the
demo trip), milestone `docs/milestones/M46-a-trip-has-a-conversation.md` (decisions 1, 2, 4, 6 and 7).

## Context

M46 gives a trip a conversation among the people on it. Messages are written for days, by every
member, and must appear on every open page without a refresh. Two stores were available:

- **The trip's event stream.** It already reaches every open page through the 2 s events poll,
  and History, replay and undo all read it.
- **A table of its own**, the way suggestions (ADR-064) and who is travelling (ADR-065) live
  beside the stream.

The stream records what the trip *is* (ADR-001, ADR-003). A message is not a plan fact: replaying
the log must not need it, undo must never take back something somebody said, and History is the
plan's history, not a transcript. The proposal cited ADR-012 for this; ADR-012 is the client's
state architecture, and the boundary is ADR-003's.

## Decision

1. **Messages live in their own table, `trip_messages`** (migrations `0048` and `0049`), in a **Chat** module
   (`apps/web/src/server/chat/`). It is ordinary CRUD with audit fields, keyed by trip id on the
   ADR-025 no-foreign-key terms. **Nothing about a message goes on the trip's event stream**: no
   event, no projection, no History entry, no undo. A per-person read cursor (last message read)
   lives beside it, `trip_chat_reads`. It holds the pair the list is ordered by,
   `(created_at, id)` (`last_read_at`, and `last_read_id` from `0049`), and compares the pair, so
   a message stamped the same millisecond as the one marked read is still unread.
2. **Realtime is a counter on the events poll, not a transport.** Every chat write (post, edit,
   delete, owner delete) bumps a per-trip `chatRev` **in the same transaction** as the write. The
   events poll serves it to **every reader** of the trip, beside `accessRev`, and the client
   refetches the messages when it moves. This is `accessRev`'s construction (a counter, because a
   delete removes nothing a `max(updated_at)` could see), not `suggestionsRev`'s role-scoped
   hash: everyone the poll serves may read the whole conversation. A failed read costs one poll
   the revision, never the events.
3. **Who may read and post is decided per request**, by the seam every trip read passes
   (`requireTripAccess`):
   - every member may read, viewers and suggesters included;
   - every member may post **while the owner is entitled to collaborators** (ADR-045: the gate
     asks Entitlements a boolean and Entitlements never learns this is chat). **After a lapse the
     chat is read-only** for everyone, and stays readable: a post or an edit is refused with the
     collaboration gate's own 402 `collaborators-not-entitled`, and a delete (an author's own, the
     owner's of any) and marking read stay allowed, because neither adds content;
   - the demo trip (ADR-031) is refused by every chat route, explicitly: the seam answers the demo
     as a viewer, which must not read as "may post";
   - a removed member is refused from their next request, because every request re-reads access.
4. **A delete is soft.** An author edits or deletes their own message and the owner deletes any.
   A deleted message keeps its row and is served as *"message removed"*, with no text. A report of
   a message joins `content_reports` (relaxed by migration `0050`), and the admin's hide and restore act on the row, not on
   anything evented.
5. **A deleted trip hides its chat.** `TripDeleted` is reversible (ADR-016), and ADR-016 defines
   no retention, so the chat is neither purged nor kept on its own clock: while the trip is
   deleted, every chat route answers as for a trip that is gone, and `TripRestored` brings the
   conversation back unchanged. The access seam serves a deleted trip with `status: "deleted"`
   rather than refusing it, so the chat routes check the status themselves.
6. **Who is online rides the same poll, and is neither chat nor an event** (M46 decision 7). It
   belongs here because it is this decision's construction a second time: state about the people
   on a trip, kept beside the stream, served on the events poll, no new transport.
   - A per-member **last-seen** row for the trip (`trip_presence`: trip id, user id, `seen_at`),
     on the ADR-025 no-foreign-key terms. The events poll is the heartbeat: a poll from a member
     writes their `seen_at` **only when it is 5 minutes old or more**, as one conditional upsert,
     so a member costs at most one write per 5 minutes however many tabs poll every 2 s.
   - The poll serves `online`, the ids of **current members** seen within the last **6 minutes**
     (one heartbeat and a margin for a late poll). It is read joined to the effective member
     list, so a removed member stops appearing once their membership row is gone, whatever their
     last-seen row says.
   - It is coarse, about 5 minutes, by design: *online* means the trip page was open and visible
     (the poll runs only in a visible tab) within the window, not this second. A closed tab reads
     as online for up to the window.
   - It moves neither `chatRev` nor the event log, and the demo trip has none. A failure to read
     or write it costs one poll its `online` field, never the events.

## Consequences

- Undo, replay and the projection-rebuild golden test never see chat. An integration test pins
  this: the trip's event log is identical before and after a conversation.
- A message's link to a day or stop is an id, not an event reference. When the target is deleted
  the message is unchanged and the link renders as plain text; nothing is repaired.
- The events poll gains a third optional revision. It costs one primary-key read per poll, as
  `accessRev` does. Presence adds one indexed read per poll and, per member, one write per
  5 minutes.
- Unread counts are computed at read time from the cursor and the messages. Home does not poll,
  so its count is as fresh as Home's own load.
- No public API endpoint now (`docs/guidelines/using-the-api.md`, *Features ship before their
  endpoints*): each chat route has a `planned` line in `server/public-api/exposure.ts`.
- Email and push are not decided here. They would read the same cursor.

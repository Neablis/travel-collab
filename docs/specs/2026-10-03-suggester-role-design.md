# A member who can suggest: the `suggester` role

**Status:** Design approved by Mitchell, 2026-10-03. Plan:
`docs/plans/2026-10-03-suggester-role.md`. Decision recorded in **ADR-063**. Not on a milestone:
Mitchell asked for it directly while M19 is current.

Mitchell's ask: a trip-member role between viewer and editor whose holder can propose changes
to the trip, which an editor or the owner approves before they take effect.

Facts below were checked against `main` at `cffddee`.

---

## 1. Where things stand

- **Roles** are `TripRole = ["viewer","editor","owner"]` (`packages/contracts/src/trip.ts:330`)
  and `InviteRole = ["viewer","editor"]` (`access.ts:15`). Stored as `text`, so no enum
  migration is needed for a new value. Rank lives in `server/accessPolicy.ts:11` and again in
  `server/access/members.ts:17`.
- **Every batchable command needs `"editor"`** (`accessPolicy.ts` `MINIMUM_ROLE`), checked per
  command type in `loadAndAuthorize` (`server/commands.ts:133`) against the actor.
- **The client is binary.** `TripProvider.tsx:356` sets `readOnly = myRole === "viewer"`, and the
  same literal appears in `SettingsSheet`, `NotebookScreen`, `PageScreen`, the invite email and
  both invite landing screens.
- **The optimistic queue** (`context/optimistic.ts`) holds `PendingUnit { id, commands,
  predictedDetail, description }`. `TripProvider` drains it to the server one unit at a time and
  flushes it with `keepalive` on `pagehide`.
- **The assistant's proposals (ADR-022) are ephemeral by decision.** `handleAskRequest.ts`
  records "no table, no migration". Nothing server-side holds a change that has not happened.
- **`Origin`** (`contracts/src/history.ts:6`) is `user | undo | redo | revert`. It is stored as
  jsonb on `events`. `packages/domain/src/trip/history.ts` switches on it twice: the undo stack
  and the history sentence.
- **Realtime is a 2-second poll** of `GET /api/trips/:id/events?after=` (`context/broadcast.ts`).
  It carries events only.

## 2. Decisions (approved)

1. **Name: `suggester`, shown as "Can suggest".** "Propose" is taken: it is the assistant's
   effect level and posture. "Pending" is taken too, as a stop kind and an invitation status.
   Rank: viewer < suggester < editor < owner. It is added to `TripRole` and `InviteRole`.
2. **Board only.** A suggester can suggest any `BatchableCommand` edit. The notebook and the
   assistant stay read-only for them, exactly as for a viewer.
3. **Authoring is the editor's board, held back.** A suggester edits the board as an editor
   does. Each edit lands in the existing optimistic queue and is **not sent**. A tray reads
   "N changes not sent" and offers **Discard** and **Send suggestion** (with an optional note).
4. **Review is inline.** Ghost stops appear on the board, visible to their author and to
   editors and the owner, never to viewers. Accept or dismiss is **per change**. A *suggestion*
   is the group of changes sent together. A header chip shows the pending count. It lists the
   changes that have no stop to sit on (name, dates, currency, budget, removing a day) and the
   ones that no longer apply.
5. **Storage is a separate CRUD module, not events.** Pending suggestions live in their own
   tables (a migration). They are not on the trip's stream, because a pending suggestion is not
   planning state until it is accepted (**ADR-063**). `AGENTS.md`'s module map gets a row.
6. **Accepting replays the commands** through `executeTripCommandBatch` with the reviewer as the
   actor and a new `Origin` kind, `suggestion`, carrying the suggestion, the change and the
   author. The change row is marked accepted in the same transaction, through the existing
   `alsoInSameTransaction` hook.
7. **Defaults:**
   - A change that depends on another pending change cannot be accepted first. The ids it
     depends on come from `AddDay.dayId`, `AddActivity.activityId` and
     `SetTripDates.newDayIds`. Dismissing the parent dismisses its dependents.
   - A change whose target is gone shows as "no longer applies".
   - The author can withdraw a change.
   - Notification is the header count only, with no email.
   - A member's role cannot be changed in place. Re-invite, as for editors today.
   - No `/api/v1` endpoints for suggestions. The new routes go in `exposure.ts` as `planned`.
   - A collaboration lapse caps a suggester to viewer, as it does an editor today.

## 3. Working decisions (made while designing; Mitchell had not seen these)

These were not part of the approved design. They are recorded here so they can be overturned
cheaply.

| # | Decision | Why | Alternative not taken |
|---|---|---|---|
| W1 | **A change is one `PendingUnit`** (its `commands[]`), not one command. | A unit is one gesture: a drag that moves and retimes is one unit. Splitting it would let a reviewer accept half of a gesture. | One command per change: finer, but it can leave a stop half-moved. |
| W2 | **The server writes the sentence**, with `predictBatch`'s description (`describeUserBatch`), at creation, against the head it was checked on. | It is the same wording the history panel uses for the same commands once accepted. The handoff named `describeProposedChange` (`ai/writeTools.ts`), but that describes one command, and a change is a unit (W1). | Client-sent text: the client's word would be trusted for something the reviewer acts on. |
| W3 | **`DismissConflict` cannot be suggested.** The client never offers it in suggest mode, because conflict Dismiss is behind `readOnly` (W8). The server still refuses a unit that contains one, as defence in depth. | Dismissing a warning is a judgement on the trip as it stands. Its target conflict may not exist when the change is reviewed. | Allow it: a suggestion that only hides a warning is noise for the reviewer. |
| W4 | **Every unit is dry-run at creation**, in order, against the current head. A unit that does not apply is refused with 422 and its index, and nothing is stored. | A suggestion that is already broken when sent wastes a reviewer's turn. The author's draft was predicted against what they saw, so the head may have moved. | Store it and let the reviewer see "no longer applies" at once. |
| W5 | **Ghosts come from a pure client overlay function** (`lib/suggestionOverlay.ts`). For each pending change, in creation order, it predicts the change with `@tc/predict` on the confirmed detail plus every pending change it depends on, then diffs the result. A failed prediction is "no longer applies". | It is the same prediction the optimistic queue already trusts, on the client, with no projection of unapplied state on the server. | A server-computed preview: a second read model of state that does not exist. |
| W6 | **Live refresh is an opaque `suggestionsRev` on the events poll response.** It is role-scoped: a suggester's covers their own changes; an editor's or owner's covers all. It is omitted for viewers and for invite-token or demo reads. The client refetches the list when it changes. | It rides the poll that already runs every 2s. A second poll would double the requests. The value is a hash, so it leaks nothing about other members' activity. | A separate poll: twice the requests. |
| W7 | **An unsent draft is lost on reload in v1.** The `pagehide` keepalive flush and the unmount drain do not run for a suggester. | Flushing would send a suggester's edits as commands, which the server refuses. That loses them anyway, noisily. Persisting a draft is a separate feature. | Persist the draft in localStorage: more state to reconcile against a moving head. |
| W8 | **One helper decides what a role may do on the board**: `boardMode(role)` → `"read" \| "suggest" \| "write"`, plus `canEditNotebook(role)`, in the existing `lib/tripRole.ts`. Every literal `role === "viewer"` client check moves onto it. `RANK` is exported from `accessPolicy.ts`, and the copy in `access/members.ts` is deleted. **Amended after review (PR #304):** the context's existing `readOnly` keeps meaning "may not write directly". It becomes `boardMode !== "write"`, so it is true for a suggester. Surfaces opt *in* to suggest mode one by one, through a new `canEditBoard` (`boardMode !== "read"`): the board, the activity editor, and the trip fields in Settings. Everything else stays behind `readOnly` and stays hidden for a suggester: Share, creating a notebook, adding a saved day, conflict Dismiss, and undo/redo. | Inserting a middle rank silently mis-gates every literal comparison. One place to change is the fix. Defaulting closed means a control nobody audited is hidden, never offered and then refused with a 403. | Patch each literal: the next role repeats the audit. Open `readOnly` to suggesters: every editor-only control would show and then 403. |
| W9 | **Dependencies are within one suggestion only.** Ghosts are not editable, so a draft can only reference ids it created itself. `dependsOn` is computed by the server at creation. | The ids a later unit references can only come from an earlier unit of the same draft. | Cross-suggestion dependencies: reachable only if ghosts were editable, and they are not. |
| W10 | **Accept = the change's commands as one batch**, `expectedSeq` unset. A rejection answers 409 `no-longer-applies` and leaves the row pending. The reviewer dismisses it. A double accept loses the conditional `UPDATE … WHERE status = 'pending'`, throws inside the hook, and rolls the batch back. | It is the same pipeline every edit takes (Invariant 1). Accepting is a decision by the reviewer, so it should not silently become a dismissal. | Auto-dismiss on failure: it hides the reason from the person deciding. |
| W11 | **An accepted change is an ordinary undoable batch.** `history.ts` treats `suggestion` like `user`. Its sentence is the user sentence. The UI prefixes "Suggested by <name>" from `origin.authorId`. | Undo works the way it does for every other edit. The domain knows ids, never names. | A non-undoable acceptance: surprising, and with no reason. |
| W12 | **A removed member's pending changes stay reviewable.** A suggester capped to viewer by a lapse keeps theirs too. | Removing a person is not the same as rejecting what they asked for. The reviewer still decides. | Cascade-dismiss on removal: it loses work the reviewer might want. |
| W13 | **A suggester has no undo/redo and no partial discard in v1.** Discard drops the whole draft. | Undo and redo are history commands, which need `"editor"`. A per-unit "remove" is a follow-up if Mitchell wants it. | Pop the last unit: cheap, but it is a new interaction nobody asked for. |
| W14 | **One route per collection.** `GET`/`POST /api/trips/:id/suggestions` lists and creates. `POST /api/trips/:id/suggestions/changes/:changeId` takes `{ action: "accept" \| "dismiss" \| "withdraw" }`. | That is two `exposure.ts` lines, not four. | A route per verb. |
| W15 | **"Suggested by" names come from the trip's member profiles** (`TripMemberProfile`, which the Travelers panel already fetches). An author who is no longer a member reads "Suggested by a former traveler". No name is stored on the event or the row. *(PR #304 review: the history DTO carries no names.)* | It uses data the reader is already authorized to see, and adds no new name-resolution route. A former member's name is not something the trip still owes its readers. | Store the display name on the change row or the origin: it goes stale when the person renames, and it copies personal data into the log. |
| W16 | **The poll reports a revision change on its own callback.** `useTripBroadcast` gains `onSuggestionsChanged(rev)`. It fires when `suggestionsRev` differs from the last value it saw, whether or not `headSeq` moved. *(PR #304 review: today's poll only calls back when `headSeq` advances, so a revision-only change would be dropped.)* | A suggestion changes no planning event, so `headSeq` stays still for exactly the changes W6 exists to announce. | Bump `headSeq`: suggestions are not events (ADR-063). |
| W17 | **The note reuses `review.ts`'s `boundedNote(500)`**: it trims, counts code points, and turns a blank note into `null`. *(T1)* | It is one rule for a free-text note, already tested. | A new bound: the same rule written twice. |
| W18 | **The DismissConflict refusal sits on each unit, not on the whole input.** Its error path is `["units", i, "commands", j]`. *(T1)* | The error names the exact command. | A whole-input refine: the error points at nothing. |
| W19 | **Public API document → 1.4.0.** The v1 trip schemas carry the role and origin enums, so `openapi.json` was regenerated with a minor bump under `openapi.ts`'s procedure. No `/v1` endpoint is added (§2.7 holds). A strict client that rejects unknown enum values could notice; the repo's rule calls this additive. *(T1)* | `openapi.test.ts` fails on a stale document, correctly. | Keep the v1 enums narrower than the contracts: two definitions of a role. |
| W20 | **Between T1 and T3, a suggester invite can be created through the API, but the picker can't offer it yet.** Such a member has viewer-level access (`MINIMUM_ROLE` is unchanged), and the email uses the viewer's wording until T3. *(T1)* | It is transient within this branch, and it fails closed. | Hold `InviteRole` back until T3: the contracts step would no longer be one step. |
| W21 | **An unknown role leaves the board live.** `TripProvider` and `SettingsSheet` use `myRole === null ? "write" : boardMode(myRole)`, while `boardMode(null)` itself answers "read". *(T2)* | A failed access read must not lock an owner out of their own trip. That was a reviewed decision (`docs/reviews/2026-08-28-m11-pr71-review.md` §5), and the server still refuses whatever the role does not allow. | `boardMode(null) === "read"` straight through: it would reverse that review. |
| W22 | **`canEditNotebook` is its own rule (editor or owner), not `boardMode === "write"`.** *(T2)* | Notebook rights and board rights can diverge for a future role. | Derive it: it couples two surfaces that have no reason to share a rule. |
| W23 | **`PageScreen`'s local `"viewer"` state value becomes `"reader"`.** It now covers a suggester too. *(T2)* | No literal `"viewer"` check is left to mislead the next reader. | Keep the name: it would be wrong for one of the two roles it covers. |
| W24 | **The Travelers badge shows the role word, "suggester", like its neighbours ("owner", "editor", "viewer").** "Can suggest" is the picker's label (`roleLabel`, which covers `InviteRole` only, since the owner is never offered). *(T3; the main thread reverted T3's "Can suggest" badge.)* | One badge reading "Can suggest" beside "owner" and "editor" reads as a different kind of thing. Relabelling all of them is a separate copy change, and `e2e/m11-invites.spec.ts` asserts the current words. | Relabel every badge "Can …": a copy change across a finished milestone's e2e, outside this feature. |
| W25 | **Create refuses a command naming another trip** (`invalid`). *(T4)* | Accepting takes the trip from the commands. Without this guard a suggester could have a change run on another trip with the reviewer's rights. Breaking the guard deliberately confirmed such a draft was stored. | Trust the route's trip id: the stored commands carry their own. |
| W26 | **Who is told `not-found` and who `forbidden`.** A non-member always gets `not-found`. On resolve, the role check runs before the change is looked up, so a viewer learns nothing about change ids. A suggester withdrawing someone else's change gets `not-found`; an editor doing the same gets `forbidden`. *(T4)* | Refusals never confirm that a row exists to someone who cannot see it. | Uniform `forbidden`: it confirms ids. |
| W27 | **Withdraw needs the author and an effective role of at least `suggester`.** A suggester capped to viewer by a lapse cannot withdraw, and their changes stay reviewable (W12). *(T4)* | A lapse caps every write. Withdraw is a write. | Let the author withdraw regardless: a write that bypasses the lapse cap. |
| W28 | **Dismissing or withdrawing gives pending dependents the same status, after the named change's conditional update wins.** Losing that race answers `already-resolved` with nothing written. *(T4)* | One decision, and it is exactly-once. | A separate "cascaded" status: one more state for nobody. |
| W29 | **Pipeline refusals on accept.** `forbidden` maps to `forbidden`. Every other refusal (`no-op`, a persistent concurrency conflict, a domain rejection) maps to `no-longer-applies` with the pipeline's message, and the row stays pending (W10). *(T4)* | The reviewer sees why, then decides. | Distinct codes per refusal: the UI does the same thing for all of them. |
| W30 | **The change → suggestion foreign key (with cascade) is the schema's first FK.** It stays inside one module. ADR-025's no-FK rule concerns `users`. *(T4)* | A change row without its suggestion means nothing. | No FK, as elsewhere: orphans with no owner. |
| W31 | **`suggestionsRev` is the first 16 characters of a base64url sha256 over the sorted `id:status` pairs.** The list returns the same value, so the list and the poll agree. *(T4)* | It is opaque and stable, and it changes on any resolution. | A max timestamp: two changes in one millisecond would look the same. |

## 4. Shape

### Contracts (`packages/contracts/src/suggestion.ts`, new)

```ts
SuggestionChangeStatus = enum["pending","accepted","dismissed","withdrawn"]
SuggestionChange = { id, suggestionId, tripId, authorId, note: string|null, createdAt,
                     commands: BatchableCommand[], description, status, dependsOn: uuid[],
                     resolvedBy: string|null, resolvedAt: string|null }
TripSuggestionsResponse = { changes: SuggestionChange[], rev: string }
CreateSuggestionInput = { units: { commands: BatchableCommand[] (1..50) }[] (1..100),
                          note?: string (≤ 500) }
ResolveSuggestionChangeInput = { action: "accept" | "dismiss" | "withdraw" }
```

There are three more changes. `Origin` gains `{ kind: "suggestion", suggestionId, changeId,
authorId }`. `TripEventsPage` gains an optional `suggestionsRev: string`. `TripRole` and
`InviteRole` gain `suggester`.

### Storage (`apps/web/drizzle/0035_trip_suggestions.sql`)

- `trip_suggestions`: `id`, `trip_id`, `author_id`, `note`, `base_seq` (the head it was checked
  against), `created_at`.
- `trip_suggestion_changes`: `id`, `suggestion_id` (FK, cascade), `trip_id`, `position`,
  `commands` jsonb, `description`, `depends_on` jsonb, `status`, `created_at`, `resolved_by`,
  `resolved_at`. Indexed on `(trip_id, status)`.

### Server (`apps/web/src/server/suggestions/`, new module)

- **`createSuggestion`**:
  - Requires the role to be exactly `suggester`. An editor writes directly.
  - Refuses `DismissConflict` (W3).
  - Dry-runs each unit (W4), computes `dependsOn` (W9), and writes the sentence (W2).
- **`listSuggestionChanges`**: a suggester gets their own changes. An editor or the owner gets
  all of them. A viewer gets 404.
- **`resolveSuggestionChange`**:
  - Accept and dismiss need `editor`. Withdraw needs the author.
  - Dependency checks: an accept refuses while any `dependsOn` change is not accepted. A dismiss
    or withdraw cascades to pending dependents.
- **`suggestionsRevFor(tripId, viewer)`**: returns the hash for the events poll (W6).
- **The pipeline change**: `executeTripCommandBatch` gains `options.origin`, defaulting to
  `{ kind: "user" }`. Invariant 1 is untouched, because suggestions never write a projection.

### Client

- `lib/tripRole.ts` gets `boardMode` and `canEditNotebook`.
- `TripProvider` in suggest mode:
  - It holds the queue instead of sending it.
  - It exposes `draft: { count, discard(), send(note) }`.
  - It skips the `pagehide` flush and the unmount drain.
- `useTripSuggestions` fetches the list and refetches whenever `suggestionsRev` changes.
- `lib/suggestionOverlay.ts` is the pure overlay (W5). It produces ghost annotations per
  activity, the chip list and the set of changes that no longer apply.
- Board surfaces:
  - **`SuggestionTray`**: the author's unsent draft.
  - **`SuggestionsChip`**: the header count and list.
  - **Ghost rendering** in `DayRiver`/`Column`, with accept and dismiss per change.
- The invite picker gains "Can suggest". The email and both landing screens get a third wording.

## 5. What a person clicks to see it

On the preview:

1. The owner opens a trip, then Settings → Travelers, and invites as **Can suggest**.
2. A second account follows the link.
3. That account drags a stop. The tray reads "1 change not sent". They press **Send
   suggestion**.
4. The owner's board shows a ghost stop and "1 suggestion" in the header. **Accept** moves the
   stop. History reads "Suggested by …".

This is the e2e flow beside `e2e/m11-invites.spec.ts`.

## 6. Out of scope (v1)

- Persisting the draft (W7).
- Notifications beyond the count.
- `/api/v1` endpoints.
- Changing a member's role in place.
- Suggesting in the notebook.
- Assistant-authored suggestions.
- Editing a ghost.

# Who is travelling, and a People panel you can read

**Status:** Approved, 2026-10-05: every decision in §3 as recommended. Built, and tracked as
**M35** (`docs/milestones/M35-travellers-and-people.md`), minted the same day after the build.
Plan: `docs/plans/2026-10-05-travellers-and-people-panel.md`. Recorded as **ADR-065**
(amends ADR-060 decision 2). Source: the candidate *"Choose who on a trip is actually
travelling"* (`docs/candidates.md:120`), plus the ask to redesign inviting, the member list and
revoking, with a visible owner state.

Facts below were checked against `main` at `d64e8c6`.

---

## 1. Where things stand

**Travellers.**
- Every member is a traveller today. `stopHeadcount(activity, memberCount)`
  (`packages/contracts/src/costs.ts:23`) returns the distinct `participants`, or every member when
  that list is empty. `stopPeople` (:53) and `balances` (:99) use the same rule. ADR-060 decision 2
  says this explicitly: "empty = all members, viewers included".
- The member count reaches costs at read time. `overlayMembers` → `recostDetail(detail,
  members.length)` (`server/access/overlay.ts:19`) runs over `effectiveMembers()`
  (`server/access/members.ts:122`). The decider gets `DecideContext.memberCount`
  (`commands.ts:194`). Shares compute `travellerCount = members.length` (`shares.ts:171`).
- The cost of this: a suggester who joined to advise doubled #314's per-person total, from
  $9,130 to $18,260.

**Membership.**
- Membership is Access data, kept as CRUD rows (ADR-003, ADR-026). `trip_memberships(trip_id,
  user_id, role, invited_by, created_at)` and `trip_invites(… role, token, status, …)`
  (`schema.ts:393-434`).
- The **owner has no membership row**. The owner is `TripCreated.createdBy`, projected as
  `members[0]` with `role: "owner"` (`domain/src/trip/evolve.ts:39`). There is exactly one owner
  and no transfer.
- Roles cannot change in place: you revoke and re-invite (suggester spec W-row, `members.ts:209`).
- `DELETE /api/trips/:id/members/:userId` (owner only, the owner themselves refused) exists but
  has **no UI and no client**.

**The UI.**
- `TravelersPanel.tsx` (403 lines) is the only surface. It sits inside `SettingsSheet` under
  "Who is invited", and its own header comment says it was built to be redesigned. SPEC §8 lists
  "Travelers UI" as deliberately not designed.
- It looks crowded for these reasons:
  - The invite form is always shown inline: email input, role select, a full-width button and a
    helper sentence come before any list.
  - Each pending invite row puts five things on one line in a narrow rail: the email (truncated),
    a raw-enum badge, a redundant "Waiting", "Copy link" and "Revoke".
  - Members show only a name and a raw-enum badge (`owner`, `editor`). There is no avatar, no
    "you" and no controls.
  - The role words disagree. Badges say `editor`; the picker says "Can edit".
  - The gate note, the lapse banner and the disabled form can all stack up.
  - The ShareButton below it adds a second list of copyable links that does something different
    (pinned read-only snapshots).
  - Everything is `text-xs`, with no hierarchy between the sections.
- The owner appears only as a `brand` badge reading "owner".
- **KI-2026-10-04-b:** the panel does not notice an invite accepted while it is open. Accepting
  writes no trip event, and the panel does not listen to the poll.
- **Primitives:** there is no `Avatar` or `Menu` in `components/ui/`. Initials avatars are
  hand-rolled in `InviteLandingScreen.tsx:194-231`, and Radix has only dialog, popover and tabs
  installed. The design file has a target row (26px moss avatar, name, slate role text, ghost
  Remove) at `Trip Planner Redesign.dc.html:4569-4597`.

## 2. The proposal in one paragraph

Travelling becomes a **per-person Access attribute**. It is CRUD and overlaid at read time, in the
same place and way as the member count already is. Per-person costs, the default "everyone" of
*Who is in*, the even split in balances, and "N travellers" all count **travellers** instead of
members. The Travelers panel is replaced by a **People** section with three readable groups:
*Travelling*, *Not travelling* and *Invited*. Each row has one avatar, one name, one plain-words
role line and one control: a `⋯` menu. Inviting moves into a dialog. The owner reads as
"Owner · created the trip" with a crown mark, and "You" marks your own row.

## 3. Decisions (approved 2026-10-05)

| # | Decision | Recommended | Why / alternatives |
|---|---|---|---|
| D1 | **Where "travelling" lives** | **Access (CRUD), not an event.** New table `trip_travellers(trip_id, user_id, travelling bool, updated_by, updated_at)`. A missing row means travelling. | ADR-060 d4 already computes totals at read time *because* membership is Access data, so a traveller count is the same kind of input as `members.length`. Putting it in the log would mean the planning log knows who is invited, which breaks the AGENTS.md module map and invariant 1 (half-evented). The cost is that History does not show "Sam is no longer travelling". A separate table, not a column, because the owner has no `trip_memberships` row and `trip_summaries` is a projection (rebuild = stored). |
| D2 | **Default for existing members** | **Travelling.** No data migration, so totals do not move on deploy. | The alternative, backfilling suggesters and viewers to not travelling, silently changes live totals. |
| D3 | **Default for a new invite** | Chosen **on the invite**, with the toggle preset by role: *Can edit* → travelling; *Can suggest* and *Can view* → not travelling. The accept writes the row. | This fixes #314's case without a second step, and the owner can flip it before sending. The alternative, always travelling, needs a fix-up after every advisor joins. |
| D4 | **Who can change it** | The **owner** for anyone, including themselves. **Each member for themselves** ("I'm not going after all"). Editors cannot change it for others. | It is about the person, and the owner pays. The AccessPolicy seam gets one rule (`setTravelling`). |
| D5 | **The owner can be not travelling** | **Yes** (a parent planning a kids' trip, or an organiser). Totals floor at 1 person, the same as `max(memberCount,1)` today. | — |
| D6 | **Explicit *Who is in* picks of someone later marked not travelling** | **The pick stands and counts.** Explicit beats default. The editor shows that chip with a "not travelling" tag, the way departed members show now (`ActivityEditor.tsx:183`). The picker lists travellers first and non-travellers under "Not travelling". | Removing picks would rewrite planning state from an Access change, which is the boundary smell. People sometimes join a single dinner. |
| D7 | **Booked by** | **Any member**, travelling or not. | A non-traveller can pay (a parent, an office). Balances still split only across travellers when nobody is picked. *(The candidate entry said "Booked by counts only travellers". This proposes the opposite, so please confirm.)* |
| D8 | **Role change in place** | **In scope.** The owner gets "Change role…" in the row menu, backed by a new `PATCH …/members/:userId {role}`. | Revoke-and-re-invite is the workaround that makes the current panel feel clumsy. It is Access CRUD, so there is no event. It still never grants `owner`. *Could be split out if you want this smaller.* |
| D9 | **Ownership transfer** | **Out of scope.** The owner comes from `TripCreated.createdBy`, so a transfer is a log change (an event plus a billing-subject change). It would be a candidate of its own. | — |
| D10 | **Where People lives** | It stays in Trip settings as its own section heading, **and** the trip header gets an avatar stack, which opens the sheet scrolled to People. | SPEC §8 says Travelers is reachable only from settings, so the avatar stack is a design change and goes through the design sync. It can be dropped and the rest still stands. |
| D11 | **Realtime** | Add `accessRev` to the events poll page, the same way ADR-064 added `suggestionsRev`. Toggling travelling, accepting, revoking or removing bumps it, and clients re-read access and recost. | Without it, a toggle changes totals only for the person who toggled. **This also resolves KI-2026-10-04-b.** |

## 4. The People section (UI)

```
People · 4                                         [ + Invite ]
Costs are split across 3 travellers.

TRAVELLING · 3
 (MW)  Mitchell W.  You                                   ⋯
       Owner · created the trip  ♛
 (SK)  Sam K.                                             ⋯
       Can edit
 (JL)  Jo L.                                              ⋯
       Can suggest

NOT TRAVELLING · 1
 (AR)  Alex R.                                            ⋯
       Can suggest · helping plan

INVITED · 2
 (✉)   priya@example.com                                  ⋯
       Can edit · will travel · sent 2d ago
 (🔗)  Link invite                                        ⋯
       Can view · sent today
```

- **One control per row.** A `⋯` menu holds the actions for that row, and you see only what you
  may do:
  - Members (owner's view): *Mark as not travelling* / *Mark as travelling*, *Change role…*
    (D8), *Remove from trip…*
  - Your own row: travelling toggle, *Leave trip…* (not offered to the owner).
  - Pending invites: *Copy invite link*, *Revoke invite…*
- **Plain-words roles everywhere.** "Owner · created the trip", "Can edit", "Can suggest",
  "Can view". No raw enums.
- **The owner state.** The owner always sorts first, with a crown glyph and the subline
  "Owner · created the trip". The owner can never be removed or changed. Their menu shows only
  the travelling toggle.
- **Destructive actions confirm** in a small dialog that says what happens:
  - Revoke: "The link stops working. If they already joined, they lose access."
  - Remove: "Alex loses access. Stops they were picked for keep the pick."
- **Invite dialog** (`+ Invite`):
  - Email (optional).
  - Role as a segmented control with a one-line meaning under it.
  - A "Coming on the trip" switch, preset per D3.
  - Primary button: **Create invite**.
  - The success state shows the link with Copy, plus "Emailed to priya@…" when an email was
    given.
  - The gate (no `trip.collaborators`) replaces the button with the existing "See plans" card
    *inside* the dialog, so it no longer stacks in the panel.
- **Banners collapse to one.** At most one banner sits under the header (lapse *or* gate), never
  both.
- **Read-only links** (ShareButton) get their own sub-heading, "Read-only snapshots", below
  People with one line saying how they differ from invites. The behaviour does not change.
- **New primitives in `components/ui/`:**
  - `avatar.tsx`: initials avatar, the moss look from `InviteLandingScreen`, extracted and
    reused there.
  - `menu.tsx`: `@radix-ui/react-dropdown-menu` (new dependency; dialog, popover and tabs are
    already Radix).
  - Each one gets a `.design-sync/previews/*.tsx`.
- **Phone:** the same section in the same Sheet. Rows are `min-h-11` touch targets and the
  menu opens as a bottom-aligned menu.

## 5. What changes downstream (every surface the survey found)

There is one new contract helper, `travellerIds(members)`, and `TripMember` gains
`travelling: boolean` (lenient default `true`). Every `members.length` and `memberIds` used for
**pricing or headcount** switches to travellers:

- **Domain:** `costs.ts` (`stopHeadcount`, `stopPeople`, `balances`), `rollupCosts`,
  `recostDetail`, `budgetRule`, `DecideContext.memberCount` → `travellerCount`.
- **Server:**
  - `overlay.ts`, `trip-access.ts:271,309`, `commands.ts:144,194,203`, `shares.ts:164,171`,
    `demoTrip.ts:187`.
  - Both history-at-seq routes.
  - The MSW recost (`mocks/handlers.ts:58`).
- **Web:**
  - `lib/cost.ts` (`tripSpend`, `stopTotalLine`).
  - `ActivityEditor` (total line, the *Who is in* grouping, chips) and `ActivityEditorSheet`.
  - `TripHeader` BudgetChip, `SettingsSheet.committedLine`, `calendarCityCards`.
  - Home: `NextTripHero` and `TripCard` ("N travellers").
  - `SharedTripScreen`.
- **Notebook widgets (`packages/pages`):**
  - `costOfStops`, `single`, `rows`, `spendBreakdown`, `spendByDay`, `block`.
  - `balances`/`person.share`.
  - The widget context `people` gains `travelling`.
  - `widgetBind` person picker: all members, with travellers first.
- **Assistant (invariant 7, parity):**
  - `read.ts` tools report `travellers` alongside `members`.
  - The `COST_DOC` text and the `handleAskRequest` copy change "every member" to "every
    traveller".
  - `openapi.json`, plus one eval prompt in `live-set.json`.
  - The assistant gets **no** tool to change travelling, because it never edits Access.
- **Public API:** `GET /v1/trips/:id/members` returns `travelling`, and the totals' meaning
  changes. This is a **minor version bump** with a `docs/contracts/CHANGELOG.md` entry, because
  the meaning of `cost × headcount` changes for consumers.

**Unchanged:** the planning log, `participants`, `bookedBy`, History, undo, and every event
payload. A trip rebuilt from its log is byte-identical (invariant 2).

## 6. Out of scope

- Ownership transfer (D9).
- Per-stop "not joining" without opening the editor.
- Avatars and colours you choose (the separate 2026-10-04 candidate). The `Avatar` primitive
  built here is where that work would plug in.
- Notebook widgets on the invite-accept page (separate candidate).

## 7. Working decisions made during the build

| # | Decision | Why |
|---|---|---|
| W1 | `TripMember.travelling` is **optional**, not `.default(true)`. Only `travellerIds(members)` reads it, and it treats a missing value as travelling. The access overlay (T2) always sets it explicitly. | A parse-time default would make every `{userId, role}` literal in the domain fail to typecheck. It would also make a stored projection differ from its rebuild from the log (invariant 2). |
| W2 | Public API bumped to **1.6.0** in T1, not T3. | The generated `openapi.json` is fingerprint-checked by `pnpm check`. T3 updates the fingerprint again if it changes the document. |
| W3 | `balances(activities, memberIds, travellerIds)` takes the traveller ids as a **required** third argument. | So no caller can keep the old even split by accident. |
| W4 | **Open, low stakes:** when nobody is travelling and nobody is picked, `stopTotal` prices one person (D5) but `balances` charges nobody. The board total and "who owes what" then disagree. For now this is documented on `stopPeople`. | Only reachable on a trip where every member, owner included, is marked not travelling. |
| W5 | The access revision is a per-trip counter, `trip_access_revs(trip_id, rev)`. It is bumped inside the same transaction as each Access write: create invite, accept, revoke, remove or leave, set travelling, change role. `accessRevFor` reads it as an opaque string, and a trip with no Access writes yet reads "0". A billing lapse does not bump it, because that cap is applied on read. | Revoke and remove delete rows, and `max(updated_at)` over the remaining rows cannot see a deletion. Pending invites are in the People list, so creating one bumps it too. |
| W6 | When an accepted invite says travelling, accept also **clears** any leftover traveller row instead of only writing a "not travelling" row. | A `setTravelling` that overlaps a remove could otherwise leave a stale row, and the person would join with the wrong value. D3 says the invite's choice is what they join with. |
| W7 | `accessRev` is served to every non-demo reader of the events poll, and is not scoped by role. A `PATCH …/members/:userId` lists invites only when the caller is the owner. | Anyone the poll serves can already read the member list through `GET /access`. Without the owner check, a member setting their own travelling would receive every invite token. |
| W8 | **Gate.** In the invite dialog, a gated owner sees the form greyed out (`fieldset disabled`), and *See plans* replaces *Create invite*. The section's single banner is the gate note only when the owner is gated without a lapse. | §4 says the gate "replaces the button", and the 2026-09-15 ruling was to keep the UI greyed out. |
| W9 | **Lapse.** The lapse banner becomes a warning `Banner` with its own *See plans* action. | Hiding the gate note would otherwise remove the lapse case's only route to upgrade. |
| W10 | **Change role.** *Change role…* opens a small `RoleDialog` that reuses the invite's `RolePicker`. | The `Menu` primitive has no submenu. |
| W11 | **"Coming on the trip".** It is the existing `CheckboxField`. | `ui/` has no Switch primitive. |
| W12 | **Invite age.** It reads "sent 2 days ago" and similar, via `formatRelativeInstant`. "· will travel" shows only when it is true. | Uses the repo's one relative-time helper. |
| W13 | **"· helping plan".** It appears only for editors and suggesters who are not travelling, never for viewers. | A viewer is not planning. |
| W14 | **Zero travellers.** The line reads "Nobody is marked as travelling, so costs are priced for one person." | States D5's floor in plain words. |
| W15 | **Board refresh after your own change.** `PeopleSection` and `SettingsSheet` take `onAccessChanged`. T8 wires it to the provider's re-read. | `endWrite` only clears the cache, so nothing re-reads the trip after it. |
| W16 | **No second `people` field.** `WidgetContext.people` does not gain `travelling`. Widgets read it from `trip.members`, which the overlay always sets. | `people` comes from a different fetch and could disagree with the member list the totals were computed from. |
| W17 | **Shared helpers take the member list.** `costOfStops` and `calendarCityCards` apply `travellerIds` themselves. Home cards show only travellers' avatars, next to the "N travellers" label. | A bare count cannot be tested for the traveller rule, and a caller could pass the member count by mistake. The label should agree with the avatars beside it. |
| W18 | **Access on the provider.** The provider exposes the whole `TripAccess` plus `refreshAccess()`, rather than a revision counter. `PeopleSection` adopts each newer value after it mounts. | The header stack needs names. With the full object, nothing makes a second read. |
| W19 | **Seeing the revision.** The first `accessRev` seen is the baseline and refreshes nothing. A rev counts as seen only after its re-read succeeds, so a failed read retries on the next poll and leaves the last good access in place. A local write is re-read twice: once at once, and again when the poll sees the bumped rev. | Re-baselining after a local write could swallow a concurrent remote change. |
| W20 | **Header stack.** It shows travellers only, as 3 avatars plus "+N", hidden below `sm`. It renders nothing until access loads. It opens settings scrolled to `#people` through a callback ref. | On a phone the title row already wraps. Radix mounts the sheet content one render late, so an effect would fire too early. |
| W21 | **Home list.** `GET /api/trips` carries `travelling` from one batched query, which brings the request to 3 statements, still constant in the number of trips. | Home cards otherwise counted everyone. |
| W22 | **The baseline comes from the access read** (amends W19, KI-2026-10-05-g). `TripAccess` carries an optional `accessRev`. `GET /access` and the `PATCH`/`DELETE …/members/:userId` responses fill it from `accessRevFor`, read **before** the members and invites. `adoptAccess` takes it as seen on every read it adopts, at load and on each re-read. A first poll whose rev differs therefore re-reads, and a local write's re-read re-baselines. The first-poll baseline remains only as a fallback, for a read with no rev: the demo trip, or a failed rev read. A poll-triggered re-read that carried its own rev keeps it, rather than the polled one. | With the first poll as the baseline, an Access write between `load` and that poll was absorbed and never shown, as when an invite was accepted inside the first 2s. Re-baselining is safe here, though W19 feared it: a rev read before its list is never newer than the list, so a concurrent remote write still moves the poll's rev past it. A rev read after the list could hide a write made in between. |

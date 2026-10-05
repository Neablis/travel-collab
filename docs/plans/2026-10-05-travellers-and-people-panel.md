# Plan: who is travelling, and the People panel

Gate: `docs/milestones/M35-travellers-and-people.md` § *Exit gate*. The milestone was minted after
this plan was built (2026-10-05). Delete this file at M35's gate close (`docs/plans/README.md`).

Spec: `docs/specs/2026-10-05-travellers-and-people-panel-design.md` (decisions D1–D11, approved
2026-10-05). ADR-065. Checked against `main` at `d64e8c6`.

**How it runs.**
- Each task goes to one `phase-implementer` subagent and stays inside the files it lists.
- Every new test is seen red first. The report gives the source edit and the failure text
  (CLAUDE.md rule 3).
- Tier 2 checks per task use the `minimal-check-subset` output. T1 is a contracts change, so it
  runs `pnpm check`.
- Tier 3 (full suite and `test:e2e:ci-like`) runs once, at T9.
- **Shipping:** built on one branch (`ccr-d8e97d98-xyat7o`), one commit per task. The original split, kept as the review order:
  - **A** = T1–T3 (data and server). This one is behaviour-neutral, because everyone defaults to
    travelling.
  - **B** = T4–T5 (costs count travellers).
  - **C** = T6–T9 (the People panel).
  - B and C both build on A and can be reviewed in parallel. PR A carries migration 0039, so its
    body declares it under **Migrations**.

Decisions made during the build are appended to the spec as W1 onward. A decision that changes
an approved D-row stops the task and comes back to the main thread.

---

## T1 — Contracts (its own step; AGENTS.md Workstreams rule)

**Scope:**
- `packages/contracts/src/{trip.ts,access.ts,costs.ts,index.ts}`
- `packages/contracts/test/{trip,access,costs}.test.ts`
- `docs/contracts/CHANGELOG.md`
- The minimum consumer edits needed to compile.

**Content:**
- `TripMember` gains `travelling: z.boolean().default(true)`, and `TripMemberProfile` follows.
- `CreateInviteInput` gains `travelling?: boolean`, and `Invite` gains `travelling`.
- New `SetTravellingInput { travelling: boolean }` and `ChangeRoleInput { role: InviteRole }`.
- `TripEventsPage.accessRev?: string` (D11).
- `costs.ts`:
  - `travellerIds(members)`.
  - `stopHeadcount` and `stopTotal` keep their signatures but are documented as taking the
    **traveller** count.
  - `stopPeople` and `balances` take the traveller ids for the empty case.
  - `bookedBy` is still checked against all member ids (D7).

**Tests:**
- Literal and default round-trips.
- A `balances` property: a non-traveller is never charged an even share, but is charged when
  explicitly picked (D6).
- The floor is 1 when there are no travellers (D5).

## T2 — Storage and Access domain

**Scope:**
- `apps/web/src/server/db/schema.ts`
- `apps/web/drizzle/0039_trip_travellers.sql` and its snapshot and journal entry
- `server/access/{members.ts,invites.ts,travellers.ts(new)}` and their tests
- `server/accessPolicy.ts`

**Content:**
- `trip_travellers(trip_id, user_id, travelling, updated_by, updated_at)`, with PK
  `(trip_id,user_id)`. A missing row means travelling (D1, D2). `trip_invites.travelling boolean
  not null default true`.
- The migration opens with a `--` comment explaining why. Its `when` must be newer than main's
  (lint).
- `effectiveMembers()` left-joins `trip_travellers`, so every member carries `travelling`.
- `createInvite` stores the choice. `acceptInvite` writes a row when it is `false`, inside the
  same transaction.
- `removeMember` and `revokeInvite` delete the row.
- `setTravelling(tripId, actor, userId, value)`: AccessPolicy allows the owner for anyone and a
  member for themselves (D4).
- `changeRole(tripId, owner, userId, role)` (D8): never to or from `owner`, and it does not
  apply the lapse cap.
- An **access revision**: one `trip_access_rev` counter, or a `max(updated_at)` across the three
  tables. Whichever is cheaper to read on the poll is decided here and recorded as W1.

**Tests:** integration (`*.int.test.ts`) for each function, covering:
- accept with not travelling;
- self versus other authorisation;
- a member removed and then re-invited starts from the invite's choice.

## T3 — Routes and the public API

**Scope:**
- `app/api/trips/[tripId]/members/[userId]/route.ts` (adds `PATCH` for `{travelling}` | `{role}`)
- `invites/route.ts` (body `travelling`)
- `app/api/trips/[tripId]/events/route.ts` (`accessRev`)
- `app/api/v1/trips/[tripId]/{members,invites}/route.ts` and `openapi.json` (minor bump)
- `lib/apiClient.ts`: `setTravelling`, `changeMemberRole`, `removeMember`. **`removeMember` is new
  to the client; the route already exists.**

**Tests:** route integration tests and a client unit test. `trip-access.int.test.ts:307`
(nobody-picked total doubles when a member joins) stays green **unchanged**. That is the proof
that PR A is behaviour-neutral.

---

## T4 — Domain and server count travellers

**Scope:**
- `packages/domain/src/trip/{costs.ts,detail.ts,conflicts.ts,decide.ts}`
- `server/access/overlay.ts`, `trip-access.ts`, `commands.ts`, `shares.ts`, `demoTrip.ts`
- Both `history/[seq]` routes
- `mocks/handlers.ts`
- Fixtures and factories (`factories/src/trip.ts`, `rollups.ts`; `fixtures/src/japan/*`)

**Content:** `memberCount` → `travellerCount` throughout, with the value coming from
`travellerIds(effectiveMembers)`.

**Tests:**
- A new integration case: the second member joins **not travelling** and the nobody-picked total
  does **not** change. This is #314's regression.
- `over-budget.test.ts` with a non-traveller present.
- **See red:** revert `overlay.ts` to `members.length` and watch the new case fail.

## T5 — Every consumer surface

**Scope** (spec §5):
- `lib/cost.ts`
- `board/ActivityEditor.tsx` and `trip/editor/ActivityEditorSheet.tsx` (*Who is in* groups
  travellers first; the "not travelling" chip per D6; Booked by lists all members per D7)
- `TripHeader`, `SettingsSheet.committedLine`, `calendarCityCards`
- `home/{NextTripHero,TripCard}.tsx` ("N travellers")
- `access/SharedTripScreen.tsx`
- `packages/pages`:
  - `select.ts`, `single.ts`, `rows.ts`, `spendBreakdown.ts`, `spendByDay.ts`, `block.ts`,
    `balances.ts`
  - `registry-types.ts` `people`
  - `templates.ts` and `presets.ts` copy
- `editor/widgetBind.tsx`
- Assistant:
  - `assistant/tools/{read,widgets}.ts`
  - `ai/handleAskRequest.ts` copy
  - `COST_DOC` (`contracts/src/activity.ts:362`)
  - `ai/eval/live-set.json`

Each `*.test.*` listed in the survey gets one non-traveller case where the number would differ.
The `ai-usage` skill is not needed. **The eval set runs once (M33 tooling)**, because the
assistant's cost wording changed.

---

## T6 — Primitives

**Scope:**
- `components/ui/{avatar.tsx,menu.tsx}` (new) with their tests
- `.design-sync/previews/{Avatar,Menu}.tsx`
- `package.json` (`@radix-ui/react-dropdown-menu`)
- `access/InviteLandingScreen.tsx` (adopts `Avatar`; no visual change)

`.design-sync/**` is a build input, not prose (AGENTS.md DoD trap).

## T7 — People section

**Scope:**
- `components/trip/people/{PeopleSection,PersonRow,InviteRow,PersonMenu,ConfirmDialog}.tsx`
  (new), replacing `TravelersPanel.tsx`
- `components/trip/people/InviteDialog.tsx` (new)
- `SettingsSheet.tsx` (heading "People"; ShareButton moves under "Read-only snapshots")
- The tests that move: `TravelersPanel.test.tsx` and `TravelersPanel.inviteRoles.test.tsx` →
  `people/*.test.tsx`

**Content:** spec §4 exactly:
- groups: Travelling, Not travelling, Invited;
- the owner state, crown and "You";
- one `⋯` per row;
- confirms on revoke and remove;
- the invite dialog with the role-preset travelling switch (D3);
- one banner at most;
- "Costs are split across N travellers".

**Tests:** keep all 25 existing behaviours (rewritten against the new structure), and add:
- the owner row has no Remove;
- a self-row shows Leave;
- toggling travelling calls the client and recosts;
- revoking needs a confirm.

## T8 — Realtime and the header entry point

**Scope:**
- `context/broadcast.ts` and `TripProvider.tsx`: on an `accessRev` change, re-read access and
  recost.
- `PeopleSection` subscribes as well. **This resolves KI-2026-10-04-b.** Move its file to
  `resolved/` in this task.
- `TripHeader.tsx`: the avatar stack (D10). It opens `SettingsSheet` at `#people`.
- SPEC §8 and the design-sync handoff note.

**Tests:** a unit test that an `accessRev` bump re-reads access. **See red:** drop the
subscription and watch it fail.

## T9 — e2e and final review

**Scope:**
- `e2e/m11-invites.spec.ts` (the copy is now plain words)
- `e2e/suggester.spec.ts`
- `e2e/m11a-invite-gate.spec.ts`
- a new `e2e/travellers.spec.ts`

The new spec's journey: the owner invites a suggester (preset not travelling) → the invitee
accepts in a second context → the owner's per-person total is unchanged and the row sits under
*Not travelling* without a reload → the owner marks them travelling → the total doubles.

**Checks:**
- `pnpm check`
- `pnpm --filter web test:e2e:ci-like` (CLAUDE.md rule 1), on desktop, narrow and phone
- `phase-verifier` against the PR's Vercel preview

**Docs:**
- ADR-065.
- The ADR-060 decision 2 amendment line.
- The candidate entry at `docs/candidates.md:120` marked PLACED.
- STATUS line.

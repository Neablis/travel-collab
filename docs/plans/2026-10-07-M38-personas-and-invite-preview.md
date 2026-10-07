# M38 — personas and the invite preview: build plan

Gate: `docs/milestones/M38-people-you-can-tell-apart.md` § *Exit gate*. Decisions are numbered
there and cited here as D1–D6. Delete this file at M38's gate close (`docs/plans/README.md`).

## The stack

Five parts, each on its own branch, merged 1 → 5 with merge commits
(`docs/guidelines/stacked-prs.md`). All open as drafts. **Nothing merges without Mitchell.**

| Part | Branch | Theme | Tier |
|---|---|---|---|
| 1 | `claude/beautiful-dijkstra-mu237r` | M38 scoped (D1–D6 answered), this plan | 1 (prose) |
| 2 | `…-personas-server` | migration `0044` (avatar, colour, public-name opt-in); `UserPreferences` and `TripMemberProfile` gain them; `publicNameFor` honours the opt-in | 2 |
| 3 | `…-invite-preview-server` | the token-scoped read that builds widget inputs with costs stripped (D4, D6) | 2 |
| 4 | `…-personas-ui` | the picker on Account; one `PersonChip` that every person surface uses; per-trip colour clash resolution | 2 |
| 5 | `…-invite-preview-ui` | the invite page renders the shared widget components read-only; the wall rule; the e2e spec | 2, then 3 on the top |

**On the preview, what does a person click to see this?**
- Part 2: nothing. It adds columns and fields and has no screen, so its body says so.
- Part 3: nothing. It adds a route, so its body says so.
- Part 4: Account → Profile → pick an avatar and colour. Then open a trip and look at People,
  the header stack, a stop's *Who is in*, and History.
- Part 5: open an invite link while signed out, or as another account, before accepting.

**Reordered 2026-10-07:** the invite preview read was built while the persona UI waited on the
design canvas, so it is part 3 and the persona UI is part 4. The section headings below keep their
original numbers: *Part 3* below is the persona UI, and *Part 4* is the preview read.

**Each part is built by several subagents at once, one per workstream** (Mitchell, 2026-10-07:
*"many subagents per workstream of a part"*). The workstreams of a part merge into its branch.

## The design (approved before any UI is built)

Parts 4 and 5 change screens, so a design canvas goes to Mitchell before either is built, the way
M37's did. **The canvas: https://claude.ai/artifact/S5AsuePX2Yqqq8ifQWNoS1** (awaiting approval). It covers four things:
- the avatar set and colour palette on Account;
- a `PersonChip` at each size it renders;
- two travellers with the same colour on one trip (the gate's walk);
- the invite page on desktop and on a phone.

## What is true today

Surveyed 2026-10-07. Re-check the line numbers before trusting them. The app is under
`apps/web/src/`.

- **The display name already exists.** M17 added `users.display_name`
  (`server/db/schema.ts:50-76`) and `UserPreferences.displayName`
  (`packages/contracts/src/identity.ts:53-85`), and Account → Profile edits it
  (`components/account/ProfileSection.tsx`). So D2's new work is not the name:
  - **Trip surfaces never see it.** `TripMemberProfile` (`contracts/src/access.ts:82`) has no
    `displayName`, so every in-trip surface shows the OAuth `users.name`.
    `lib/displayName.ts:27-35` records this as a one-field follow-up. `withProfiles`
    (`server/access/members.ts:503-523`) already reads the whole `users` row.
  - **The public library shows the chosen name today**, with no opt-in:
    `server/playbooks.ts` (:186, :416, :876) calls
    `publicNameFor({displayName, name})`. D2 needs an opt-in column, and these three call sites
    pass `displayName` only when it is set.
- **There is no per-person colour or avatar.** `components/ui/avatar.tsx` takes a `tone` of
  `moss | info`, and its initials come from `lib/initials.ts`. Colours must be design tokens,
  because `scripts/check-color-wall.mjs` rejects raw colours.
- **Person surfaces, and where each gets its name from:**

  | Surface | File | Name comes from |
  |---|---|---|
  | People section | `trip/people/PeopleSection.tsx:292` | `TripAccess` |
  | Its rows | `PersonRow.tsx:40` | `TripAccess` |
  | Pending invites | `trip/people/InviteRow.tsx:40` | the invite (no account yet, so an icon) |
  | Header stack | `trip/TripHeader.tsx:612-640` | `TripAccess` |
  | *Who is in*, *Booked by* | `board/ActivityEditor.tsx:542,576` | `NamedMember[]` from `personNames` |
  | Suggestion authors | `board/SuggestionsChip.tsx`, `SuggestionActions.tsx:93-120` | `usePeople` |
  | History | `board/HistoryPanel.tsx:53,100` | `usePeople` |
  | Home cards | `home/TripCard.tsx:234`, `NextTripHero.tsx:264` | `TripSummary.members` (no name: handle initials) |

  `usePeople` (`components/pages/people.tsx:45-92`) is the client-side `userId → name` record, and
  it becomes `userId → Persona`.
- **A defect found on the way:** `trip/UnscheduledRack.tsx:483` prints *Parked by {userId}*. Part 3
  fixes it, because it is a person surface.
- **Invites never expire** (ADR-026:104). `trip_invites` has no `expires_at`. The gate's
  *"an expired or revoked token returns nothing"* is read as: revoked, or already accepted, returns
  nothing. The token stays the authority (ADR-026), and that is unchanged.
- **The invite landing** is `app/(front)/invite/[token]/page.tsx` → `access/InviteLandingScreen.tsx`,
  fed by `readInviteLanding` (`server/inviteLanding.ts:29`). Today it shows the inviter, counts,
  days or legs with cities, and the crew's first names.
- **"Have a look first"** (`invite/[token]/look`) mounts the whole `TripBoardScreen` read-only,
  with a synthetic viewer (`server/access/trip-access.ts:106-158`). **That shows stop costs, which
  D4 hides.** See *Open question* below.
- **Widgets** (ADR-035): `packages/pages/src/registry.ts` (`renderMacro`, `inputsFor`) over
  `WidgetContext` (`registry-types.ts:453`: `trip, page, user, globals, today, external, people`).
  `MacroView.tsx` and `editor/ReadOnlyPageDoc.tsx` feed them. D4 maps to existing widgets:
  - dates: `dates`, or the `trip.countdown` preset;
  - route: `trip.strip` and `city.rows`;
  - who is going: `person.share`, without its cost column;
  - the total: `cost`.
- **There is no map widget.** `components/playbooks/SharedDayMap.tsx` is the read-only map
  that public playbook days use. The invite page reuses it, and builds no new map.
- **Walls:** nothing forbids an invite-only widget today. Part 5 adds a `.dependency-cruiser.cjs`
  rule: nothing under `components/access/**` may define a macro. It may only import
  `@tc/pages`' renderers and `MacroView`.
- **The next migration is `0044`.** Merge `main` before taking the number.

## Open question for Mitchell (raised in part 1, needed before part 5)

**Does *Have a look first* keep showing the whole board?** It predates M38, and it shows every
stop's cost. That is exactly what D4 says an invitee should not see. *Recommended:* once the
preview exists, the look page renders the same cost-stripped preview, so there is one
pre-accept view. The alternative is to keep it as it is, and say so in D4.

## Part 2 — personas on the server

1. **Migration `0044_personas`** adds three columns to `users`:
   - `avatar` text null: a key from the fixed set (D1);
   - `color` text null: a key from the fixed palette;
   - `public_display_name` boolean, not null, default false (D2).
2. **Contracts**:
   - Add `AvatarKey` and `PersonColor` as Zod enums in `identity.ts`. They are keys, not URLs or
     hex values.
   - `UserPreferences` and `UpdateUserPreferences` gain all three fields.
   - `TripMemberProfile` gains `displayName`, `avatar` and `color`, each nullable with a default,
     for version skew.
   - Add a `CHANGELOG.md` entry. Bump `/v1` if `TripMemberProfile` is published there.
3. **Server**:
   - `readPreferences` and `writePreferences` handle the new columns.
   - `withProfiles` fills the new member fields.
   - The three `publicNameFor` call sites in `playbooks.ts` pass `displayName` only when
     `public_display_name` is true.
4. **Tests**:
   - A preferences route integration test round-trips the three fields.
   - A gate box: an integration test reads a public profile and a published day for a user with a
     display name who has not opted in, and finds only the sign-in name's short form. It is seen
     red against today's `playbooks.ts`.

## Part 3 — you can tell people apart

1. **A pure `personaFor(member, tripMembers)`** in `packages/domain` decides the colour for one
   trip (D3). Members are ordered by join time. The first to claim a colour keeps it, and a later
   joiner shifts to the next palette colour no one on the trip is using. The stored choice never
   changes. Unit tests cover a clash, a three-way clash, and a palette exhausted.
2. **`PersonChip`** wraps `Avatar`:
   - It takes a `Persona`: `{ name, avatar, color }`.
   - It renders the avatar glyph if one is chosen, else the initials, on the colour's token.
   - Every surface in the table above uses it, and `usePeople` returns personas.
   - The gate box is one `PersonChip` test, seen red with the old initials.
3. **Account → Profile** gains the avatar grid, the colour swatches, and the *show my display name
   on public pages* switch, through `useAccountPreferences`.
4. **Home cards** get personas: `TripSummary.members` gains the same three fields in one read, as
   M37 D5 requires.
5. **Fix** *Parked by {userId}*.

## Part 4 — the token-scoped read

1. `GET /api/invites/[token]/preview` returns a `TripPreview` contract:
   - dates;
   - days, with each day's city and stop titles and coordinates;
   - members as personas;
   - the trip total.

   It has **no** per-person amounts and no per-stop costs (D4). The type has no field that could
   hold them, so the leak cannot happen by forgetting a filter.
2. It resolves the token through `inviteByToken`. Revoked or accepted returns `410` with an empty
   body. An unknown token returns `404`.
3. **Gate box, as an integration test**: it asserts no cost key at any depth except the total,
   and that a revoked or accepted token returns nothing. It is seen red by adding a stop cost to
   the projection.

## Part 5 — the invite page shows the trip

1. A `previewContext(TripPreview): WidgetContext` adapter, the only invite-specific code (D6).
   The landing renders the fixed set (D5) through `MacroView`, read-only:
   - `trip.countdown`;
   - `trip.strip`;
   - `city.rows`;
   - `person.share`, without its cost column;
   - `cost`.

   Then `SharedDayMap` renders the stops' coordinates.
2. A depcruise rule: `components/access/**` may not import from `packages/pages/src/macros/**`
   internals or define a `MacroDef`. It is seen red by adding a stub widget there.
3. The look page follows the answer to the open question.
4. **The e2e spec, `m38-personas.spec.ts`**: set an avatar, invite someone, open the invite as
   them, see the trip, accept, and see the avatar in People. It passes on
   `pnpm --filter web test:e2e:ci-like`.
5. The `[walk]` box: two travellers with the same colour, on the top part's preview.

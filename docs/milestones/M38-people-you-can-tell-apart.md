# M38 — You can tell people apart, and see a trip before you join it

**Status:** **Gate closed 2026-10-08, 8 of 8** (retro at the end), as #356 → #360. Current from 2026-10-07, by M37's gate closing. **Scoped 2026-10-07**: all six
decisions below were answered as recommended. Build plan: `docs/plans/2026-10-07-M38-personas-and-invite-preview.md`. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*). It builds on M35: the `Avatar`
primitive (`components/ui/avatar.tsx`) and the People section are where both halves plug in.

## Why this exists

M35 made it possible to say who on a trip is going. It did not make those people easy to tell
apart. Mitchell, 2026-10-04: *"avatars and better personas for your account so you can see who's in
a activity or invited easier, they can select a avatar and a color, along with there custom name"*.

The invite-accept page is where someone decides whether to join, and it says little about the
trip. The same day: *"leveraging the notebook widgets for the accept joining trip page so it shares
code and tells you more about the trip before accepting"*. Both are about how a person meets a
trip and the people on it, so they are one milestone.

Candidates absorbed (each deleted by this gate):
- *Avatars and personas: a picture, a colour and a name you choose* (2026-10-04)
- *The invite-accept page uses notebook widgets to say what the trip is* (2026-10-04)

## Decisions (answered 2026-10-07: every one as recommended)

1. **Avatars come from a fixed set; there are no uploads.** *Recommended:* uploads bring storage
   and moderation, which the admin reports panel does not cover for images.
2. **A display name is separate from the sign-in name**, and it is what every trip surface shows.
   It falls back to the sign-in name. A public-library profile (ADR-061) shows the display name
   only if the user opts in, so a private name never leaks.
3. **Colour is personal, and a trip resolves clashes at render time.** *Recommended:* if two
   travellers on one trip chose the same colour, the later joiner's chip is shifted for that trip
   only. Their stored choice does not change. Requiring a unique colour per trip would make
   joining fail for a reason the joiner cannot see.
4. **What an invitee sees before accepting.** *Recommended:* dates, the route (days and cities),
   the map, who is going (display names and avatars), and the trip's total. Per-person cost and
   individual stop costs stay hidden, because costs are the sensitive part. The token holder is
   not a member yet (ADR-026), so the token is what authorises this read.
5. **The owner does not choose which widgets show**, at least at first. *Recommended:* one fixed
   set, so there is one code path. Owner choice can come later if anyone asks for it.
6. **How a widget renders without membership.** ADR-035 says a widget is a function of declared
   inputs. *Recommended:* a server read keyed on the invite token builds exactly those inputs, and
   the page renders the same widget components read-only. There is no invite-only copy of any
   widget.

## Scope

- Account preferences gain avatar, colour and display name, through a migration and a contracts
  change.
- Every place a person appears uses them: stop attendees, *Who is in*, *Booked by*, the People
  section, pending invites, the header avatar stack, suggestion authors, and History.
- `app/(front)/invite/[token]` renders a read-only trip slice with the notebook widgets, fed by a
  token-scoped read.

## Out of scope

- Uploaded photos as avatars.
- Ownership transfer (M35 D9).
- Trip chat (M46), which will reuse these personas.

## Exit gate

- [x] **Decisions 1–6 are answered and recorded here.**
      *(Ticked 2026-10-07: Mitchell accepted all six as recommended. Fixed avatar set, no uploads;
      display name opt-in on public pages; colour clashes resolved at render time per trip; the
      invitee sees no per-person or per-stop costs; one fixed widget set; a token-scoped read feeds
      the shared widget components.)*
- [x] **A person's avatar, colour and display name show on every surface listed under Scope.** A
      test per surface, or one test over a shared `PersonChip` they all use, was seen red with the
      old initials.
      *(Ticked 2026-10-07, part 4: one test per surface, each in that surface's own test file. The
      surfaces are People rows, the header stack, home cards and the hero, *Who is in*, *Booked by*,
      the editor sheet, suggestion authors, History's *Suggested by* line and the rack's *Parked
      by*. Each was seen red with the old initials, e.g. `expected '<span aria-hidden="true" …' to
      contain 'lucide-mountain'` (received `…>BO</span>…`). Pending invites keep their invited
      look, by the design.)*
- [x] **No private name reaches a public page**: an integration test reads a public profile and a
      published day for a user who has not opted in, and finds only the public name.
      *(Ticked 2026-10-07, part 2 (#357): `playbooks/board/route.int.test.ts` › *never shows a chosen
      name its owner has not opted in to publishing* reads the board, the profile, Discover and the
      published day's page. Seen red with the gate removed: `expected [ 'Pip Q.', 'Pip Q.', 'Pip
      Q.' ] to deeply equal [ 'Paula H.', 'Paula H.', 'Paula H.' ]`.)*
- [x] **The invite page shows the trip before accepting, using the notebook widgets'
      components**. A grep or architecture-wall rule shows no invite-only copy of a widget.
      *(Ticked 2026-10-08, part 5. The landing and *Have a look first* both draw `InvitePlanCard`
      through `MacroView`, with `trip.countdown`, `trip.people` (new and shared with notebooks),
      `trip.strip`, `city.rows`, `cost` and `SharedDayMap`. The only invite-specific widget code is
      the `previewContext` adapter. The depcruise rule `invite-renders-shared-widgets-only` was
      seen firing on stub files (`error invite-renders-shared-widgets-only: …StubInviteWidget.ts →
      packages/pages/src/macros/primitives/single.ts`). `noInviteWidget.test.ts` catches a
      `MacroDef` built through the public index, which depcruise cannot see. It was seen red
      with `Received: ["components/access/StubInviteWidget.ts"]`.)*
- [x] **The token-scoped read returns nothing that decision 4 hides**: an integration test asserts
      per-person and per-stop costs are absent, and an expired or revoked token returns nothing.
      *(Ticked 2026-10-08, parts 3 and 5. `preview/route.int.test.ts` walks the body for any money
      key or number except the total. It was seen red twice: a stop `cost`, `expected [
      'days[0].stops[0].cost', …(6) ] to deeply equal [ 'total', 'total.amountMinor' ]`, and a
      disguised `fee`. A revoked or accepted token returns 410 with an empty body. Invites never
      expire (ADR-026), so "expired" is read as accepted. The old invite-token viewer, which
      served the whole `TripDetail` to a token holder, is retired. `trip-access.int.test.ts` ›
      *a pending invite's token opens no trip read* covers five routes. Against the old code it
      failed with `expected 200 to be 401`.)*
- [x] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: set an avatar, invite
      someone, open the invite as them, see the trip, accept, and see the avatar in People.
      *(Ticked 2026-10-08, part 5. `e2e/m38-personas.spec.ts` passes on ci-like: `2 passed
      (15.4s)`. The owner sets *Rowan Persona*, Tent and Plum, and they survive a reload. The
      signed-out invitee sees the plan, *Who's going* with the tent chip, and the $60.50 total,
      with no stop's $42.50 or $18.00, on the landing and on *Have a look first*. The guest picks
      Bike and also Plum, then joins. In People the owner's tent shows, and the guest's own chip
      reads "Rowan Persona chose plum first, so you're … on this trip." The owner then sees the
      guest's bike. Seen red with `PersonRow` passing `avatar={null}`: `Expected: 1 / Received: 0`
      at `ownerRow.locator(".lucide-tent")`.)*
- [x] **[walk]** On the PR preview, a two-person trip where both chose the same colour is walked.
      *(Ticked 2026-10-08. The walk ran on Neablis/travel-collab#360's Vercel preview (deployed
      `8a03de1`) with two live browser sessions. A set Tent and Plum, and they were kept after a
      reload. The signed-out invite and *Have a look first* showed only the total, `$97.75`; none of
      the stop prices ($42.50, $18.00, $37.25) appeared in the text or the HTML. B chose Bike and
      also Plum, then joined. In B's People, A is plum with a tent and B is **ochre** with a bike,
      and B's own chip reads "Sam Walker chose plum first, so you're ochre on this trip." The header
      stack, the home card, *Who is in* and *Booked by* agree. A's People, opened before B joined
      and not reloaded, showed B in ochre 3.3 s after Join, with no tooltip on B's row. The only
      console error was the sandbox's blocked `vercel.live` feedback widget. The screenshots are in
      the session scratchpad.)*
- [x] A retro is appended at gate close.
      *(Ticked 2026-10-08: below.)*

## Retro — gate closed 2026-10-08 (8 of 8)

**What shipped.** Five stacked PRs, merged 1→5 on 2026-10-08:
- **Scope (#356).** All six decisions were answered as recommended. Later calls by Mitchell: `/v1/trips` names nobody; the design canvas was approved as drawn; migration `0044` opts in existing display names; the referral card obeys the opt-in.
- **Personas, server (#357).**
  - Migration `0044_personas` adds `avatar`, `color` and `public_display_name` to `users`.
  - `TripMemberProfile` carries the persona.
  - Every public name query (board, profile, Discover, published day, referral card) uses a chosen name only when its owner opted in.
- **The invite preview, server (#358).** `GET /api/invites/:token/preview` returns a strict `TripPreview`: the plan, the people going and the trip total, with no per-person or per-stop money and no user ids. A refused token gets an empty 404 or 410.
- **Personas, UI (#359).**
  - `PersonChip` is on every person surface.
  - Colours are resolved per trip on the server (`resolveTripColors`), and the later joiner is shifted, with a sentence saying why.
  - The account screen shows the colour trips derive, with the pickers and the public-name checkbox.
  - `/demo` has a deliberate clash: Priya shows ochre.
- **The invite preview, UI (#360).**
  - The landing and *Have a look first* draw the shared notebook widgets through `MacroView`, including the new `trip.people` (*Who's going*).
  - The old invite-token viewer is retired. It served the whole `TripDetail` to anyone holding a pending token.

**What held.**
- **Decisions came first, then the canvas.** Six decisions and an approved eight-recommendation canvas went in before any UI. None of them was reopened during the build.
- **The self-review found the privacy holes before anyone else did.**
  - Part 2's review found two leaks: a chosen pseudonym could reach public pages, and the referral card ignored the opt-in.
  - Both went to Mitchell as decisions (the backfill and the gate) rather than being guessed. The backfill was then verified on a fresh database.
- **Retiring the token viewer was the right size.** The preview read replaced a route that gave a token holder everything. `trip-access.int.test.ts` now pins the shut door across nine routes.
- **The architecture wall moved one design.**
  - `defaultColor` first went into `server/users.ts`.
  - `pnpm arch` refused it: `identity-knows-no-trips`.
  - So it lives in `access/personaColors.ts`, beside the domain call it needs, rather than with a rule bent around it.

**What did not.**
- **CodeRabbit ran only after Mitchell asked, for the second milestone running.** He asked *"Was a code review done for each part? Code Rabbit review?"*, and the answer was no. M37's retro had already said to review each part before opening it.
  - Once started, the reviews took about four hours of wall time. CodeRabbit allows one review an hour on this plan and auto-skips PRs whose base is not `main`, so each part needed `@coderabbitai review` and its own hour.
  - It found one real bug, in part 5's `trip.people`: the stack drew a fourth chip that the sentence counted as "other". That test had been **asserting the bug**: `toEqual(["Sam", "Priya", "Kenji", "Mei"])`.
  - **Next time:** request CodeRabbit on part *n* as soon as it opens, so the hourly quota runs alongside the build rather than after it.
- **A new control broke an old gate.** Part 4's public-name checkbox measured 16px on a phone, and `m26-phone-targets` went red on #359 and #360.
  - Chromium ignores padding on a native checkbox and stretches its tick to fill any size it is given, so the primitive itself had to change shape. The input is now a transparent 44px target over a drawn 16px box.
  - Every later checkbox inherits the fix. The cost is that the tick is ours, not the browser's.
- **Tooling surprises cost a round each.**
  - Running prettier with its defaults reformatted 30 files: the repo is not prettier-formatted.
  - The colour wall read the PR reference `#359` in a comment as a hex colour, and `#ff0000` in a test.
  - The container was OOM-killed once when heavy suites ran in parallel. Run them one at a time.
- **The merge again reached production before its migration.** `0044` had not been dispatched when the stack merged (14:06 UTC), despite the hand-off saying to dispatch right after part 2. It ran afterwards, on `b10f513`. That is M37's finding, repeated. The automatic-gating question raised on #357 is still Mitchell's decision.

**Left open, not gating.**
- CodeRabbit's summary on #358 still shows a "merge risk" about a malformed stored currency. The finding was withdrawn on its thread: `SetTripCurrency` and `TripCurrencySetV1` both enforce `^[A-Z]{3}$`.
- `SuggestionsChip`'s by-line separator is now an `aria-hidden` "·", so a screen reader hears "Day 2 Suggested by …" with no pause.
- Agent briefs and `ADAPTER.md` point at `apps/web/.env.example`, which does not exist; only the root one does.


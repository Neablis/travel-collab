# M15 — Front door

**Status:** In progress. Tasks 1-5 implemented on this branch (no PR open yet):
landing page, custom sign-in/sign-up with failure states, Home's empty-state
first-run moment, the account menu (already shipped in M10 Phase 8b), and the
e2e cover below. **Decision 1 (2026-08-26)** moves this milestone's execution
ahead of M10's Phase 9 gate and M16 — superseding the "runs after M16" ordering
`docs/milestones/README.md`'s roadmap table and "Current milestone" section
still state as of this writing. That file is **not** amended by this change
(out of this task's scope); reconciling it is part of "What remains before
this gate can close" below. The gate itself is **not closed** — see that
section for the one thing still outstanding.

## Why this exists

The product has no front door. An unauthenticated visitor to the deployed app
gets `<Heading>travel-collab</Heading>` and a link to NextAuth's default sign-in
page (`app/page.tsx:205-217`). A signed-in one has no way to sign out at all:
`server/auth.ts` exports `signOut` and nothing in `apps/web/src` calls it.

The 2026-08-23 design sync designed the whole surface — landing, sign-in,
sign-up, first run, account menu — with copy. This milestone builds it.

It is deliberately **not** part of M10. M10's scope is an authenticated-user
visual pass over Home and the trip plan; a new unauthenticated surface is not
polish. See ADR-021 for the ordering argument and
`docs/design-feedback/2026-08-23-design-sync-review.md` for the reconciliation
this came out of.

## Scope

Design source: `.design-sync/handoff/design/Trip Planner Redesign.dc.html` —
`isLanding` (≈1469-1541), `isAuth` (≈1543-1582), `isFirstRun` (≈1584-1640), the
account `Popover` (≈94-103, handlers ≈3091-3095). Copy is in the file; do not
invent product copy (`.design-sync/handoff/README.md` says the same).

1. **Landing page.** Hero, the product claim, two CTAs, the sample-itinerary
   card, the proof chips. Replaces the bare unauthenticated home.
2. **Sign-in and sign-up screens.** Custom, Google-only, replacing NextAuth's
   default page. They differ only in copy — one component, two modes, with the
   swap link between them (`authTitle` / `authSub` / `authScopeLine` /
   `authSwapPrompt` / `authSwapCta` in the DC).
3. ~~**First-run screen.** "What are you planning, Sam?" — one field, "Start
   planning", and the "Roughly when?" row as a `<Preview>` shell. `CreateTrip`
   carries only a name and that does not change here (`SPEC.md` D4).~~
   **Deleted — decision 3 (2026-08-26).** See Decisions below.
4. **Account menu.** The header avatar's `Popover`. **Already shipped in M10
   Phase 8b** — `components/AccountMenu.tsx` has name, email and a real
   `signOut({ callbackUrl: "/" })`. No account model exists (see "Explicitly
   out of scope" below), so "Your account" gets nothing further — decision 6
   (2026-08-26). Nothing left to build here.
5. **The states the design does not draw.** Sign-in failure, a revoked or denied
   Google grant, first-run with the network down. The DC shows the happy path
   only; these are ours to design and are part of the gate.

### Explicitly out of scope

- **"Look around a real trip"** — the landing hero's secondary CTA. It needs
  unauthenticated read of a real trip, which is **M11**'s share-link work.
  Omit it, or `<Preview>`-wrap it against a registry id pointing at M11. Do not
  build a bespoke public-read path for one button.
- **The Caesura rename** — lands in M10 Phase 8b.
- **An account model.** NextAuth's session carries a name, an email and a
  picture. Nothing beyond that exists, so nothing beyond that can be shown.
- **Invites.** "Invited to someone's trip? Sign in with the address the invite
  went to" is copy on the sign-in screen. Invites themselves are **M13**;
  `TripMember.role` is the literal string `"owner"`.

## Open questions — decide before or during, not after

1. ~~**Is the one-field first-run screen intentionally different from the four-step
   new-trip wizard?**~~ **Resolved — decision 3 (2026-08-26).** No first-run
   screen; the merged four-step `NewTripWizard` is the only create path.
2. ~~**May the landing copy sell M11 and M12?**~~ **Resolved — decision 2
   (2026-08-26).** Yes — it ships verbatim, as aspiration.

## Decisions — 2026-08-26 (Mitchell)

1. **M15 executes now**, ahead of M10's Phase 9 gate and M16. M10 stays open
   meanwhile; that is accepted. (See the Status note above — this supersedes
   ADR-021/ADR-022's ordering; `docs/milestones/README.md` has not yet been
   updated to match.)
2. **Open question 2 resolved — the landing copy ships verbatim as
   aspiration.** The hero's "Save the highlights when you get back, share them
   with the world, and let other travelers remix the best parts into their own
   adventures" sells M11 (fork/remix) and M12 (community), and the proof chip
   "Remix anyone's itinerary" does the same. This is the explicit approval the
   gate item asks for.
3. **Open question 1 resolved — there is no first-run screen.** The design's
   one-field "What are you planning, Sam?" screen is dropped; the merged
   four-step `NewTripWizard` is the only create path. This is safe because the
   gate's real requirement — create a first trip from a name alone — is
   already satisfied: `NewTripWizard.tsx:431` renders a "Create empty" button
   on every step, gated only by `trimmedName !== ""` (`:215`).
   `app/(app)/page.test.tsx` now covers it.
4. **A signed-in user with no trips sees Home's empty state**, not a separate
   screen. "Brand new account" is inferred from zero trips; there is no user
   table to record it in. Someone who deletes every trip sees it again, which
   is correct behavior.
5. **The landing lives at `/welcome`; `/` redirects to it** when
   unauthenticated.
6. **Scope item 4 (account menu) was already shipped** in M10 Phase 8b —
   `components/AccountMenu.tsx` has name, email and a real
   `signOut({ callbackUrl: "/" })`. No account model exists, so "Your account"
   gets nothing further. Scope item 3 (first-run screen) is deleted per
   decision 3.

## Exit gate

- [x] An unauthenticated visitor to `/` is **redirected to `/welcome`**,
      which shows the landing page (decision 5). Proven by
      `e2e/m15-front-door.spec.ts` (`goto("/")` → `toHaveURL(/\/welcome$/)`,
      hero heading visible) and `apps/web/src/app/(app)/page.tsx`'s
      signed-out redirect.
- [x] Sign-in and sign-up are our screens, not NextAuth's default page.
      Proven by `e2e/m15-front-door.spec.ts` and `AuthScreen.test.tsx`.
- [ ] Both complete a real Google sign-in end to end on the deployed app.
      **Not run.** No Vercel preview deployment exists for this work — there
      is no upstream branch and no open PR (`git rev-parse @{u}` fails,
      `gh pr list --head <branch>` is empty). The automated e2e suite
      (`e2e/m15-front-door.spec.ts`) exercises the **dev-login** provider
      only; a real Google grant is not something this session can perform.
      This check is manual, against a Vercel preview, and remains outstanding
      — see "What remains" below.
- [x] A signed-in user with no trips sees Home's empty state (decision 4)
      and can create a trip from a name alone via the wizard's "Create empty"
      (decision 3). Proven by `apps/web/src/app/(app)/page.test.tsx` and
      `e2e/m15-front-door.spec.ts`.
- [x] A signed-in user can sign out from the header and returns to the
      landing page. Proven by `e2e/m15-front-door.spec.ts` (Account menu →
      Sign out → `/welcome`).
- [x] Sign-in failure, a denied Google grant, and a network failure during
      trip creation each have a designed, tested state — no blank screen and
      no raw error. ("First run" here now means the wizard's create-trip
      failure path, since the separate first-run screen was dropped —
      decision 3.) Proven by `AuthScreen.test.tsx` ("explains a declined
      Google grant instead of showing a code", "falls back to plain language
      for an unrecognised error code") and `NewTripWizard.test.tsx` ("shows
      the create-trip error inline and keeps the sheet open on failure").
- [x] Nothing on the landing page claims an unbuilt capability that the two
      open questions above have not explicitly approved (decision 2).
- [x] "Look around a real trip" is absent or `<Preview>`-wrapped; no
      unauthenticated trip-read path was built. `LandingScreen.tsx` wraps it
      in `<Preview id="landing-peek-trip">`; proven inert by
      `e2e/m15-front-door.spec.ts`.
- [x] Every `<Preview>` added here is registered in
      `apps/web/src/lib/preview-registry.ts` with its real milestone, and the
      sync test passes. `landing-peek-trip` → M11;
      `preview-registry.test.ts` is part of the unit suite that passed.
- [x] An e2e script covers landing → sign-in → first trip → sign out, and
      joins the suite prior milestones' scripts run in.
      `e2e/m15-front-door.spec.ts` exists and asserts the full flow,
      including the `/signin` ↔ `/signup` swap-link round trip. **Revision
      note:** the first version of this spec filled the dev-login username
      field immediately after the `/signup` → `/signin` swap-link click; both
      routes render `AuthScreen`'s dev-login form with the same
      `input[name="username"]`, and the client-side transition between them
      remounts a fresh `useState("")`, so the fill could race the not-yet-
      settled navigation and land on a field about to unmount — reproduced by
      a reviewer's `test:e2e:ci-like` run (failed on the initial attempt and
      retry #1). Fixed by settling on the `/signin` heading before filling,
      filling through a `getByLabel` locator, and asserting the value
      actually stuck before submitting. Verified with
      `CI=true pnpm exec playwright test m15-front-door.spec.ts
      --project=desktop` against the production build already in
      `apps/web/.next` — **2/2 passed**, twice in a row. The full
      `test:e2e:ci-like` run (all projects, including `narrow`) has not been
      re-verified by this session since the fix — deferred to the reviewer's
      authoritative rerun rather than repeating a multi-minute full-suite run
      per their instruction.
- [ ] `pnpm typecheck && pnpm lint`, unit, int and the full e2e suite green
      against a **production** build with `CI=true` (KI-27), including the
      narrow-viewport project. **`pnpm check` and `test:int` are green; the
      full e2e suite is the remaining piece.** Commit `c581151` cleared the
      five arbitrary Tailwind values this box used to list in
      `apps/web/src/components/front/LandingScreen.tsx` (`tracking-widest`,
      `max-w-98`, and three documented `style` escapes), so `pnpm check`
      (typecheck, ESLint, the lint wall, the colour wall, the case-collision
      check) is green: 106 unit test files, 794 tests passing, 1 skipped.
      `pnpm --filter web test:int` is also green: 13 files, 85 tests. Both
      re-verified 2026-08-26. The full `test:e2e:ci-like` run against the
      fixed spec has not been re-verified by this session (see the note
      above) — its authoritative result is the reviewer's rerun, not a claim
      made here. See "What remains" below.
- [ ] Retro appended here; `TODO.md`, this file's boxes and
      `docs/milestones/README.md`'s Current milestone all flipped in **one**
      commit (README's gate-close checklist). **Deliberately not done** — the
      milestone is not closing yet (see Status above and "What remains"
      below).

## What remains before this gate can close

One thing, outside this task's scope:

1. **Verify a real Google sign-in end to end on a deployed preview.** A
   Vercel preview for PR #56 now exists and deployed successfully, so this is
   no longer blocked on "no preview exists" — what's outstanding is a human
   performing a real Google sign-in from `/signin` and `/signup` on that PR's
   Vercel preview, confirming both land on `/`. Record the result on the PR's
   **Verification actually performed** section per `AGENTS.md`.

Once that's done: tick the two remaining exit-gate boxes, append the retro,
and flip `TODO.md` / `docs/milestones/README.md`'s Current milestone (and
reconcile its stated M15 execution order with decision 1 above) in one commit
per README's gate-close checklist.

## Retro

*(appended at gate close)*

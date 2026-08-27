# M15 — Front door

**Status: Gate closed 2026-08-26.** All five tasks landed on PR #56: landing
page, custom sign-in/sign-up with failure states, Home's empty-state
first-run moment, the account menu (already shipped in M10 Phase 8b), and the
e2e cover below. **Decision 1 (2026-08-26)** moved this milestone's execution
ahead of M10's Phase 9 gate and M16, superseding ADR-021/ADR-022's stated
ordering; `docs/milestones/README.md`'s roadmap table and "Current milestone"
section are reconciled to this in the same commit that closes this gate.
M10's Phase 9 gate is still open and remains the next work — this milestone
closed out of that stated order, not instead of it.

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
   ADR-021/ADR-022's ordering. `docs/milestones/README.md` was reconciled to
   match in the same commit that closed this gate.)
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
      hero heading visible) and, as of 2026-08-26,
      `apps/web/src/middleware.ts`'s server-side redirect (its own
      split-config Auth.js instance built from `@/lib/authConfig.ts`,
      ADR-024, superseding ADR-023) — a
      `curl` against `/` with no session cookie returns a 307 with
      `Location: /welcome` before any page renders. This replaces the
      original client-side implementation (Home fetching `/api/trips`,
      getting a 401, then `router.replace`), which cost a round trip and
      briefly showed the authenticated app chrome above an empty body. That
      client-side path still exists in `apps/web/src/app/(app)/page.tsx`, now
      narrowed to its real remaining job: a session that expires while the
      page is already open.
- [x] Sign-in and sign-up are our screens, not NextAuth's default page.
      Proven by `e2e/m15-front-door.spec.ts` and `AuthScreen.test.tsx`.
- [x] Both complete a real Google sign-in end to end on the deployed app.
      **Verified manually by Mitchell on 2026-08-26**, against PR #56's
      Vercel preview deployment: a real Google sign-in from both `/signin`
      and `/signup`, and the dev-login path, all landing on `/`. This is a
      manual check, not an automated one — the automated e2e suite
      (`e2e/m15-front-door.spec.ts`) still exercises only the dev-login
      provider, since a real Google grant is not something an agent session
      can perform. An earlier attempt against the same preview had failed;
      that turned out to be a missing redeploy after the Google env vars
      were added to the Preview environment, not a code defect — see KI-50
      for the durable follow-up (`AUTH_REDIRECT_PROXY_URL`).
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
- [x] `pnpm typecheck && pnpm lint`, unit, int and the full e2e suite green
      against a **production** build with `CI=true` (KI-27), including the
      narrow-viewport project. Commit `c581151` cleared the five arbitrary
      Tailwind values this box used to list in
      `apps/web/src/components/front/LandingScreen.tsx` (`tracking-widest`,
      `max-w-98`, and three documented `style` escapes), so `pnpm check`
      (typecheck, ESLint, the lint wall, the colour wall, the case-collision
      check) is green. Re-verified 2026-08-26 **after merging `origin/main`**
      (commit `90a07e6`): 109 unit test files, 850 tests passing, 1 skipped;
      the colour wall scans 307 files with 0 pending re-skin.
      `pnpm --filter web test:int` is also green: 13 files, 85 tests.

      **The full e2e suite, including `narrow`, is now green — on CI, which
      is authoritative.** The local `test:e2e:ci-like` run recorded above
      (22 passed, 1 failed on `e2e/m10-map-rail.spec.ts:29`, untouched by
      this branch) was a 33.8-minute run following a 1.1-minute clean run of
      the identical command — a signature of local machine contention, not a
      defect, per KI-1's "verify before waving through" precedent. **GitHub
      Actions run `33023719009` on PR #56** — `unit-tests`, `static-checks`
      and `integration-e2e` all green. CI's `integration-e2e` job runs
      `pnpm --filter web build` then `pnpm --filter web test:e2e` with no
      `--project` filter (confirmed against `.github/workflows/ci.yml`), so
      the `setup`, `desktop` and `narrow` projects all ran against a
      production build in that job. This is the authoritative signal this
      box requires; the local run above is superseded by it.
- [x] Retro appended here; `TODO.md`, this file's boxes and
      `docs/milestones/README.md`'s Current milestone all flipped in **one**
      commit (README's gate-close checklist).

## What remains before this gate can close

Nothing. The one outstanding item — a human performing a real Google sign-in
against PR #56's Vercel preview — is done (see the exit-gate box above); every
other box was already satisfied. `TODO.md`, this file's boxes, and
`docs/milestones/README.md`'s Current milestone (including reconciling its
stated M15 execution order with decision 1 above) are flipped together in the
gate-close commit, per README's gate-close checklist.

## Retro

**Gate closed 2026-08-26.**

**Four defects were in the implementation plan itself, not in the
implementers' work — and the review layer caught all four.** Subagents
transcribed the plan faithfully each time; the specs handed to them were
wrong:

1. A duplicated `vi.mock` for one module path.
2. A `<Suspense fallback={null}>` wrapping an entire page body, so `/signin`
   and `/signup` prerendered a blank shell instead of the auth screen.
3. A test mocking `GET /api/trips` as a bare array when the route actually
   returns `{ trips }` — the gate-evidence test only passed via an unrelated
   `?? []` fallback masking the mismatch.
4. A Playwright strict-mode race where a freshly created trip renders twice
   on Home.

None of these would have been caught by trusting the plan's own description
of "what this step verifies" — each needed someone to check the plan's claim
against the actual code and test output.

**Twice a subagent reported one of this branch's own defects as
"pre-existing."** The colour-wall violations in `LandingScreen.tsx` — a file
*this branch created* — and the e2e strict-mode flake were both reported that
way, and both were wrong: new code, not inherited debt. "Pre-existing" is a
claim to verify (`git log`/`git blame` the file, or diff against the branch
point), not a label to accept at face value just because it resolves the
finding conveniently.

**Local e2e was misleading; CI was authoritative, and CI almost didn't run at
all.** A local `test:e2e:ci-like` run failed on `m10-map-rail` and took 33.8
minutes; CI ran the identical suite green in 3m39s — the same "local
contention reads as a defect" trap the milestone file's exit-gate box above
records directly. Worse: CI could not run at first, because the PR had merge
conflicts and GitHub silently declines to run `on: pull_request` workflows
when it cannot compute a merge commit — no error, no queued run, nothing to
grep for. Merging `origin/main` unblocked it, and `main` had already landed
local-e2e reliability work (KI-27 budgets) the branch predated. Lesson: a PR
with zero check runs and no red X is not "not yet started" — check for merge
conflicts before assuming CI just hasn't gotten to it.

**The `/` redirect shipped client-side first, and that was written up as
"deferred to a human" rather than raised as a problem.** Mitchell called it
out — a redirect implemented by the authenticated app briefly mounting, then
noticing it lacks a session, and pushing the user out, when the whole point
was a front door that never shows the app shell to a stranger. That became
middleware plus a lint-wall exemption (ADR-023), then CodeRabbit argued the
exemption away and Mitchell agreed, producing the Auth.js split-config
(`src/lib/authConfig.ts`, both `src/server/auth.ts` and `src/middleware.ts`
building their own instance from it) and ADR-024, which supersedes ADR-023.
The final shape — middleware held to the same lint-wall standard as any other
UI file, with no special exemption — is better than either intermediate one.
The lesson generalizes past this one redirect: a corner that reads as "fine
for now, a human can decide later" is worth surfacing at the point it's cut,
not after the fact, because the decision that follows (here, a real
architecture split) is often not obvious from the workaround itself.

**The preview Google failure was a missing redeploy, not a code defect.** The
first attempt at a real Google sign-in against PR #56's preview failed; the
cause was that the Google OAuth env vars had been added to Vercel's Preview
environment without a subsequent redeploy picking them up, not anything wrong
in `authConfig.ts` or the callback wiring. `docs/known-issues.md` KI-50
records the durable follow-up: `AUTH_REDIRECT_PROXY_URL` so one registered
Google redirect URI covers every preview deployment, instead of hand-registering
each branch's alias.

**Scope decisions that shaped the milestone, made explicitly rather than
absorbed silently:**
- The designed first-run screen ("What are you planning, Sam?") was dropped
  entirely (decision 3) once it became clear `NewTripWizard`'s "Create empty"
  button already creates a trip from a name alone — the gate's real
  requirement was already met by an existing control, so building a second,
  narrower one would have been redundant surface area.
- The landing page's copy ships verbatim as aspiration (decision 2),
  explicitly selling M11 (fork/remix) and M12 (community) before either
  exists, on the basis that the copy was designed that way and reads as
  intent rather than a false claim about present capability.

Both were surfaced as open questions in this file before being decided, not
discovered as drift after the fact — the process the milestone file's "Open
questions — decide before or during, not after" heading asks for.

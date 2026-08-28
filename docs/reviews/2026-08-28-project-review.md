# Project review — 2026-08-28

A full-repo review across seven dimensions: CI/agent-tooling efficiency, logical
bugs, testing (false positives and feedback speed), orphaned code and doc drift,
security, simplification/refactoring, and new Claude automation. Conducted at
`a64a8ff` (main + PR #63) by six parallel review agents, each finding verified
against the tree before inclusion; headline items re-verified independently.

Severity/confidence labels: **CONFIRMED** = the full code path was traced.
**PLAUSIBLE** = mechanism verified in code, triggering scenario not fully proven.

---

## Executive summary — the ten things to act on first

1. **A rejected `fetch` permanently wedges the optimistic send queue** and
   silently loses every queued edit (Bugs §1). One try/catch in `apiClient.ts`
   fixes it and also cures the wizard hang (Bugs §2).
2. **The AI endpoint has no rate limit and no prompt-size cap** — unbounded
   spend against `AI_GATEWAY_API_KEY` by any signed-in account (Security H1).
3. **Two committed skills teach the repo's own banned anti-patterns**:
   `ci-triage` recommends the full-suite-in-disguise vitest form *and* the
   forbidden dev-lane e2e repro (CI F1/F2). One-line fixes.
4. **`packages/factories` is missing from the typecheck hook and both
   narrowing maps** — edits and contracts fan-outs silently skip a 346-test
   package (CI F3).
5. **The test-suite overhaul's Phase 5 prune never happened** — its gate
   closed 2026-08-27, nothing live surfaces the deferred work, and the suite
   has regrown past the pre-overhaul baseline (Testing §1, Docs §4).
6. **No CI job has `timeout-minutes`** — one hung run can bill 360 minutes,
   18% of the monthly Free-plan cap (CI F4).
7. **Dev login is gated by a single env var with no `VERCEL_ENV` check**,
   unlike the demo-reset gate it should mirror (Security M1). Two lines.
8. **`docs/STATUS.md`'s "Next action" section contradicts its own top
   section** and ~88% of the mandated first-read file is history (Docs §1-2).
9. **Activity fields are hand-enumerated in ten places, not four** — a
   compile-checked descriptor refactor collapses them to one (Refactor §1).
10. **`Location.city`/`countryCode` never made it into `activityStatesEqual`**
    — a city-only update is rejected as a no-op, invisible to the property
    tests because the generator's pool carries no `city` (Bugs §6).

---

## 1. Logical bugs

### 1.1 CONFIRMED — rejected fetch wedges the send queue (HIGH, silent data loss)

`apps/web/src/lib/apiClient.ts:92-127` (`sendTripCommand` /
`sendTripCommandBatch`) have no try/catch, and neither does the sender effect
in `apps/web/src/components/trip/context/TripProvider.tsx:125-171`. A fetch
that **rejects** (offline blip, DNS failure — as opposed to a non-2xx response,
which is handled) throws inside the async IIFE before `inFlight.current =
false` runs. The sender is then permanently gated: no `failHead` is recorded,
the head and everything behind it never send again for the life of the page,
the UI shows "Saving…" forever, and navigation loses all of it. This is the
KI-5/KI-36/KI-42 silent-loss class on a trigger none of them cover, with no
retry surface (KI-36's failure/retry machinery only engages on a *resolved*
failed response).

Same class, second site: `load()` (`TripProvider.tsx:73-97`) — a rejecting
`fetchTripDetail` leaves `status` stuck at `"loading"` forever with no error.

The repo already knows this bug class: `createTrip` (`apiClient.ts:36-53`) got
a try/catch for exactly this reason (CodeRabbit, PR #32) — none of the other
nine fetch helpers in the file did.

**Fix:** wrap the fetches in `apiClient.ts` in try/catch returning
`{ok:false, error:{status:0,…}}`, mirroring `createTrip`. Note that
`TripDetail.parse` on a 200 can also throw and hits the same wedge.

### 1.2 CONFIRMED — new-trip wizard hangs in "submitting" on network failure (MEDIUM-HIGH)

`apps/web/src/components/home/NewTripWizard.tsx:158-212` — `submit()` has no
try/catch around `await dispatch(...)`. Trip created, then the `SetTripDates`
dispatch's fetch rejects → `setSubmitting(false)` never runs → wizard
permanently disabled with no error, and a real dateless trip was silently
minted. Same root cause as 1.1; fixed by the same apiClient change.

### 1.3 CONFIRMED — KI-42 verified real, and its code comment lies

`apps/web/src/components/trip/context/optimistic.ts:82-94` — on a successful
head confirm, any remaining unit that no longer predicts cleanly is dropped and
`break` drops everything after it; the units are removed from `pending`, so
the comment's claim that loss "will be reported via failHead semantics" is
false — `failHead` never sees them. The open-KI status is accurate.

### 1.4 CONFIRMED — `applyOutcome` discards queued-but-unsent edits: a fourth, undocumented silent-loss trigger (MEDIUM)

`TripProvider.tsx:222-228` (`applyOutcome` sets `pending: []`) +
`TripBoardScreen.tsx:305-318` (`submitAssistantAsk` has **no `pending` gate**).
Drag a card (unit queued), immediately ask the assistant: the AI batch executes
server-side, `applyOutcome` clears `pending`, and queued units that were never
sent are silently discarded from both the UI and the server. History commands
deliberately guard this exact hazard (`if (pending) return`,
`TripProvider.tsx:190-191`); the AI ask path has no equivalent. Bonus race: the
in-flight head and the AI batch contend on optimistic concurrency, so the
user's own edit can surface a spurious "Someone else changed this trip."

**Fix:** gate `submitAssistantAsk` on `pending` (disable the ask box or flush
first), or merge rather than clear. File as a KI: the register's own framing is
"one queue, three triggers" — this makes it five (KI-5 navigation, KI-36 fixed,
KI-42 re-prediction, §1.1 rejected fetch, this one).

### 1.5 CONFIRMED — `tripDetailFactory` gives every day the same date (LOW, test infra, KI-40 species)

`packages/factories/src/trip.ts:104` stamps `date: startDate` on every day in
the loop; the real projection derives `startDate + i`. Any fixture with
`dayCount ≥ 2` and `startDate` set is projection-impossible: `calendarMonths`
(`calendarData.ts:101-106`) keys by date, so all days collapse into one cell.
Nothing fails today only because current tests hand-build `days` when they care
about dates. Fix: derive `date` as startDate + dayIndex.

### 1.6 PLAUSIBLE — `activityStatesEqual` ignores `Location.city`/`countryCode` (MEDIUM-LOW, latent M18-class gap)

`packages/domain/src/trip/equality.ts:43-45` compares only `name`/`lat`/`lng`;
the `Location` contract (`packages/contracts/src/activity.ts:32-51`) also
carries `city` and `countryCode`, both persisted and read by real surfaces
(`shortPlace`, `cityFor`, day accents, rack `area`). Consequences: (a) an
`UpdateActivity` changing only `city`/`countryCode` is rejected as a no-op by
`okUnlessNoOp` — e.g. geocoder enrichment backfilling a `city` never persists;
(b) `diffTripStates` never emits for a city-only difference, so undo/revert
won't restore it — self-consistently invisible to the round-trip property test,
which uses the same blind equality; (c) the generator
(`test/support/tripGenerator.ts:21-25`) has no `city` in its LOCATIONS pool, so
no test can catch it. This is exactly the hand-enumeration drift the M18
kind/tags work guarded against — kind/tags made it into all four sites;
city/countryCode never did.

**Fix:** compare the full Location, add a `city`-bearing location to the
generator pool. If the omission was deliberate, a comment + test must say so.

### 1.7 PLAUSIBLE — history-command dispatch races a same-tick enqueue (LOW)

`TripProvider.tsx:188-205` — `dispatch` closes over `pending` computed at
render time; an undo clicked in the same tick as an accepted enqueue passes the
stale `pending === false` check, and the undo's reconcile (`{confirmed,
pending: []}`) drops the just-queued unit. Narrow window, same loss class.

### 1.8 PLAUSIBLE — `commandsFor` default `startDate` mixes local and UTC arithmetic (LOW, test-only)

`packages/factories/src/commands.ts:87-92,109` — builds "now + 10 days" with
local `setDate`, then slices the UTC ISO string; one day off near midnight on
non-UTC hosts. The file's own `addIsoDays` (line 94) exists to avoid this and
is not used here.

### Verified sound (traced, no defect)

M18 `kind`/`tags` enumeration is present and correct in all four domain sites
plus evolve/decide/generator/mocks/duplicateTrip/importer. Open KIs
spot-verified accurate (KI-39, KI-40, KI-34); resolved KIs verified actually
fixed (KI-36, KI-37/41, KI-38, KI-29, KI-14, KI-1). Also traced clean:
event-store optimistic concurrency, batch authz (`BatchableCommand` excludes
`CreateTrip`, so the first-command-only policy check is currently safe),
`fitIntoDay`/`rackDropWindow` clamp math, `resolveDrop` index adjustment,
`calendarData` UTC math, Japan seed integrity, `duplicateTrip`'s event→command
mapping.

---

## 2. Security

### HIGH

**H1. CONFIRMED — AI endpoint: no rate limit, no prompt cap → cost abuse.**
`apps/web/src/server/ai/handleAiRequest.ts:66` — `prompt: z.string().min(1)`
with **no max**; `:86` — up to **32 model round-trips per request** for
`board`/`combined`, the full envelope re-sent each step. The only rate limiter
in the codebase (`server/ai/rateLimit.ts`) is geocoding vendor pacing; nothing
throttles `POST /api/trips/[tripId]/ai` per user/trip/IP, and there is no spend
accounting. Any Google account can sign up, create a trip, and loop
near-body-limit prompts against the operator's gateway key; the unauthenticated
`/api/health/ai-mode` even tells the attacker when spend is live. The kill
switch is remediation after the bill, not prevention.
**Fix:** `.max(~4000)` on prompt; per-user + global rate limiter (Postgres
counter works — the events table already gives per-actor timestamps); consider
a per-request token/step budget. Same limiter should cover the geocode proxy
(L4).

### MEDIUM

**M1. Dev-login gate is one env var with no environment constraint.**
`apps/web/src/lib/authConfig.ts:28-41` — `AUTH_DEV_LOGIN === "true"` registers
a Credentials provider accepting **any username, no password** (`dev-${name}`).
Contrast `lib/demoDataReset.ts:19-21`, which requires `VERCEL_ENV ===
"preview"` (platform-set, unforgeable) **and** the opt-in var. One Vercel
env-var scoped to "All Environments" by mistake and production accepts
credential-less sign-in; `.env.example`'s "NEVER set in production" is
documentation, not enforcement (the same gap KI-24 records for `AI_LIVE`).
Where dev login is on with a shared DB, IDs are deterministic — anyone typing
`alice` becomes `dev-alice`. Previews are currently fenced only by Vercel
Deployment Protection.
**Fix:** `AUTH_DEV_LOGIN === "true" && process.env.VERCEL_ENV !== "production"`
(mirroring `isDemoDataResetEnabled()`).

**M2. No security headers at all.** `apps/web/next.config.ts` has no
`headers()`; no CSP, no `frame-ancestors`/`X-Frame-Options` (UI redressing of
delete/reset buttons), no `Referrer-Policy`, no `nosniff`. A CSP is cheap here
— there are no third-party scripts.

**M3. PLAUSIBLE (deferred plan) — shared `AUTH_SECRET` across Preview and
Production.** KI-50's planned `AUTH_REDIRECT_PROXY_URL` fix requires an
identical `AUTH_SECRET` in both environments; sessions are stateless JWTs, so a
preview-minted JWT would then verify on production. Today the `dev-` prefix on
dev-user IDs is the only thing preventing impersonation of a production Google
user — a thin, implicit invariant. When the proxy lands: ensure
`AUTH_DEV_LOGIN` is provably off in every environment sharing the prod secret,
or add an environment claim to the JWT.

### LOW

- **L1.** `SECURITY.md` is the unedited GitHub template (fictional 5.1.x/4.0.x
  version table, placeholder text). Actively inaccurate; replace or delete.
- **L2.** `AI_LIVE` env override silently disables the kill switch
  (`modelSelection.ts`) — known and accepted as KI-24, but it compounds H1.
- **L3.** `GET /api/trips` loads **every** user's trips and filters in JS
  (`server/projections.ts:81-83` → `api/trips/route.ts:14`). No current leak,
  but one dropped `.filter()` is a full cross-tenant dump, and cost grows with
  total users. Push the membership predicate into the query.
- **L4.** Geocode proxy (`api/geocode/route.ts`): authenticated but uncapped —
  any user can burn the LocationIQ quota.
- **L5.** `PageContent` is `z.array(z.unknown()).passthrough()`
  (`packages/contracts/src/pages.ts:33-36`) — unbounded stored JSON per page
  (storage abuse). No XSS sink today (no `dangerouslySetInnerHTML` anywhere;
  StarterKit ships no Link extension; macro nodes re-validated against a closed
  registry) — but adding `@tiptap/extension-link` later without `isAllowedUri`
  hardening creates a `javascript:` href sink fed by this permissive stored
  content. Cap serialized size; note the hazard in the contract comment.
- **L7 (severity unassessed — triage needed).** GitHub reports **19 open
  Dependabot vulnerability alerts (12 high, 7 moderate)** on the default
  branch (surfaced by the push that published this review:
  `github.com/Neablis/travel-collab/security/dependabot`). Not triaged here —
  many npm advisories don't apply to this app's usage — but 12 highs deserve a
  pass, and `docs/guidelines/ci-cost-and-capacity.md:116` notes there is no
  `.github/dependabot.yml`, so version bumps arrive ad hoc (the untracked
  Vitest 2→3 major bump in Testing §2 is what that looks like in practice).
- **L6.** CSRF posture rests entirely on Auth.js's default `SameSite=Lax`
  cookie. Adequate today; one cookie-config change away from every mutation
  route being CSRF-able. An Origin or `Content-Type: application/json` check
  would make it explicit.

### Verified sound

Every handler under `app/api/**` checks `auth()` then membership (trips,
history, duplicate, pages via `pages-guard.ts`, commands via `soleMemberPolicy`
inside the transaction); no IDOR found. Event-log integrity: `actorId`, `seq`,
`batchId`, `occurredAt`, `origin` all server-set; actor forging not expressible
via the API. Demo-reset gate sound (preview-only, fail-closed 404, caller-scoped
soft delete, separate Neon branch). Prompt-injection blast radius: closed tool
set, server-injected `tripId`, server-minted UUIDs, same authorized pipeline —
worst case is edits the caller could already make. No raw SQL beyond a static
index predicate; no committed secrets; no `NEXT_PUBLIC_` vars;
`safeCallbackUrl` rejects `//` and backslash variants; middleware is UX-only
(every handler re-checks `auth()` independently, so split-brain drift can't
create an authz hole).

---

## 3. Testing — false positives and the feedback loop

Measured this session (4-core sandbox, Postgres on :5433): web unit **111
files / 894 tests, 68.6s wall** (environment 69.4s); int 13 files / 85 tests,
12.2s; domain ~3.7s. Baseline at the 2026-08-23 overhaul: 95 files / 569
tests, 52.9s, environment 58.7s.

1. **The Phase 5 prune never ran and the suite regrew past the pre-overhaul
   baseline.** `docs/STATUS.md:626` gates Phases 5-7 on M10 Wave 2's gate —
   which closed 2026-08-27. Nothing resumed; no live doc surfaces the deferred
   work (it lives only in a paragraph marked "history"). Since the inventory:
   +16 files, +325 tests, +4,603 test LOC; environment cost is now *worse* than
   the number the overhaul was launched to fix. `TimelineLens.test.tsx` —
   flagged as the canonical brittleness case — grew 15 → 41 tests. **Execute
   `docs/plans/test-overhaul/phase-5-prune.md` now**, re-running the Phase 0
   inventory first as the plan itself requires. Expected: ~20% fewer tests,
   ~15-20s off every unit run, and removal of exactly the duplicated
   style/Preview re-proofs that produce "false positive" red.
2. **Vitest was major-bumped 2→3 without the migration its own config
   mandates.** `apps/web/vitest.unit.config.ts:14-16` says "This is Vitest
   2.1.9, migrate the split rather than dropping it" — the tree is on 3.2.6
   (dependabot), every run prints the `environmentMatchGlobs` deprecation, and
   **Vitest 4 removes it**, which would silently delete the node/jsdom split
   and its ~33% environment win. Migrate to `test.projects`; re-validate the
   config's Vitest-2-era measurements (`isolate: false`, `maxThreads: 4`).
   Related: `@vitest/coverage-v8` is still 2.1.9 against vitest 3.2.6.
3. **`e2e/m10-map-rail.spec.ts` is built on ~24s of wall-clock sleeps** (nine
   `waitForTimeout(120)` sites plus a 200-step scroll scan;
   `test.setTimeout(90_000)`) — the exact pattern KI-13/KI-21 banned, and the
   120ms is coupled to `scrollThrottleMs`'s trailing edge, so a tuning change
   flakes the spec with no spec change. Replace sleep+read with
   `expect.poll`/`toHaveText` retries; ~42 scan steps prove the same property
   as 200. ~25s off every e2e run.
4. **Integration tests are invisible to local `pnpm check`** — root `check` =
   typecheck + lint + unit only; CI runs `test:int` but a local green check can
   hide broken route handlers/authz for a ~10-min CI round trip. Add
   `check:full`, or run `test:int` conditionally when `pg_isready -p 5433`
   succeeds with a loud "skipped: no DB" line.
5. **e2e specs never clean up the trips they create** — every spec mints
   `` `${name} ${Date.now()}` `` trips against the shared alice user; only m8
   deletes its own. Each run leaves ~14 trips forever; the home page fans out
   one fetch per card (KI-28), so every run makes the next slower and shifts
   layout-settle timing. Adopt an `[e2e]` name prefix + Playwright
   `globalTeardown` that deletes prefixed trips via the existing API.
6. **Authz duplication → table-driven suite.** The 401/403 pair is hand-rolled
   per route and has grown to four copies (the inventory counted three). One
   table-driven authz suite over every endpoint is fewer tests and strictly
   better coverage — it fails when a *new* endpoint ships without a guard.
7. **KI-40 fixture false positive** — `activityFactory` gives every activity
   the identical `09:00–11:00` window and `tripDetailFactory` hardcodes
   `conflicts: []`; ~34 web files consume these. Stagger by sequence index (as
   `commandsFor` already does) before the consumer count grows further.
8. **Enforcement guard:** add a lint rule banning `page.waitForTimeout` in
   `e2e/` (allowed only with an inline justification comment). The repo has
   paid for this lesson three times; §3 above shows it regrows without
   enforcement.
9. **The honest structural gap remains KI-11**: the AI mock suite stayed green
   through seven real model failures. The non-CI live-model replay harness its
   entry sketches (fixed prompt set, record the `meta` envelope, compare
   across runs) is the only real answer.

**Healthy — don't spend time here:** property tests + witness floors (floors
measured per the documented rule, generator acceptance-rate floored too, no
vacuous property found); `playwright.config.ts` (dual viewports, lane reporter,
traces, AI-kill-switch globalSetup); post-KI-21 `dragCardTo`; the single
documented `it.skip`.

---

## 4. CI, agent hooks, and dev tooling

The CI setup is unusually well-tuned already (draft-gating, job merging,
concurrency-cancel, path filters all in place and correctly reasoned). The
remaining findings are mostly correctness gaps in the *agent tooling* —
including two places where committed directions contradict the repo's
hardest-won rules.

- **F1 (HIGH).** `.claude/skills/ci-triage/SKILL.md:62` recommends
  `pnpm --filter web test -- --run <file>` — the exact form
  `minimal-check-subset/SKILL.md:48-56` measured and banned (pnpm swallows the
  passthrough; the full 103-file suite runs while printing a narrowed-looking
  command). `phase-verifier.md:39` repeats it. Replace both with
  `pnpm --filter web exec vitest run -c vitest.unit.config.ts <file>`.
- **F2 (HIGH).** `ci-triage/SKILL.md:65-66` tells agents to reproduce e2e CI
  failures with `pnpm --filter web test:e2e` — the dev lane CLAUDE.md rule 1,
  `AGENTS.md`, and KI-27 forbid for verdicts. Change to `test:e2e:ci-like` and
  drop the env-var list (`playwright.config.ts:96-103` is self-sufficient).
- **F3 (HIGH).** `scripts/hooks/typecheck-touched-package.mjs:21-27` omits
  `packages/factories`: an edit there gets no post-edit typecheck, and a
  contracts edit fans out to a list that skips factories — the exact
  silent-break case the fan-out exists for. Same omission in
  `minimal-check-subset/SKILL.md:19-23` and `phase-verifier.md:22-23`.
- **F4 (HIGH).** No `timeout-minutes` on any job in `ci.yml` or
  `migrate-production.yml` — a hang bills the 360-minute default; one wedged
  `integration-e2e` run burns 18% of the 2,000-minute monthly cap. Suggested:
  10 / 15 / 10 (averages are 1.7-4.1 min).
- **F5 (MEDIUM).** `ci.yml:143`'s Next.js cache key hashes
  `apps/web/**/*.[jt]s` *after* `pnpm install`, so `hashFiles` walks
  `node_modules` (symlinks followed) on every long-pole run. Scope to
  `apps/web/src/**` + `packages/*/src/**`.
- **F6 (MEDIUM).** `phase-verifier.md:38` prescribes `pnpm --filter web lint` —
  the form STATUS.md itself records as having "let real violations through"
  (ESLint only; skips the lint/colour/case walls). Change to root `pnpm lint`.
- **F7 (MEDIUM).** `scripts/hooks/check-destructive-git.mjs:21-24` misses plain
  `git reset HEAD~1`/`--mixed` (moves the tip identically to `--soft`),
  `git commit --amend`, and `git push origin --force` (flag must immediately
  follow `push` to match) — the exact incident class the hook was built after.
- **F8 (MEDIUM).** `scripts/sync-launch-config.mjs:36-44` writes
  `port: 3001+index` per worktree but the spawned command never sets
  `WEB_PORT`, so every entry binds 3001 and the second launch collides while
  launch.json claims 3002. Emit `WEB_PORT=<port>` in the command.
- **F9 (LOW-MEDIUM).** `next build` in CI re-runs the type check the sibling
  job runs in parallel (~34s inside the long-pole job — often one billed
  minute). Env-gated `typescript.ignoreBuildErrors` on the CI step only;
  `static-and-unit`'s `!cancelled()` structure guarantees `tsc` still always
  reports.
- **F10 (LOW).** `scripts/check-lint-wall.mjs` pays three cold ESLint startups
  per run (~6-12s on every `pnpm lint`/`pnpm check`/CI). Run ESLint once over
  all three fixtures with `--format json`.
- **F11 (LOW each).** Stale prose: `vitest.unit.config.ts`'s "This is Vitest
  2.1.9" comment (see Testing §2); `ci-cost-and-capacity.md:23-27` still names
  the merged-away `unit-tests`/`static-checks` jobs; `check-color-wall.mjs:19`'s
  hex regex will false-positive on `href="#cafe"`-shaped strings and its
  `arbitraryValue` pattern misses `clsx()`/multi-line usage; **the three repo
  subagents' `tools:` frontmatter omits the Skill tool while their own
  instructions say to *use* skills** (`ki-fixer.md:30`,
  `phase-implementer.md:42` — and `superpowers:*` references may not resolve
  in every environment). Either add `Skill` to their tools or reword to "read
  `.claude/skills/<name>/SKILL.md`".

**Verified sound:** draft-gating + `ready_for_review` + `!cancelled()`
structure; `migrate-production.yml`'s guard and non-cancellable concurrency;
`session-start.sh`; the Playwright browser-cache split; pnpm store caching in
all jobs.

---

## 5. Orphaned code and outdated documentation

1. **STATUS.md's tail actively misdirects (HIGH).** `docs/STATUS.md:1550-1553`
   ("Start M18 … Nothing has been built on it") is false since PR #63 — the
   file's own top section records PR 1 done. `:1581-1653` is an unpruned
   Phase-8b-era tail: ":1605 six orphan worktrees" (there is one), ":1609
   M16 comes next" (M18 is), ":1623 the walk keeps rolling forward" (it ran).
   ":1525-1547 Blocking / broken right now" contains July-2026 history. Four
   more "not started" phrases at `:516`, `:548-549`. **One commit: rewrite
   "Next action" to ~15 lines (M18 PR 2), delete `:1581-1653`, trim Blocking.**
2. **STATUS.md is ~88% history in the mandated first-read file (HIGH).** The
   self-labeled historical "In flight" block alone is 830 lines (50%). Live
   instruction is ~150-200 of 1,652 lines. Adopt an archive threshold: at gate
   close, per-phase records move to the milestone file/retro in the gate-close
   commit; target STATUS.md ≤ ~250 lines. This is the same problem
   `docs/plans/README.md` already diagnosed for plans ("~131,000 tokens of
   search noise"), now living in the one file every session must read.
3. **Roadmap drift: M17 exists nowhere in the ordering (HIGH).** M17 "Account
   customization" is approved (`docs/milestones/README.md:53`, milestone file
   exists) but absent from the canonical order and **absent from TODO.md
   entirely** — the file whose rule is "first unchecked item = current work."
   Also `README.md:185` "Current milestone: M18 … Not started" is stale.
4. **The test-overhaul Phases 5-7 resume-condition fired silently
   (MEDIUM-HIGH).** See Testing §1. Surface it in TODO.md or STATUS's Next
   action.
5. **`.design-sync/handoff/DRIFT.md` stale rows (MEDIUM):** KI-44/45/47 listed
   open (all resolved), "there is no tags field" (false since #63), "rename to
   Caesura … a year stale" (shipped in Phase 8b), "18 shelled surfaces" (24),
   footer "Phase 9 is next" (closed).
6. **`docs/plans/` violates its own archive rule (MEDIUM):** three
   finished/dead files still checked out with 0 boxes ticked —
   `2026-08-05-KI-15-…`, `2026-08-16-map-rail-focus-tracking.md` + `-KICKOFF`
   (retro exists; the plan even instructs the forbidden `test:e2e` lane), and
   `2026-08-23-test-suite-overhaul-KICKOFF.md` (dead branch/worktree
   instructions). Delete; git history retains them.
7. **Dead dependencies (MEDIUM):** `tippy.js` and `@tiptap/suggestion` in
   `apps/web/package.json` have zero importers — leftovers of M8's removed
   macro authoring (macro *rendering* is deliberately alive; verified).
   `@vercel/speed-insights` is declared at the root but imported only by
   `apps/web` — move it.
8. **Foreign skills in `.claude/skills/` (MEDIUM):** `gemini-interactions-api`
   (36K) is committed and aggressively self-triggering ("read BEFORE opening
   the target file… whenever the task is LLM-shaped") — in a repo with zero
   Gemini code and Vercel-AI-Gateway assistant milestones (M16/M9) up next, it
   risks steering sessions to the wrong provider's API. `user-experience`
   (256K) is unreferenced in AGENTS.md. Remove the Gemini skill unless there's
   an undocumented reason; document or remove the other.
9. **Known-issues hygiene (LOW-MEDIUM):** register is in good shape; one wrong
   cross-reference — KI-47's resolved entry points at KI-50 where the tag-count
   design delta is **KI-52**. `scripts/repro-ki13.sh` outlived its closed KI
   (its own header admits it doesn't reproduce anything); delete or fold into
   the Phase-5 prune decision.
10. **Small items (LOW):** `TODO.md:159` references the deleted
    `phase-8b-design-sync.md`; the `TripSummary.startDate` candidate still
    anchors to closed-M10 sequencing. **Verified alive — do not delete:**
    `packages/predict` (the deliberate lint-wall seam), `FocusProvider`
    (predates cancelled Phase 1b, actively imported), the three retired lenses
    (fully gone), `.coderabbit.yaml` paths (all exist), `.claude/launch.json`
    (clean, single entry), every path AGENTS.md/CLAUDE.md references (all
    exist). `scripts/design-wall-pending.json` being `[]` is the designed end
    state and still load-bearing for `check-color-wall.mjs`.

---

## 6. Less code, same outcome — and long-term maintainability

### 6.1 The headline: collapse activity-field enumeration from ten sites to one

The field set (`title, timeWindow, location, notes, anchors, kind, tags,
cost`) is hand-enumerated in **ten** places, not the four STATUS.md names:
`contracts/src/activity.ts` (commands ×2 + the two event payloads, verbatim
duplicates), `contracts/src/detail.ts` (`ActivityView`), `domain/src/trip/`'s
`state.ts` (a hand-written near-copy of `ActivityView` — brushing the "no
hand-written types duplicating contract schemas" invariant), `equality.ts`,
`diff.ts` (two payload literals), `hydrate.ts`, `detail.ts`, `evolve.ts`,
`decide.ts`, and `test/support/tripGenerator.ts` — plus
`apps/web/src/server/duplicateTrip.ts:90-102`. M18 touched every one; only
runtime tests, never the compiler, catch a missed site (and §1.6 above shows
one field pair that *was* missed, permanently).

**Proposed shape** (full sketch in the review record; summary):

1. **Contracts:** one `ActivitySnapshot` Zod object + a
   `SnapshotWithReplayDefaults` extension carrying the `.default()`s; commands
   and both event payloads become `.extend()`s of it. Wire shape byte-identical
   (source composition, not a contract change — changelog entry anyway).
2. **Domain:** `ActivityState = ActivitySnapshot` (derived, not hand-written);
   a new `activityFields.ts` holding a mapped-type `FIELD_EQUAL` record over
   `keyof ActivitySnapshot` — **the compiler fails when the schema gains a
   field until an entry is added** — from which `activityStatesEqual`,
   `applyPatch` (the one omitted-vs-null merge rule `decide.ts` spells
   per-field), `EMPTY_FIELDS`, and `ACTIVITY_FIELD_KEYS` all derive.
3. **Call sites become spreads/key-driven picks:** `diff.ts`'s payload
   literals → `{tripId, activityId, dayId, ...a}`; `hydrate.ts` → key-driven
   `pickSnapshot` (key-driven, not rest-spread, so unparsed details can't
   smuggle extra keys into stored payloads); `evolve.ts` → rest-destructure;
   `decide.ts` → `applyPatch`; the generator's value pools become a mapped
   record so **the test generator also fails to compile** on a new field.

Result: a new contract field = one schema edit + three compile-forced entries,
all in one file. ~120 LOC of repetition deleted; the 10-site scavenger hunt
becomes a type error. Risk medium-low — guarded by the repo's strongest tests
(diff round-trip property, hydrate property, equality suite). One semantic to
preserve knowingly: fix §1.6 (city/countryCode) first or fold it in
deliberately, so the descriptor doesn't fossilize the blind comparison.
Per AGENTS.md, the contracts step is its own reviewed PR.

### 6.2 Do-now quick wins

- **Compose the event-payload schema block even if 6.1 is deferred** —
  `activity.ts:134-141` vs `153-160` are verbatim copies; a `.default()`
  landing on one payload but not the other silently corrupts replay for
  updated activities only. ~16 LOC, wire-identical, minimal risk.
- **`InsertPlaybookDialog.tsx:21-24`** re-declares `toMinutes`, a byte-identical
  copy of `lib/time.ts:8-11` — whose header comment exists to say "one copy."
  Import it; keep the genuinely-different `fromMinutes` with a one-line
  clamp-vs-modulo comment.
- **Three copies of UTC add-days arithmetic** (`lib/dates.ts:5-8` inline,
  `calendarData.ts:49-53`, `NewTripWizard.tsx:76-80`), each re-deriving the
  bare-parse footgun in comments. Export `addDaysIso` from `lib/dates.ts`.

### 6.3 Worthwhile

- **Extract TimelineLens's inline pure helpers** (`lastEndTime`, `nextSlot`,
  `addRowLabel`, `totalScheduledMinutes`, `routeSummary` — ~110 lines of pure
  functions in a 719-line component). This is the repo's own established
  pattern (`timelineData.ts`, `overlapData.ts`, `resolveDrop.ts`) left
  unfinished: `nextSlot` is currently exported *from the .tsx* and unit-tested
  inside a 660-line jsdom test file, paying browser-world setup for pure
  arithmetic. Move to `timelineSlots.ts` + a node-env test. (TripBoardScreen,
  NewTripWizard, Board were checked and do **not** need this — their
  extractables are already out.)

### 6.4 Verified healthy — deliberately not findings

`predict`/optimistic layering is already unified (one-line re-export; client
prediction reuses the real domain reducers — no duplicated logic). `witness.ts`
triplication is deliberate and documented (a shared package = a new module-map
entry; revisit only at a fourth consumer). `moneyEqual`/`fmt` micro-duplicates
are forced by the CI-enforced UI/domain boundary. Config sprawl: none (all
tsconfigs/vitest configs are one-line extends or measured splits). Dead
abstractions: none (AccessPolicy and Geocoder both have real second
implementations or documented seams).

---

## 7. New Claude tooling for this repo

Derived from where the findings above show rules being re-broken despite being
written down — the pattern is consistent: **prose rules regress; mechanical
gates don't.**

1. **PreToolUse Bash guard for the two banned test forms.** CLAUDE.md rule 1
   has now been violated by the repo's own committed skill (F2), a plan file
   (Docs §6), and twice historically (KI-27). A small hook matching
   `test:e2e(?!:ci-like)` and `--filter web test -- --run` in Bash commands,
   printing the rule and the correct command (allow an explicit override token
   for deliberate dev-lane spec iteration), ends the class. Highest
   payoff-per-line of anything in this section.
2. **Extend the existing PostToolUse typecheck hook** with the factories entry
   (F3) — same file, one object literal.
3. **A `status-gc` skill (or a step in the gate-close checklist)** that
   archives STATUS.md's closed-milestone sections into the milestone
   file/retro and rewrites Next action — run at every gate close. Docs §1-2
   shows this drifts every time it's left to prose discipline; `/roadmap`
   reconciles flags but not narrative staleness.
4. **A `ki-file` skill** that appends a correctly-formatted known-issues entry
   (id allocation, cross-reference check). The one defect found in the
   register was a wrong cross-ref (KI-50 vs KI-52) — exactly what a template
   prevents. Cheap.
5. **ESLint rule (or a wall script) banning `page.waitForTimeout` in `e2e/`**
   without an inline justification comment (Testing §8). The repo's wall-script
   pattern (`check-lint-wall.mjs`) already knows how to do this.
6. **Give the three repo subagents the `Skill` tool** (or reword their
   instructions to read the SKILL.md files) so `ki-fixer`/`phase-implementer`/
   `phase-verifier` can actually follow their own directions (F11).
7. **A monthly `ci-spend` check** — the cost doc's measurement method as a
   skill, so "measure once after the change" (F5/F9) actually happens, and a
   hung-run regression (F4) is caught within a month.
8. **When M16 starts: an eval-set skill for the assistant** — M16's milestone
   file already owes per-ask analytics and a fixed eval set; KI-11 shows the
   mock suite is structurally blind to live-model regressions. A
   `assistant-replay` skill (fixed prompts → record `meta` envelopes → diff
   across runs, off-CI) covers both with one artifact.

Not recommended: more subagents or more prose in AGENTS.md. The review's
strongest cross-cutting evidence is that the repo's written rules are good and
its *mechanical* enforcement is what lags — every high finding above is either
a missing guard (F3, F4, F7, H1, M1) or prose that drifted from reality
(F1, F2, F6, Docs §1-3).

---

## Suggested sequencing (PR-sized batches)

1. **Correctness (small, high value):** apiClient try/catch (§1.1, fixes §1.2)
   + `submitAssistantAsk` pending gate (§1.4) + file the new KI + equality
   city/countryCode (§1.6, with generator pool addition).
2. **Security quick wins:** AI prompt cap + rate limiter (H1), dev-login
   `VERCEL_ENV` guard (M1), `headers()` block (M2), real SECURITY.md (L1).
3. **Agent-tooling fixes (one commit each, near-zero risk):** ci-triage F1/F2,
   factories in hook + maps (F3), `timeout-minutes` (F4), phase-verifier root
   lint (F6), destructive-git regex (F7), launch-config `WEB_PORT` (F8), the
   PreToolUse test-lane guard (Tooling §1).
4. **Docs one-day pass:** STATUS.md prune + Next-action rewrite (Docs §1),
   M17 into TODO/order (Docs §3), surface test-overhaul Phases 5-7 (Docs §4),
   plans/deps/skills/KI-ref hygiene commit (Docs §6-9), DRIFT.md pass (§5).
5. **Testing:** vitest `test.projects` migration (§2), de-sleep map-rail (§3),
   `check:full` (§4), then the full Phase 5 prune with re-inventory (§1) and
   e2e teardown (§5).
6. **Refactors, each its own PR:** event-payload composition (6.2 first), then
   the field-descriptor refactor (6.1, contracts step first per AGENTS.md),
   TimelineLens extraction (6.3).

# Quality enforcement

## The testing pyramid (what every layer owes)

| Layer | Test kind | Bar |
|---|---|---|
| `packages/domain` | Vitest unit + fast-check property tests | Every `decide`/`evolve` branch; every conflict rule gets property tests; upcasters proven against old-version fixtures |
| `packages/contracts` | Schema round-trip tests | Parse/serialize fixtures; breaking-change detection by reviewing changelog |
| `apps/web/src/server` | Integration against real Postgres (docker-compose) | Every endpoint: happy path + rejection + authz denial; event-store suite (ordering, optimistic concurrency, rebuild) |
| `apps/web` UI | Component tests against MSW mocks | Critical interactions (drag, conflict surfaces, undo) |
| Whole system | Playwright e2e | One happy-path script per milestone, green forever after its gate |

## Golden tests (never allowed to fail, never allowed to be skipped)

1. **Projection rebuild:** drop read models, replay the full log, result must
   equal stored state. Runs in CI on every PR.
2. **Optimistic concurrency:** two appends at the same `(stream_id, seq)` —
   one wins, one returns a typed conflict.
3. **Replay totality:** a fixture log containing every event type at every
   historical version folds without error.
4. **Lint wall:** fixtures importing `@tc/domain` from UI code must fail CI.

## CI pipeline (every PR)

typecheck → lint (including boundary rules) → unit → integration (Postgres
service container) → e2e smoke → golden tests. All green or it doesn't merge.

`pnpm check` (typecheck + lint + unit) is the fast subset with no
infrastructure dependency — run it constantly while iterating. It does
**not** run integration or e2e, since those need a running Postgres
(`pnpm setup` once, then `docker compose up -d` or equivalent) and, for e2e,
installed Playwright browsers. Run those explicitly before claiming done on
anything that touches the server or a user-facing flow:
`pnpm test:int` (`apps/web`'s `*.int.test.ts` against real Postgres) and
`pnpm --filter web test:e2e` (or scope to one spec while iterating, e.g.
`pnpm --filter web test:e2e m10-map-rail`) — see
`environments-and-deploys.md` for the one-time env setup. None of the three
commands need you to `export` DATABASE_URL by hand.

**`pnpm --filter web test:e2e` runs against `pnpm dev`, not what CI runs
(KI-27).** `playwright.config.ts` only switches to `pnpm start` (the
production build) when `process.env.CI` is set — locally it defaults to the
dev server for fast iteration. That's the right default while you're writing
a spec, but dev mode's on-demand per-route compilation adds a real,
variable delay on a route's first hit in a run (confirmed directly: 3.8s
cold, 0.2s warm) that's easy to mistake for a genuine failure — a "stuck on
Loading…" timeout that isn't code-caused. Two real bugs during M10 Phase 4
produced false signals this way in the same session (a fixed bug that
looked possibly-still-broken; a real regression initially masked by
unrelated dev-server noise) — see KI-27 in `known-issues.md` for the full
story.

Reach for `pnpm --filter web test:e2e:ci-like` instead of plain `test:e2e`
whenever a local e2e result needs to be trustworthy on its own — before
concluding a bug is fixed, before concluding a failure is flaky noise, and
always before opening/updating a PR whose diff touches a user-facing flow.
It builds production and runs the full suite with `CI=true`, which flips
`webServer.command` to `pnpm start` and sets `AUTH_TRUST_HOST` for you
(Auth.js rejects `next start` traffic from an untrusted host otherwise) —
the same server CI's `integration-e2e` job actually runs against. It's
slower (a full production build first) — that's the tradeoff for the
signal being real; don't run it on every iteration, just before trusting
the result.

**This paragraph was not enough, twice** (2026-08-26, PR #55 — see KI-27's
amendment). Two supports were added because a rule only read by someone who
already opened this file is not a control:

- A **failing local run now prints the warning itself**
  (`apps/web/e2e/laneReporter.ts`), naming `test:e2e:ci-like` at the moment the
  misreading would otherwise happen.
- The **non-CI budgets now fit the non-CI server** — `timeout` 120s and
  `expect` 20s locally, against CI's 30s/5s. That removes a band of false
  failures from the iteration lane but **does not make it authoritative**: at
  full-suite parallelism the dev lane still failed specs `ci-like` passed
  (21/23 vs 23/23). Everything above stands unchanged.

Recognise the shape: **a failure whose location moves between runs is a
timeout; a real defect fails in the same place every time.** And before
recording a failure as environmental anywhere, grep `docs/known-issues.md` for
the symptom — see `cloud-agent-sessions.md`.

## Definition of done (restated from AGENTS.md — the checklist)

- [ ] `pnpm check` green locally; CI green.
- [ ] New logic has tests at its layer per the pyramid above.
- [ ] Milestone e2e extended if a user flow changed.
- [ ] Contracts changelog entry if any schema changed; consumers updated in
      the same PR.
- [ ] No invariant weakened; blockers reported, not bent.
- [ ] Docs updated (ADR / milestone file / guidelines) if behavior or
      interfaces changed.
- [ ] Conventional commit(s), one logical change each.
- [ ] PR opened from `.github/PULL_REQUEST_TEMPLATE.md`, with **Verification
      actually performed** filled in — including what was *not* run and why.

## Waiting on PR checks

Do not hand-poll `gh pr checks` in a loop. One command blocks on all of them:

```
gh pr checks <n> --watch --fail-fast
```

CodeRabbit is a registered status check, so this covers it too. Its summary
comment appears within about 30 seconds; its review verdict takes 2-11
minutes. Treat its findings as bug reports to verify against the code — it
caught a genuine navigation race in M10 Wave 2 Phase 7. Its verbosity and
per-path focus live in `.coderabbit.yaml`.

Run straight after a push, `--watch` may return in ~1s with the *previous*
commit's checks — all green, indistinguishable from your push having passed.
Confirm a run exists for your actual HEAD before trusting it:

```
gh run list --commit "$(git rev-parse HEAD)" --limit 1
```

## Fast feedback while you work

- A `PostToolUse` hook (`scripts/hooks/typecheck-touched-package.mjs`)
  typechecks only the package owning each edited `.ts`/`.tsx` file, so a type
  error surfaces seconds after the edit rather than at `pnpm check` time. It
  applies the same narrowing rules as the `minimal-check-subset` skill,
  including the contracts hard-exception, and uses an incremental build-info
  cache (~4s first run, ~1.6s after).
- A failing CI e2e run uploads `playwright-report/` and `test-results/` as the
  `playwright-report` artifact. `trace: "on-first-retry"` means a flaky failure
  hands back a real trace — download it instead of re-reading job logs.

## Code review expectations (agent-to-agent or self-review before Mitchell)

- Verify claims by running commands, not by reading code sympathetically.
- Check the diff against the drift signals in `validating-direction.md`.
- Prefer deleting code to adding it; match surrounding style; comments only
  for constraints code can't express.
- Reject "temporary" duplication of contract types on sight.

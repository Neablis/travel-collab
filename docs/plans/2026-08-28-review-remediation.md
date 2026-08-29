# Review remediation — the 2026-08-28 project + PR #71 reviews

Both reviews (`docs/reviews/2026-08-28-project-review.md`,
`docs/reviews/2026-08-28-m11-pr71-review.md`) closed out at `4223adc` with
almost everything still open. Three PRs have landed since (#74 fixtures, #75
subagent protocol, #76 OG metadata); none of them touched a review finding.

Re-verified against the tree at `63f83ff` before planning. **Two findings are
already fixed and drop out:** KI-54 (`Location.city`/`countryCode` in
`activityStatesEqual` — project review §1.6) and KI-42 (`confirmHead`, §1.3),
both by PR #73's KI sweep. Everything else below was confirmed still live by
reading the code, not by trusting the review.

## Blocking, not agent work

**Migrations 0006–0009 are still undispatched.** `migrate-production.yml` has
zero runs ever (re-checked via the GitHub API at plan time). Production sign-in
attempts a `users` upsert against a table that does not exist, so sign-in is
broken there — not just the M11 features. `gh workflow run
migrate-production.yml -f confirm=migrate`, from `main`. This is a production
action and needs Mitchell's go-ahead, not a subagent's.

## Waves

Parallel agents work in one tree with **strictly disjoint file scopes**; the
orchestrator does all git. Waves exist where scopes would otherwise collide.

### Wave 1 — correctness and security (5 agents, disjoint)

| Agent | Findings | Scope |
|---|---|---|
| **W1-A send-queue integrity** | PR §3, §4; project §1.1, §1.2, §1.4 | `lib/apiClient.ts`, `context/TripProvider.tsx`, `board/TripBoardScreen.tsx`, `SavedDaysDialog.tsx`, `AddSavedDayButton.tsx` |
| **W1-B access layer** | PR §1, §2, §7-invite-preview | `server/access/invites.ts`, `server/access/trip-access.ts`, `lib/savedStops.ts` |
| **W1-C AI + geocode limits** | project H1, L4 | `server/ai/handleAiRequest.ts`, `server/rateLimit*`, `api/geocode/route.ts` |
| **W1-D auth gate + headers** | project M1, M2, L1; PR §7 | `lib/authConfig.ts`, `lib/devLogin.ts`, `next.config.ts`, `SECURITY.md`, `.env.example` |
| **W1-E agent tooling + CI** | project F1–F8, F11 | `.claude/skills/**`, `.claude/agents/**`, `scripts/hooks/**`, `scripts/sync-launch-config.mjs`, `.github/workflows/**` |

### Wave 2 — surface and query (3 agents)

| Agent | Findings | Scope |
|---|---|---|
| **W2-A viewer gating** | PR §5 | board/lens components (collides with W1-A on `TripBoardScreen.tsx`) |
| **W2-B trips-list query** | PR §6; project L3 | `api/trips/route.ts`, `server/projections.ts`, `server/access/members.ts` |
| **W2-C docs + hygiene** | project Docs §1,3,5,6,7,8,9; PR §4/§8 KI filing | `docs/**`, `TODO.md`, `.design-sync/**`, `apps/web/package.json` deps, `.claude/skills/gemini-*` |

### Wave 3 — testing and small refactors (2 agents)

| Agent | Findings | Scope |
|---|---|---|
| **W3-A testing loop** | project Testing §2,3,4,5,8 | `vitest.unit.config.ts`, `e2e/**`, `playwright.config.ts`, `package.json` scripts, a `waitForTimeout` wall |
| **W3-B refactor quick wins** | project §6.2 | `contracts/src/activity.ts` payload composition, `InsertPlaybookDialog.tsx` `toMinutes`, `lib/dates.ts` `addDaysIso` |

## Deliberately deferred (with reasons)

- **§6.1 activity-field descriptor refactor** — the right call, but AGENTS.md
  makes the contracts step its own reviewed PR, and it touches ten sites plus
  the generator. Its own milestone-sized change, not a remediation wave.
- **Testing §1 Phase 5 prune** — the plan requires re-running the Phase 0
  inventory first. Real work, own PR; surfaced in TODO.md by W2-C instead.
- **Security L7 Dependabot (19 alerts)** — needs per-advisory triage against
  actual usage; a `.github/dependabot.yml` lands in W1-E so future bumps are
  tracked, the triage itself is separate.
- **PR §7 member-email disclosure, 403/404 oracle** — the reviews themselves
  call these deliberate product decisions. Mitchell's call, not a fix.
- **KI-11 live-model replay harness** — belongs with M16.

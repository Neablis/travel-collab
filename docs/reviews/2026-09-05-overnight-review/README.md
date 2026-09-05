# Overnight project review — 2026-09-05

**Status: RUNNING since 00:31 PT 2026-09-05.** This file is
the plan and the live tracker; it is updated as each stream finishes. The
findings it produces live one-per-file under `findings/`, written so a fixer
agent can act on one without re-deriving it.

Requested by Mitchell 2026-09-04 22:15 PT: *"the big pass"* — track progress,
use research subagents, and leave a list of found issues documented well
enough for another agent to fix.

Tree under review: branch `claude/project-overnight-review-nxjj1y` at the
commit this file is committed in, which is `main` (`947646f` + #142) plus this
review's own prose. No code is changed by this review.

## Scope — the seven questions

| # | Stream | Question | Where to look first |
|---|---|---|---|
| A | Security | Are invites, shared trips, members, and the shared notebook / playbook library safe? Authz on every route, token handling, CSP, dev-only routes, AI spend. | `apps/web/src/server/access/**`, `accessPolicy.ts`, `apps/web/src/app/api/**`, `middleware.ts`, `auth*.ts`, `SECURITY.md`, KI-066 |
| B | Notebook + widget AST | Is the widget framework a framework — clean, extensible, common-sense rules for the next fifty widgets — or a hand-built set of twelve? | `packages/pages/**`, `packages/contracts/src/pageDoc.ts`, `pages.ts`, `apps/web/src/components/pages/**`, `server/pages.ts`, `server/ai/pageTools.ts`, ADR-035…039, `docs/specs/2026-09-0{3,4}-*.md` |
| C | Versioning, history, migration | Will the first major change or pivot break existing trips and notebooks? Event versioning, `PageDoc` migrations, projection rebuild, Drizzle migrations, clone/share replay, kept-day snapshots. | `packages/contracts/src/{events,history,pageDoc}.ts`, `server/{eventStore,projections,history,cloneTrip}.ts`, `access/sharedView.ts`, `savedDays.ts`, `drizzle/**`, ADR-003/005/016/027/028/036/038/040 |
| D | Infra, DB, Vercel, review loop | Are the dev / DB / deploy decisions right, and are we using the tools we have (Vercel, GitHub, CodeRabbit, Neon, Sentry, flags) well? | `.github/**`, `apps/web/scripts/**`, `scripts/**`, `docs/guidelines/{environments-and-deploys,ci-cost-and-capacity,quality-enforcement}.md`, `.coderabbit.yaml`, `next.config.*`, `sentry.*`, `.claude/**` |
| E | Maintainability & patterns | Which coding patterns are working, and which cause repeat issues? Mine the KI register and retros for recurrence classes; read the largest files. | `apps/web/src/components/**` (esp. `TripBoardScreen`, lenses, `TripProvider`, `optimistic.ts`), `lib/apiClient.ts`, `docs/known-issues/**`, `docs/retros/**` |
| F | Simplifiable code | Where is code more complicated than its job? | `server/ai/**` (esp. `handleAskRequest.ts`), `server/{quota,admission,savedDays,playbooks}.ts`, `packages/domain/**`, duplicated helpers across `components/**` |
| G | Broken functionality | What is broken now and uncaught? Run every lane that can run here, then hunt in code the lanes do not reach. | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:int` (Postgres :5433), `pnpm --filter web test:e2e:ci-like`; then untested routes and UI paths |

## Method

1. **One research subagent per stream**, all dispatched in parallel at 00:30 PT,
   each with the brief in `briefs/` and a hard rule: **cite `file:line` for every
   claim, and separate CONFIRMED (path traced end to end) from PLAUSIBLE
   (mechanism seen, trigger not proven).** Read-only; no code changes.
2. **A verification wave** re-checks every finding marked HIGH or CONFIRMED
   against the tree before it is written up, independently of the agent that
   found it. Anything that does not survive is dropped or downgraded, and the
   report says so.
3. **Write-up.** Each surviving finding becomes `findings/F-<stream><nn>-<slug>.md`
   in the template below; the report body (this README, §Findings) indexes them
   by severity and the executive summary names the ten to act on first.
4. **Known-issues cross-check.** Before filing, `grep -rl <symptom> docs/known-issues/`.
   A finding that already has a KI links to it rather than duplicating it
   (README rule: one defect, one entry). New correctness defects are **not**
   filed as KIs by this review — the register is for things knowingly left
   unfixed, and the point of this list is that they get fixed — but the
   template carries every KI field so filing one is a `git mv` if Mitchell
   decides to defer.

## Finding template (`findings/F-*.md`)

```markdown
# F-A01 — <one line, symptom terms>

- **Stream:** A Security · **Severity:** HIGH | MEDIUM | LOW · **Confidence:** CONFIRMED | PLAUSIBLE
- **Area:** files a fixer opens first, with lines
- **What is wrong:** the observable problem, then the mechanism, with `file:line` cites
- **How to reproduce / how it was verified:** the exact steps or the code path traced
- **Suggested fix:** concrete enough to start from; name the alternative if there is a real choice
- **Scope of the fix:** files touched, whether contracts change (→ CHANGELOG entry), whether a migration is needed, expected check subset
- **Test that should exist:** what would have caught it, at which layer (`docs/guidelines/testing.md`)
- **Cross-reference:** KIs, ADRs, milestones, prior review sections
- **Do not:** anything a fixer might reasonably do that would be wrong here
```

## Tracker

Updated live. Times are PT.

| Step | State | Notes |
|---|---|---|
| Orientation read (AGENTS, STATUS, layout, prior reviews) | done 22:40 | This file |
| Briefs written for A–G | done 22:55 | `briefs/` |
| Wake scheduled 00:30 | done 22:56 | send_later → 07:30 UTC |
| Streams A–G dispatched | 00:31 | seven general-purpose agents, parallel |
| A Security | done 00:41 | 7 findings (6 CONFIRMED), 37-route authz table, 08-28 items: 7 fixed, 2 still open |
| B Notebook / widget AST | done 00:41 | 9 findings (8 CONFIRMED), 3 recipes, 12 proposed rules |
| C Versioning / migration | done 00:40 | 7 findings (6 CONFIRMED), pivot-cost analysis, 13 verified-sound |
| D Infra / DB / Vercel / review loop | done 00:43 | 8 findings (6 CONFIRMED), 13 ranked recommendations, 08-28 items: 8 fixed, 2 still open |
| E Maintainability / patterns | done 00:39 | 9 findings (7 CONFIRMED), 7 recurrence classes, 12 verified-sound |
| F Simplifiable | done 00:44 | 12 findings (all CONFIRMED), /ask flow map, 13 deliberately-not |
| G Broken functionality (lanes + hunt) | lanes done 00:46, hunt relaunched 07:35 | ALL LANES GREEN: typecheck, lint, unit, int 450/450, seed:verify 18/18, e2e ci-like 89/89, drizzle check. First agent killed by session limit during the browser walk |
| Verification wave | A–F done 08:05 | Session limit hit ~00:50 PT killed four verifiers + stream G mid-run; resumed 07:31 PT. Every stream had 1–4 cites pointing at wrong lines; all corrected in findings/. One escalation (F-B09), four downgrades, one drop (F09 truncators) |
| Findings written | A–F done 08:10 (44 files); G pending | |
| Executive summary | pending | |
| Committed + pushed | pending | |

## Findings

*(filled in as streams complete)*

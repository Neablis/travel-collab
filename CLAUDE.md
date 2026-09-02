# CLAUDE.md

Read `AGENTS.md` — it is the single operating manual for this repo (invariants,
architecture boundaries, workstreams, definition of done). Everything there is
binding for agent work here.

Quick orientation:
- **Where the work actually is right now (read this first): `docs/STATUS.md`**
- What to work on next: `TODO.md`
- Product/architecture design: `docs/specs/2026-07-07-foundation-design.md`
- Decisions and rationale: `docs/architecture/` (ADRs)
- Current milestone and gates: `docs/milestones/README.md`
- How to build/connect/validate/enforce quality: `docs/guidelines/`
- Contract change log: `docs/contracts/CHANGELOG.md`
- Known issues & tech debt (unfixed-but-known): `docs/known-issues/` (one file per entry; `open/` is the list)
- How to write a test worth its cost: `docs/guidelines/testing.md`
- Working in a cloud session (what's different here): `docs/guidelines/cloud-agent-sessions.md`

Four rules that are cheap to state and were expensive to relearn:

1. **An e2e result only counts from `pnpm --filter web test:e2e:ci-like`.**
   Plain `test:e2e` serves `pnpm dev`, which compiles routes on first hit and
   produces timeouts CI does not have. The dev lane is for iterating on a spec
   you are writing — not for a verdict, a PR checkbox, or anything you tell
   Mitchell.
2. **Before calling a failure environmental, flaky, or infra,
   `grep -r "<symptom>" docs/known-issues/`.** Both times rule 1 was broken, the
   entry describing it (KI-27) already existed and went unread. A failure whose
   location *moves between runs* is a timeout; a real defect fails in the same
   place every time.
3. **A test is not done until you have seen it fail.** Break the code it
   protects, watch it go red *for your reason*, restore it, watch it go green.
   Three tests written in one session (2026-09-02) passed while asserting
   nothing, and every one was caught only by doing this afterwards. The PR
   template asks for the source edit and the real failure text. Procedure:
   `docs/guidelines/testing.md`, or the `write-a-test` skill.
4. **Verification scales to the change; it is not one flat list.** A prose-only
   change (`docs/**`, `.claude/**`, root `*.md`) runs **nothing** — CI and
   CodeRabbit both filter those paths, so there is no check to wait for either.
   Scoped code runs the `minimal-check-subset` skill's output, not `pnpm check`.
   The full suite is a **final-review** cost, paid once when the branch leaves
   draft. `AGENTS.md`'s Definition of Done has the three tiers and the trap
   (`.design-sync/**` is a build input, not prose).

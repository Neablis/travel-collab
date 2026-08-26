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
- Known issues & tech debt (unfixed-but-known): `docs/known-issues.md`
- Working in a cloud session (what's different here): `docs/guidelines/cloud-agent-sessions.md`

Two rules that are cheap to state and were expensive to relearn:

1. **An e2e result only counts from `pnpm --filter web test:e2e:ci-like`.**
   Plain `test:e2e` serves `pnpm dev`, which compiles routes on first hit and
   produces timeouts CI does not have. The dev lane is for iterating on a spec
   you are writing — not for a verdict, a PR checkbox, or anything you tell
   Mitchell.
2. **Before calling a failure environmental, flaky, or infra, grep
   `docs/known-issues.md` for the symptom.** Both times rule 1 was broken, the
   entry describing it (KI-27) already existed and went unread. A failure whose
   location *moves between runs* is a timeout; a real defect fails in the same
   place every time.

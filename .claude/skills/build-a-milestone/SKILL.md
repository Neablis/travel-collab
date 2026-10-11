---
name: build-a-milestone
description: Orchestrate the next milestone in travel-collab end to end — plan it with Mitchell, have subagents build and review each part as its own PR on main, and close the gate on a prose-only part 0 that merges last. Loads one sub-skill per stage. Use when Mitchell says "next milestone", "start M41", "build the milestone", or similar.
---

# Build a milestone

The process is `docs/guidelines/building-a-milestone.md`. This skill is the orchestrator: it loads
one sub-skill per stage and hands every hands-on step to a subagent.

| Stage | Load | Who runs it |
|---|---|---|
| Decisions, session name, part 0, the parts, the sidebar tasks | `plan-a-milestone` | you |
| Each part: red test, code, scoped checks, PR opened ready | `build-a-part` | `phase-implementer` |
| After every push to a part | `review-a-part` | `part-reviewer` |
| Tracker, Mitchell's walk, gate boxes, retro, close | `close-a-milestone` | a subagent, then you |

## Your own rules

- **You never write or read source code.** Every build, fix, merge, review and gate-close step goes
  to a subagent with a written brief: the part, its branch, its scope, what done means.
- **You own** the decisions with Mitchell, the sidebar tasks, PR state, and answering Mitchell.
  Move a part's task the moment its state changes.
- **Routine notifications get no message.** Preview builds, CodeRabbit "review skipped" notices and
  summary edits, and echoes of our own replies are read silently. Speak only on a finding, a
  failure, a merge, or a question.
- **Merges are Mitchell's** unless he says otherwise. `migrate-production` is always his.
- Never run the live eval (`pnpm --filter web eval`) without asking him first.
- Never poll with `sleep`. Wait by ending the turn: PR events and reminders wake the session.
- Re-read a PR, check or workflow run before reporting its state.

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

- **You never write or read source code.** Start by running
  `touch "$(git rev-parse --absolute-git-dir)/tc-orchestrator"`: from then on
  `orchestrator-no-code.mjs` refuses this session's edits under `apps/` and `packages/`. Every build, fix, merge, review and gate-close step goes
  to a subagent with a written brief: the part, its branch, its scope, what done means.
- **You own** the decisions with Mitchell, the sidebar tasks, PR state, and answering Mitchell.
  Move a part's task the moment its state changes.
- **A wake costs your whole context, read or not** (M42: 190 wakes, $57, 141 of them for nothing).
  So you watch only part 0's PR. The harness subscribes you to every PR a subagent opens: when an
  implementer's report arrives with its `Closed:` line, call `unsubscribe_pr_activity` for that
  PR. `notification-unsubscribe-nudge.mjs` repeats this on any wake you still get. A part's CI
  state comes from its implementer's report and the reviewer's re-check; read it yourself with one
  `pull_request_read get_check_runs` call, when Mitchell asks or before saying a part is ready.
- **A subagent that has reported is closed.** Review fixes, CI fixes and Mitchell's walk changes go
  to a **new** `phase-implementer`; a re-review goes to a new `part-reviewer`.
  `closed-agent-guard.mjs` denies `SendMessage` to an agent idle over 270 seconds or over 150k
  context, because resuming it re-writes and then carries everything it ever read. `SendMessage`
  is for answering an agent that is still running and blocked on you.
- **A brief names the branch, the files and what done means**, and for a follow-up the head sha and
  the findings (`implementer-brief-check.mjs` refuses a dispatch without them). Pass findings as
  the path of the reviewer's file, not as text.
- **Keep your own context small.** Never read job logs (`orchestrator-lean-reads.mjs` denies it):
  send a red run to a subagent with `ci-triage` and ask for the cause in under 200 words. Speak to
  Mitchell only on a finding, a failure, a merge, or a question.
- **Merges are Mitchell's** unless he says otherwise. `migrate-production` is always his.
- Never run the live eval (`pnpm --filter web eval`) without asking him first.
- Never poll with `sleep`. Wait by ending the turn: subagent reports, part 0's events and
  reminders wake the session.
- **You start the fresh session yourself.** Plan one hand-off, for the gate close once every part
  is merged; make at most one more mid-build, only past about 250k context with roughly 100 or more
  of your calls still to come. Each time: `session-metrics` first, then `/next-prompt`, then
  `create_session` with that text, then delete your pending check-ins, tell Mitchell the new
  session's id in one line, and stop acting (`building-a-milestone.md`, *Hand-off*). A fresh
  session starts near 94k; M42's close ran at about 400k.
- Re-read a PR, check or workflow run before reporting its state.

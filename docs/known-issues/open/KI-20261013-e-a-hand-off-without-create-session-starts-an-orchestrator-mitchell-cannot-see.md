### KI-2026-10-13-e — a hand-off without `create_session` starts an orchestrator Mitchell cannot see, answer or steer

- **Severity:** reliability. The milestone keeps moving, but its orchestrator is out of Mitchell's
  reach: its questions go unanswered, and a blocked or wrong session goes unnoticed.
- **Area:** `.claude/skills/next-prompt/SKILL.md` (Step 4: `create_session`, and the fallback when it
  is missing); `docs/guidelines/building-a-milestone.md` (*Hand-off*);
  `.claude/skills/build-a-milestone/SKILL.md` ("You start the fresh session yourself").
- **Symptom:** the M46 orchestrator (session_013FKGghWjcdv3FMpPzacj8b, a Claude app chat session that
  cloned the repo) passed 250k context, and the context-limit hook asked it to hand off. It had no
  `create_session` tool, and nothing lets a session clear its own context. As a workaround it
  started the continuation with a one-time `create_trigger` holding the hand-off prompt. The new
  session (session_011qbNMRGbsPBTwdL5JLuArV) ran and did the work: it opened PR 435 and PR 436.
  But a session started by a scheduled task does not appear in Mitchell's session list. The
  direct URL (`https://claude.ai/code/<session id>`) is the only way in, so he could not see it,
  answer its questions, or tell whether it was blocked.
  It also spreads: the hand-off brief told the new session to use the same `create_trigger`
  fallback for its own hand-off.
- **Related friction, same session:**
  - The `phase-implementer`, `part-reviewer` and `ki-fixer` agent types were not registered until
    the session resumed inside the repo. Every builder and reviewer ran as `general-purpose`
    told to act as one, so `session-metrics` could not measure them ("no phase-implementer
    transcripts").
  - CI job logs could not be read from the container (KI-2026-10-13-f).
  - Approving each scheduled-task create and delete stalled the loop. PR 434 added those tools to
    `.claude/settings.json`'s allow list, but whether the Claude app's own prompt honours that
    file has not been checked.
- **Why not fixed here:** Mitchell (2026-10-13) wants a bigger change to orchestrator hand-offs, so
  this records the failure. **Likely fix, to decide:** a session without `create_session` stops
  and gives Mitchell the prompt to start the session himself, never a scheduled task. Better, the
  hand-off happens in a place he can see: a session he starts, or a continuation in the same
  thread. Whichever is chosen, `next-prompt` Step 4 and the hand-off rule say so, and a hand-off
  brief never names a workaround for the next hand-off.
- **Cross-reference:** M46 (part 0 PR 432); PR 433, PR 434, PR 435, PR 436;
  `docs/guidelines/cloud-agent-sessions.md`.
- **First noted:** 2026-10-13, during M46's build.

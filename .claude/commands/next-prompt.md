---
description: Generate a self-contained handoff prompt for the next session, capturing real state (branch, PR, checks, what's proven vs assumed) rather than a summary.
argument-hint: "[optional: what the next session should focus on]"
---

# Generate the next prompt

Produce a **copy-pasteable prompt** that lets a fresh session pick this work up
cold. The next session has none of this conversation — write for that reader.

Focus for the handoff (may be empty): **$ARGUMENTS**

## Step 1 — Establish real state, don't recall it

Run these. Do not write the handoff from memory of this conversation; memory is
where "I think that passed" comes from.

```
git status -sb
git log --oneline origin/main..HEAD
git worktree list
```

Then, if a PR exists for this branch:

```
gh pr view <n> --json number,state,mergeable,headRefOid --jq '"#\(.number) \(.state) mergeable=\(.mergeable) head=\(.headRefOid[0:7])"'
gh pr checks <n>
```

Confirm the reported checks belong to your actual HEAD — `gh pr checks` will
happily show a previous commit's results:

```
gh run list --commit "$(git rev-parse HEAD)" --limit 1
```

## Step 2 — Separate what is proven from what is assumed

This is the part that carries the most value and is easiest to fake. For every
claim you are about to hand over, ask: *did I run the command, or do I believe
it?* Anything unverified goes in the handoff explicitly as unverified.

Specifically pin down:

- Which checks were actually run, with their real outcomes.
- Whether the **manual browser walk** happened. If not, say so — this is the
  step that gets silently skipped, and the one that finds real crashes.
- Whether any test was passing-on-retry (that is a bug, not a pass).
- Anything discovered and deliberately left unfixed.

## Step 3 — Write the prompt

Output a single fenced block, ready to paste. Structure it:

**Where things stand** — branch, PR number and state, what has merged and what
has not. Concrete, with SHAs where they matter.

**What is done and proven** — with the evidence. "668/668 unit tests, `pnpm
check` exit 0" beats "tests pass."

**What is done but NOT verified** — the honest list. Name the specific check
that was not run and why.

**The next concrete step** — one actionable thing, not a menu. If
`$ARGUMENTS` named a focus, that is the step. Otherwise derive it from
`docs/STATUS.md` and the first unchecked item in `TODO.md`.

**Constraints and gotchas discovered this session** — the non-obvious things
that would cost the next session real time to rediscover. Be specific: a
command that does not work the way it appears to, a file that cannot be
touched, a milestone boundary that blocks something tempting.

**Where to read in** — point at the repo's own files rather than restating
them:
- `docs/STATUS.md` — the resume-from-here file
- `TODO.md` — first unchecked item is the current work
- `AGENTS.md` — binding invariants and Definition of Done
- the relevant `docs/plans/` or `docs/milestones/` file

## Rules for the generated prompt

- **Self-contained.** No "as we discussed", no pronouns pointing at this
  conversation.
- **State over narrative.** The next session needs the position, not the story
  of how it was reached.
- **Honest about gaps.** An explicit "this was never verified" is worth more
  than a confident summary that turns out to be wrong three steps in.
- **Short enough to actually read.** If it runs past roughly 60 lines, you are
  restating docs the next session can open itself.

## Step 4 — Offer to persist it

After showing the block, ask whether to also update `docs/STATUS.md` — that is
the repo's real handoff mechanism, and AGENTS.md requires it be updated
"whenever in-flight work changes hands." A pasted prompt is for the next
session; STATUS is for every session after that.

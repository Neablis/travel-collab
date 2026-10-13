# Writing a retro

A milestone's retro is appended to its file in `docs/milestones/` at the gate close
(`close-a-milestone`). Until M42 it had no fixed shape, and nothing in it said what the milestone
cost. M42 cost 2.1× M41 for the same amount of code, and that was found only because Mitchell
asked and a session spent hours reconstructing it
(`docs/retros/2026-10-12-m42-token-spend-retro.md`). So a retro now has four sections, and one of
them is generated.

A retro about something other than a milestone (an incident, a process) goes in `docs/retros/` as
its own file. It uses the same sections where they apply, and owes a spend block only if cost is
its subject.

## The four sections

```markdown
## Retro — written <date> (<n> of <n> boxes ticked)

### What went well
<facts, each with its evidence: a PR, a commit, a run>

### What could be better
<what happened, what it cost, and the change that would have prevented it>

### Leftovers
<each with where it now lives: a known-issue id, a candidate, or "Mitchell's call">

## Spend
<!-- session-metrics:milestone v1 -->
<the generated block, pasted unchanged>

### Spend against the last milestone
<one line per target: this milestone, the last one, met or missed, and why if missed>
```

Write the first three in plain sentences. A point without evidence is an opinion; leave it out or
find the evidence.

## The spend block

Run this **in every session that worked on the milestone, before its hand-off** (`building-a-milestone.md`,
*Hand-off*), and carry the block in the handoff text. The transcripts it reads live only in that
session's container, and M45's block covered one session in five because only the last ran it:

```bash
pnpm -s session-metrics --milestone ~/.claude/projects/<dir>/<session-id>.jsonl \
  --parts <merged parts> --lines-added <n> --cost-usd <n>
```

- `--lines-added` is the merged diffs of the milestone's PRs, without `docs/`,
  `*.generated.json` and `pnpm-lock.yaml`, so milestones compare.
- `--cost-usd` is the session's recorded cost (`list_sessions` → `external_metadata.usage`). Without
  it the block reports units only, which still compare between milestones.
- Paste the output unchanged. `pnpm milestone close` looks for its marker line and refuses without
  it. `--no-spend "<reason>"` is the escape for a milestone whose transcripts are gone; the reason
  is printed in the close's output, and the retro says the same.

## The targets

Set after M42. Change one only in a retro, with the measurement that justifies it.

| Measure | Target | M42 | M41 |
|---|---|---|---|
| Dollars per 1,000 lines added | under 20 | 34 | 15 |
| Orchestrator's share of the spend | under 15% | 30% | not measured |
| A builder's average context | none over 250k | 315k (part 9) | not measured |
| GitHub wakes per merged part | under 5 | 21 | not measured |
| Cache re-writes after a coordinator message | 2 or fewer | 24 | not measured |

A missed target is a finding for *What could be better*, with its cause. The block also counts
what each spend guard denied (`scripts/hooks/`, listed in `building-a-milestone.md`, *Spend*): a
guard that denied something it should have allowed is recorded here, and one that misfires twice
is deleted.

## What the numbers do not say

- **Output tokens are understated in transcripts**, so the block's units leave them out. Output
  was under 10% of M42's cost.
- **The wake classifier was written from a description of cloud transcripts.** Its `other` row is
  the check on it: a large `other` means a pattern is wrong, not that nothing happened.
- **Scope decides most of the total.** Two milestones compare per 1,000 lines added, not in
  dollars.

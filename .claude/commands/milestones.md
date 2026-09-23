---
description: The whole milestone table with gate tallies, plus any disagreement between the files that record it.
argument-hint: "[optional: a milestone id like M26 to drill into]"
---

# Milestones

```
pnpm milestones
```

That is the whole command. It prints every milestone — id, title, TODO tick
state, exit-gate tally, the current marker — joined from `TODO.md` and
`docs/milestones/`, in ~2.8KB against a 69KB file. Then any **disagreement**
between them.

**Do not read `docs/milestones/README.md` to recover what this printed.**
Open a milestone's own file when you need box *text* rather than a tally.

Drill-down target (may be empty): **$ARGUMENTS**

If that names a milestone, read only that milestone's file, at the exit-gate
line this printed.

## What the disagreements mean

They are **facts, not verdicts** — the same posture `pnpm state` takes.

- *first unchecked item is M12, not M26* — fine when the marker records a
  Mitchell decision that overrides position. Check the marker.
- *M9 appears on 2 rows with different tick states* — the tick state is
  **unknown**, not guessed. Two rows claim one id; resolve them.
- *ticked in TODO but the gate has open boxes* — a real gate-close miss.

For the judgement about which source to believe, run `/roadmap`. This command
deliberately refuses to make it.

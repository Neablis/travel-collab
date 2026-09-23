---
description: List the unscheduled candidate ideas, with each entry's placement state.
argument-hint: "[optional: placed | scoped | unplaced to filter]"
---

# Candidate ideas

```
pnpm candidates $ARGUMENTS
```

That is the whole command. `docs/candidates.md` is ~40KB; this prints ~4KB —
one line per entry with its date, placement state and `file:line`. **Open the
file only at an offset this printed**, never in full.

Three states, and the difference decides what may be deleted:

- **unplaced** — nobody has committed to it.
- **placed → M<n>** — absorbed into that milestone, and **its gate close
  deletes the entry**. `pnpm milestone close` does that; nobody has to
  remember it. This is a rule `docs/milestones/README.md` already stated and
  that was being skipped — M23's entry survived its own gate closing.
- **scoped → M<n>** — absorbed, but the entry says it is *"kept here only for
  the reasoning"*. **Never auto-deleted.**

If you are placing a candidate into a milestone, annotate the entry in place
saying which milestone and that its gate deletes it — that annotation is what
makes the pruning automatic later.

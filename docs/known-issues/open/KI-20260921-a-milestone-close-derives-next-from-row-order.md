### KI-2026-09-21-a — `pnpm milestone close` derives the NEXT milestone from TODO.md's row order, which that file's own header says means nothing

- **Severity:** correctness (it writes the wrong milestone into four files, silently, at the one moment every status flag moves)
- **Area:** `scripts/milestone.mjs` (`close()`, the `const order = idx.items.filter(...)` / `const next = order[0]` derivation).
- **Symptom / What happens:** the script picks the next milestone as **the first unticked row in `TODO.md`**, i.e. by physical position. `TODO.md`'s own header forbids exactly that reading:

  > *"Whichever item carries `← current milestone` is the current work — **read the marker, not the position.** The list is deliberately out of order: Mitchell reorders it, and a reorder moves the marker without moving the rows."*

  So after any reorder, the derivation is reading a signal the file says carries no information.

- **How it was found:** closing M26 on 2026-09-21. The recorded order is `… → M23 ✓ → M26 → M13 → M12 → M24 → …`, but M13's row sits **below** M12's in `TODO.md` (the 2026-09-18 reorder moved the marker, not the rows, per the rule above). The dry run printed `next: M12` and proposed writing M12 into `TODO.md`'s marker and `docs/milestones/README.md`'s *Current milestone* line. **Caught only because the dry run prints a diff** — `--confirm` would have made M12 current with no error and no warning.

  This is the same class the script's own header says `assertAnchors()` exists to prevent — *"Editing four files off a parse that silently found nothing is how you corrupt all four"* — one door along: the parse here does not find nothing, it finds the wrong thing confidently.

- **Why the obvious fix is not the fix:** read the order from `docs/milestones/README.md`'s arrow line instead. There are **seven** such lines in that file and six are historical notes (`:131`, `:146`, `:159`, `:167`, `:431`, `:551`), with the live one at `:246`. Picking one automatically is a heuristic, and a heuristic here is how you get the M12 answer back with more steps. The script's stated philosophy is that it refuses rather than guesses.

- **UPDATED the same day, after CodeRabbit on PR #200.** The first mitigation made `--next` an *optional override* and left the row-order derivation as the default. CodeRabbit's Major finding was that this documents a trap and leaves it armed: *"If a user runs `close <id> --confirm` without `--next`, this command can move the marker and README current milestone to the wrong milestone."* Correct, and it is the same shape as the `.gitignore` rule on this branch that covered one of three fixture families. **`--next` is now REQUIRED** — the script refuses without it, prints the row-order candidate explicitly labelled as a guess with no authority, and cites this entry. The regression test that used to pin the wrong default now pins the refusal. **This entry stays open**: refusing is not the fix, it is a way of not being silently wrong while the fix is missing.

- **Superseded mitigation, kept for the reasoning:** `--next <id>`, which lets the operator state the successor the files cannot. It validates against the index and refuses an unknown id, an already-ticked one, the milestone being closed, and a bare `--next` with no value; it prints a NOTE when it overrides the row-order default. The default behaviour is unchanged, **so the trap is still armed for anyone who does not pass the flag.**

- **The real fix, not attempted here because it is a decision rather than a repair:** a machine-readable execution order — one list, in one place, that both this script and `pnpm state` read. That would also close the standing DRIFT line the state digest has printed at every session start for days (*"TODO.md's first unchecked item is M12, not M26"*), which is this same mismatch seen from the other end and has been dismissed as cosmetic every time. It is not cosmetic; it is this bug's early warning.

- **Until then:** pass `--next` at every gate close, and **read the dry-run diff before `--confirm`** rather than treating the two runs as a formality.

- **First noted:** 2026-09-21 (closing M26).
- **Cross-reference:** `docs/milestones/README.md`'s gate-close checklist (which this script executes), `TODO.md`'s header rule, `scripts/lib/roadmap-read.mjs` (`readTodo` already reads BOTH the first-unchecked row and the marker, and reports them separately precisely because they can disagree — the close script uses the wrong one of the two).

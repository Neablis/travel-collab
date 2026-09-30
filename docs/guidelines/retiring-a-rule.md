# Retiring a rule

Every rule in `AGENTS.md` and the other first-read files earned its place with
an incident. Nothing so far has ever removed one. The surface wall
(`pnpm surface --check`) fires on growth, which is right, but a wall that only
fires *over* budget leaves one remedy by the time it fires: a trim under
pressure against a red build, or a raised budget.

**Measured, 2026-09-25.** `docs/STATUS.md` grew into `surface-size.test.mjs`'s
10% headroom floor and `static-and-unit` failed on **every PR against `main`**
until someone trimmed it (`docs/retros/2026-09-25-status-archive.md`). On
2026-09-30 `AGENTS.md` was at 89% of its budget, one ordinary section away from
doing the same.

## When

- **A file is past 85% of its budget.** `pnpm surface` marks it `!!`, and
  `pnpm milestone close` lists a retirement pass for it as step 7. A gate
  close is the calm cadence: judgement, not a red build, decides what goes.
- **A PR adds to a file already at `!!`.** Pay for the bytes you add by
  retiring at least as many in the same PR. This is the one-in-one-out rule
  that stops the next crisis; it asks for judgement, so nothing enforces it.

## What may be retired

Each criterion can be checked by reading the file. None depends on memory or
opinion.

1. **Enforced.** A lint, test or hook now fails (or asks) with a message that
   teaches the rule. The prose shrinks to the rule plus the check's name. The
   check teaches the rest when it fires, which is the only moment anyone needs it.
2. **History of the document.** *"This section used to say…"*, *"Why this
   section changed."* That is what `git log` and the retro are for. Retire it
   whole.
3. **Incident narrative past one sentence.** Keep the rule, the citation
   (PR/KI number) and the one number that makes it credible. The story already
   lives in the KI or retro it came from.
4. **Restated.** The same rule in two first-read files, or twice in one. Keep
   the copy every session already has loaded; the other one points to it.
5. **Stale.** It cites a file, script, workflow or tool that no longer exists,
   or lists a set that has since grown. `grep` settles it. Fix it or retire it.

**Never retire** an invariant, a module-map row, or a rule's one-line incident
citation. The citation is what makes agents follow the rule. Shorten *around*
it.

*"Hasn't fired in N sessions"* is a good signal when you can measure it, but in
a cloud session you can't. The transcript corpus that `pnpm session-metrics`
reads lives only on the laptop that ran the sessions. If you have the corpus
and a rule was never tripped, it is a candidate under criterion 3: shorten it,
but keep it in place.

## How

1. Move the removed text **verbatim** to `docs/retros/<date>-retired-rules.md`,
   one section per removal: the file, the criterion, the old text, and what
   replaced it. Archived rather than deleted, and greppable.
   `docs/retros/2026-09-30-retired-rules.md` is the first one and shows the
   shape. **A file that already has its own archive uses it**: `STATUS.md`'s
   closed sections go to `docs/retros/<date>-status-archive.md`, and
   `docs/milestones/README.md`'s dated notes go to
   `docs/milestones/decisions-archive.md` in date order, where other files'
   citations by date still find them.
2. Leave a pointer where a reader would still look for the rule. Leave
   nothing where the text was only history.
3. Aim below 85%, not just under it. A pass that lands at 84% triggers again
   on the next paragraph.
4. The branch is Tier 1 if it touched only prose (`AGENTS.md` §Definition of
   Done). Say in the commit which criterion each removal used.

**Reversing a retirement** is putting the text back. Do it in a commit that
names the incident that brought it back. That incident is evidence a criterion
was wrong, so correct this page in the same commit.

### KI-2026-09-20-i — CodeRabbit's docstring pre-merge check counts JSDoc, and much of this repo explains itself in `//` above the symbol instead

- **Severity:** process friction, not a defect. It fails a pre-merge check as a
  ⚠️ warning; nothing is broken and nothing is blocked.
- **Area:** `.coderabbit.yaml` (the pre-merge checks block), and every file that
  carries its reasoning in `//` comments — which is most of them.

- **Symptom / What happens:** on PR #198 the **Docstring Coverage** pre-merge
  check reported **66.67% against a required 80.00%**, having "analyzed 9
  functions across 7 files". The functions it counted as undocumented are
  explained at length — just in `//` blocks immediately above the symbol rather
  than in `/** */` attached to it.

- **How it was found:** Mitchell asked for the leftovers of PR #198 to be filed.
  The warning had been raised in chat and deliberately not chased.

- **WHY IT WAS NOT CHASED, so the next person does not treat it as an oversight.**
  This repo's own convention is mixed and deliberate: `widgetMatches`,
  `MacroNodeView` and `WidgetFilter` carry real JSDoc, while `railList`,
  `openSeededPage` and most e2e helpers carry `//` blocks. Converting the e2e
  helpers to satisfy a percentage would make those files internally
  inconsistent, for a number rather than for a reader. **A comment's job is to
  be read, and the wall this repo actually enforces is `check-lint-wall.mjs`,
  not a coverage figure.**

- **The real question, which is Mitchell's and not a build's:** does this repo
  want JSDoc as a convention? Three honest answers, and the check follows
  whichever is chosen rather than driving it:
  1. **Yes** — then it is a codemod plus a lint rule, and the 80% threshold is
     a floor worth having.
  2. **No** — then the check should be turned off in `.coderabbit.yaml`, because
     a permanently-failing gate is one people learn to scroll past, which costs
     more than it saves (the same failure mode `docs/STATUS.md` records for a
     stale first-read file).
  3. **Only on exported API** — the most defensible middle, and the one this
     repo half-does already.

  **Leaving it as-is is the one answer with an ongoing cost**: every PR from now
  on carries a red pre-merge row that means nothing.

- **Second occurrence, 2026-09-21, on a much larger sample — PR #199.**
  **51.39% against the same 80.00% threshold, "72 functions across 17 files"**,
  against #198's 9 functions across 7. The branch adds eight `scripts/*.mjs`
  tools whose reasoning runs to paragraphs — why the wave-gate regex matches
  what it does, why `resolve` and not `join`, why a blocked lane never
  withholds a PR — all in `//` above the symbol, which is the convention those
  files were written to. Converting them for the percentage would move prose
  that is already there into a shape a counter prefers.

  It was again **not chased**, for the reason above, and is recorded here
  instead. What has changed is the evidence: the warning is now reproducible
  on any PR that adds tooling, which is what makes answer 3 (*"only on
  exported API"*) look like the cheapest defensible line rather than a
  compromise. **Still Mitchell's decision; still costing a red row on every PR
  until it is made.**

- **ANSWERED 2026-09-22 — answer 1, yes.** Mitchell: JSDoc is the convention,
  and the 80% threshold is a floor worth having. Deliberately not acted on in
  the same breath (*"let's do it in a ki not now"*), so **the work is
  `KI-2026-09-22-a`** and this entry stays open as the record of the three
  options and of why the check behaves as it does. The question this entry
  asked is closed; the gap it measures is not.

- **What it would take:** a decision, then either a `.coderabbit.yaml` edit
  (minutes) or a convention documented in `docs/guidelines/` and applied as
  files are touched (no big-bang rewrite).

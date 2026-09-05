### KI-2026-09-05-u — `quality-enforcement.md` restates the Definition of Done and now contradicts it, so an agent that opens it first runs the full suite on a prose change — RESOLVED

- **Severity:** cleanup (of the operating manual — no product impact, and the failure mode is agent time and CI wall clock, not a defect)
- **Area:** `docs/guidelines/quality-enforcement.md:87-89` ("## Definition of done (restated from AGENTS.md — the checklist) … `pnpm check` green locally; CI green") vs `AGENTS.md:249-306` (Tier 1 "Run nothing", Tier 2 "the `minimal-check-subset` skill's output and nothing more"); `test:e2e:ci-like` appears in **58** markdown files; `AGENTS.md:191-192` and `connecting-the-parts.md:53` both claim the MSW mocks are "generated from contracts"
- **Symptom / What happens:** the restatement was true when written and the source moved. Its title invites an agent to open it, and what it then says is exactly the behaviour AGENTS.md's tiers were written to stop — the same tier confusion CLAUDE.md rule 4 records being got backwards twice (measured on #103, then again on #141). Nine-plus restatements of the e2e rule will drift the same way. The MSW sentences are already false: the mocks are hand-written (see KI-2026-09-05-q).
- **Why not fixed here:** found by a read-only review; no code was changed by it.
- **Suggested fix:** `quality-enforcement.md` §DoD becomes a **pointer** to AGENTS.md's tiers — its own header already says "restated", which is the admission; the two MSW sentences say "hand-written against the contract schemas"; and a one-line house rule in `docs/guidelines/README.md`: guidelines cite `AGENTS.md §X`, they do not re-quote it.
- **Cross-reference:** [F-E08](../../reviews/2026-09-05-overnight-review/findings/F-E08-guidelines-restate-and-contradict-agents.md) (LOW, CONFIRMED); CLAUDE.md rule 4; AGENTS.md §Definition of Done; KI-2026-09-05-q (the MSW claim).
- **Reproduction (documentary, 2026-09-05).** Quoted side by side before anything
  was changed. `AGENTS.md:251` + `:267` — *"**Tier 1 — prose only.** Every path
  changed **by the whole branch** … is under `docs/**`, `.claude/**`,
  `.agents/**`, or is a root-level `*.md` … Run nothing. No `pnpm check`, no
  test lane, no typecheck, no e2e, no browser."* Against
  `docs/guidelines/quality-enforcement.md:87-89` — *"## Definition of done
  (restated from AGENTS.md — the checklist) … - [ ] `pnpm check` green
  locally; CI green."* Under a header reading *every change*, with no tier and no
  prose-only exception: a direct contradiction, and the guideline is the copy.
  A second instance of the same contradiction sat three paragraphs up in the same
  file at `:32-33` — *"`pnpm check` … run it constantly while iterating"* —
  against Tier 2's *"the `minimal-check-subset` skill's output **and nothing
  more**"*.
- **The MSW claim was verified against the code, not assumed.**
  `apps/web/src/mocks/handlers.ts` is a 291-line hand-maintained file: no
  generator script references it (a recursive search for `handlers.ts` across
  `scripts/`, `apps/web/scripts/` and `packages/` returns nothing), it carries no
  generated/DO-NOT-EDIT marker, `msw` appears only as a devDependency, and its
  history shows 12 hand-edited revisions across M1-M14. It *imports types* from
  `@tc/contracts`, which is what the sentence had drifted from. The guideline was
  wrong, not the code — so both sentences were corrected, per KI-2026-09-05-q,
  which explicitly delegates them here.
- **Fix.** `quality-enforcement.md` §Definition of done is now a **pointer**: the
  checklist copy is deleted and replaced by a link to `AGENTS.md` §Definition of
  Done naming all three tiers, plus the record of why the copy drifted, so it
  does not come back. `:32-33` now says `pnpm check` is not the mid-branch
  default and names Tier 2. `AGENTS.md:191-192` and `connecting-the-parts.md:53`
  now say the MSW mocks are **hand-written against the contract schemas**, and
  name the file. `docs/guidelines/README.md` carries the one-line house rule this
  entry asked for — *a guideline cites `AGENTS.md §X`; it does not re-quote it* —
  which is the structural guard against the next restatement, including the
  nine-plus copies of the e2e rule this entry flagged as the next to drift.
- **Proof.** Re-read of all four changed regions. A repo-wide markdown search for
  `restated from AGENTS` and ``check` green locally`` now returns only this entry,
  its review finding, and `.github/PULL_REQUEST_TEMPLATE.md:50` (a real Tier-3
  checkbox, left alone — below); a search for `generated from contract` returns
  only historical records. Checks run: **none, correctly.** The branch's full
  changed-path set is `AGENTS.md`, `docs/guidelines/README.md`,
  `docs/guidelines/connecting-the-parts.md`,
  `docs/guidelines/quality-enforcement.md` and this file's rename — Tier 1 under
  the very rule this entry is about. Running `pnpm check` to close it would have
  reproduced the bug.
- **No regression test:** the bug class is prose consistency between two
  documents, which admits no runnable assertion. The `README.md` house rule is
  the substitute control.
- **Left alone, deliberately.** `.github/PULL_REQUEST_TEMPLATE.md:50` restates
  `pnpm check` as an unlabelled checkbox — outside this entry's Area, and outside
  Tier 1's path set, so editing it would have made this branch Tier 2.
  `AGENTS.md:116`'s "typed API client" claim belongs to KI-2026-09-05-q.
- **First noted:** 2026-09-05, overnight review stream E. **Resolved:** 2026-09-05.

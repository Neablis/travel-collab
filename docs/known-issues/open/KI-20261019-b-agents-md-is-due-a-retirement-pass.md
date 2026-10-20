### KI-2026-10-19-b — AGENTS.md is at 86% of its byte budget and due a retirement pass

- **Severity:** cleanup. Nothing is broken. `pnpm surface --check` passes but marks the file `!!`,
  and `surface-size.test.mjs` fails `static-and-unit` on every PR once the file is inside its
  10% headroom floor. That is how `docs/STATUS.md` broke every PR against `main` on 2026-09-25.
- **Area:**
  - `AGENTS.md`.
  - The procedure: `docs/guidelines/retiring-a-rule.md`, its criteria and its "How", which moves
    removed text verbatim to `docs/retros/<date>-retired-rules.md`.
  - The check: `scripts/surface-size.mjs`.
- **Symptom / What happens:** on `main` at d0cdadc, `pnpm surface --check` prints `!! AGENTS.md
  29,085 B … budget 34,000` and "due a retirement pass, not a raise". Under 85% means under
  28,900 B. A pass worth doing aims lower, to around 75% (25,500 B, about 3.5 KB out), so the
  next two exemptions don't trip it again. The 2026-10-18 PRs added about 1.1 KB between them:
  Home's exemption, the trip board's exemption, and the playbooks live/cached split.
- **Where the bytes are** (section sizes in bytes on d0cdadc; `awk` over the `##`/`###` headings):

  | Section | Bytes | Candidate, with the criterion from `retiring-a-rule.md` |
  |---|---|---|
  | Definition of Done › Verification scales to the change | 3,237 | (4) restates CLAUDE.md rule 4 and the PR template's tier comment; (3) the suggester-retro story in "The short version" |
  | Architecture map and dependency rules | 3,354 | ~2.4 KB is six exemption paragraphs (lines 129–168). (1) each is enforced by fixtures in `scripts/check-lint-wall.mjs` and (4) restated in `apps/web/eslint.config.mjs`'s block comments. A list of path → decision → fixture count keeps the rule and its citation. (5) the trip board's paragraph says "the board is in the first HTML"; since PR 486's later commits only the header and the view's placeholder are. |
  | Testing model | 3,328 | (4) restates `docs/guidelines/testing.md` and CLAUDE.md rules 1–3; (3) the witness story ("A probe once passed 400 runs…") past one sentence |
  | What the change itself must carry | 2,854 | (3) the M18 and PR 141 stories past one sentence |
  | Repo automation | 2,711 | (5) check the listed commands, skills and hooks still exist (`grep`) |
  | Waiting on PR checks | 1,221 | (3) the M42 wake-cost story: keep "$57, 141 of 190 for nothing" and cut the rest |

- **Never retire:** an invariant, a module-map row, or a rule's one-line incident citation
  (`retiring-a-rule.md`). The exemption list must keep each path, its decision citation and
  "on the console's terms".
- **Why not fixed here:** the session that filed this was asked only to document it. The pass is
  judgement work for its own PR. Per `retiring-a-rule.md`, the next PR that adds to AGENTS.md
  should retire at least as many bytes as it adds.
- **Cross-reference:** `docs/guidelines/retiring-a-rule.md`;
  `docs/retros/2026-09-30-retired-rules.md` (the first pass, and the shape to copy); PR 486 (the
  trip board exemption, +346 B); `pnpm milestone close` step 7 (lists the pass at a gate close).
- **Partial pass, 2026-10-19 (M50 close):** 29,085 B → 28,316 B (83%), so `pnpm surface`
  no longer marks the file `!!`. Eight narrative and restatement trims only
  (`docs/retros/2026-10-19-retired-rules.md`). Still open: the exemption paragraphs as a list,
  the Verification and Testing sections against CLAUDE.md, the stale trip-board sentence, and
  the 75% target. Those restructure binding text, so they want their own reviewed PR.
- **First noted:** 2026-10-18, PR 486's final review. Filed 2026-10-19.

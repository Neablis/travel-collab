# F-E08 — Guidelines restate rules instead of pointing to them, and one restatement now contradicts its source

- **Stream:** E Maintainability · **Severity:** LOW · **Confidence:** CONFIRMED (verified)
- **Area:** `docs/guidelines/quality-enforcement.md:87-89` — "## Definition of done (restated from AGENTS.md — the checklist) … `pnpm check` green locally; CI green." vs `AGENTS.md:249-306` — Tier 1 "Run nothing", Tier 2 "the `minimal-check-subset` skill's output and nothing more". `test:e2e:ci-like` appears in 58 markdown files. `AGENTS.md:191-192` and `connecting-the-parts.md:53` claim MSW mocks are "generated from contracts" (they are hand-written — F-E03).
- **What is wrong:** an agent that opens `quality-enforcement.md` first (its title invites it) runs the full suite on a prose change, which is exactly the behaviour AGENTS.md's tiers were written to stop. Nine-plus restatements of the e2e rule will drift the same way.
- **Suggested fix:** `quality-enforcement.md` §DoD becomes a pointer to `AGENTS.md`'s tiers (its own header already says "restated"); the two MSW sentences say "hand-written against the contract schemas"; a one-line house rule in `docs/guidelines/README.md`: guidelines cite `AGENTS.md §X`, they do not re-quote it.
- **Scope of the fix:** 3–4 prose files; Tier 1; nothing run.
- **Cross-reference:** F-E03, F-D08 (the same drift in `ci.yml`'s header and `.coderabbit.yaml`).
- **Do not:** add a fourth statement of the rule to fix the third.

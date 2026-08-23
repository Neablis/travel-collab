# Phase 7 — Make it stick: guidance a smaller model can follow

**The stated goal:** a new test gets written correctly *without* frontier-model
guidance. That is a real constraint on how this phase is written — prose that
sounds wise but requires judgment to apply will not survive contact with a
smaller model. Three mechanisms, in descending order of reliability:

1. **A lint rule** — cannot be ignored, needs no reading. Prefer this always.
2. **A checklist with concrete examples** — works if it is short and the
   examples are copy-pasteable.
3. **Prose principles** — the weakest. Necessary for the "should this test
   exist at all" question, which no linter can answer.

The current `AGENTS.md` Testing model section is entirely (3), which is why the
suite drifted. This phase adds (1) and (2) and trims (3) to what only prose can
carry.

---

## Task 7.1 — Enforce what a linter can enforce

Add to `apps/web/eslint.config.*` (and the packages' equivalents), scoped to
test files only. Each rule replaces a paragraph of guidance nobody reads:

| Rule | Catches | Message should say |
|---|---|---|
| `no-restricted-syntax` on `.className` in `expect()` | presentation assertions | "Assert behavior, not classes — the color wall lint owns the design contract. See docs/guidelines/testing.md#assert-behavior" |
| `no-restricted-syntax` on `waitForTimeout` / `setTimeout` in tests | hard waits | "Use a web-first assertion or `findBy*`; a sleep is a future flake" |
| `no-restricted-syntax` on `tripDetailFixture` / literal `TripDetail` object shapes | hand-built data | "Use `@tc/factories` scenarios — hand-built rollups drift" |
| `no-restricted-imports` for `crypto.randomUUID` in test files | non-deterministic ids | "Factories mint deterministic ids; a random id makes a failing diff unreadable" |
| [`eslint-plugin-testing-library`](https://github.com/testing-library/eslint-plugin-testing-library) `recommended` | `waitFor` misuse, `container.querySelector`, missing `await` on `findBy*` | (its own messages are good) |
| [`eslint-plugin-playwright`](https://github.com/playwright-community/eslint-plugin-playwright) `recommended` | conditional assertions, `expect` outside `test`, forbidden waits | (its own) |

The two plugins are the highest-value items here: they encode most of Phase 6's
rules as automated checks, and they are maintained by the respective projects.

**One rule deliberately NOT added: a coverage threshold.** A percentage gate is
what produces the per-prop render tests this whole plan is deleting. Say so in a
comment where a future session would otherwise add one.

`scripts/check-lint-wall.mjs` already exists as the pattern for repo-specific
enforcement; extend it rather than inventing a second mechanism if a rule does
not fit ESLint cleanly.

## Task 7.2 — Write `docs/guidelines/testing.md`

New file, and it becomes the single answer to "how do I test this here". It
must be **short enough to read in full before writing a test** — target under
150 lines. Structure:

### 1. The decision table (the most important part)

| I changed… | Test it in… | Do NOT also test it in… |
|---|---|---|
| a domain rule (`decide`/`evolve`/`conflicts`) | `packages/domain`, unit + property | a component, an int test, or e2e |
| a schema | `packages/contracts` round-trip | anywhere else |
| an endpoint / projection | `apps/web/src/server/*.int.test.ts` | a component test |
| a component's rendering of given data | one component test, using a scenario factory | e2e |
| a user-visible flow across pages | the milestone e2e script | a component test |
| a pure helper in `src/lib` | a `.test.ts` (node env — no DOM) | anywhere else |
| styling only | nothing. The color wall lint owns it. | — |

This table is the thing that stops the same rule being proven four times, and
it is mechanical enough for a small model to apply.

### 2. The "should this test exist" test

Three questions, all of which must be yes:

1. Can you name a plausible code change that breaks this test?
2. Would that change break **no other test**?
3. Would that change be a real bug, not a deliberate refactor?

If (1) is no, it tests nothing. If (2) is no, it is a duplicate — the other test
is enough. If (3) is no, it is brittleness, and it will cost more than it saves.

### 3. Copy-pasteable canonical examples

Not descriptions of good tests — actual ones, from the post-Phase-6 suite,
each with a one-line note on why it is shaped that way:

- a domain property test with a measured `witness` floor
- a component flow test using a scenario factory and role-based queries
- an integration test using `commandsFor`
- an e2e test using `storageState` + API-built state + web-first assertions

A smaller model copies a good example far more reliably than it applies a
principle. Budget more words here than anywhere else in the file.

### 4. The locator ladder and the testid contract

Verbatim from Phase 6 Tasks 6.1 and 6.2, with the current testid list.

### 5. Running things, and what to believe

Fold in `quality-enforcement.md`'s existing (good) KI-27 advice about
`test:e2e:ci-like` vs `test:e2e`, plus Phase 4's decision procedure for
flake-vs-bug. Cross-reference, do not duplicate — two copies drift, which is
the same rule `TODO.md`'s own header applies to scope.

## Task 7.3 — Rewrite `AGENTS.md`'s Testing model section

`AGENTS.md` is the operating manual and is read on every session, so it gets
the **short** version — the invariants only, pointing at
`docs/guidelines/testing.md` for the how. Keep, because each records a real
incident and prose is the only carrier:

- The `witness` rule and *why* (a probe passed 400 runs asserting zero times).
- "If a comment asserts an invariant, a test enforces it or the comment is a
  lie with a timer on it."
- The layer table (which package owns which kind of test).

Add, as new invariants earned by this plan:

- **Test count is a cost, not a score.** A PR that adds tests without adding
  coverage of a *new* failure mode is a PR that made the suite slower.
- **Prove it at one layer.** Name the layer that owns each claim; do not
  re-prove it above.
- **Never assert presentation.** Classes, tag names, DOM structure and prose
  copy are not contracts. Roles, labels, values and behavior are.
- **No test may sleep.**
- **Data comes from `@tc/factories`.**

Remove the "Critical interactions (drag, conflict surfaces, undo)" line from
`quality-enforcement.md`'s pyramid — it reads as a mandate to component-test
drag, which is what produced the jsdom drag tests that could not work
(`resolveDrop.ts` and `rackDisclosure.ts` were extracted precisely because
jsdom has no `DataTransfer`). Replace with: drag is tested in e2e; the pure
decision functions under it are tested as pure functions.

## Task 7.4 — A `write-a-test` skill

The repo already carries task-scoped skills (`minimal-check-subset`,
`ci-triage`, `worktree-hygiene`). Add `.claude/skills/write-a-test/SKILL.md`
that fires on "add a test", "test this", "cover this case".

It should be a **procedure**, not a summary of the guidelines:

1. Classify the change against the decision table → which layer.
2. Check whether an existing test already covers it → if so, extend it rather
   than adding a file. (This is the step that prevents regrowth.)
3. Pick the scenario factory; if none fits, add one to `@tc/factories` rather
   than hand-building data.
4. Copy the canonical example for that layer.
5. Run the narrowest command that covers it (`minimal-check-subset` already
   does this — chain to it).
6. Before finishing: apply the three "should this test exist" questions to what
   you just wrote. If any answer is no, delete it.

Step 6 is the one that matters and the one a model will skip unless it is an
explicit numbered step.

## Task 7.5 — Close out the plan

Per `docs/plans/README.md`, plans are staging-area artifacts and are removed at
gate close, with durable reasoning promoted first.

- [ ] `ADR-021-testing-strategy.md` — records *why* the suite shrank, the
      measured before/after, and the levers evaluated and rejected
      (`isolate: false` at 248 failures; a coverage-percentage gate; a
      permanent mutation-testing CI job). A future session **will** propose all
      three again; the ADR is what stops the rediscovery cost.
- [ ] `docs/known-issues.md`: KI-13, KI-19, KI-21, KI-25 in Resolved, each with
      its actual root cause. KI-11 updated to note the model harness is still
      the open item and now has a cheaper home.
- [ ] `docs/STATUS.md` updated — this was an off-roadmap insert during M10
      Wave 2, and `AGENTS.md` requires that to be called out, not silently
      absorbed. State plainly whether it moved M10's gate (it should not).
- [ ] `TODO.md`: note the insert under Standing tasks or Candidate ideas as
      appropriate.
- [ ] `docs/testing-baseline.md` deleted; its durable numbers live in the ADR.
- [ ] `docs/plans/2026-08-23-test-suite-overhaul.md` and
      `docs/plans/test-overhaul/` removed in the same commit.

---

## Exit checklist

- [ ] Lint rules in place; a deliberately bad test (className assertion, hard
      wait, hand-built fixture) fails `pnpm lint`. **Verify by writing one.**
- [ ] `docs/guidelines/testing.md` exists, is under ~150 lines, and contains
      four real copy-pasteable examples.
- [ ] `AGENTS.md` Testing model rewritten; `quality-enforcement.md` pyramid
      corrected.
- [ ] `write-a-test` skill exists and its procedure was followed end-to-end for
      one real test as a dry run.
- [ ] **The acceptance test for this whole phase:** hand a small model a real
      change and the instruction "add a test for this", with no other guidance.
      It should pick the right layer, use a factory, use role-based queries, and
      not add a duplicate. If it does not, the guidance is still too abstract —
      fix the guidance, not the model.

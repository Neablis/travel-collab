### KI-2026-09-07-d — the verification loop ran on CI instead of locally: nine pushes, a regression the local lane could have caught, and three checks that were green for the wrong reason

- **Severity:** reliability of verification (no product defect — every issue below was found and fixed before merge). What is wrong is the *loop*: the tooling makes CI the cheapest place to discover a failure, so that is where failures got discovered. Filed against the setup rather than against one session, because the same shape will produce the same session again.
- **Area:** `package.json:18` (`check`, and what it does not cover), `AGENTS.md` Definition of Done Tier 3 (the "if a user flow changed" judgement call) and `AGENTS.md:236-247` (the draft-PR rule and its lapsed justification), `apps/web/playwright.config.ts:11` (`laneReporter` registered only when `CI` is unset), `.claude/protocol/adapter.json` (`exclusiveCommands` — no entry covers the e2e lane), `.claude/commands/ki-sweep.md` step 6a (opens a PR, not a draft).
- **Reported:** Mitchell, 2026-09-07, on PR #155: *"why do you commit and push so often? why not use local tests to do real work then push a bunch at once? everything you described is really wasteful"* — then *"document all these issues … focus on the ki improvement holistically how to run tests, leverage local versus ci, and improve reliability a testing signal."*

---

## What actually happened, measured

**Nine pushes on one PR, nine full CI cycles.** `17aaae3, 017eaa8, 161a615, 98ea7d6, a5f8cfb, af38e31, 018a430, a0fae2b, 6e4a6c0`. Three stand out:

- `a5f8cfb` → `af38e31` — a fix, then a fix **to that fix**, minutes apart. The first wrote `git fetch … || echo "…degrades to shape-only"`, which reports success even when the fetch fails: the same defect the commit was fixing. Catching that needed a re-read, not a runner.
- `161a615` — one cross-reference paragraph in one KI file, pushed alone. The branch already carries code, so `paths-ignore` does not apply (CLAUDE.md rule 4: Tier 1 is a property of the **branch**) and a full suite ran for a paragraph.
- `98ea7d6`, `a0fae2b`, `6e4a6c0` — three separate "respond to review feedback" pushes where one would have done.

**Eight of the nine were free to avoid, and the ninth would still have shipped.** `ci.yml:92` and `ci.yml:154` are `if: github.event.pull_request.draft == false`, and `.coderabbit.yaml` sets `auto_review.drafts: false` — a draft PR runs **nothing**. The one push that was genuinely warranted (`018a430`, carrying the dev-login fix Mitchell was blocked on) reaches him through a Vercel preview, which deploys regardless of draft state. Opening as a draft would have cost the user nothing and saved eight cycles. `AGENTS.md:236` already requires it; `.claude/commands/ki-sweep.md` step 6a, the document actually being followed at that moment, says only "Open a PR".

**A regression the local lane could have caught.** `018a430` made dev login bypass the invite gate. `pnpm check` passed. `integration-e2e` then failed twice on `m11a-invite-gate.spec.ts` — the spec that proves the gate **through dev login**, because that is the only way a browser test mints an identity the app has never seen. The bypass made four refusal assertions and a single-use-code race pass vacuously. Nothing about that needed a runner either; it needed `test:e2e:ci-like` on an auth change.

**A contended local e2e run that produced junk, and said nothing about being junk:**

| run | conditions | result | wall clock |
|---|---|---|---|
| first | launched in the background while `typecheck`, integration tests and edits ran on the same machine | **56 failed, 1 flaky, 46 passed** | **24.2m** |
| second | nothing else running | **102 passed, 1 flaky** | **4.8m** |

Same tree apart from the gate fix. A 5× slowdown with a large scattered failure set is KI-13's signature exactly, and the operator created the contention. About three of those 56 were the real m11a regression; the rest was noise that was briefly reported as a reproduction.

**A human's attention spent and then discarded.** CodeRabbit does not auto-review this repo (public, 0 stars, below its 10-star OSS gate — KI-2026-09-01), so every review is a step Mitchell performs by hand and then waits ~21 minutes for. `AGENTS.md:386` is explicit that **any push during that window aborts it**, and that the abort surfaces only as an edit to an existing comment. Its assessment on #155 still reads *"Merge Risk: Moderate · up to `af38e`"* — two code pushes and a docs push later. Nothing in the loop warns before a push that a review is in flight or already superseded; the only signal is a comment edit nobody is watching for.

**Three checks green for the wrong reason, in one branch:**

1. `PageAssistant.test.tsx` asserted a follow-up lands *in the composer*. jsdom keeps focus there; no real browser does, because `AssistantRail.tsx:592` is `disabled={asking}` and disabling a focused input blurs it (KI-2026-09-07-c). Green in CI forever, describing behaviour that has never existed.
2. `scripts/check-migration-journal.mjs` enforced its headline rule only where `origin/main` resolves. `actions/checkout` fetches one ref, so in CI — the one place it could block a merge — it printed `baseline NOT compared` and exited 0. Its own header argued this was acceptable.
3. The dev-login bypass above, which hollowed out `m11a`'s subject while leaving it green.

---

## What in the setup produced this

Each of these is a property of the tooling, not of one operator's judgement.

**1. `pnpm check` does not run e2e, and the decision to run it is left to the worst-placed judge.**

```
check: pnpm typecheck && pnpm lint && pnpm test && pnpm test:int:if-db
```

Tier 3 says run `pnpm check`, "plus `test:e2e:ci-like` **if a user flow changed**". That conditional is decided by the person who just wrote the change and believes it is small. An authentication change does not look like "a user flow" until the invite-gate spec goes red. There is **no list of change classes that must run e2e**, so the default is to skip — and under the draft rule above, where CI runs nothing, skipping locally means the regression has no signal at all until the PR is marked ready.

**2. The contention warning that exists is switched off in the lane that needs it.** `playwright.config.ts:11` registers `laneReporter.ts` only when `CI` is **unset**. `test:e2e:ci-like` is `pnpm build && CI=true pnpm test:e2e` — so in the ci-like lane the reporter never runs. Its header explains exactly why prose was insufficient ("Prose that has to be read at exactly the right moment is not a control. The failing output is the one thing that is always read") and then declines to print in the lane where results are actually believed. Reasonable as written — the message it carries is about the *dev* lane — but it means the local run that produces a quotable verdict is the one with no health check on itself.

**3. The same config makes contention maximally destructive.** With `CI=true` set locally, `timeout` drops to 30s from 120s and `retries` becomes 1 (`playwright.config.ts:32,58`). A loaded machine plus a 30s budget converts contention into mass timeouts, and the retry doubles the wall clock while doing it. That is the 24.2 minutes.

**4. The lease hook models the wrong resource for this lane.** `scripts/hooks/resource-lease.mjs` is exactly the right mechanism, and `.claude/protocol/adapter.json` deliberately excludes the e2e lane: *"`test:e2e` is deliberately NOT in this pattern: it picks a free port itself"*. True — and the resource that matters under contention is **CPU**, not a port, and there is no CPU or heavy-lane resource in the manifest. Second gap: leases are held per **unit** (worktree), so a single unit running typecheck, integration tests and e2e at once — this session — is outside the model twice over.

**5. The stated reason to batch is out of date, and the replacement is weaker.** `AGENTS.md:241-245` justifies the draft rule with "this repo is private on a GitHub Free plan (2,000 Linux minutes/month)". `docs/guidelines/ci-cost-and-capacity.md` records that the repo went public on 2026-08-31 and minutes are now unlimited; it correctly says the levers survive on session time and Claude tokens. But the binding document still argues from the lapsed premise, and a rule whose stated reason has expired reads as optional. It was treated as optional here.

**6. Some checks genuinely cannot run locally, which teaches that CI is where truth lives.** The migration wall's baseline needs `origin/main`. Preview behaviour needs a deployment. Once a few things are knowable only from CI, "push and see" becomes the habit for everything else too.

---

## What would fix it

Ordered by value per unit of work. None is large.

1. **Name the change classes that require e2e, so it stops being a judgement call.** In Tier 3, replace "if a user flow changed" with a list: `server/admission.ts`, `server/users.ts`, `lib/authConfig.ts`, `lib/devLogin.ts`, routing/middleware, and anything touching focus or selection in the editor. All three of this branch's near-misses are in that list. `minimal-check-subset` could emit it, and a wall could enforce it: if the diff touches those paths and the PR body carries no e2e line, fail.
2. **Let `laneReporter` speak in the ci-like lane too, with a different message.** Register it whenever the run is local (the config already knows: `webServer.command` and `TC_TEST_DB` distinguish the lanes better than `CI` does), keep the dev-lane warning gated as it is, and add a duration check: record a rolling median in `test-results/` and print `THIS RUN TOOK 5.0× THE MEDIAN — treat failures as contention, not defects (KI-13)` above the summary. One line converts a 24-minute lie into a labelled one. Precedent: `test:int:if-db` already prints *"A green `pnpm check` here is NOT a green CI"* when the database is absent.
3. **Add a CPU-exclusive resource to `.claude/protocol/adapter.json`, and make the lease intra-unit.** Cover `test:e2e`, `test:int` and `next build` under one `heavy-lane` resource with a symptom line naming KI-13. The port reasoning that excluded `test:e2e` is correct and simply about a different resource.
4. **Open sweeps and phase PRs as drafts.** One word in `.claude/commands/ki-sweep.md` step 6a and in `phase-implementer`'s brief, matching `AGENTS.md:236`. Intermediate pushes then cost nothing until `gh pr ready`.
5. **Re-justify the batching rule from the premise that still holds.** Update `AGENTS.md:241-245` to cite session time, Claude tokens and reviewer attention rather than the 2,000-minute cap, and state a budget an agent reads while working: *batch until the branch is verifiable, then push once; a second push within the hour needs a reason you would say out loud.*
6. **Make an in-flight review visible to the thing that pushes.** The handoff flow (`AGENTS.md:390-405`) already says nobody pushes for ~21 minutes after a trigger; nothing enforces or even displays it. A `PreToolUse` guard on `git push` that reads the PR's latest CodeRabbit comment and asks when a review is in flight or when HEAD has moved past `coveredCommitId` would cost one API call and convert a silently aborted review into a question. Same shape as `check-destructive-git.mjs`.
7. **Close the "green for the wrong reason" class deliberately.** Three instances in one branch is a pattern, not luck. The shape is **a check that passes without exercising the property it names**, and its three sub-shapes belong in `docs/guidelines/testing.md`: an assertion the test environment fabricates (jsdom focus), a rule that degrades silently exactly where it matters (the wall's baseline), and a fix that removes its own test's subject (the dev-login bypass). The existing red-first drill catches only the first.

---

## What this entry is not

Not an argument that CI is the wrong place for e2e — CI's e2e is the authoritative signal and correctly caught the regression. The problem is that it was the **first** signal rather than the second, on a branch where the draft rule would have meant no signal at all. Nor an argument for fewer checks: every check named here earned its place. The ask is that the cheap local loop cover what the expensive remote one covers, and that it say clearly when its own answer should not be believed.

- **Cross-reference:** **KI-13** (component tests timing out under parallel load — the contention reproduced here); **KI-27** (the `test:e2e` vs `test:e2e:ci-like` lane trap, and the two times prose alone failed to prevent it — `laneReporter.ts` is its fix); **KI-2026-09-07-c** (the jsdom focus property, found only in a real browser); the `a5f8cfb`/`af38e31` pair (the wall that only ran locally); `docs/guidelines/ci-cost-and-capacity.md` (the lapsed minutes argument and what replaced it); `AGENTS.md` Definition of Done and `AGENTS.md:236-247`; CLAUDE.md rules 1, 2 and 4.
- **First noted:** 2026-09-07, by Mitchell, reviewing how PR #155 was worked rather than what it contained.

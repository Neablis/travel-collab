### KI-2026-09-02 — GitHub Advanced Security's agentic code scanning fails every PR before it reads the diff, because the model it asks for is not available

> **RESOLVED 2026-09-03 by observation, not by a fix of ours.** The check started passing
> and has stayed passing. Nothing in this repo changed to cause it — the entry's own
> diagnosis was that the failure came from a model being unavailable on GitHub's side, and
> the most likely explanation is simply that it became available again.
>
> **The evidence, in order, all on the same day:**
>
> | PR | head | `github-advanced-security` |
> |---|---|---|
> | #129 | `d8e67db` | ❌ failure |
> | #129 | `318c27b` | ❌ failure |
> | #130 | `09eb5d5` | ✅ success |
> | #130 | `f068a9c` | ✅ success |
> | #131 | `c4e1f0d` | ✅ success |
>
> Two failures then three consecutive passes, across two different PRs and five heads.
> The entry was deliberately **not** resolved on the first pass — one green run is a
> coincidence, and the whole point of this file is not to record guesses.
>
> **What this closes, and it was the real cost:** the failing check made `mergeStateStatus`
> read `UNSTABLE` on every PR, which reads as "do not merge yet" to anyone who has not read
> this entry. That tax is gone.
>
> **If it comes back**, the entry below is still the right diagnosis and the right advice —
> it dies at `session.create` before reading the diff, so re-running it never helps, and
> CodeQL plus both `Analyze` jobs passing on the same head remains the test that only the
> agentic check is broken. Reopen rather than rewrite.

- **Severity:** CI noise, not product. It cannot pass and it cannot find
  anything — it fails during session setup, so no analysis of any kind runs. It
  costs a red X on every pull request and, worse, it makes `mergeStateStatus`
  read `UNSTABLE`, which is the state a reviewer is trained to treat as "do not
  merge yet."
- **Area:** the `GitHub Advanced Security` check (`Code scanning AI findings on
  PR #N`). **Not `ci.yml`.** It is GitHub-managed and triggered `dynamic`; there
  is no workflow file for it in this repo — `.github/workflows/` holds only
  `ci.yml` and `migrate-production.yml`. Nothing in the repository turns it on
  and nothing in the repository can turn it off.
- **What happened, measured on pull request 115** (run `33581045673`, job
  `100095218638`, 2026-09-02, 33s):

  ```
  Creating copilot-sdk session with model: claude-opus-4.6 …
  Error creating PR review request: Error: Request session.create failed with
  message: Model "claude-opus-4.6" is not available.
  ##[error]Process completed with exit code 1.
  ```

  It checked the repo out, built a 27,515-token prompt, loaded `AGENTS.md` and
  `CLAUDE.md` as custom instructions — and then died at `session.create`. **The
  diff was never analysed.** A red X here therefore says nothing whatsoever
  about the branch.
- **Why this is not "flaky" and should not be retried:** the failure is
  deterministic and identical every run, at the same step, before any input from
  the branch is read. `CLAUDE.md` rule 3's test applies and gives a clean
  answer — *a failure whose location moves between runs is a timeout; a real
  defect fails in the same place every time*. This one fails in the same place
  every time and is still not a defect in this repository, because the place it
  fails is a vendor's model catalogue.
- **It is also independent of the change.** Pull request 115 is Tier 1, prose
  only. `ci.yml`'s `paths-ignore` skipped `static-and-unit` and
  `integration-e2e` correctly; this check ran anyway, because **`paths-ignore`
  is a property of `ci.yml` and does not govern GitHub-managed workflows.**
  That is worth stating on its own, because the PR body originally claimed
  "nothing will run" on a Tier 1 PR and that claim is false: CodeQL and GHAS
  both run regardless of paths.
- **Fix path, in preference order, all of them Mitchell's** — none is in this
  repository's gift: (a) wait, if `claude-opus-4.6` is a transient catalogue
  gap on GitHub's side; (b) check whether Copilot's model access for this
  account/org includes the model the scanner requests, in GitHub settings;
  (c) disable the agentic code-scanning check for the repository if it stays
  broken, since a check that can never pass trains everyone to ignore a red X.
- **Why not fixed here:** there is nothing to fix in the branch. No commit, no
  configuration file and no workflow edit in this repository changes the
  outcome, and changing repository or org settings is not an implementer's
  call.
- **Cross-reference:**
  `KI-20260901-coderabbit-reports-success-while-skipping-the-review.md` — the
  mirror image, and worth reading beside this one. That one is a check
  reporting **green while doing nothing**; this one is a check reporting **red
  while doing nothing**. Neither status is evidence about the code, and both
  are cases of `AGENTS.md`'s "do not watch what cannot run".
- **Confirmed a second time on a different PR, 2026-09-03** — pull request 125
  (run `33704320548`, 31s). Identical in every respect that matters: same step
  (`session.create`), same message (*Model "claude-opus-4.6" is not
  available."*), same exit code 1, and the diff again never analysed. The only
  difference is prompt size — 26,078 tokens against 115's 27,515 — which tracks
  the diff and confirms the scanner reads the branch **before** it dies, then
  discards the work.

  **This is what upgrades "deterministic" from an inference to an
  observation.** The first sighting could only argue determinism from the
  failure's position within one run; two PRs, a day apart, on different
  branches and different content, failing at the same step with the same string
  settles it. `CLAUDE.md` rule 3's test — *a failure whose location moves
  between runs is a timeout; a real defect fails in the same place every time*
  — returns the same answer it did the first time, and so does the caveat: the
  place it fails is a vendor's model catalogue, not this repository.

  **Fix path (c) is now the one worth taking.** A check that has never passed,
  cannot pass, and is re-confirmed broken on each new PR is training every
  reviewer in the repo to read a red X as noise — which is the failure mode
  that makes a *real* red X get waved through later. That cost accrues per PR
  and it is the only cost this issue has.
- **First noted:** 2026-09-02, triaging the only failing check on pull
  request 115.

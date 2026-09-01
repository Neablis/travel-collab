### KI-2026-09-01 — CodeRabbit posts a GREEN status while skipping the review entirely, so `gh pr checks --watch` reports a review that never happened

- **Severity:** correctness of the process itself — this is not a code defect,
  it is the repo's documented safety net silently reporting success. Filed at
  the severity the thing it protects would carry, because the failure is
  invisible by construction.
- **Area:** `AGENTS.md` §"Waiting on PR checks — do not hand-poll",
  `.coderabbit.yaml`, `.github/PULL_REQUEST_TEMPLATE.md` §"Waiting on checks",
  `docs/STATUS.md` (two paragraphs stating the wrong cause).
- **Symptom / What happens:** CodeRabbit no longer auto-reviews this repository.
  Its comment on PR #105: *"This repository does not receive automatic reviews
  because it has fewer than 10 stars."* Confirmed against the API —
  `stargazers_count: 0`, `visibility: public`, so the OSS free-tier gate
  applies and nothing about this repo will clear it soon.

  **The dangerous half is not the missing review — it is the status it posts.**
  Compare the combined commit status on two PRs:

  | PR | Date | `context` | `state` | `description` |
  |---|---|---|---|---|
  | #102 | 2026-08-31 | CodeRabbit | **success** | `Review completed` |
  | #105 | 2026-09-01 | CodeRabbit | **success** | `Review skipped: manual review required for this OSS repository` |

  Same context, same `success` state, opposite meaning. So
  `gh pr checks <n> --watch --fail-fast` — **the exact command `AGENTS.md`
  mandates as the one blocking command that covers CodeRabbit** — exits 0 and
  shows CodeRabbit green on a PR it never read. A session following the repo's
  documented process correctly concludes "all checks green, CodeRabbit
  included" and is wrong.

  This is the same shape as the trap `AGENTS.md` already documents one level
  down — *"that reads exactly like 'my push passed'"* — except it is now the
  safety net itself, and there is no second net behind it.
- **Why this matters more here than it would elsewhere:** this repo's own
  record is that CodeRabbit catches a defect class the local suite cannot.
  From `docs/STATUS.md` on the M11a/M11b stack: **nineteen issues found across
  four PRs, fourteen of them "a test that passes while proving nothing", and
  *every one of the nineteen was green locally*** — `pnpm check` cannot catch
  that class by construction. `.coderabbit.yaml`'s own header keeps it on the
  grounds that it *"caught a real fire-and-forget navigation race in M10 Wave 2
  Phase 7 that no test covered."* Losing it silently removes the only check
  that has ever found those.
- **Three things in the docs are now false**, and each would mislead a session
  on its own:
  1. `AGENTS.md`: *"CodeRabbit is a registered status check … so `--watch`
     waits for it and exits non-zero the moment anything fails."* It still
     posts a status; that status is now green regardless.
  2. `docs/STATUS.md`, twice: the reason CodeRabbit did not review is recorded
     as *"it does not review drafts by default"*, and the remedy as *"trigger
     CodeRabbit on drafts"*. **The draft rule is real but is not the cause
     here** — the star gate applies to ready PRs too, as #105 (ready, not
     draft) proves. Triggering only on drafts fixes nothing.
  3. `.coderabbit.yaml`: *"It stays a required check."* It is not blocking —
     #105 reports `mergeable_state: "clean"` with the review skipped — so
     nothing stops a PR merging unreviewed.
- **Why it is not fixed here:** every real fix is Mitchell's call and costs
  either money or a habit change. Four options, ranked, none taken
  unilaterally:
  1. **Restore the paid plan**, if the trial lapsing is what changed. Cheapest
     in process terms — everything written down becomes true again.
  2. **Trigger manually on every PR** (`@coderabbitai review` as a comment).
     Works — it is what PR #105 did — but it is a step a human or agent must
     remember on every PR, which is exactly the class of trailing manual step
     the gate-close checklist exists to abolish.
  3. **Get to 10 stars.** Out of the project's control and not a plan.
  4. **Drop CodeRabbit from the documented process** and replace it with
     something that does run. Honest, and loses the only check that has caught
     the "green locally, wrong anyway" class.

  Until one is chosen, **the docs are corrected to describe what actually
  happens** rather than what used to, so no session trusts a green CodeRabbit
  status again.
- **How to check whether this is still true:** `gh pr view <n> --json
  statusCheckRollup` and read CodeRabbit's *`description`*, not its state.
  `Review completed` is a real review; `Review skipped: …` is not. A check run
  query will not show it at all — CodeRabbit posts a **legacy commit status**,
  not a check run, so `pull_request_read`'s `get_check_runs` returns six or
  seven entries with no CodeRabbit among them and that is normal, not evidence
  of absence. Use the combined status.
- **Cross-reference:** `.coderabbit.yaml` (the config that still says
  `auto_review.enabled: true`, which is true and no longer sufficient),
  `AGENTS.md` §"Waiting on PR checks", KI-24 (the same species one domain over
  — a control that warns rather than prevents).
- **First noted:** 2026-09-01 on PR #105, by Mitchell, reading CodeRabbit's
  skip comment: *"I think my 1 month free of premium ended, and this is the new
  behavior."* The status-is-green-anyway half was found while verifying that
  against the API.

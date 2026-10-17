---
name: github-rest
description: Every GitHub action this repo takes, as `gh api` REST calls that work from a Claude Code cloud session — open PRs, a PR's state and checks, runs and jobs, check-run annotations, create or edit a PR, mark it ready, comment, read and resolve review threads, re-run a workflow. Use whenever a skill, command or hook says `gh pr …` or `gh run view`, because the cloud proxy refuses GitHub's GraphQL API and those commands use it.
---

# GitHub over REST

**The rule.** From a cloud session, `api.github.com/graphql` answers 403 for every token,
including a personal access token: the proxy refuses it, not GitHub. `gh pr list`, `gh pr
checks`, `gh pr view`, `gh pr ready`, `gh pr create` and `gh run view` are GraphQL-backed and
fail; `gh api repos/…` is REST and works, and the proxy supplies the credential (so `gh auth
status` reporting an invalid token is not a problem). On a laptop every recipe below works
too, so write scripts, skills and briefs against these and nothing else.

**Job logs are the one thing REST cannot give you here.** `actions/jobs/<id>/logs` redirects to
a blob host the proxy refuses (KI-2026-10-13-f). Read the check run's annotations instead,
then reproduce the job locally with its own command (`ci-triage`).

`R=repos/Neablis/travel-collab` throughout.

## Read

| Want | Command |
|---|---|
| Open PRs | `gh api "$R/pulls?state=open" --jq '.[] \| "\(.number) \(.head.ref) draft=\(.draft) \(.title)"'` |
| One PR's state | `gh api $R/pulls/<n> --jq '{state,merged,mergeable,draft,head:.head.sha,base:.base.ref}'` |
| PRs for a branch | `gh api "$R/pulls?state=all&head=Neablis:<branch>" --jq '.[] \| "\(.number) \(.state) \(.merged_at // "")"'` |
| The PR's diff | `gh pr diff <n>` (REST) or `gh api $R/pulls/<n>/files --jq '.[].filename'` |
| Checks on a head | `gh api $R/commits/<sha>/check-runs --jq '.check_runs[] \| "\(.name): \(.status) \(.conclusion)"'` |
| Runs for a head | `gh api "$R/actions/runs?head_sha=<sha>" --jq '.workflow_runs[] \| "\(.id) \(.name) \(.status) \(.conclusion)"'` |
| Jobs of a run | `gh api $R/actions/runs/<id>/jobs --jq '.jobs[] \| "\(.id) \(.name) \(.conclusion)"'` |
| A check run's annotations | `gh api $R/check-runs/<check_run_id>/annotations --jq '.[] \| "\(.path):\(.start_line) \(.annotation_level) \(.message)"'` |
| Review threads | `gh api $R/pulls/<n>/ccr/review_threads` |
| Review comments | `gh api $R/pulls/<n>/comments --jq '.[] \| "\(.id) \(.path):\(.line) \(.user.login): \(.body[0:80])"'` |
| Issue comments on a PR | `gh api $R/issues/<n>/comments --jq '.[] \| "\(.id) \(.user.login): \(.body[0:80])"'` |
| Rules on `main` | `gh api $R/rules/branches/main` |

**Confirm the sha before trusting a check list.** Right after a push the newest run may belong
to the previous commit; take `<sha>` from `git rev-parse HEAD`, never from the PR page's memory.

## Write

| Want | Command |
|---|---|
| Create a PR, ready | `gh api -X POST $R/pulls -f title='…' -f head=<branch> -f base=main -F draft=false -F body=@body.md` |
| Edit the body | `gh api -X PATCH $R/pulls/<n> -F body=@body.md` |
| Mark ready for review | `gh api -X POST $R/pulls/<n>/ccr/ready_for_review` |
| Convert to draft | `gh api -X POST $R/pulls/<n>/ccr/convert_to_draft` |
| Comment on the PR | `gh api -X POST $R/issues/<n>/comments -F body=@comment.md` |
| Reply on a review thread | `gh api -X POST $R/pulls/<n>/comments/<comment_id>/replies -f body='…'` |
| Resolve / unresolve a thread | `gh api -X POST $R/pulls/<n>/ccr/comments/<comment_id>/resolve` (or `/unresolve`) |
| Re-run a run's failed jobs | `gh api -X POST $R/actions/runs/<id>/rerun-failed-jobs` (whole run: `/rerun`) |
| Delete a merged branch | `gh api -X DELETE $R/git/refs/heads/<branch>` |

Not yours: merging (Mitchell merges, `AGENTS.md`), `migrate-production` (his dispatch), and
`ccr/auto_merge`. A body or title still may not carry a model id: `pr-tool-guard.mjs` checks
the MCP tools and `draft-pr-guard.mjs` checks `gh pr create|edit`, so on `gh api` the rule is
yours to keep by hand. Every comment ends with the Claude Code attribution footer
(`working-a-review.md`). A milestone part opens ready, never draft (`build-a-part`).

## Checks that are not the PR's

Before treating a red check as the PR's fault, read `docs/known-issues/open/` for its name:
`github-advanced-security` goes red on PRs that cannot have caused it (KI-2026-10-17-b) and is
not required; `test / unit` has gone red once and green on re-run with nothing reproducing
(KI-2026-10-14-c). `ci-ok` is the one check that decides.

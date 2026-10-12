### KI-2026-10-12-d — a PR's Vercel preview fails with `git_info_fail`

- **Severity:** reliability. No code is at fault; the PR just has no preview to walk until it is
  retried.
- **Area:** `.github/workflows/vercel-preview.yml`, which asks Vercel for a deployment of the PR
  head through `POST /v13/deployments` with a `gitSource` (`ref` and `sha`).
- **Symptom:** the deployment for the head's `sha` (`mcp__Vercel__list_deployments`, project
  `prj_UoxcnmAsWMtHXx8jLXyespRqSULM`, team `team_FOAEiiLfMMxICIFszLWvzfzF`) is in state `ERROR`
  with `git_info_fail`: Vercel could not fetch the commit. The workflow run can still be green,
  since it only asks for the deployment.
- **Occurrences (two, both 2026-10-12, M45):**
  - PR 421, head `8c4b228`.
  - PR 422, head `3f3ee41`.
- **Remedy:** re-run that head's `vercel-preview` workflow run,
  `gh api -X POST repos/Neablis/travel-collab/actions/runs/<id>/rerun`. Do not push an empty
  commit to retry it: a push re-runs the whole CI suite and wakes every session watching the PR.
- **Why not fixed:** transient on Vercel's side; found while working M45, whose part 0 is prose
  only. **Fix direction**, if it recurs often: have the workflow poll the deployment and retry the
  request once on `git_info_fail`.
- **Cross-reference:** `.claude/skills/review-a-part/SKILL.md` step 6 (where the preview URL goes).
- **First noted:** 2026-10-12, M45.

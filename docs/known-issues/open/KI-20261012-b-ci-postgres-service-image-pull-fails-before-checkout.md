### KI-2026-10-12-b — a CI job fails at "Initialize containers" because the postgres service image will not pull

- **Severity:** reliability. CI noise only; no code is at fault. Each occurrence costs a re-run
  of the whole workflow run (and `ci-ok` goes red with it).
- **Area:** `.github/workflows/ci.yml`, the `services.postgres.image` of `test / integration`
  (line 229) and `test / e2e` (line 277): `public.ecr.aws/docker/library/postgres:17`.
- **Symptom:** the job fails in the **"Initialize containers"** step, before checkout and before
  any test, after about 17–19 seconds. The annotations read `Docker pull failed with exit code 1`,
  followed by two backoff retries. A re-run of the same head passes.
- **Occurrences (three, all on ECR Public):**
  - PR 413, run 38184850349 attempt 1, an e2e shard; green on attempt 2. The M42 milestone file
    and retro record it as ECR `toomanyrequests`.
  - PR 422, run 38259706383, `test / integration`, 14:00Z 2026-10-12.
  - PR 421, run 38264879649 attempt 1, `test / e2e (1/2)` (job 114864491713), about 14:43Z
    2026-10-12; green on attempt 2.
- **Not confirmed:** the registry's own error. The raw job logs for the two 2026-10-12 runs could
  not be read (the log blob URL returned Forbidden through the cloud session's proxy), so
  `toomanyrequests` is the likely cause, not a proven one. Whoever next sees it with log access
  should record the error text here.
- **History:** the image moved from Docker Hub (anonymous `toomanyrequests` on shared runners,
  PR 378, 2026-10-09) to `mirror.gcr.io`, then to ECR Public's durable copy in `962144c`. ECR
  Public also rate-limits anonymous pulls, by source IP, and shared GitHub runners share IPs.
- **Why not fixed here:** found while working M45; the fix is a CI change and part 0 is prose
  only. **Remedy for now:** re-run the failed job; it is not a code fault, and per rule 2 in
  `CLAUDE.md` it is the entry to cite before calling a red job infra.
- **Fix direction:** authenticate ECR Public pulls (an authenticated pull gets a much higher
  limit than an anonymous one; `aws-actions/amazon-ecr-login` with `registry-type: public`, or
  `services.postgres.credentials`), or stop pulling per job (cache the image, or install Postgres
  on the runner with `apt` instead of a service container).
- **Cross-reference:** `docs/milestones/M42-the-front-door-shows-more.md` (retro, *Infra failures
  cost a re-run each*: "it should get one if it happens again");
  `docs/retros/2026-10-12-m42-token-spend-retro.md` (the open-items list);
  KI-2026-09-27-a (Google Fonts, the other infra re-run of M42).
- **First noted:** 2026-10-12, M45 (PR 421's third review, after the third occurrence).

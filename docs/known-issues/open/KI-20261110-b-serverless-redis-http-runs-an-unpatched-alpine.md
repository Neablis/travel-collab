### KI-2026-11-10-b — the cache's HTTP shim runs an image on an Alpine that gets no security fixes

- **Severity:** security (no exploit seen; the service is private, see below).
- **Area:** the `caesura-redis-http` Coolify service (`hiett/serverless-redis-http:latest`),
  `apps/web/src/server/cache/redis.ts`, `docs/ops/coolify-vps.md` (lines 17-20, and the
  `CACHE_DRIVER` / `KV_REST_API_*` row of the env table).
- **Symptom / What happens:** Coolify's image scan (Mitchell, 2026-11-10) reports for
  `hiett/serverless-redis-http:latest`: two security problems "that attackers are likely to
  use", one more that "has no fix yet", and "This image uses Alpine 3.17.7, which no longer
  gets security fixes". Rebuilding or redeploying in Coolify does not help: the image is
  third-party and pulled as published, so a redeploy pulls the same base.
- **Why it is there:** the cache talks to Redis through `@upstash/redis`, an HTTP client, a
  leftover from Upstash on Vercel. On the box, serverless-redis-http turns those HTTP calls into
  Redis protocol for `caesura-redis` (M59).
- **Exposure:** limited. The service is not published to the internet, only to containers on
  the box's private network (`docs/ops/coolify-vps.md:17-20`), and the cache is expendable by
  design (ADR-059): a broken or removed Redis costs a request its speed-up, never a 500.
- **Why not fixed here:** found during the M60 close; the fix is code plus a Coolify change,
  and M60's stack is closed to unrelated code (a push to its top part re-runs the full CI).
- **Intended fix (preferred):** drop the shim. Add a `CACHE_DRIVER` value for a native Redis
  client (TCP, a `REDIS_URL` pointing at `caesura-redis`) behind the existing three-operation
  `CachePort` in `apps/web/src/server/cache/redis.ts` (get / set / del, each bounded at 300 ms
  and failing open), with a test; switch the env on `caesura-web`; then delete the
  `caesura-redis-http` service and its `KV_REST_API_*` variables, and update the runbook.
  Rejected alternatives: building our own copy of the shim on a current Alpine (we would own an
  Elixir image's patching for no gain), or waiting for a newer upstream tag (the project is
  barely maintained; not checked, Docker Hub is unreachable from the cloud session).
- **Cross-reference:** ADR-059 (Redis is an expendable cache), M59
  (`docs/milestones/M59-self-host-on-coolify-vps.md`, decision on Redis on the box),
  `docs/ops/coolify-vps.md`.
- **First noted:** 2026-11-10, M60 close.

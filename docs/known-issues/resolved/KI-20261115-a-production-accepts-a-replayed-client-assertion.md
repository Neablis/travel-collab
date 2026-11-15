### KI-2026-11-15-a — production accepts a replayed client assertion, so its cache is off or down — RESOLVED

- **Severity:** reliability, with a security edge. Replay protection for agents' client assertions
  is best effort by design (ADR-089), but on production it is not working at all, and nothing
  reported it. Other protections that ride the same cache may be silently off too.
- **Area:** `apps/web/src/server/oauth/clientAssertion.ts` (the `jti` check, `cache.setIfAbsent`),
  `apps/web/src/server/cache/` (the driver), production's `CACHE_DRIVER` and the
  `serverless-redis-http` service on Coolify.
- **Symptom / What happens:** the kit validator's `assertion.jti-reuse` check, run against
  https://caesura.today on 2026-11-15, sent the same client assertion to `/api/oauth/token` twice.
  The second was accepted: `{"error":"invalid_grant","error_description":"unknown refresh token"}`
  (the refresh token was a deliberate unknown, so `invalid_grant` means the assertion passed). A
  reused `jti` should be refused `invalid_client` while the cache is up. ADR-089 says the check
  "fails open: while the cache is down or `CACHE_DRIVER=off` (ADR-059), a replayed `jti` passes",
  so production's cache is off or unreachable. Rate limits and anything else backed by the cache
  may be silently off for the same reason; that is not checked yet.
- **Why not fixed here:** found by a prose-only PR recording the validator run; the cause is in
  production's configuration, which needs Coolify access.
- **Fix path:** Mitchell checks `CACHE_DRIVER` on the production app and whether the
  `serverless-redis-http` shim is running and reachable on Coolify. Then re-run the validator with
  `--only assertion.jti-reuse` and record the result in
  `docs/milestones/M60-personal-agents-act-for-you.md`. If the cache was down rather than off,
  consider whether a down cache should be reported somewhere, since it fails open silently.
- **Cross-reference:** ADR-089 (client assertions, fails open), ADR-059 (Redis is an expendable
  cache), KI-2026-11-10-b (the cache's HTTP shim), KI-2026-11-14-a (the validator run).
- **First noted:** 2026-11-15, kit validator re-run on production after the test agent's Allow.
- **Resolved:** 2026-11-15. **Cause:** the cache was unreachable, not off. `caesura-web`'s
  `KV_REST_API_URL` names the `caesura-redis-http` application by its Coolify resource ID
  (`xcneb7oqk33td6imben7pnyj`), but that application had *consistent container name* off, so
  Coolify named its container `<ID>-<deploy timestamp>` and nothing on the `coolify` network
  answered to the bare ID. From `caesura-web`'s terminal, a `fetch` of `KV_REST_API_URL + "/ping"`
  failed with `EAI_AGAIN`; every cache call failed open, so replay protection and every
  cache-backed rate limit were off, most likely since the move to Coolify (M59's box notes "a
  cache hit was not observed separately"). `CACHE_DRIVER`, the token, the shim's
  `SRH_CONNECTION_STRING` (to `caesura-redis` by its ID) and the network were all correct.
  **Fix (Coolify API, no code or `caesura-web` redeploy):** `is_consistent_container_name_enabled`
  set on `caesura-redis-http` and the application restarted; the deploy log shows the container
  created as `xcneb7oqk33td6imben7pnyj`. **Proof:** the kit validator, `check https://caesura.today
  --milestone foundation --only assertion.jti-reuse`, now passes ("The token endpoint refuses a
  client assertion whose jti it has already seen"). In the same change the shim's public domain
  (`http://xcneb7oqk33td6imben7pnyj.5.161.224.156.sslip.io`, Coolify's generated one) was removed;
  the proxy now answers that host with its "Site not available" 503 on a shim path. The check
  still passed after that restart. The runbook (`docs/ops/coolify-vps.md`) now states both
  settings. A cache that fails silently still reports nothing; that part of the fix path is left
  as is.

### KI-2026-10-02-a — the public library's rate-limit rows have no sweep index — RESOLVED

- **Severity:** cost / performance, once anonymous traffic is real. Nothing is broken today.
- **Found 2026-10-02** while building ADR-061. Signed-out reads of the playbook library are
  charged to a per-IP `public-library-minute` quota (`server/quota.ts`
  `publicLibraryQuota`, `server/publicLibraryLimit.ts`). Each anonymous IP writes a row to
  `rate_limit_counters` every minute it reads.
- **What happens today:**
  - Expired rows are swept on 1% of allowed requests, through `scheduleSweep` in
    `server/og/limit.ts`.
  - `rate_limit_counters_link_preview_window` (`server/db/schema.ts`) is a partial index on
    the `link-preview-minute:` prefix only. So this policy's sweep scans the whole table.
  - One process-wide `sweeping` flag is shared with the link-preview sweep. While one sweep
    is running, the other is skipped and waits for a later request.
- **Fix:** a partial index for the `public-library-minute:` prefix (schema change plus
  migration), mirroring the link-preview one. Or a single sweep that clears every
  IP-keyed policy.
- **Watch:** this only matters once there are many distinct anonymous IPs. Until then the
  table stays small.
- **Resolved 2026-10-02 (Mitchell: "go ahead and add the rate limit index").** Migration
  `0034_public_library_sweep_index` adds `rate_limit_counters_public_library_window`, a
  partial, window-led index on the `public-library-minute:` prefix, beside the link-preview
  one in `server/db/schema.ts`. `quota.int.test.ts`'s planner test now runs for both
  policies. Seen failing: renaming the policy to `public-library-minutes` turned the planner
  test red (`expected '[{"QUERY PLAN"…' to contain '"Index Name":"rate_limit_counters_pub…'`),
  and restoring it turned the test green. The shared `sweeping` flag is unchanged: a skipped
  sweep is retried on a later request, which is harmless.
- **Production:** previews migrate on build. Production is migrated by dispatching
  `migrate-production` from `main` after merge, and that run applies 0033 too, which
  `pnpm state` reports as not yet applied.

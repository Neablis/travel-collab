### KI-2026-10-02-a — the public library's rate-limit rows have no sweep index

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

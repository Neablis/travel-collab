### KI-2026-10-27-h — The sweep of `oauth-register-hourly` counters scans the whole counter table

- **Severity:** performance, low while `rate_limit_counters` is small.
- **Area:** the sweep M55 part 2 added for `oauth-register-hourly` rows in `rate_limit_counters`
  (the `publicLibraryLimit` pattern).
- **Symptom / What happens:** the delete filters on the policy name and window with no partial
  index behind it, so each sweep reads every counter row of every policy.
- **Why not fixed here:** the table is small today; an index is a migration outside part 2.
- **Fix path / Tripwire:** add a partial index on the policy's window column for the IP-keyed
  policies, or one index on `(policy, window_start)`. If the sweep shows in slow-query logs, do it.
- **Cross-reference:** M55 part 2, PR 615.
- **First noted:** 2026-10-27, M55 part 2 fix.

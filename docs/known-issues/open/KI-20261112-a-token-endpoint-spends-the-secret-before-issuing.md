### KI-2026-11-12-a — the token endpoint spends a code or refresh token before it stores the new pair, so a failed issue followed by a retry revokes the grant

- **Severity:** correctness (rare: needs a database failure between two statements, then a
  retry). The person behind the grant must consent again; nothing leaks.
- **Area:** `apps/web/src/server/oauth/tokens.ts` (`exchangeCode`, `refresh`, `issueTokens`,
  `cutOffGrant`).
- **Symptom / What happens:** `exchangeCode` marks the code used, and `refresh` marks the
  refresh token rotated, in one statement, then calls `issueTokens` in another, with no
  transaction. If `issueTokens` throws (the database drops, a constraint fails), the client
  gets `500 server_error` and holds nothing usable. When it retries, the code or refresh token
  it presents is already spent, so reuse detection (`cutOffGrant`, "code-reuse" or
  "refresh-reuse") revokes the whole grant.
- **Why not fixed here:** found while reviewing PR 729 (KI-2026-11-11-a). That PR only gives a
  thrown handler a JSON body, and it chose `500` with no `Retry-After` so that it does not
  invite the retry. The fix needs `issueTokens` to take a transaction handle, which is wider
  than that PR.
- **Fix path:** run the spend (`update … set used_at / rotated_at`) and `issueTokens`'s inserts
  in one `db.transaction`, passing the `tx` through, so a failed issue leaves the secret
  unspent. Test: make `issueTokens` throw once, then retry the same code or refresh token, and
  expect 200 rather than a revoked grant. Watch it fail first.
- **Cross-reference:** KI-2026-11-11-a, ADR-083 decision 4 (Lifetimes: rotation and reuse detection), RFC 9700
  §4.14.2.
- **First noted:** 2026-11-12, `part-reviewer` on PR 729.

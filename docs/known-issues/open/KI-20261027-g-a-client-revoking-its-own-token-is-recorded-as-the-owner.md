### KI-2026-10-27-g — A client revoking its own token over RFC 7009 is recorded as the owner

- **Severity:** audit accuracy, low. Revocation itself works; only the recorded reason is wrong.
- **Area:** `apps/web/src/server/oauth/` revoke path (`POST /api/oauth/revoke`), and the revoked
  reason on the OAuth tables from migration `0069` (M55 part 1).
- **Symptom / What happens:** when Claude (or any client) revokes a token at `/api/oauth/revoke`,
  the grant or token is marked revoked with reason `owner`, the same as the person pressing
  Disconnect. Connected apps and any later audit cannot tell the two apart.
- **Why not fixed here:** a distinct reason needs a migration on part 1's table and a line in
  ADR-083 §1, both outside part 2's scope.
- **Fix path / Tripwire:** add a `client` reason in a migration, pass it from the revoke route,
  and assert it in the revoke route's int test. If a Connected apps row ever needs to say who cut
  it, fix this first.
- **Cross-reference:** ADR-083 §1, §5; M55 part 2, PR 615 (review-615-a).
- **First noted:** 2026-10-27, M55 part 2 review.

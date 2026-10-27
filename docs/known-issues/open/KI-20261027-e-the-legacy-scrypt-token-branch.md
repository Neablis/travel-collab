### KI-2026-10-27-e — The legacy scrypt branch in `verifyToken` outlives its purpose on 2027-10-27

- **Severity:** cleanup. No user impact while it stays; it only names a revoked token correctly.
- **Area:** `apps/web/src/server/api-tokens/legacyScrypt.ts` (the whole file) and its one caller,
  `legacyRefusal` in `apps/web/src/server/api-tokens/index.ts`, reached from `verifyToken` on a
  keyed-lookup miss. Its fixtures: `legacyRow` in `apiTokens.int.test.ts` and the
  `storage changed` case in `public-api/route.int.test.ts`.
- **Symptom / What happens:** migration 0069 (M55 part 1) moved `api_tokens` from scrypt to a keyed
  HMAC and revoked every live row with `revoked_reason = 'storage-changed'`. So that someone
  presenting one of those tokens hears *"revoked when token storage changed … Mint a new one"*
  rather than *"not valid"*, a miss looks up rows by the secret's 8-character prefix and that
  reason, and confirms the secret with one scrypt verify (ADR-083 §3). That keeps `scrypt` in the
  tree after nothing is stored with it.
- **Why not fixed here:** a token minted the day before 0069 ran can live 365 days, so until its
  `expires_at` passes it can still be presented, and deserves the explanation.
- **Fix path / Tripwire:** on or after **2027-10-27**, confirm in production that no
  `storage-changed` row is unexpired
  (`SELECT count(*) FROM api_tokens WHERE revoked_reason = 'storage-changed' AND expires_at > now()`
  answers 0), then delete `legacyScrypt.ts`, make the keyed-lookup miss in `verifyToken` answer
  `unknown`, and delete the two fixtures and the tests that plant them. Keep the
  `storage-changed` value, the route's message and the token list's line: the rows stay listable.
- **Cross-reference:** ADR-083 §3; M55 part 1.
- **First noted:** 2026-10-27, M55 part 1.

# ADR-092: A second factor after Google, carried in the JWT and revoked by an epoch

**Status:** **Accepted — 2026-11-20.** Mitchell, scoping M62 (*"Go with your recommendations"*).
**Deciders:** Mitchell (product/eng); Claude (drafted).
Amends: ADR-025. Sessions stay stateless JWTs, but each token now carries a security epoch that the
`users` row can make stale.

## Context

The only way to sign in to Caesura is Google. Sessions are NextAuth JWTs with no adapter
(ADR-025), so a stolen cookie keeps working until it expires and cannot be revoked. Since M55 and
M60, an account can also mint API tokens and OAuth grants for software that acts on its behalf.
Mitchell asked for MFA with biometric unlock, adding factors and revoking them
(`docs/milestones/M62-a-second-factor-you-control.md`, D1–D16).

## Decision

1. **Google stays the only first factor.** An account with MFA on lands on `/signin/verify` after
   Google and before any app route. A passkey as a first factor is out of scope.
2. **The factors are passkeys (WebAuthn), TOTP and one-time recovery codes.** SMS and email codes
   are not offered.
3. **The JWT records what passed.** It holds `amr` (`["google","webauthn"]` or `["google","otp"]`),
   `mfaAt`, and `epoch`. A server route sets them through NextAuth's `update` after it verifies the
   factor. `proxy.ts` redirects a token on an MFA account when its `amr` has only one entry.
4. **Revocation is an epoch.** `users.security_epoch` goes up on every factor change, turn-off,
   code regeneration and operator reset. The `jwt` callback refuses a token minted under an older
   epoch, which signs out every other session. The session that made the change gets a new token.
   This is the one place stateless sessions become revocable. It costs one primary-key read of
   `users` per server `auth()`, which means several per page render. This is a new read: the
   callback was pure before M62, and `server/auth.ts` now supplies the lookup. The proxy's
   `mfaRequired` flag is current only as of sign-in or the last `update()`, so turning MFA on
   bumps the epoch too, and a cookie the epoch has made stale is sent to `/signin`.
5. **Secrets at rest.** The TOTP secret is sealed with AES-256-GCM under `MFA_SECRET_KEY`
   (`server/secrets/sealed.ts`), because verifying a code needs the secret back. Recovery codes
   are stored as keyed digests (`server/secrets/keyedDigest.ts`), and each works once.
6. **Fresh checks.** Adding or removing a factor, regenerating codes, turning MFA off, the OAuth
   consent screen and *Create token* each need a second factor checked within the last 10
   minutes. Existing tokens and grants keep working.
7. **Guessing is limited.** 5 wrong codes in 15 minutes lock codes for an account for 15 minutes
   (`mfa_attempts`). Passkeys are not limited.
8. **The PWA lock is a convenience, not a boundary.** It is a client gate over a valid session,
   per device, cleared only by a passkey assertion. The UI says so.
9. **Recovery past the codes** is an operator reset in the console. It records the operator, the
   reason and an email confirmation they attest to (`mfa_resets`).

## Consequences

- Every session read now checks the epoch. A bad migration or a missing column would sign everyone
  out, so the `jwt` callback treats a missing epoch as 0.
- Production needs `MFA_SECRET_KEY` set before enrolment works. Without it, enrolment fails closed.
  Losing the key makes every enrolled authenticator app unusable, and recovery codes and passkeys
  still work.
- The passkey RP ID is the deployment's host, so a passkey made on production never unlocks a
  preview.
- MFA is free on every tier.

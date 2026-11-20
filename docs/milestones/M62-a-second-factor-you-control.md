# M62 — An account can ask for a second factor, and you control every one

**Status (2026-11-20): scoped, not started.** Minted by Mitchell the same day: *"support for MFA,
including biometric unlock, revoking MFA and adding new ones"*. Placed **next after M59, ahead of
M53**, by Mitchell the same day (see `docs/milestones/README.md`, *2026-11-20 — minted: M62 and M63*).
**Scoped the same day with every decision as recommended.** Mitchell: *"Go with your
recommendations."*

## Why this exists

Signing in to Caesura is Google and nothing else (`apps/web/src/lib/authConfig.ts`: the Google
provider, plus a Credentials provider for dev login only). Sessions are stateless NextAuth JWTs
with no adapter (ADR-025). So an account is exactly as safe as the Google account behind it, and
a stolen session cookie is the whole account until it expires.

Since M55 and M60, an account is also something other software acts for: API tokens with scopes,
OAuth grants for Claude's connector, and Poppy agents (ADR-083, ADR-089). The account's
*Security* tab already holds API tokens and Connected apps, and its own comment reserves the space
for this: *"The tab is the place for whatever else secures an account later (MFA)"*
(`components/account/AccountScreen.tsx:45`).

What is asked for:

- **Biometric unlock**: Face ID, Touch ID, Windows Hello or an Android fingerprint, which on the
  web means a **passkey** (WebAuthn, with a platform authenticator and user verification).
- **Adding new factors**: more than one passkey (phone and laptop), and an authenticator app.
- **Revoking**: removing one factor, and turning MFA off entirely.

## Decisions

### Decided 2026-11-20, all as recommended

Each *Recommendation* below is now the decision.

1. **What MFA sits on top of.** *Recommendation:* a second step after Google, not a replacement
   for it. Google stays the only first factor. Once an account has MFA on, a Google sign-in
   lands on `/signin/verify` before any app route. A passkey as a *first* factor
   (passwordless sign-in without Google) is a later candidate. It changes account recovery and
   sign-up, which is a milestone of its own.
2. **Which factors.** *Recommendation:* passkeys (WebAuthn) and TOTP authenticator apps, plus
   one-time recovery codes. **No SMS**: it costs money per message, it is the weakest factor,
   and SIM swaps are the attack MFA exists to stop. Email codes are not a second factor when the
   first factor is the same Google account that owns the inbox.
3. **What "biometric unlock" means in the PWA.** *Recommendation:* two things, both from the same
   passkey. **(a)** The MFA step at sign-in asks for the passkey first, so on a phone it is one
   Face ID prompt. **(b)** An opt-in *Lock after inactivity* on an installed PWA (M52): after a
   chosen idle time (15 minutes, 1 hour, 1 day), the app shows a lock screen that only a passkey
   assertion clears. The session is not signed out, so drafts and the offline cache survive.
   The lock is a client gate over a valid session. That makes it convenience on a shared
   device, not a server security boundary. The milestone file says so, and so must the UI copy.
4. **How the session records that the second factor passed.** *Recommendation:* an `amr` claim
   (`["google","webauthn"]` or `["google","otp"]`) and an `mfaAt` time in the JWT, set by a server
   action that verifies the assertion and calls NextAuth's `update`. `proxy.ts` sends a session
   whose account has MFA on but whose token has no `amr` second entry to `/signin/verify`. The
   `users` row carries `mfa_enabled_at` and a `security_epoch`. Every factor change bumps the
   epoch, and a token minted under an older epoch fails verification. That is how revoking
   reaches sessions that are already open, which stateless JWTs cannot do today.
5. **Where factors live.** *Recommendation:* one `user_factors` table (migration): `id`,
   `user_id`, `kind` (`passkey` | `totp`), a name the person chose, `created_at`, `last_used_at`.
   Passkey columns hold the credential id, public key, sign count and transports. TOTP holds its
   secret encrypted with a key from the environment, never in plain text and never only
   digested, since it must be read back. Recovery codes go in `user_recovery_codes`, each
   stored HMAC-SHA256 like every API secret since M55 (`server/secrets/keyedDigest.ts`), and
   each one works once.
6. **Adding a factor.** *Recommendation:* adding any factor needs a *fresh* second-factor check
   (within 10 minutes) when MFA is already on, or a fresh Google sign-in when it is off. The first
   factor added turns MFA on and shows ten recovery codes once, with *Download* and *Copy*.
   Turning on is not done until the person ticks *I saved these*. A passkey is named from its
   authenticator (*"iPhone passkey"*) and can be renamed.
7. **Revoking.** *Recommendation:* each factor has *Remove*, behind the same fresh check. You
   cannot remove the last factor while MFA is on; *Turn off two-step sign-in* does that, removes
   every factor and every recovery code, and needs the fresh check too. *Regenerate recovery
   codes* voids the old set. Every one of these bumps `security_epoch`, which signs out every
   other session, and emails the account (`server/email/send.ts`) with what changed and from where.
8. **What MFA covers beyond the browser.** *Recommendation:* the OAuth consent screen
   (`/oauth/authorize`, M55) and *Create token* both require a satisfied second factor, since
   they mint credentials. Existing API tokens and OAuth grants keep working, because they are
   already scoped and revocable. Turning MFA *on* offers *Also revoke all tokens and connected
   apps*, unticked.
9. **Losing every factor.** *Recommendation:* recovery codes are the only self-serve path. Past
   that, the operator console gets a *Reset two-step sign-in* action, recorded with the operator and a
   reason, run only after the account's Google email confirms. No support flow is built
   beyond that.
10. **Library.** *Recommendation:* `@simplewebauthn/server` and `@simplewebauthn/browser` for
    WebAuthn, and `otpauth` for TOTP. Both are small and well maintained, and both run server
    side, not on the edge. The RP ID is the apex domain, so a passkey made on production works
    on production only. PR previews get their own RP ID and cannot unlock production
    passkeys, which is fine.
11. **Tier.** *Recommendation:* free for everyone. Account security is not a Premium feature,
    and a paywall on it reads badly.

### Decided 2026-11-20 at planning, all as recommended

The code survey turned up three gaps. Mitchell also approved how each part works on screen,
including the interaction sketches in `docs/plans/2026-11-20-M62-a-second-factor-you-control.md`.

12. **Order.** M62 starts now, beside M59. M59 still has its production cutover and Coolify
    previews open, and M62 depends on neither.
13. **Wrong codes.** Server actions have no rate limit today. At `/signin/verify`, 5 wrong
    authenticator or recovery codes in 15 minutes, per account, lock codes for 15 minutes and email
    the account. Passkeys cannot be guessed, so they stay usable during the lock.
14. **Where the TOTP key comes from.** The repo has no encryption helper. A new
    `server/secrets/sealed.ts` (AES-256-GCM) takes its key from `MFA_SECRET_KEY`. Mitchell sets
    that variable on production in Coolify before the top part merges. The app fails closed on
    enrolment without it.
15. **The operator reset's confirmation** is the operator ticking *I confirmed this by email with
    the account's Google address*, beside a required reason. It is recorded in an `mfa_resets` row
    and listed on the console's account page. No email-confirmation flow is built.
16. **The PWA lock setting is per device**, stored locally, because a phone and a laptop want
    different answers. It is shown only in the installed app, and only when the account has a
    passkey.

## Scope

A first cut of the parts, for the plan to settle:

1. **The model** (decisions 4, 5): migration for `user_factors`, `user_recovery_codes`,
   `mfa_enabled_at`, `security_epoch`. The JWT claims, the epoch check, and the `proxy.ts`
   redirect.
2. **Passkeys** (decisions 3a, 6, 10): register and verify, the *Two-step sign-in* section on
   *Security* with add, rename and remove, and the `/signin/verify` screen.
3. **Authenticator app and recovery codes** (decisions 2, 6, 7): TOTP enrolment with a QR code
   and a typed confirmation, and the recovery codes' show-once, use-once and regenerate flow.
4. **Revoking and its reach** (decisions 7, 8): remove, turn off, the epoch bump, the email,
   and the consent screen and *Create token* gates.
5. **The PWA lock** (decision 3b): the idle timer, the lock screen and its setting.
6. **The operator reset** (decision 9).
0. **The gate**: an ADR, the evidence, the retro.

## Out of scope

- Passkeys as a first factor, or any sign-in that is not Google.
- SMS, email codes, push approval or hardware keys as their own kind (a security key works today
  as a passkey, through WebAuthn, and is not designed for separately).
- Requiring MFA for anyone, including operators. A candidate once it exists.
- Step-up for ordinary edits. Only credential-minting and factor changes ask again.

## Exit gate

- [ ] **Model:** a session whose account has MFA on and whose token lacks a second factor is sent
  to `/signin/verify` from every app route, and a token under an older `security_epoch` is refused
  (integration tests).
- [ ] **Passkey:** registering, verifying and removing a passkey pass with a virtual
  authenticator (`test:e2e:ci-like`, or CI on the PR).
- [ ] **Authenticator app:** a TOTP code from the enrolled secret passes, a used or wrong code
  fails, and the secret is not stored in plain text (unit and integration tests).
- [ ] **Recovery codes:** each code works once, regenerating voids the old set, and they are
  stored as keyed digests (integration tests).
- [ ] **Add a second factor:** a second passkey or an authenticator app can be added beside the
  first, and either one completes sign-in.
- [ ] **Revoke:** removing a factor, turning MFA off, and regenerating codes each sign out every
  other session and send the account an email.
- [ ] **Credential gates:** the OAuth consent screen and *Create token* refuse a session without a
  satisfied second factor when MFA is on.
- [ ] **PWA lock:** with the lock on, an installed app idle past its time shows the lock screen,
  and only a passkey clears it.
- [ ] **Operator reset:** the console action clears an account's factors and records who did it and why.
- [ ] **[walk]** Mitchell turns MFA on production on with Face ID on his phone, adds his laptop's
  passkey and an authenticator app, signs in with each, removes one, and turns it off.

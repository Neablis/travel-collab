# M62 plan: An account can ask for a second factor, and you control every one

Milestone: `docs/milestones/M62-a-second-factor-you-control.md` (D1–D16, answered 2026-11-20). ADR: `docs/architecture/ADR-092-a-second-factor-after-google.md`.
Part 0 is the prose-only tracking PR on `ccr-f7b14b1c-can07a`. It merges last.
Deleted at gate close (`docs/plans/README.md`).

Paths are relative to `apps/web/src/` unless they start with `packages/`, `apps/`, `docs/`, or `e2e/`
(that last one means `apps/web/e2e/`).
Line numbers are from `main` at `b4539ab`, so treat them as a starting point, not as fact.
**New** marks a file that does not exist yet.

## Order

| Part | Branch | Base |
|---|---|---|
| 1 The model | `claude/m62-part1-model` | `main` |
| 2 Passkeys and turning on | `claude/m62-part2-passkeys` | part 1 |
| 3 Authenticator app and recovery codes | `claude/m62-part3-totp-codes` | part 2 |
| 4 Revoking and its reach | `claude/m62-part4-revoke` | part 3 |
| 5 The PWA lock | `claude/m62-part5-pwa-lock` | part 4 |
| 6 The operator reset | `claude/m62-part6-operator-reset` | part 5 |

The parts form one stack (`docs/guidelines/stacked-prs.md`). Every PR is a draft. Part 6's PR is
retargeted to `main` and runs the one full CI.

Facts the parts share (the survey, 2026-11-20):
- **Migrations.** `apps/web/drizzle/`. The latest is `0078_poppy_one_sign_in_per_resource`, and the
  journal is `drizzle/meta/_journal.json`. Part 1 adds `0079_mfa` with every M62 table:
  `user_factors`, `user_recovery_codes`, `mfa_attempts` (D13), `mfa_resets` (D15), and on `users`
  the columns `mfa_enabled_at` and `security_epoch` (integer, default 0). Later parts add no
  migration.
- **Schema** is `server/db/schema.ts`: `users` at L60, `apiTokens` at L244, `oauthGrants` at L349.
- **Auth.** The NextAuth config is `lib/authConfig.ts`: `callbacks.jwt` at L210 and `session` at
  ~L245. The instance is `server/auth.ts:16`. `proxy.ts` runs `NextAuth(authConfig)` at L31,
  `proxy` at L95, `isGuardedPath` at L165, and the `/signin` redirect at L218. Its matcher is at
  L289. No code calls `getToken`, so every read goes through `auth()`, which goes through the
  `jwt` callback.
- **Dev login** is the Credentials provider `dev-login` (`authConfig.ts:191`). In e2e,
  `signInAsDevUser` is `e2e/helpers.ts:202`, and storage state comes from `e2e/auth.setup.ts`.
  A dev-login session counts as the Google first factor (`amr: ["google"]`).
- **Secrets.** `server/secrets/keyedDigest.ts` (`keyedDigest` L101, `digestsMatch` L136) is used
  for recovery codes. The repo has no encryption helper, so part 1 adds `server/secrets/sealed.ts`
  (D14). There is no env schema either, so env is read ad hoc as in `lib/deployment/env.ts`.
  Add `MFA_SECRET_KEY` to the root `.env.example`.
- **Email** is `server/email/send.ts` (`sendEmail` L77), with templates in
  `server/email/templates.ts`.
- **Security tab.** `components/account/AccountScreen.tsx`: the MFA comment is at L42, and
  `SecuritySection` is at L62. Two-step sign-in goes above API tokens (L157).
- **Dependencies** (added in part 2 and part 3, in `apps/web/package.json`):
  `@simplewebauthn/server`, `@simplewebauthn/browser`, `otpauth`, and a QR library (`qrcode`).
  None of them is present today.
- **WebAuthn in e2e** goes through a CDP virtual authenticator
  (`WebAuthn.addVirtualAuthenticator`). The repo has no precedent for it. Part 2 adds the helper
  to `e2e/helpers.ts`.
- **The RP ID** comes from `publicOrigin()`'s host (`lib/deployment/env.ts:33`).

## Part 1: The model (~14 files)

**Theme.** This part covers D4, D5, D13 and D14: the tables, the JWT claims, the epoch check, the
redirect, a sealed-secret helper, the attempt limiter, and the recovery-code module (generate,
verify once, regenerate). It builds no UI beyond a minimal `/signin/verify` placeholder page so the
redirect lands somewhere. Part 2 replaces that page.

| File | Entry point | Change | Test |
|---|---|---|---|
| `apps/web/drizzle/0079_mfa.sql` + journal (**new**) | — | the tables and columns above | `server/mfa/model.int.test.ts` (**new**) |
| `server/db/schema.ts` | `users` L60 | the new tables and columns | same |
| `server/secrets/sealed.ts` (**new**) | `seal`, `unseal` | AES-256-GCM with `MFA_SECRET_KEY`; throws when the key is unset | `server/secrets/sealed.test.ts` (**new**) |
| `server/mfa/state.ts` (**new**) | `mfaStateFor(userId)`, `bumpSecurityEpoch` | reads `mfa_enabled_at` and `security_epoch` | `server/mfa/model.int.test.ts` |
| `server/mfa/recoveryCodes.ts` (**new**) | `issueRecoveryCodes`, `consumeRecoveryCode` | 10 codes, `keyedDigest`, each used once; issuing again voids the old set | `server/mfa/recoveryCodes.int.test.ts` (**new**) |
| `server/mfa/attempts.ts` (**new**) | `recordFailure`, `isLocked` | D13: 5 in 15 minutes | `server/mfa/attempts.int.test.ts` (**new**) |
| `lib/authConfig.ts` | `callbacks.jwt` L210 | `amr`, `mfaAt`, `epoch` on the token; `update` trigger; return null when the epoch is older | `lib/authConfig.test.ts` |
| `proxy.ts` | `proxy` L95 | MFA on and no second `amr` entry → `/signin/verify?callbackUrl=` | `proxy.mfa.test.ts` (**new**) or the existing proxy test |
| `app/(front)/signin/verify/page.tsx` (**new**, placeholder) | — | heading and sign-out only | — |
| `.env.example` | — | `MFA_SECRET_KEY` | — |

Gate boxes: **Model** (seen red), and **Recovery codes** for the server half.

**Preview walk:** nothing appears on screen. Verify with the integration tests.

## Part 2: Passkeys and turning on (~16 files)

**Theme.** This part covers D3a, D6 and D10. It builds WebAuthn register and verify, the real
`/signin/verify` screen (passkey first), the *Two-step sign-in* section with Add a passkey, rename,
the 10-minute fresh-check dialog, and the first factor turning MFA on with recovery codes shown
once. Turning on **bumps the epoch** (part 1 review, finding 5a). A request carrying a session
cookie that `auth()` refuses as stale is redirected to `/signin` (finding 5b). Remove and turn-off belong to part 4.

| File | Entry point | Change | Test |
|---|---|---|---|
| `apps/web/package.json` | — | `@simplewebauthn/server`, `@simplewebauthn/browser` | — |
| `server/mfa/passkey.ts` (**new**) | `registrationOptions`, `verifyRegistration`, `authenticationOptions`, `verifyAuthentication` | RP ID from `publicOrigin()`; challenges are short-lived | `server/mfa/passkey.int.test.ts` (**new**) |
| `app/api/account/mfa/passkeys/route.ts` (**new**) | POST options and verify | adds a factor; the first one turns MFA on and returns codes | `app/api/account/mfa/mfa.int.test.ts` (**new**) |
| `app/api/account/mfa/factors/[factorId]/route.ts` (**new**) | PATCH rename | — | same |
| `app/api/mfa/verify/route.ts` (**new**) | POST passkey assertion | sets the `amr` claim through `update` | same |
| `app/(front)/signin/verify/page.tsx` | — | the real screen | — |
| `components/front/VerifyScreen.tsx` (**new**) | `VerifyScreen` | passkey prompt first, then the other options | `components/front/VerifyScreen.test.tsx` (**new**) |
| `components/account/TwoStepSection.tsx` (**new**) | `TwoStepSection` | off and on states, factor rows | `components/account/TwoStepSection.test.tsx` (**new**) |
| `components/account/FreshCheckDialog.tsx` (**new**) | — | the verify step in a dialog | covered by `TwoStepSection.test.tsx` |
| `components/account/RecoveryCodesSheet.tsx` (**new**) | — | Download, Copy, *I saved these*, and the revoke-tokens tick (wired in part 4) | `components/account/RecoveryCodesSheet.test.tsx` (**new**) |
| `components/account/AccountScreen.tsx` | `SecuritySection` L62 | mounts the section above API tokens | `AccountScreen.security.test.tsx` |
| `e2e/helpers.ts` | — | `addVirtualAuthenticator(page)` | — |
| `e2e/m62-passkey.spec.ts` (**new**) | — | register, sign out, sign in through verify, rename | itself |

Gate boxes: **Passkey** for register and verify (removal comes in part 4).

**Preview walk:** go to Account › Security › Add a passkey, see the codes sheet, tick, then Done.
Sign out and back in, and the passkey prompt appears.

## Part 3: Authenticator app and recovery codes (~10 files)

**Theme.** This part covers D2, D6, D7 (Regenerate) and D13 in the UI. Pass the factor row's id as GCM
additional data when sealing the TOTP secret, so a sealed secret can't be moved to another row
(part 1 review, finding 8). Verify codes only through the atomic attempt entry point from part 1. It adds TOTP enrolment with
a QR code and the *Can't scan?* text, the code and recovery-code paths on `/signin/verify` with the
lock message, *Regenerate* with the left count, and either factor completing sign-in.

| File | Entry point | Change | Test |
|---|---|---|---|
| `apps/web/package.json` | — | `otpauth`, `qrcode` | — |
| `server/mfa/totp.ts` (**new**) | `startTotp`, `confirmTotp`, `verifyTotp` | the secret is sealed; a used code (same step) is refused | `server/mfa/totp.int.test.ts` (**new**) |
| `app/api/account/mfa/totp/route.ts` (**new**) | POST start and confirm | — | `app/api/account/mfa/mfa.int.test.ts` |
| `app/api/account/mfa/recovery-codes/route.ts` (**new**) | POST regenerate | fresh check; bumps the epoch | same |
| `app/api/mfa/verify/route.ts` | — | `otp` and `recovery` kinds, through `attempts.ts` | same |
| `components/account/AddAuthenticatorDialog.tsx` (**new**) | — | QR code, secret text, a 6-digit field | `components/account/AddAuthenticatorDialog.test.tsx` (**new**) |
| `components/front/VerifyScreen.tsx` | — | code and recovery inputs, the lock message | `VerifyScreen.test.tsx` |
| `components/account/TwoStepSection.tsx` | — | Add an authenticator app, the codes-left count, Regenerate | `TwoStepSection.test.tsx` |
| `e2e/m62-totp.spec.ts` (**new**) | — | enrol beside a passkey, then sign in with the code (generated in the test from the shown secret) | itself |

Gate boxes: **Authenticator app**, **Recovery codes** (regenerate), and **Add a second factor**.

**Preview walk:** go to Security › Add an authenticator app, scan it with a phone, and type the
code. Sign out, choose *Use authenticator code*, and get in.

## Part 4: Revoking and its reach (~12 files)

**Theme.** This part covers D7 and D8. Consume the `carry` proof that re-mints the changing session's token
(part 1 review, finding 7). It adds Remove (refused for the last factor), *Turn off
two-step sign-in*, the epoch bump on every change (other sessions are signed out), the security
email, the gates on consent and *Create token*, and the *Also revoke all tokens and connected
apps* tick.

| File | Entry point | Change | Test |
|---|---|---|---|
| `app/api/account/mfa/factors/[factorId]/route.ts` | DELETE | fresh check; refuses the last factor | `app/api/account/mfa/mfa.int.test.ts` |
| `app/api/account/mfa/route.ts` (**new**) | DELETE (turn off), POST revoke-all | — | same |
| `server/mfa/changes.ts` (**new**) | `recordSecurityChange` | bumps the epoch, re-mints the current session's token, sends the email | `server/mfa/changes.int.test.ts` (**new**) |
| `server/email/templates.ts` | — | `securityChangeEmail` | `server/email/templates.test.ts` |
| `app/api/oauth/authorize/route.ts` | `POST` L31 | refuses without a satisfied factor when MFA is on | `app/api/oauth/authorize/route.int.test.ts` |
| `components/oauth/ConsentScreen.tsx` | L65 | sends the person to verify first | `ConsentScreen.test.tsx` |
| `app/api/account/tokens/route.ts` | `POST` L33 | the same gate | `app/api/account/tokens/tokens.int.test.ts` |
| `components/account/TokensSection.tsx` | L210 | handles the refusal by opening the fresh check | `TokensSection.test.tsx` |
| `components/account/TwoStepSection.tsx` | — | Remove, Turn off | `TwoStepSection.test.tsx` |
| `e2e/m62-passkey.spec.ts` | — | remove a passkey; a second browser context is signed out | itself |

Gate boxes: **Passkey** (remove), **Revoke**, and **Credential gates**.

**Preview walk:** with two factors, remove one and check the email in the dev outbox. Turn off,
and a second tab is back at sign-in.

## Part 5: The PWA lock (~6 files)

**Theme.** This part covers D3b and D16: a per-device idle lock in the installed app, shown only
with a passkey, where only a passkey assertion clears it. The session stays.

| File | Entry point | Change | Test |
|---|---|---|---|
| `lib/pwaLock.ts` (**new**) | `lockSetting`, `isPastIdle` | localStorage, guarded by try/catch | `lib/pwaLock.test.ts` (**new**) |
| `components/PwaLockGate.tsx` (**new**) | — | idle timer, lock screen, Unlock and Sign out | `components/PwaLockGate.test.tsx` (**new**) |
| `app/(app)/layout.tsx` | — | mounts the gate | — |
| `components/account/TwoStepSection.tsx` | — | the *Lock after inactivity* control, when standalone (`lib/installPrompt.ts:82`) | `TwoStepSection.test.tsx` |
| `app/api/mfa/verify/route.ts` | — | an `unlock` purpose that does not change the session | `app/api/account/mfa/mfa.int.test.ts` |
| `e2e/m62-pwa-lock.spec.ts` (**new**) | — | emulate standalone, set a short idle time, lock, unlock with a virtual authenticator | itself |

Gate boxes: **PWA lock**.

**Preview walk:** the preview cannot be installed. The e2e spec emulates standalone mode.

## Part 6: The operator reset (~7 files)

**Theme.** This part covers D9 and D15: the console action, the `mfa_resets` record, and the
email.

| File | Entry point | Change | Test |
|---|---|---|---|
| `app/api/admin/accounts/[accountId]/mfa-reset/route.ts` (**new**) | POST | `requireAdminApi`, a reason and the confirm tick, then clear and bump | `app/api/admin/accounts/[accountId]/mfa-reset/route.int.test.ts` (**new**) |
| `server/admin/accountDetail.ts` | `adminAccountDetail` L50 | MFA state and resets | `server/admin/accountDetail.int.test.ts` |
| `components/admin/AccountMfaReset.tsx` (**new**) | — | the dialog | `components/admin/AccountMfaReset.test.tsx` (**new**) |
| `components/admin/AccountPage.tsx` | L85 | mounts it | `components/admin/AccountPage.test.tsx` |

Gate boxes: **Operator reset**.

**Preview walk:** go to /admin › an account with MFA › Reset two-step sign-in, enter a reason, tick
the box, and confirm. The account's factors are gone and the reset is listed.

## Gate

The e2e boxes (Passkey, Add a second factor, PWA lock) read CI on part 6's PR once it is
retargeted to `main` and ready. The integration and unit boxes read the same run. The **[walk]**
is Mitchell's, on production after the merge. It needs `MFA_SECRET_KEY` set in Coolify first
(D14), because PR previews have never had working sign-in.

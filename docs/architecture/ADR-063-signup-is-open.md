# ADR-063: Signup is open; an invite code is tracked, not required

**Status:** **Accepted — 2026-10-03.** Mitchell asked for it. This records the shape.
**Deciders:** Mitchell (product); Claude — drafted
Amends: **M11a** (`docs/milestones/M11a-invite-gate.md`) — the gate's refusals.
Related: **ADR-025** (`users` under JWT sessions; "never been here" is "no `users` row"),
**M20 link 8** (the referral reward keys on a redeemed code).

## Context

> Strip out the invite code as a blocking element. We want to leave being able to invite
> someone and tracking who invites who, but it will no longer block new users.

Since M11a a brand-new account was refused unless it presented one of three credentials — a
pending trip-invite token, the shared super code, or an unspent single-use code — and landed on
`/signup?error=MISSING_INVITE_CODE | INVALID_INVITE_CODE | SPENT_INVITE_CODE`.

## Decision

1. **Nobody is refused for want of a code.** `recordSignIn` admits every brand-new account.
   When `redeemAdmission` reports a refusal, the admission is recorded as `open-signup` instead
   (a new `AdmissionGrant`). It credits nobody.
2. **A code that can be claimed still is.** `redeemAdmission` is unchanged: a valid single-use
   code is claimed with the same conditional `UPDATE`, so `invite_codes.redeemed_by` still
   records who came in on whose code, and M20's `rewardReferrer` still fires on
   `via === "invite-code"`. A spent code admits its second holder without rewriting the first
   redeemer.
3. **The field stays on `/signup`, marked optional.** `ADMISSION_FIELD_COPY` now says the code
   credits whoever invited you and may be left empty. Minting codes (`/api/account/referrals`)
   and trip invites are untouched.
4. **`refusalRedirect` is deleted.** Nothing produces a refusal path any more. The
   `AdmissionRefusal` contract and its copy map stay. `redeemAdmission` still uses the enum to
   say why nothing was claimed, and a stale `/signup?error=…` link still renders a sentence.
   Retiring them is a separate contract change.

## Consequences

- M11b and M12 were scoped on "the platform is invite-gated" (M11a § Why this exists). That
  premise no longer holds. Public user-authored text now rests on M12's reporting and
  moderation alone.
- The dev-login bypass and `DEV_LOGIN_HONOURS_INVITE_GATE` stay. The bypass still claims no
  code. The e2e opt-out now exists so `m11a-invite-gate.spec.ts` can prove a code is claimed
  through the real cookie round trip.
- `INVITE_SUPER_CODE` no longer guards anything. It only marks how someone arrived.

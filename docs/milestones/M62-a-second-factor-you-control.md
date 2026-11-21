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

- [x] **Model:** a session whose account has MFA on and whose token lacks a second factor is sent
  to `/signin/verify` from every app route, and a token under an older `security_epoch` is refused
  (integration tests). Evidence (paths under `apps/web/`, lines as at b26e446): `src/server/mfa/model.int.test.ts:54` (MFA account with only its first factor is sent to `/signin/verify` from an app route), `:64` (also from `/admin`, `/oauth/authorize` and the live library), `:118` (a token under an older `security_epoch` is refused, the session that made the change kept). CI run 44872567334 on b26e446, green (unit, integration, e2e 1/2 and 2/2).
- [x] **Passkey:** registering, verifying and removing a passkey pass with a virtual
  authenticator (`test:e2e:ci-like`, or CI on the PR). Evidence: `e2e/m62-passkey.spec.ts:14` (register with a virtual authenticator, sign out, sign in through verify, rename) and `:128` (remove a passkey). CI run 44872567334 on b26e446, green (unit, integration, e2e 1/2 and 2/2).
- [x] **Authenticator app:** a TOTP code from the enrolled secret passes, a used or wrong code
  fails, and the secret is not stored in plain text (unit and integration tests). Evidence: `src/server/mfa/totp.int.test.ts:36` (secret stored sealed, never as the scanned base32), `:66` (the current code passes once, the same step again fails), `:82` (a code outside one step of drift fails), `:96` (another account's code fails); `src/server/secrets/sealed.test.ts:14`. CI run 44872567334 on b26e446, green (unit, integration, e2e 1/2 and 2/2).
- [x] **Recovery codes:** each code works once, regenerating voids the old set, and they are
  stored as keyed digests (integration tests). Evidence: `src/server/mfa/recoveryCodes.int.test.ts:29` (each code works once), `:51` (regenerating voids the whole old set), `:13` (stored as keyed digests, none in plaintext). CI run 44872567334 on b26e446, green (unit, integration, e2e 1/2 and 2/2).
- [x] **Add a second factor:** a second passkey or an authenticator app can be added beside the
  first, and either one completes sign-in. **Ticked 2026-11-21 on the walk as the missing evidence:** on production Mitchell used a passkey on two devices (his Android phone and his desktop) and an authenticator app beside them, each used to sign in (see the **[walk]** box). Test evidence, proven at b26e446: an authenticator app is added beside a passkey and its code completes sign-in (`apps/web/e2e/m62-totp.spec.ts:28`; `apps/web/src/app/api/account/mfa/mfa.int.test.ts:600`), and a passkey completes sign-in (`apps/web/e2e/m62-passkey.spec.ts:14`; `mfa.int.test.ts:148`). A second passkey is added only at the route level (`mfa.int.test.ts:307`, `:710`); no test signs in with a second passkey, because the virtual authenticator refuses a second credential for one account (`apps/web/e2e/m62-passkey.spec.ts:126`).
- [x] **Revoke:** removing a factor, turning MFA off, and regenerating codes each sign out every
  other session and send the account an email. Evidence: `src/app/api/account/mfa/mfa.int.test.ts:779` (Remove signs out a session minted before it, keeps this one), `:810` (Turn off), `:694` (Regenerate bumps the epoch so another session is refused), `:838` (one email per change, asserted by recipient and subject for Remove, Regenerate and Turn off). CI run 44872567334 on b26e446, green (unit, integration, e2e 1/2 and 2/2).
- [x] **Credential gates:** the OAuth consent screen and *Create token* refuse a session without a
  satisfied second factor when MFA is on. Evidence: `src/app/api/oauth/authorize/route.int.test.ts:113` (Allow is refused with 403 and grants nothing without a second factor in the last ten minutes), `src/app/api/account/tokens/tokens.int.test.ts:66` (Create token is refused with 403 and no token). CI run 44872567334 on b26e446, green (unit, integration, e2e 1/2 and 2/2).
- [x] **PWA lock:** with the lock on, an installed app idle past its time shows the lock screen,
  and only a passkey clears it. Evidence: `e2e/m62-pwa-lock.spec.ts:23` (idle past its time locks, the passkey opens it; installed mode is emulated through `navigator.standalone`) and `src/components/PwaLockGate.test.tsx:60` (locks, and only the passkey clears it). CI run 44872567334 on b26e446, green (unit, integration, e2e 1/2 and 2/2).
- [x] **Operator reset:** the console action clears an account's factors and records who did it and why. Evidence: `src/app/api/admin/accounts/[accountId]/mfa-reset/route.int.test.ts:140` (clears factors and codes, turns two-step off, bumps the epoch, records the operator, reason and confirmed email in `mfa_resets`, emails the account). CI run 44872567334 on b26e446, green (unit, integration, e2e 1/2 and 2/2).
- [x] **[walk]** Mitchell turns MFA on production on with a biometric passkey on his Android phone and on
  his desktop, adds an authenticator app, and signs in with each. **Wording amended 2026-11-21, Mitchell's call:**
  the box first read *Face ID on his phone, his laptop's passkey and an authenticator app, signs in with each,
  removes one, and turns it off*; Face ID on an iPhone is replaced by a biometric passkey on Android and on
  desktop, because he has no iPhone. **Walked on production 2026-11-21**, in his words: *"I don't have an iPhone so
  skip Face ID, tested both an authenticator app and a biometric lock on android and desktop."* **Not walked on
  production:** removing a factor and turning MFA off; the Revoke box's integration tests cover them. Ticked:
  Mitchell, production, 2026-11-21.

## Retro — written 2026-11-21 (10 of 10 boxes ticked)

The stack merged 2026-11-21: PRs 774 to 778 through PR 778 (merge 2557e2e, 18:19Z), then PR 779 (301f28e,
18:26Z). `deploy-production` run 44934907812 on 2557e2e applied `0079_mfa` (its "Apply pending migrations"
step succeeded), and run 44935504221 on 301f28e is green. Mitchell walked production the same day (see the
**[walk]** box, whose wording he amended). Closed with gate 10 of 10.

### What went well

- Six parts, PRs 774 to 779, stacked on part 0 (PR 773), with the code complete on the top, PR 779.
  Part 1 adds migration `0079_mfa`.
- One full CI run on the top part decided the milestone, as `building-a-milestone.md` says. It went red once (run 44865756857 on
  317a13b) and green after the fixes (run 44872567334 on b26e446: unit, integration, e2e 1/2 and 2/2).
- Every new test was seen red first, in the builders' and fixers' reports, per the
  `write-a-test` rule.
- Eight of ten gate boxes were ticked with a test path, a line and the green run behind each (see the
  Exit gate); *Add a second factor* and the **[walk]** were ticked on Mitchell's production walk of 2026-11-21.
- The merge was clean: `0079_mfa` applied on the first deploy (run 44934907812 on 2557e2e) and PR 779's deploy
  (run 44935504221 on 301f28e) is green.
- The build ran with no browser calls, no `SendMessage` and no full `pnpm check`; the
  implementer-brief-check guard denied 2 calls.

### What could be better

- **The red CI run was fixed on part 6 first, then moved down before the merge.** Run 44865756857
  on 317a13b had red jobs: missing exposure lines, a missing artboard entry, 13 missing docstrings, and
  an architecture cycle. The cycle was broken by moving `CodeEntryForm` from `components/front` to
  `components/account`. `building-a-milestone.md` §4 says a fix goes to the lowest part it touches and
  merges up. They went on part 6 first, which was faster, and left parts 1 to 5 each failing those
  checks on their own. Before the merge, on Mitchell's request, each part's share of the fixes was ported down
  to its own part and merged up. The part heads were then 7902f71, adbf44f, 5b3b732, db8ae0f, 7b33fa7 and
  be0a91a, each green in CI on its own. That is the rule (`building-a-milestone.md` §4) restored after the
  fact, at the cost of a second round of merge-ups; fixing on the lowest part first would have avoided it.
- **Build session 1's spend block is lost.** Session 1 (parts 0 to 3: 11 `phase-implementer`, 8
  `part-reviewer` and 1 Explore dispatch, 0 browser calls, 0 `pnpm check` runs) was handed off at about 265k
  context, and its `## Spend` block was not carried in the hand-off. Its transcript went with its
  container. Its numbers are not reconstructed here, and none are invented. The block below covers
  session 2 only, so this milestone's spend is understated by everything parts 0 to 3 cost. The
  hand-off rule exists for exactly this (`writing-a-retro.md`, *The spend block*); it was not followed.
  A change that would have prevented it: run `session-metrics` as the hand-off's first step and paste
  the block into the handoff text before anything else is written.
- **No per-model cost breakdown or USD figure is available for any session.** The blocks report
  units only.
- **Previews never had a working sign-in**, so no part was ever walked in a browser before the close.
  The first walk was on production, after the merge, so a defect it found would have been a production defect.

### Not verified

- **iOS Safari and iPhone remain untested.** Mitchell has no iPhone, so Face ID was skipped. WebAuthn starting on arrival at `/signin/verify` without a user gesture is **reasoned
  about, not seen**. If Safari refuses it, the fallback is the "Use a passkey" button on the same screen.
- **Removing a factor and turning MFA off were not walked on production.** Only the Revoke box's integration tests cover them.
- Mitchell's walk reported an authenticator app and a biometric passkey on Android and on desktop; it did not report the PWA lock, recovery codes or the operator reset, which stay covered by tests only.
- The PWA lock was seen only through the e2e emulation of standalone mode
  (`navigator.standalone`), never in an installed app.

### Leftovers

- `globals.css` (part 5): up to 7 seconds of blank screen if a launch never hydrates (the splash ends
  at 3 s and the lock mark lifts at 10 s). Carried minor; Mitchell's call whether it is worth a
  known issue.
- `templates.ts` is now the fifth hardcoded copy of the support address, and also the reset email's
  reply-to. Carried minor; Mitchell's call.
- `FreshCheckDialog` has no unit test file. Carried minor; Mitchell's call.
- PR 777's body does not name the part 2 and part 3 fixes it carries (`safeCallbackUrl.ts`,
  `VerifyScreen.tsx`). It is a draft that lands through PR 779's merge, so it only matters to a
  reader of that PR's history.
- *Add a second factor* (Exit gate): no test signs in with a second passkey. The route adds one
  (`mfa.int.test.ts:307`), and the virtual authenticator refuses a second credential for one account.
  The box was ticked on Mitchell's walk (a passkey on Android and on desktop). A test for it still does not exist; Mitchell's call whether one is wanted.
- The PWA lock's early-lock script warns on client navigation: `docs/known-issues/open/KI-20261121-m62-early-lock-script-warns-on-client-navigation.md`.

## Spend
<!-- session-metrics:milestone v1 -->

Build session 2 (2026-11-21, session 16cd7ff1: parts 4 to 6, the CI fixes and close step 1). Build
session 1 (parts 0 to 3) is not in this block, because its block was lost with its container.

19 agents, 984 API calls, 13.18M units (input + 1.25 × cache write + 0.1 × cache read; output excluded).

| Who | Agents | Calls | Avg ctx | Peak ctx | Units | Share |
|---|---|---|---|---|---|---|
| phase-implementer | 10 | 671 | 106k | 250k | 8.67M | 65.8% |
| part-reviewer | 7 | 219 | 81k | 157k | 2.63M | 20.0% |
| orchestrator | 1 | 73 | 170k | 225k | 1.42M | 10.8% |
| general-purpose | 1 | 21 | 103k | 110k | 463k | 3.5% |

Target: orchestrator share under 15%, met at 10.9%. SendMessage 0. implementer-brief-check denied 2. Browser calls 0. Full `pnpm check` runs 0.

Close session (2026-11-21, session 1e83452a: merging up, the CI fixes, the gate evidence and the close). Snapshot of the orchestrator's transcript taken while the part 0 close subagent was still running, so that subagent's remaining calls are not in it; `--parts 6`, no `--lines-added` or `--cost-usd` (not available to the close). Pasted from the script, without its heading and marker line, which are above.

9 agents, 231 API calls, 3.66M units. One call is one assistant `message.id`; units = input + 1.25 × cache write + 0.1 × cache read (output excluded, transcripts understate it).

**By agent type**

| Who | Agents | Calls | Avg context | Peak context | Units | Share |
|---|---|---|---|---|---|---|
| `phase-implementer` | 6 | 147 | 50k | 74k | 1.68M | 46.0% |
| `orchestrator` | 1 | 50 | 167k | 218k | 1.26M | 34.5% |
| `general-purpose` | 2 | 34 | 122k | 159k | 713k | 19.5% |

**Costliest agents**

| Agent (description) | Type | Calls | Avg context | Peak context | Units |
|---|---|---|---|---|---|
| M62 gate evidence and retro draft | `general-purpose` | 26 | 132k | 159k | 527k |
| M62 part 2: merge up, make CI green | `phase-implementer` | 35 | 55k | 74k | 456k |
| M62 part 3: merge up, make CI green | `phase-implementer` | 28 | 52k | 64k | 332k |
| M62 part 4: merge up, make CI green | `phase-implementer` | 33 | 55k | 71k | 253k |
| M62 part 5: merge up, make CI green | `phase-implementer` | 20 | 45k | 52k | 245k |
| M62 part 1: make CI green | `phase-implementer` | 15 | 44k | 51k | 232k |
| Close M62 on part 0 | `general-purpose` | 8 | 89k | 100k | 186k |
| M62 part 6: merge part 5 up | `phase-implementer` | 16 | 42k | 49k | 166k |

**Orchestrator turns, by what started them**

| What started the turn | Turns | Units | Share of orchestrator | Idle |
|---|---|---|---|---|
| GitHub / trigger notification | 0 | 0 | 0.0% | 0 of 0 (0 units) |
| Subagent report | 7 | 315k | 25.0% | – |
| Subagent finished | 4 | 419k | 33.2% | – |
| Harness | 1 | 0 | 0.0% | – |
| Human | 5 | 527k | 41.8% | – |
| Other (unrecognised frame) | 0 | 0 | 0.0% | – |

**Follow-ups and cache re-writes**

| Measure | Count | Tokens |
|---|---|---|
| `SendMessage` calls by the orchestrator | 0 | – |
| Coordinator messages received mid-life, by 0 subagent(s) | 0 | – |
| Full cache re-writes in subagents | 4 | 237k |
| — directly after a coordinator message | 0 | 0 |

**Guard hooks**

| Hook | deny | note |
|---|---|---|
| `implementer-brief-check` | 1 | 0 |

**Targets**

| Target | Result | Measured |
|---|---|---|
| Orchestrator share of units < 15% | missed | 34.5% |
| No phase-implementer averaging > 250k context | met | worst 55k |
| GitHub wakes per merged part < 5 | met | 0 / 6 = 0.0 |
| Dollars per 1k lines added < 20 | not measurable | needs --cost-usd and --lines-added |
| Coordinator-message re-writes <= 2 | met | 0 |

### Spend against the last milestone

- Orchestrator's share of the spend: target under 15%, met at 10.9% for session 2 (the table's row reads
  10.8%; the two figures are as the session reported them). Not comparable for session 1, whose block is lost.
- A builder's average context: target none over 250k, met (phase-implementer average 106k, peak 250k, which is at the limit, not over it).
- Dollars per 1,000 lines added, GitHub wakes per merged part, and cache re-writes after a coordinator
  message: not measured. There is no USD figure for either session, and `SendMessage` was 0.
- Close session (1e83452a): orchestrator share missed its 15% target at 34.6%, because it was the orchestrator's own transcript with most work delegated to short subagents; phase-implementer average context 50k, met; coordinator-message re-writes 0, met. GitHub wakes per merged part: 0 notification turns, met. Dollars per 1,000 lines added: not measured, as no `--cost-usd` or `--lines-added` was available.

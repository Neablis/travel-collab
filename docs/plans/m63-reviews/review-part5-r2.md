# Review: M63 part 5, PR 788 (fresh extra pass, Opus)

## Reviewed
PR 788, branch claude/m63-part5-security-page, head d45494e5f9ea1f1649f5bdcb720c4156cc3a0cb0. Part diff `e5ebe40..d45494e`; stack diff `5db7b06..d45494e` for cross-part effects. Read from `git archive d45494e` (no checkout): SecurityScreen.tsx and test, security/page.tsx and test, OG png (viewed) and alt, securityContacts.ts, security.txt/route.ts, discovery.test.ts diff, e2e m63-security-page.spec.ts and fixtures/test.ts, sitemap, agentsMd, landing/phone/developers diffs, route-artboard-index diff, SECURITY.md, PR body, plan part 5, M63 decisions 10-18, round-1 review.
Claims checked against code at d45494e: lib/authConfig.ts (providers; dev-login gated), server/mfa/{changes,factors,state,passkey}.ts, app/api/account/mfa/{route,factors/[factorId],recovery-codes,totp,passkeys}/route.ts, app/api/mfa/verify/route.ts, AccountScreen.tsx (Security tab, PremiumSecurity), api/oauth/authorize/route.ts (scope subset, api.tokens), server/oauth/verifyAccess.ts, server/public-api/actor.ts, server/api-tokens/index.ts, db schema token columns, next.config.ts HSTS.

## Findings (most severe first)

None blocker or major. Every sentence on the page is backed by code; see "Claims verified".

1. MINOR. SECURITY.md:18-26 (not in the diff, made false by it). It still says the GitHub advisory and the email are "the same two routes ... published at /.well-known/security.txt". After this PR security.txt publishes only the email. Failure: a maintainer reading SECURITY.md believes security.txt lists the advisory route and that the two agree. Fix: change that sentence to say security.txt and /security publish the email only (D18); the in-repo advisory route can stay for collaborators.

2. MINOR. SecurityScreen.tsx:128 "We keep only a fingerprint of each token". True for API tokens (token_hash, keyedDigest; legacy scrypt also one-way) and OAuth access/refresh tokens. Not true for every column named token: trip_invites.token, trip_shares.token and page_shares.token are stored in plaintext (schema). The page means API tokens, and share links are not called tokens in the UI, so the risk is low. Failure: a reader who knows invite or share links carry a token takes the sentence to cover them. Fix: "a fingerprint of each API token and app connection", or accept it as worded and note the scope in the PR table.

3. MINOR (PR body). In the "Claims to check" table, the row "never more than you can" cites `verifyAccess.ts`'s scope gate and its check ("a tool outside the granted scope: refused"). That proves "holds only the permissions you give it", not "never more than you can". What backs the second claim is `public-api/actor.ts:163-175` (token confinement checked before the membership question) plus the v1 handlers' membership checks. Fix: cite those, and add a production check in which a token held by a trip viewer tries a write on that trip and gets 403.

4. MINOR (test evidence). In the red-first record for "links resolve", the edit `#scopes` to `#scopez` failed on the hard-coded `toContain("/developers#scopes")` (SecurityScreen.test.tsx:106), not on the anchor-resolution loop (:107-111). So that record does not show the loop can go red. Reading the code, the loop would fail if DevelopersScreen dropped `id="scopes"`. Fix: record that edit (remove the id in DevelopersScreen) as the red-first case.

Observation for Mitchell, not a defect: `Policy:` now points at /security (D13). That page does not carry SECURITY.md's scope (previews are out of scope and enable dev login) or its "no SLA, no bounty". A researcher who reads only security.txt can no longer find either. D13 chose this; it may be worth one line on /security.

## Claims verified (page, FAQ, metadata, OG alt)
- Google sign-in: the only production provider. Credentials is dev-login, gated by isDevLoginEnabled (authConfig.ts:179-197).
- The second factor is optional: mfa_enabled_at null reads as off (state.ts:22).
- Passkey with Face ID, a fingerprint or a PIN: userVerification "required", no attachment restriction (passkey.ts:113). No platform is named that the code does not cover.
- The authenticator app gives a 6-digit code. Recovery codes come with turn-on (factors.ts:108-116).
- Acts as you, and holds only the permissions you give it: consent scopes must be a non-empty subset of the request (authorize/route.ts:62-64). Never more than you can: actor.ts confinement, then membership.
- Revoke: revokedAt is checked on every request, with no cache (api-tokens/index.ts:228). Disconnect is immediate: grant and token revokedAt are checked on every request (verifyAccess.ts). The api.tokens entitlement is checked again on every use (verifyAccess.ts:90).
- Premium: the Security tab gates on api.tokens (AccountScreen.tsx:91-171). Consent is refused without it (authorize/route.ts:61).
- Other devices are signed out on: turn-on (factors.ts:115), turn-off (mfa/route.ts DELETE), factor removal (factors/[factorId] DELETE), and new recovery codes (recovery-codes POST). Each bumps the epoch, and the acting session is kept by a proof.
- Lost-phone FAQ: removeFactorIn refuses the last factor (changes.ts:29-37). Turn off needs only the fresh check. A recovery code at /api/mfa/verify mints a "recovery" proof that sets mfaAt, so a recovery-code sign-in can remove a factor or turn MFA off. Turning on again issues new codes.
- "Add one under Account, then Security": the Two-step section is in the Security tab (AccountScreen.tsx:275).
- Connections are encrypted: HSTS is set on production (next.config.ts:120-138), and the PR table has the http-to-https curl check.
- The token is shown once (TokensSection).
- OG alt "Security at Caesura. Your account, your data." matches the image.

## Clean
Correctness (no wrong claim found); invariants (no contract change; scope matches plan part 5 and D18); data paths (no write); accessibility read from markup (one h1, labelled sections, native links, email link labelled; not rendered); conventions (no "#NNN", comments explain why); no GitHub in page text, hrefs, security.txt, agentsMd, llms.txt or front screens; NOT_DRAWN has /security and /ai; sitemap and inbound links present; security.txt still valid RFC 9116 (Contact, Expires 2027-10-01 unchanged, Policy, Canonical).
Tests: none that asserts nothing. The deny-list and GitHub tests have length guards. The e2e spec would go red on a 404 (status 200 assertion), on the proxy redirecting to /signin, or on a missing h1, so it can fail for the right reason. It checks no claim's text, which is the unit tests' job.

## Earlier fixes (review-part5-r1.md)
1. Lost-device FAQ: holds (SecurityScreen.tsx:30; test :79-85).
2. GitHub contacts: holds per D18 (securityContacts.ts:13-15; test :115-124, :168-176; discovery.test.ts).
3. Encryption wording: holds (SecurityScreen.tsx:126). The PR table has the http redirect check.
4. Windows Hello and Android: holds (SecurityScreen.tsx:78; test :74).
5. OG alt: holds (alt.txt, page.tsx:19, page.test.tsx).
6. Premium gating: holds (SecurityScreen.tsx:111-112, FAQ :34).
7. Second REPO constant: holds (removed; the comment points at SECURITY_CONTACTS). The SECURITY.md half of the old comment's subject is now stale; see finding 1.
8. PR table: mostly holds. The "never more than you can" row still cites the scope gate only; see finding 3.

## Not checked
No production or preview check (no network to caesura.today), including the http redirect, which is the proxy's and not in the repo. Did not run vitest, tsc, eslint or e2e. Did not render the page or check contrast. The membership checks in each v1 handler that an MCP tool reaches were not read one by one; I relied on actor.ts's documented ordering. Did not read every TokensSection and ConnectedAppsSection line cited in the PR table.

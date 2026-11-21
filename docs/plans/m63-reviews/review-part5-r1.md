# Review: M63 part 5, PR 788 (round 1)

## Reviewed
PR 788, branch claude/m63-part5-security-page, head f0d93e5009eb86acb3784d4ebdeaa76807ffeaef, base fd83201afc2c170b102b84a3da94da65170043c8. Read in full: SecurityScreen.tsx and test, security/page.tsx and test, securityContacts.ts, security.txt/route.ts, discovery.test.ts diff, AiScreen.tsx safety answer and AiScreen.test.tsx diff, e2e spec, route-artboard-index diff, sitemap, agentsMd, landing/phone/developers link diffs, OG image (viewed), PR body. Claims checked against origin/ccr-8a6d904d-vhaiet (M62 on it): server/mfa/{changes,factors,state}.ts, lib/authConfig.ts jwt callback, mfa/passkey.ts, oauth/{tokens,verifyAccess}.ts, api-tokens, secrets/keyedDigest.ts, next.config.ts, ConnectedAppsSection, TokensSection, AccountScreen.

## Findings (most severe first)

1. BLOCKER. SecurityScreen.tsx:34-36 (FAQ "What if I lose my phone?"). The answer says to sign in with a recovery code, "then remove the lost device and make a new set of codes". `removeFactorIn` (server/mfa/changes.ts:~30-37) refuses to remove the last factor (`ChangeRefused("last-factor")`). Someone whose phone is their only factor cannot do what the page says; they must Turn off. Decision 12 says every claim is true. Fix: say "remove the lost device (or turn two-step off if it was your only one) and make a new set of codes", and add this to the PR's production-check row.

2. MAJOR (judgement for Mitchell; decision 11 vs 13 tension). securityContacts.ts:6,17-19 and SecurityScreen.tsx:~140. The rendered page puts `https://github.com/Neablis/travel-collab/security/advisories/new` and `/issues/new` in hrefs, labelled "Report it privately, if we have given you access" and "Report a bug that is not a security problem". D11 says "no repository". The deny-list test reads text only, so it passes while the DOM names the repo and the owner's GitHub account. Also: the label "if we have given you access" tells every visitor the repository is private; a public reader who clicks gets a 404; and an issues link on a vulnerability section sits beside "do not open a public issue". Fix options: show only the email on the page and keep all three in security.txt (D13 says "same contacts", so this needs Mitchell's call), or keep them and record the exception in the milestone. Either way, extend the deny-list test to check hrefs, or state the exception in it.

3. MINOR. SecurityScreen.tsx "Every connection to Caesura is encrypted". The code only sets HSTS on the production deployment (next.config.ts, `deployEnv() === "production"`). The plain-http redirect is not in the repo, and the first http request is by definition unencrypted. The PR table cites only HSTS as code evidence. Safer wording: "Caesura is served over HTTPS only" or "Connections to Caesura are encrypted", and the production check must include `curl -sI http://caesura.today` showing a redirect, not only the HSTS header.

4. MINOR. SecurityScreen.tsx sign-in section: "Face ID, Touch ID, Windows Hello or an Android phone". Only "Face ID" is in code (VerifyScreen.tsx:18 comment). passkey.ts sets `userVerification: "required"` with no attachment restriction, so the others depend on the user's device, not on Caesura. The PR's check ("a phone and a laptop") does not cover Windows Hello or Android. Weaken to "a passkey lets your device (Face ID, a fingerprint, a PIN) confirm it is you", or record a check on each named platform.

5. MINOR. OG image vs alt. opengraph-image.alt.txt and page.tsx image alt say "Your account, your data, your AI", but the PNG shows "Your account, your data" plus "Security at Caesura". Alt does not match the picture; the test only checks the files are non-empty.

6. MINOR. SecurityScreen.tsx FAQ 3 and "Revoke a token under Account, then Security". The token section is a plan-gated upgrade prompt for accounts without `api.tokens` (AccountScreen.tsx:141,167). "Lists your tokens" is true only for entitled accounts. Low risk; add to the check row or soften.

7. MINOR. security.txt/route.ts:34 keeps a second `REPO` constant beside securityContacts.ts:6, for the comment text only. Drift risk; import it, or drop the issues URL from the comment. The comment block above (the `SECURITY.md` description) also still describes the contacts rather than pointing at the constant.

8. MINOR (PR body). "Claims to check" table is nearly complete (every sentence and FAQ answer has a row). Missing or weak: the "last factor cannot be removed" caveat (finding 1); http redirect code location (finding 3); Windows Hello/Android (finding 4); "token ... acts as you ... never more than you can" cites UI copy (`TokensSection.tsx:327`, `DevelopersScreen`) and a route comment, not a test of the second gate; the production check should include one MCP/scope-limited call that is refused. Also the description string claims "what an AI tool can do for you", which maps to /ai, not a checked claim; fine.

## Verified true against code (no finding)
- Other sessions signed out: `recordSecurityChange` bumps the epoch for factor removal, Turn off and code regeneration (routes under api/account/mfa); `turnOnWithFirstFactor` bumps it when the first factor turns MFA on (factors.ts:115). Older-epoch tokens return null in createJwtCallback (authConfig.ts, `token.epoch < state.epoch`). Takes effect on the next server `auth()` read, not at the proxy; acceptable for "signed out". Adding a second factor does not bump, and the page does not claim it.
- Recovery codes issued on turning on (factors.ts:109-116).
- Authenticator app 6-digit code (AddAuthenticatorDialog.tsx:69).
- Token revoke: tokens looked up by hash on each request and revokedAt checked; no cache found. Disconnect: verifyAccess.ts:65-68 refuses on grant or token revokedAt per request, so "immediately" holds.
- Fingerprint: ADR-083 `keyedDigest` HMAC-SHA256 with pepper for API tokens, OAuth access/refresh tokens, codes; schema stores `token_hash` only. "Shown once": TokensSection.tsx:249,327.
- Google sign-in; second factor optional (mfa_enabled_at null reads as off).

## Clean
- Certification: none named in rendered text, title, description or alt; test covers soc 2, iso 27001, hipaa, gdpr, certified, compliant.
- Build detail in text and metadata: no header names, vendors, libraries; "HMAC", "SHA", "pepper", "epoch" not on the page. Only the hrefs breach D11 (finding 2).
- security.txt: still valid RFC 9116 (Contact lines, Expires 2027-10-01T00:00:00.000Z unchanged, Policy added, Canonical, Preferred-Languages). Contacts and their order are unchanged (email, advisory, issues). Test asserts Policy line, contacts equal the constant, and Expires. Policy is the literal production URL (stated judgement call, acceptable per brief).
- FAQ JSON-LD: built from the same `SECURITY_FAQ` array as the visible questions; test compares marked names to visible h3 names. Answers come from the same array so cannot diverge.
- /ai safety answer: AiScreen.tsx:205-212 appends only a "Read about security" link to /security; test asserts no passkey/authenticator/recovery/fingerprint/encrypted/vulnerab text on /ai. UPCOMING_ROUTES hack removed, so the /security link is now checked against real routes.
- Metadata: title 53 chars (absolute), description 119, canonical and og:url /security, one h1, sitemap entry and test, inbound links (landing, phone footer, /developers, /agents.md), route-artboard NOT_DRAWN entry.
- Tests: SecurityScreen link-resolution test would go red on a bad anchor/route; no test found that asserts nothing (each has a length > 0 guard against vacuous loops). The "names no certification/build" lists cannot see href text (finding 2).
- Accessibility (read from markup only): one h1, sections labelled by headings, links are in lists, native anchors, no custom focus handling. Not rendered.
- Data paths: no table, cache or derived copy written.
- Conventions: no "#NNN" in code or comments found.

## Earlier fixes
None given.

## Not checked
No production check (no network to caesura.today). Did not run tests, tsc, eslint or e2e. Did not render the page or check colour contrast of `text-brand underline`. Did not verify that Traefik redirects http to https. Did not read the full M62 password/fresh-check path for whether a recovery-code session may remove a factor (finding 1 assumes it can; it may also be refused). Did not check PNG dimensions.

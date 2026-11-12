### KI-2026-11-12-b — Consent Allow to a loopback redirect strands the user on a dead page

- **Severity:** correctness. The user completes the consent they were asked
  for and gets a dead page: the grant is issued but undeliverable through
  the UI, and the code exists only in the address bar of a page that failed
  to load.
- **Area:** `apps/web/src/components/oauth/ConsentScreen.tsx`
  (`ConsentScreen`, `ConsentMarking`, the `localhost-warning` Banner, the
  Allow fetch then `window.location.assign`), `apps/web/src/app/oauth/authorize/page.tsx`
  (`AuthorizePage`, `redirectHost`), `apps/web/src/server/oauth/recognised.ts`
  (`consentMarking`, `RECOGNISED_REDIRECTS`), `apps/web/src/server/oauth/redirects.ts`
  (`isLoopback`), `apps/web/src/server/oauth/authorizeRequest.ts`
  (`parseAuthorizeRequest`, the Allow `redirectTo`).
- **Symptom / What happens:** a client registered with a loopback
  redirect_uri (here `http://localhost:8931/callback`, registered by DCR
  during the Poppy full-loop test) shows its consent page with "Access goes
  to localhost:8931" and, when the marking is `localhost-warning`, the banner
  "Access goes to a program on this computer, not to a website. Continue only
  if you started this connection yourself, in an app you trust." Allow posts,
  the server answers with a `redirectTo`, and the browser navigates to the
  loopback URL. When the user is approving from a device that is not running
  the program — the normal Poppy case, a person on their phone approving for
  a server-side agent — nothing listens there, the page fails to load, and
  the authorisation code is only in the failed page's address bar
  (`/callback?code=...&state=...`). There is no error page, no code shown
  for copying, and no way back to the grant from the UI.
- **Evidence:** 2026-11-11 ~21:41 CST, Mitchell on his phone at MDW, on the
  fresh-agent Poppy walkthrough: he opened the authorize URL for the test
  client (`a50af0b7-c999-4a24-a414-676f98f3128d`, scopes `trips:read
  library:read`), signed in, saw "Access goes to localhost:8931", clicked
  Allow, and landed on the dead localhost page. The code from that grant was
  never pasted back and expired; the loop was never completed through the UI.
- **Why this is not "no warning":** the loopback warning exists (ADR-083
  amendment F; `consentMarking` returns `localhost-warning` before any
  recognised redirect can outrank it), but it warns about trust — "continue
  only if you started this connection yourself, in an app you trust" — not
  about reachability. Mitchell started the connection himself and trusts the
  app, so the warning correctly did not stop him; it just never said the
  redirect will fail from this device. Its model is co-location ("a program
  on this computer"), which is true for a desktop native app and false when
  the approving device and the program are different machines.
- **Why not fixed here:** filed as a KI per Mitchell's ask while he travels;
  the fix needs a product decision (wording vs a code-display fallback vs a
  device grant), not a doc change.
- **Fix path:** first, say the reachability plainly on the consent page when
  the redirect is loopback: the app must be listening on *this* device, and
  approving from another device will dead-end. Second, give the user a
  recovery: when the redirect is loopback, show the code on a Caesura page
  the user can copy ("copy this code back to your agent") instead of, or
  before, navigating away to an address that may not exist. Longer term, the
  device authorization grant (RFC 8628) is the Poppy-native path for agents
  whose users are on phones — agent shows a code, user approves on their own
  device, agent polls for the token, no redirect at all — but that is an
  ADR-089 follow-up decision, not this fix. Explicitly not the fix:
  rejecting loopback redirect_uris at DCR; loopback is legitimate for native
  apps (RFC 8252) and the register route must keep accepting it.
- **Tripwire:** any loopback-redirect grant approved from a mobile browser,
  or a support report of "I allowed it and got a blank page".
- **Cross-reference:** KI-20261111-a (the DCR 500; the walkthrough that
  surfaced this), KI-2026-11-12-a (token endpoint spends the secret before
  issuing), ADR-083 §6 and amendment F (consent is the defence; the loopback
  warning), ADR-089 (Poppy design doc; decision 13's walkthrough needs a
  working loop).
- **First noted:** 2026-11-11, fresh-agent Poppy full-loop test by Sunny
  (Muse) at Mitchell's request; Mitchell hit it himself on his phone.

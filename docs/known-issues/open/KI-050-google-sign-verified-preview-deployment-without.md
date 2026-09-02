### KI-50 — Google sign-in can't be verified on a preview deployment without hand-registering each branch's redirect URI
- **Severity:** cleanup (no user impact in production; blocks a verification workflow)
- **Area:** `apps/web/src/server/auth.ts`, the Vercel Preview environment, and
  the Google Cloud OAuth client's Authorized redirect URIs.
- **Symptom (2026-08-26, M15 gate check on PR #56):** signing in with Google on
  a preview deployment fails. Google requires the redirect URI to match a
  registered value **exactly** and supports no wildcards, so Auth.js's callback
  — `https://<host>/api/auth/callback/google`, built from the request host —
  is rejected on any host that has not been registered by hand.
- **Not what it looks like:** the preview host is *not* unstable. Vercel gives
  each branch a durable alias (`travel-collab-git-<branch>-<team>.vercel.app`)
  that survives every push to that branch, so registering it works and keeps
  working. The cost is **per branch**, not per deployment.
- **Workaround in use:** register the branch alias's callback URI in the Google
  Cloud OAuth client (APIs & Services → Credentials → the Web application
  client matching `AUTH_GOOGLE_ID` → Authorized redirect URIs). Done for
  `claude/subagent-three-pages-plan-cd88a4` on 2026-08-26 to close M15's gate.
  Every future branch that needs a real Google sign-in pays the same two
  minutes, and the list accumulates dead entries as branches are deleted.
- **Fix path — Auth.js's redirect proxy.** `@auth/core@0.41.3` (what
  `next-auth@5.0.0-beta.32` resolves to) supports `AUTH_REDIRECT_PROXY_URL`
  (`lib/utils/env.js:39`, `lib/init.js:41-47`). Set it on the **Preview**
  environment to the canonical production auth URL
  (`https://<production-domain>/api/auth`) and register **only** that one URI
  with Google. Auth.js then sends Google the canonical redirect URI, and the
  deployment whose own origin matches `redirectProxyUrl` (`init.js:43-44` sets
  `isOnRedirectProxy`) forwards the session back to the originating preview.
  One registration covers every preview, forever.
- **Preconditions before attempting it:** production must already have a
  working Google OAuth client, and `AUTH_SECRET` must be identical across the
  Production and Preview environments — the proxy forwards signed state
  between the two deployments, so a mismatch fails closed. Note also that
  Vercel Deployment Protection is enabled on previews (a request to
  `/api/auth/providers` 302s to `vercel.com/sso-api`), so the OAuth callback
  only survives in a browser already authenticated to Vercel SSO; worth
  confirming that interaction when the proxy is wired up. Updated 2026-08-29:
  "authenticated to Vercel SSO" is no longer the only way in — a share link or
  the automation bypass secret both set a cookie that carries the whole
  browsing session, so the callback has a second route through. See
  `docs/guidelines/environments-and-deploys.md`, "Testing against a preview
  deployment". Still unconfirmed either way.
- **STATUS 2026-09-02 — the fix is built and deployed to configuration; one
  step of proof is outstanding.** Done: `AUTH_REDIRECT_PROXY_URL` is set to
  `https://caesura.today/api/auth` on **both** the Preview and Production
  Vercel environments; the session JWT now carries the environment that minted
  it, which is what makes the shared `AUTH_SECRET` safe (project review M3, and
  the reason this entry stayed shut for a week); ADR-034 records the mechanism,
  read out of `@auth/core@0.41.3` itself rather than from the docs.
  `scripts/check-auth-proxy.mjs` turns "is the proxy live on this deployment"
  into one command. **Not done: nobody has completed a real Google sign-in on a
  preview.** Two of this entry's own preconditions are now confirmed rather
  than assumed — production has a working Google client, and `AUTH_SECRET` is a
  single variable scoped to Production and Preview, so it cannot differ. The
  third, the interaction with Deployment Protection, is still exactly as
  unconfirmed as this entry has said since 2026-08-29.
  **Why it is still open:** the check needs a request that gets past Vercel SSO
  on the preview host. `VERCEL_AUTOMATION_BYPASS_SECRET` exists but is a
  sensitive variable, so `vercel env pull` returns it empty; the share-link
  route was not available to the session that did this work. Both are things a
  human has in one click and an unattended agent does not. The remaining step
  is: open PR #120's preview, sign in with Google, and confirm you land back on
  the preview signed in. Then move this entry to `resolved/`.
- **Why deferred:** the workaround unblocks M15's gate today, and the proxy
  touches production auth configuration — not something to change while a
  milestone gate is mid-verification. Mitchell's call, 2026-08-26.

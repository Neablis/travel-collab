# ADR-034: Previews sign in through production's redirect proxy, and the session token names its environment

**Status:** Accepted — 2026-09-02
**Deciders:** Mitchell (product/eng, standing request 2026-09-02), Claude (architect)
Closes: **KI-50** (Google sign-in unverifiable on a preview without hand-registering each branch)
Closes: **M3** of `docs/reviews/2026-08-28-project-review.md` (shared `AUTH_SECRET` across Preview and Production)
Related: ADR-024 (the edge-safe auth config split), ADR-025 (users under JWT sessions)

## Context

Google requires an OAuth redirect URI to match a registered value **exactly**
and supports no wildcards. Auth.js builds its callback from the request host —
`https://<host>/api/auth/callback/google` — so every preview host is a URI
Google has never heard of, and a real Google sign-in on a preview fails.

The workaround since 2026-08-26 was to hand-register each branch's durable
Vercel alias in the Google Cloud console. The preview host is stable per
branch, so this works; the cost is two minutes per branch that ever needs a
real sign-in, forever, and a redirect-URI list that accumulates dead entries as
branches are deleted. It is also the reason M11a's gate had to be walked on
**production** rather than on its own preview.

## Decision

**1. Previews delegate the OAuth round trip to production.**
`AUTH_REDIRECT_PROXY_URL=https://caesura.today/api/auth` is set on the
**Production and Preview** Vercel environments. `@auth/core@0.41.3` reads it
directly (`lib/utils/env.js:39`); no application code configures it.

The mechanism, verified by reading the resolved package rather than the docs:

- A deployment whose own origin **is not** the proxy URL's origin sends Google
  `redirect_uri = <proxy>/callback/google` and stashes its own callback URL in
  the OAuth `state` (`lib/actions/signin/authorization-url.js:38-41`).
- A deployment whose origin **is** the proxy URL's origin sets
  `isOnRedirectProxy` (`lib/init.js:41-47`), decrypts the incoming `state`, and
  — when the origin inside it is not its own — redirects the whole callback,
  query string intact, back to the deployment that started it
  (`lib/actions/callback/index.js:25-36`).

So exactly one URI, production's, is ever registered with Google, and it covers
every preview that will ever exist. Production's own sign-in is untouched:
there `isOnRedirectProxy` is true, no origin is written into `state`, and the
forwarding branch does not fire.

**2. The `state` must decrypt on both ends, so `AUTH_SECRET` stays shared.**
`state` is a JWE encrypted with the secret (`lib/actions/callback/oauth/checks.js:103-125`).
Production cannot forward a preview's callback without being able to read it.
This is not a new sharing — one `AUTH_SECRET` variable has been scoped to
Production and Preview since 2026-07-08 — but the proxy makes it load-bearing
rather than incidental, which forecloses "just give each environment its own".

**3. Therefore the session token carries the environment that minted it.**
Sessions here are stateless JWTs with no adapter, so a shared secret means a
token signed anywhere verifies everywhere. `AUTH_DEV_LOGIN=true` is set on
Preview, where the credentials provider accepts any username with no password
and yields `dev-<name>` — an identity that post-M11 inherits real trip
memberships. Lifting that cookie onto `caesura.today` was a working sign-in as
that member; Deployment Protection on previews was the only thing in the way,
and that is a fence, not a check.

`authConfig`'s `jwt` callback now stamps `token.env = VERCEL_ENV ?? "development"`
at mint time and returns `null` for any token whose claim does not match the
reading deployment. `null` is Auth.js's own end-of-session signal — it clears
the cookie rather than merely ignoring it (`lib/actions/session.js:33,54`).

This is the second of the two options the project review left open under M3.
The first — "ensure `AUTH_DEV_LOGIN` is provably off in every environment
sharing the prod secret" — was rejected because dev login on previews is wanted:
the e2e lane and every preview walk depend on it.

## Consequences

**A token with no claim is refused, so this deploy signs everyone out once.**
Deliberate. Tokens minted before this shipped are exactly the ones whose origin
cannot be established, which is what the check exists for; trusting them would
leave the hole open for the 30-day life of every cookie already issued. The app
is pre-launch, so the cost is a handful of re-sign-ins.

**Both environments must be redeployed for the pairing to hold.** Vercel
injects environment variables at deploy time. A preview built after the
variable existed will send Google production's URI; if production has not been
redeployed since, it will not recognise itself as the proxy and will try to
consume the callback itself, failing on a `state` cookie it never set. The two
must move together, and production must move first or at the same time.

**The redirect target is only as trustworthy as `AUTH_SECRET`.** The proxy
forwards to whatever origin the decrypted `state` names, with no allow-list.
Anyone holding the secret can therefore aim production's callback at an origin
of their choosing. That is a strictly smaller capability than what the secret
already grants (minting sessions), so it changes the value of the secret not at
all — but it means the secret must never be shared with an environment we do
not control, and in particular must not be scoped to Development.

**Deployment Protection still sits in front of the final hop.** The last
redirect lands on the preview's own host, which 302s an unauthenticated request
to `vercel.com/sso-api`. A browser already carrying a Vercel SSO cookie, a
`?_vercel_share=` grant, or the automation bypass cookie passes straight
through; one that is not, does not. This does not affect production sign-in and
is the same fence every other preview interaction meets.

## Alternatives rejected

- **Keep hand-registering branch aliases.** The status quo. Rejected: it is the
  problem, and it is what made M11a's gate a production walk.
- **A single long-lived preview alias that every branch deploys to.** Would
  work with one registered URI and no shared secret, but serialises preview
  testing across branches — this repo routinely has six or more worktrees open.
- **Separate `AUTH_SECRET` per environment, no proxy.** Closes M3 outright and
  needs no environment claim, but forecloses the proxy entirely (decision 2),
  which is the thing that was asked for.

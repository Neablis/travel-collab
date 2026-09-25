# Security Policy

## Scope

Caesura (`travel-collab`) is a private, single-deployment application, not a
distributed library. There are no releases, no version numbers and nothing for
anyone to pin — the supported version is whatever is currently deployed from
`main` to production, and every fix reaches every user on the next deploy.
(This file previously carried GitHub's unedited template, complete with a
fictional 5.1.x/4.0.x support table. Project review L1.)

Anything served from the production deployment is in scope. Preview
deployments are not: they are fenced by Vercel Deployment Protection, carry
non-production data, and deliberately enable affordances production does not
have (see below).

## Reporting a vulnerability

Open a **private** GitHub security advisory on this repository
(Security → Report a vulnerability), or contact the maintainer directly. Do
not open a public issue for anything exploitable.

There is no SLA and no bounty — this is one maintainer's project. Expect a
first response in days, not hours.

## Things worth knowing before reporting

Documented, deliberate behaviours, so they don't get reported as findings:

- **Share and invite links are bearer tokens in the URL path.** Anyone holding
  a `/s/<token>` link can read the trip it points at; anyone holding an
  `/invite/<token>` link can join. That is the feature (ADR-026, ADR-027).
  Tokens are stored in plaintext so an owner can re-copy a link they already
  handed out, and they can be revoked.
- **Environment-gated affordances.** Dev login (`AUTH_DEV_LOGIN`) and the
  demo-data reset (`SEED_DEMO_DATA`) require both an operator opt-in *and* a
  non-production `VERCEL_ENV`, which is set by the platform and cannot be set
  by us. If you can reach either on production, that is a real finding.
- **CSRF protection is the session cookie's `SameSite=Lax`, and only that.**
  There is no Origin check and no CSRF token on `/api/**` (Auth.js's own token
  guards only its sign-in and sign-out actions). It holds because every
  cookie-authenticated mutation is a `POST`/`PATCH`/`PUT`/`DELETE` sent by
  `fetch`, never a top-level navigation or a `GET`, so a cross-site page cannot
  make a browser attach the cookie to one; the public API's bearer tokens are
  not cookies and are out of this question, and Next.js server actions (one,
  on `/signup`) carry Next's own Origin-against-Host check. The residual is
  browsers that do not implement `SameSite`. The attribute is Auth.js's default, and
  `apps/web/src/lib/authConfig.test.ts` fails if a config change or an Auth.js
  upgrade stops the session cookie being `Lax` or `Strict` — whoever needs
  `SameSite=None` (an embedded surface, say) must add an Origin check on
  mutations first. A mutation reachable by `GET`, or one that works
  cross-site anyway, is a real finding. (KI-2026-09-05-f, 2026-08-28 review
  L6.)
- **Known, recorded gaps** live in `docs/known-issues/`. A finding already
  filed there is not news, though a working exploit for one is.

Trust boundaries, the module map and the invariants that hold them are in
`AGENTS.md`; decisions with security consequences are in `docs/architecture/`.

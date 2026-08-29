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
- **Known, recorded gaps** live in `docs/known-issues.md`. A finding already
  filed there is not news, though a working exploit for one is.

Trust boundaries, the module map and the invariants that hold them are in
`AGENTS.md`; decisions with security consequences are in `docs/architecture/`.

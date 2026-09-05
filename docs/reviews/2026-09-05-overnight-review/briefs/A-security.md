# Stream A — Security

Question: **Are inviting, shared trips, membership, and the shared notebook /
playbook library safe?** These were layered onto a single-player app (ADR-026,
027, 028, 029, 040; M11, M11a, M11b, M13). Assume a hostile signed-in user and
an anonymous holder of a link.

Read first:
- `apps/web/src/server/accessPolicy.ts`, `server/access/{trip-access,members,invites,shares,sharedView,saved-day-access}.ts`
- Every route under `apps/web/src/app/api/**/route.ts` — build a table:
  route × method × who may call it × where the check lives. A route with no
  check row is a finding.
- `apps/web/src/middleware.ts` (or `src/proxy.ts`), `auth.ts`, `auth.config.ts`, ADR-023/024/025/034
- `apps/web/src/server/db/schema.ts` — tokens, indexes, what is nullable
- `SECURITY.md`, `docs/known-issues/open/KI-066-*` (CSP), KI-2026-09-0x GHAS entry if present
- `apps/web/src/server/ai/handleAskRequest.ts`, `quota.ts`, `admission.ts` — AI spend controls (the 2026-08-28 review's H1 said none existed; what landed since?)
- `apps/web/src/app/api/dev/**` and how they are gated (`VERCEL_ENV`?)

Specific things to check:
1. **Every write on a trip goes through AccessPolicy** (AGENTS.md invariant 6c).
   Grep for direct `db.` writes on planning/pages/saved-days tables in route
   handlers and find any that skip the seam. Pages (notebook) and saved days
   are CRUD — do THEY check membership/role on read AND write?
2. **Role semantics:** viewer vs editor vs owner — can a viewer write? Can an
   editor invite, revoke, delete the trip, change sharing? Can a member remove
   the owner? Can the last owner leave?
3. **Invite tokens:** entropy source, storage (hashed or plain?), expiry,
   single-use, revocation, what `accept` does if already a member, whether the
   token is logged (Sentry breadcrumbs, `askAnalytics`, request logs).
4. **Share links (`/s/[token]`):** what does an anonymous holder see — does the
   replay leak members' identities, emails, other pages, cost data beyond the
   pin? `clone` — who may clone, what lineage leaks.
5. **Playbooks / saved days:** `publish`, `profile/[userId]`, `board` — PII in
   public profile, unpublish semantics, can I read another user's unpublished
   day by id, can I add a saved day into a trip I only view.
6. **`INVITE_SUPER_CODE`** and any other shared secret in the signup gate —
   where checked, timing-safe compare, rate limit.
7. **IDOR by id shape:** uuids everywhere? Anywhere a sequential or
   user-controlled id is accepted (`history/[seq]`, `members/[userId]`)?
8. **Input validation at the edge:** every route parses with a contracts Zod
   schema? Any `request.json()` used raw? Size limits on page content (a
   notebook doc is a JSON blob — max size?).
9. **Headers/CSP/cookies:** `next.config`, `unsafe-inline` (KI-066), SameSite,
   `AUTH_TRUST_HOST`, dev login gate (`AUTH_DEV_LOGIN` — the 2026-08-28 M1
   finding — fixed?).
10. **Server-side fetches** (geocoding, AI gateway, LocationIQ) — SSRF surface,
    key handling, what user text reaches which provider.

Deliver the route × authz table as a section of your report even if it is all
green; it is the artefact the next reviewer needs.

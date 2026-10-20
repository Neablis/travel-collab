# ADR-079: A signup remembers the first channel that brought its visitor, for 30 days

**Status:** **Accepted — 2026-10-19.** Mitchell chose first touch over URL-only that day (M50,
decision 6).
**Deciders:** Mitchell (product); Claude — drafted
Related: ADR-078 (`/` is static and the proxy does not see it), ADR-063 (invite codes no longer
gate signup; the `pending_admission` cookie), M50 (`docs/milestones/M50-strangers-find-a-day.md`).

## Context

The go-to-market plan measures each channel by **signups**, not visits: every launch link
carries `?ref=<channel>` (`showhn`, `sideproject`, …). Nothing stores it today. Most visitors
browse before signing up, often on a later day, so a ref read only from the signup URL would
lose nearly all of them.

Two constraints shape where the ref can be caught:

- **`/` is static** (ADR-078): the proxy's matcher does not include it, so that no request for
  the landing pays for `auth()`.
- **The ref is untrusted text** from any link anyone writes.

## Decision

1. **The proxy matches any path carrying a `ref` query parameter**, through a matcher entry with
   `has: [{ type: "query", key: "ref" }]`. A request without `ref` never enters the proxy, so the
   landing stays static for every ordinary visit. The branch for this entry sets a cookie and
   does nothing else: no `auth()`, no rewrite.
2. **The cookie is `caesura_ref`**: first-party, `HttpOnly`, `SameSite=Lax`, `Secure` in
   production, `Max-Age` 30 days. Its value must match `^[a-z0-9-]{1,32}$` after lowercasing;
   anything else is dropped, not stored.
3. **First touch wins**: if `caesura_ref` is already set, a new `?ref=` does not overwrite it.
4. **Signup copies it once.** When `recordSignIn` creates a user, it reads `caesura_ref` and
   writes it to `users.signup_ref` (nullable text, migration `0060`). An existing account
   signing in again is never changed. The cookie is cleared after it is copied.
5. **Reporting reads `users.signup_ref`** grouped by value, on the operator console's Users tab
   and in `pnpm signups-by-ref`. A null ref is shown as *direct*.

## Consequences

- Visits with `?ref=` pay the proxy's cost; a few launch-day visits, not the landing's traffic.
- A cookie set on a CDN-cached response would leak to other visitors, so the `ref` branch's
  response must not be cached; the static landing served without the cookie is unaffected.
- The ref is a channel label, not personal data; it needs no consent banner. If a privacy notice
  page is written later, it should mention it.
- A person who clears cookies, or comes back after 30 days, counts as *direct*. Accepted.

# ADR-024: Auth.js split-config restores the middleware boundary, superseding ADR-023

**Status:** Accepted — 2026-08-26
**Deciders:** Mitchell (product/eng), Claude (implementer), following CodeRabbit review on PR #56
**Supersedes:** ADR-023 (`src/middleware.ts` joins the lint wall's exempt shell)
Related: ADR-002 (server/UI boundary), ADR-019 (§ lint wall widened for `.well-known`)

> **Later note (2026-08-28, Next 16 upgrade).** The file this ADR calls
> `src/middleware.ts` is now **`src/proxy.ts`**. Next 16 deprecated the
> `middleware` file convention in favour of `proxy`; the rename is purely
> nominal and the boundary this ADR describes is unchanged — same split
> config, same Edge-safe `@/lib/authConfig` instance, same matcher. The
> `eslint.config.mjs` auth-config wall is keyed on the filename and was
> renamed with it, so the rule still names exactly the two permitted
> importers (`src/server/auth.ts` and `src/proxy.ts`). Nothing below is
> superseded; only the filename moved.
Milestone: `docs/milestones/M15-front-door.md`

## Context

ADR-023 added `src/middleware.ts` (exact path) to the lint wall's `ignores` in
`apps/web/eslint.config.mjs`, so that `apps/web/src/middleware.ts` could
`import { auth } from "@/server/auth"` to decide whether a request is
authenticated before a page renders. The reasoning at the time: middleware
never ships to the browser and runs only on the server, so it is
"definitionally server-side" in the same way `src/server/**` and
`src/app/api/**` are, and therefore belongs in the wall's exempt shell rather
than being treated as UI reaching into server internals.

ADR-023 itself flagged the residual cost honestly: each exemption makes the
next one easier to justify ("we already made an exception"), and it noted —
without building it — that "the split-config pattern (an Edge-safe
`auth.config.ts` without Node-dependent providers, imported by both
middleware and the main auth instance) is the documented remedy if this ever
breaks... but it is not needed today and was not built speculatively."

CodeRabbit reviewed PR #56 and flagged the exemption: middleware importing
`@/server/auth` directly is exactly the shape the wall exists to prevent,
and Auth.js v5 ships its own documented pattern for this exact situation —
a shared, edge-safe config object that each consumer (middleware, the server
instance) turns into its own `NextAuth()` instance. Growing the exempt list
was the wrong call when the library already provides a way to avoid needing
the exemption at all. Mitchell reviewed and ruled in CodeRabbit's favor:
**restore the boundary using the split-config pattern instead of carrying
the exemption forward.**

## Decision

**Split `apps/web/src/server/auth.ts` into a shared edge-safe config plus two
independent Auth.js instances, and remove `src/middleware.ts` from the lint
wall's `ignores`.**

1. `apps/web/src/lib/authConfig.ts` holds the `NextAuthConfig` object itself
   — the `providers` array (Google gated on `AUTH_GOOGLE_ID`/
   `AUTH_GOOGLE_SECRET`, the `dev-login` Credentials provider gated on
   `AUTH_DEV_LOGIN`), the `callbacks`, and the `pages` map. It imports only
   from `next-auth` / `next-auth/providers/*` — nothing from `@/server/*`,
   nothing Node-only.
2. `apps/web/src/server/auth.ts` imports that config and builds the full
   instance: `export const { handlers, auth, signIn, signOut } =
   NextAuth(authConfig)`. Its exported names are unchanged.
3. `apps/web/src/middleware.ts` builds its **own** lightweight instance from
   the same config — `const { auth } = NextAuth(authConfig)` — instead of
   importing `@/server/auth`'s live singleton. The redirect logic and
   `matcher` are otherwise untouched.
4. `apps/web/eslint.config.mjs`'s lint-wall `ignores` drops back to its
   original three entries (`src/server/**`, `src/app/api/**`,
   `src/app/.well-known/**/route.ts`). `src/middleware.ts` is no longer
   listed — and no longer needs to be, since it no longer imports
   `@/server/*`.

### Why this is a real fix, not indirection that hides the same import

Middleware now depends on **configuration** — a plain object describing
providers, callbacks, and pages — not on the server's live auth singleton or
any server internal. The wall's stated purpose (`AGENTS.md`, "The module
map") is to stop UI-adjacent code from reaching into server internals or the
domain package instead of going through the API surface. A provider-config
object with no I/O, no database handle, and no server-only dependency is not
what that rule is protecting against; importing the server's constructed
`auth` instance — which closes over whatever the server module wires up next
to it — is. Moving the shared shape out from under `src/server/**` and
handing each consumer its own instance is exactly Auth.js v5's documented
answer to "middleware needs auth state but must stay Edge-compatible."

This also directly undoes the specific cost ADR-023 named: the exempt list
returns to three entries, and the precedent "we already made an exception
here" no longer applies to `src/middleware.ts`.

### The residual cost, honestly

`src/lib/authConfig.ts` is importable by genuine UI in a way `src/server/auth.ts`
never was — `src/lib/**` is not under the wall's exempt shell, and nothing
before this change stopped a component from importing it. Doing so wouldn't
leak a secret (the object holds no live credentials, just provider wiring
gated on env vars already public in the sense that their *presence* is not
sensitive), but it would let UI code construct its own Auth.js instance or
inspect provider configuration outside the two places designed to do so,
which is a boundary violation of the same kind the wall exists to prevent
elsewhere.

Closed with a narrow `no-restricted-imports` rule in
`apps/web/eslint.config.mjs`, scoped to `src/components/**` and `src/app/**`
(excluding `src/app/api/**`), forbidding `@/lib/authConfig` with a message
naming `src/server/auth.ts` and `src/middleware.ts` as the only permitted
importers. This is a second, UI-scoped block layered on top of the base
wall block rather than an addition to it — ESLint's flat config replaces a
rule's configuration wholesale with whichever matching block comes last for
a given file, rather than merging pattern arrays across blocks with
overlapping `files` globs, so the UI-scoped block repeats the base wall's
domain/server patterns (from a shared constant, to avoid the two copies
drifting) alongside the new `@/lib/authConfig` pattern. The rule's bite was
verified directly: a throwaway `import "@/lib/authConfig"` added to a UI
file under `src/app/**` made `pnpm --filter web lint` fail with the rule's
message, then the throwaway import was removed.

## Alternatives rejected

- **Leave ADR-023 as-is.** Rejected per Mitchell's ruling on CodeRabbit's
  review: the library's own split-config pattern removes the need for the
  exemption, so keeping the exemption once a no-exemption fix exists is
  paying the wall's cumulative cost (documented in ADR-023) for nothing.
- **Route auth through an API call inside middleware** (unchanged from
  ADR-023's rejection of this: it adds a network round trip inside
  middleware on every matched request, defeating the latency reason for
  doing this at the middleware layer at all).
- **Move `authConfig.ts` under `src/server/` and re-export a subset for
  middleware to import.** Rejected: anything under `src/server/**` is
  already exempt-shell territory, so middleware importing from it — even a
  narrower re-export — is the same shape the wall exists to prevent, just
  one file removed. The whole point of the split is that the shared config
  lives somewhere that is not `@/server/*`, so an import of it from
  middleware is not an import of a server internal.

## Consequences

- `apps/web/eslint.config.mjs`'s lint-wall `ignores` returns to its original
  three entries; `src/middleware.ts` is bound by the same `no-restricted-imports`
  rule as any other UI file, and passes because it no longer imports
  `@/server/*`.
- A new, narrower `no-restricted-imports` rule (UI-scoped, `@/lib/authConfig`
  only) exists specifically because the split makes the shared config
  reachable from UI in a way the previous single-file `server/auth.ts`
  never was.
- `apps/web/src/server/auth.ts`'s public exports (`handlers`, `auth`,
  `signIn`, `signOut`) are unchanged; every existing consumer
  (`src/app/api/**` route handlers, `src/server/pages-guard.ts`) needed no
  changes.
- Both the Google and `dev-login` providers still register from the same
  env-var gates as before the split — verified by reading rendered sign-in
  markup and by the front-door e2e spec, which authenticates via `dev-login`.
- `docs/milestones/M15-front-door.md`'s references to the exemption/ADR-023
  as the mechanism are updated to describe the split-config instance instead.

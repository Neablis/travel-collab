### KI-2026-09-23-b — `src/server/`'s root is one folder holding four modules, so the architecture wall cannot see the cycles between them

- **Severity:** cleanup — a blind spot in a check, plus two real cycles
  sitting in it. Nothing misbehaves today; the cost is that the wall's green
  line over-claims for exactly the modules the module map cares most about.
- **Area:** the 27 non-test files directly under `apps/web/src/server/`
  (`projections.ts`, `commands.ts`, `savedDays.ts`, `users.ts`, `auth.ts`,
  `flags.ts`, `flagEntities.ts`, …) against `apps/web/src/server/access/` and
  `apps/web/src/server/entitlements/`; rule `no-folder-cycle` in
  `.dependency-cruiser.cjs`.

- **Symptom.** dependency-cruiser's `scope: "folder"` cycle rule does not
  report a cycle between a folder and its own subfolder. Trip Planning
  (`projections.ts`, `commands.ts`, `savedDays.ts`), Identity (`users.ts`,
  `auth.ts`) and the flags plumbing all live as loose files in the `server/`
  root, so every cycle between them and `server/access/` or
  `server/entitlements/` is a parent↔child cycle and is invisible. Two exist
  today, found by the first run's ad-hoc strongly-connected-components pass
  (`docs/reviews/2026-09-23-architecture-wall-first-run.md`), not by the wall:

  1. **Access ↔ Planning.** `access/invites.ts:14`, `access/shares.ts:8`,
     `access/trip-access.ts:6` import `getTripDetail` from `projections.ts`;
     `projections.ts:4` imports `hasMembershipRow` from `access/members.ts`,
     and `commands.ts:27` imports `effectiveMembers` from it. Also
     `access/saved-day-access.ts:3` → `savedDays.ts`, and `savedDays.ts:19` →
     `access/invites.ts` (type only). **The Planning → Access edges are
     deliberate and commented** (`projections.ts:139-149`, `commands.ts:78-81`:
     Planning does not own `trip_memberships`, so it borrows the predicate
     rather than rewriting it). The Access → Planning edges are the ones to
     look at: the module map says Access does not know *"what a trip
     contains"*, and `getTripDetail` returns exactly that.
  2. **Identity ↔ Entitlements.** `users.ts:12-14` imports `livePlanVersion`,
     `offerTrial` and `rewardReferrer` (the signup trial and referral reward);
     `entitlements/requireAdmin.ts:14` imports `auth`, and `auth.ts:3` imports
     `recordSignIn` from `users.ts`. `entitlements/admin.ts:25` → `flags.ts` →
     `flagEntities.ts` → (dynamic) `auth.ts` closes the same loop a second way.

- **Why not fixed here.** Both need an owner's call, not a file move: whether
  Access may read a trip's detail (or should receive it from the route), and
  whether signup's trial issuance belongs in Identity or in a composition step
  after it. The structural fix for the blind spot itself is to give each
  module in `server/`'s root its own folder (`server/planning/`,
  `server/identity/`), at which point `no-folder-cycle` sees both cycles and
  this entry's two findings become lint failures to resolve or name.

- **Cross-reference:** `KI-2026-09-23-d` (the `entitlements/admin.ts`
  composition appears in both), AGENTS.md module map and invariant 6c,
  ADR-045, `docs/reviews/2026-09-23-architecture-wall-first-run.md`.
- **First noted:** 2026-09-23, the first run of `pnpm arch`.
- **Re-verified 2026-09-25 (overnight sweep):** still true. There is still no `server/planning/` or `server/identity/`, and `pnpm arch` reports no server-root cycle. Every edge above still exists, some at moved lines: `access/invites.ts:13` (was 14), `access/shares.ts:8` and `access/trip-access.ts:6` → `getTripDetail`; `projections.ts:13` (was 4) → `hasMembershipRow`; `commands.ts:27` → `effectiveMembers`; `access/saved-day-access.ts:3` → `savedDays`; `savedDays.ts:20` (was 19) → `access/invites` (type). On the identity side, `users.ts:12-14` → entitlements, `entitlements/requireAdmin.ts:14` → `auth`, `auth.ts:3` → `users`, `entitlements/admin.ts:25` → `flags` → `flagEntities.ts:113` (dynamic `auth`). The "deliberate and commented" notes have moved to `projections.ts:245-260` and `commands.ts:82-87`. The server root now holds 38 non-test files, not 27.

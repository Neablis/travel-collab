# M36 — the operator console in four tabs: build plan

Gate: `docs/milestones/M36-operator-console.md` § *Exit gate*. Decisions are numbered there and
cited here as D1–D10; links as L1–L6. Delete this file at M36's gate close
(`docs/plans/README.md`).

## Order and branches

| PR | Links | Tier | On the preview, a person clicks… |
|---|---|---|---|
| 1 | minting (this plan, the milestone file, TODO/README/STATUS rows) + **L1** the shell | 2 | `/admin`, then each of Financial · Users · Library; the tier tabs on Financial |
| 2 | **L2** six filters, Asked 30d, Last active, row → account link, *Show them in Users* | 2 | Users; each filter; a row; the link on Financial |
| 3 | **L3** the account page | 2 | a row in Users; Revoke on a test account |
| 4 | **L4** the AI models tab | 2 | AI models |
| 5 | **L5** Library notebooks, **L6** e2e + sweep, then Tier 3 | 2 → 3 | Library; the whole walk |

The first PR is on `claude/eager-sagan-ekawmk`. Later PRs branch from the previous one's head or
from `main` once it has merged; whichever, each is a draft until it is green. The AI models tab
(L4) depends only on L1, so it can run in parallel with L2/L3 in its own worktree.

## What is true today

Surveyed 2026-10-06 against `main` @ `12c4ff8`. Re-check before trusting a line number.

- **The page** is `apps/web/src/app/admin/page.tsx`: a server component, gated by
  `adminUserId()` → `notFound()`, reading `adminOverview()` and `listReports` ×3 in one
  `Promise.all`, rendering one column: `RevenueStrip` → `AccountsPanel` → `UnderwaterPanel` →
  `ReportsPanel` → `GrantSourcePanel` + `TierPanel` → `PriceCheckPanel`.
- **The wire shape** is mirrored UI-side in `apps/web/src/lib/adminOverview.ts`, pinned to
  `server/entitlements/admin.ts` by a compile-time identity check in `admin.console.test.ts`.
  Any new field is added on both sides or that test fails.
- **`webhooks-behind`** already renders inside `RevenueStrip`. **Nothing on the server detects
  the design's `version-conflict` state** — no read or write in `server/entitlements/` reports
  one — so L1 moves `webhooks-behind` to a page-level banner on Financial and Users and draws no
  `version-conflict` banner. That state needs a source before it can be drawn; L1's PR says so.
- **`AccountsPanel` has four filters today** (`all`, `entitled` "Holds a paid plan", `granted`,
  `unentitled` "Free"), in component state. Past due and Costs more than it pays are L2's, so
  *Show them in Users* is L2's too.
- **`TabStrip`** (`components/ui/tab-strip.tsx`) is an owned-state client primitive. URL tabs
  need a small client wrapper that calls `router.push` with the new `tab` and no `account`.
- **Grant and revoke** are `POST` / `DELETE /api/admin/grants`, used by `GrantForm`,
  `GrantDialog` and `GrantList` from inside `AccountsPanel`'s rows.
- **Data for L2/L3** with no migration: `users.created_at` (joined), `events.actor_id` +
  `occurred_at` (edits, last active; no index on `actor_id` — D6), `ai_usage` (asked, turns),
  `ai_usage_steps`, `ai_usage_tool_calls`, `entitlement_grants` (including revoked rows, which are
  never deleted), `subscriptions.status` (past due), `trip_memberships` (invited to),
  `saved_notebooks` (notebooks).

## L1 in detail — the shell

1. `page.tsx` takes `searchParams`, resolves `tab` to one of four values (unknown → financial),
   and renders the header row (Heading + subtitle left, tab strip right) and one tab body. Data
   reads stay one `Promise.all`; the report lists are read only when the tab is Library.
2. `components/admin/ConsoleTabs.tsx` — client; `TabStrip` over the four values, navigating to
   `?tab=<value>` (dropping `account`). AI models is **not in the strip until L4** builds it, so
   no tab is a placeholder.
3. **Financial**: `RevenueStrip` (banner lifted out), a `repeat(auto-fit,minmax(340px,1fr))` grid
   of `UnderwaterPanel` and the rebuilt `TierPanel`, then `PriceCheckPanel`.
4. **`TierPanel`** — one tier per tab (premium · plus · free by `displayOrder`, default the first
   paid): name + live price or `free`; one sentence of what it grants, or *Planning only — no
   ai.\*, no collaborators* when it grants nothing (decided by `entitlements.length === 0`, never
   by plan id — ADR-045 rule 4); 2×2 cells; the versions table; the read-only footer.
5. **Delete `GrantSourcePanel`** and its usages; `UnderwaterPanel` already carries the per-source
   counts.
6. **Users** renders `AccountsPanel` unchanged.
7. **Library** renders `ReportsPanel` unchanged.
8. Tests: a page-level test of tab resolution seen red; `TierPanel` per-tab test; update
   `admin.console.test.ts` for the deleted panel.

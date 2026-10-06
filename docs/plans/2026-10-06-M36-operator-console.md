# M36 — the operator console in four tabs: build plan

Gate: `docs/milestones/M36-operator-console.md` § *Exit gate*. Decisions are numbered there and
cited here as D1–D10; links as L1–L6. Delete this file at M36's gate close
(`docs/plans/README.md`).

## The stack

Seven parts, each on its own branch and stacked on the one below, merged 1 → 7 with merge commits
(`docs/guidelines/stacked-prs.md`). All open as drafts. **Nothing merges without Mitchell.**

| Part | Branch | Links | Tier | On the preview, a person clicks… |
|---|---|---|---|---|
| 1 | `claude/eager-sagan-ekawmk` | minting: this plan, the milestone file, TODO/README/STATUS rows, the candidate | 1 (prose) | nothing — docs only |
| 2 | `claude/eager-sagan-ekawmk-shell` | **L1** the tab shell | 2 | `/admin`, then Financial · Users · Library; the tier tabs on Financial |
| 3 | `claude/eager-sagan-ekawmk-users` | **L2** six filters, Asked 30d, Last active, row → account link, *Show them in Users* | 2 | Users; each filter; a row; the link on Financial |
| 4 | `claude/eager-sagan-ekawmk-account` | **L3** the account page | 2 | a row in Users; Revoke on a test account |
| 5 | `claude/eager-sagan-ekawmk-ai` | **L4** the AI models tab | 2 | AI models |
| 6 | `claude/eager-sagan-ekawmk-library` | **L5** Library notebooks, **L6** e2e + sweep, then Tier 3 on the whole stack | 2 → 3 | Library; the whole walk |
| 7 | `claude/eager-sagan-ekawmk-perf` | **Perf pass** (Mitchell, 2026-10-06: tabs slow to open): Users paged and counted in SQL, reads scoped to what a tab draws, `events (actor_id, occurred_at)` — the stack's one migration | 3 | each tab opens fast; Users pages, searches and filters over every account |

Each part is based on the part above it in the table. L4 depends only on L1, so part 5 may be
**built** in parallel with parts 3 and 4 in its own worktree, from part 2's head; it is merged
forward onto part 4 before it opens, so the stack stays a single line. Fixes go to the lowest
part they touch and merge forward (§3 of the guideline).

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

# M36 — The operator console is four tabs, and an account has a page

**Status:** Minted, scoped and placed 2026-10-06 by Mitchell — *"I added a design handoff to redo
the admin/operator dashboard. Create a new milestone … it will be the next milestone"* — and
**started the same day**, while M34 is still current with its walk and retro open. Its row sits
**immediately after M34** in `TODO.md`, ahead of M35, so `pnpm milestone close M34` reads M36 as
the next current milestone. Starting before M34 closes is building ahead of the current
milestone; the 2026-10-06 note in `README.md` records it as Mitchell's call rather than hiding it.

Design: `.design-sync/handoff/design/OperatorConsole.dc.html` (standalone; `startTab` and `ops`
props reach every state). Spec: `.design-sync/handoff/specs/operator-console.md`. Drift:
`.design-sync/handoff/DRIFT.md` **D20** (console shape) and **D21** (notebook and AI analytics).
It supersedes SPEC §17.2's single-scroll console. Build plan:
`docs/plans/2026-10-06-M36-operator-console.md`.

## Why this exists

The console is one scroll that grew a panel per milestone: M20's accounts and tiers, M21's
revenue strip, underwater list and price check, M12's report queue. Every new panel went to the
bottom, so the one part that needs action (reports) sits below four that only report. Granting
and revoking happen inside a table row with no confirm and no record of what the account does.
And the ledger M31 built — per turn, per step, per tool call — **is read by no admin surface at
all**; the `ai-usage` skill's SQL is the only way to see it.

The 2026-10-05 handoff redraws it as four tabs, gives an account a page of its own, and adds the
two analytics surfaces the data now supports.

## Decisions made while scoping (not asked; Mitchell can overturn any of them)

1. **The tab and the open account are URL state**: `/admin?tab=financial|users|library|ai`, and
   `/admin?tab=users&account=<id>`. The page stays a server component reading the Entitlements
   module directly (the 2026-09-14 exemption in `AGENTS.md`); a tab click is a navigation, not a
   client fetch. Switching tabs closes an open account page because the `account` param is not
   carried. An unknown `tab` value renders Financial.
2. **The accounts table's search, filter and page also move to the URL** (`q`, `filter`, `page`),
   so *← All accounts* returns with them kept, which the spec asks for. They stay client-side
   filtering over the list the server already sent; only their storage changes.
3. **`PriceCheckPanel` stays on Financial**, below the two panels, unchanged (the spec's open
   question 1, its own assumed answer).
4. **Growth per tier is not in this milestone** (the spec's open question 2). Neither
   `users.plan_id` nor `entitlement_grants` preserves history, so the weekly series needs either
   a rollup table (a migration and a job) or a derivation from grants plus `billing_events` that
   has never been checked against Stripe's own history. That is a design decision with a data
   cost, and the spec says to flag it before estimating. It is filed as a candidate, and the
   Users tab ships without the three charts — not with placeholders.
5. **Library's notebook analytics ship only what has a source** (DRIFT D21): the *Saved to a
   library* tile and the table's Notebook, By, Saved and Pages columns. *Shared*, *Saved by
   someone else*, *Trips started from one* and the weekly cards need a notebook share link and an
   adds ledger that do not exist; they are not drawn as zeros and not as Previews. They stay
   D21 until a milestone builds the share link.
6. **"Last active" is derived, not stored**: the latest of an account's planning events
   (`events.actor_id`) and assistant turns (`ai_usage.user_id`), trailing 30 days, so *active N
   of 30 days* is a count of distinct days in the same read. No `last_seen` column and no
   write on the request path. If the `events` read is too slow without an index on
   `actor_id`, the index is this milestone's one migration and the PR says so.
7. **The account page's assistant section reads counts and sizes only.** The footer is verbatim
   and the page grows no "view question" affordance: the ledger holds no content
   (`usage.int.test.ts`), and this milestone does not change that.
8. **Granting and revoking are still the only writes**, through the existing
   `POST`/`DELETE /api/admin/grants`. Revoke gains a confirm and a failure line; the Grant Dialog
   loses nothing it has today. No publish, migrate-to-version or price edit appears anywhere
   (`admin.console.test.ts` keeps refusing them).
9. **No public API endpoint.** The console reads the server directly. If a link does add an
   internal route, it is registered in `exposure.ts` as `never` — admin surfaces are not
   exposed — and that is the default this milestone takes rather than `planned`.
10. **The AI models tab reads the trailing 30 days only**, with the previous 30 for the one delta
    the spec draws. Cost uses the same gateway-priced rule as the accounts table's cost column
    (`microUsd.ts`), never `Money`.

## Scope

Six links, each one reviewable by clicking on its own preview.

1. **The shell — four tabs, Financial and Library assembled from what exists.** `Heading` and
   subtitle with a `TabStrip` on the same row, `?tab=` driven. **Financial**: `RevenueStrip`,
   then *Costs more than it pays* beside **How each tier is doing** rebuilt as one tier per tab — name and live price, one
   sentence of what it grants, a 2×2 of Accounts / MRR / Median cost · 30 days / Median margin ·
   payers, the *Published versions* table and the read-only footer — then `PriceCheckPanel`.
   **`GrantSourcePanel` is deleted**: it repeats *Underwater by construction*. **Users**: the
   accounts table as it is today. **Library**: `ReportsPanel`, unchanged behaviour.
   `webhooks-behind` becomes a page-level banner on Financial and Users. The design's
   `version-conflict` banner is **not drawn**: nothing on the server detects that state today.
2. **The accounts table — six filters and two columns.** All · Paying · Granted · Free · Past
   due · Costs more than it pays, counted over the search, and Financial's **Show them in
   Users** lands on the last. Columns Account · Holds · Why · Pays ·
   Costs 30d · **Asked 30d** · **Last active** · State · `›`. The whole row is a link to the
   account page; Grant and the inline grant list leave the row. Search, filter and page in the
   URL (decision 2).
3. **The account page.** Header with badges and **Grant a plan**; the six-cell facts strip;
   *Assistant · last 30 days* (stat row, questions-a-day bars against the plan's ceiling, top
   tools, recent turns, the verbatim footer, both empty states); *Activity* (edits a day and six
   recent events); *Plan and grants* with Revoke → inline confirm → failure line, then plan
   history. Reports' **by {owner}** links here.
4. **The AI models tab.** The four-number strip, turns a day with failed turns at the base and
   the task-class / escalation split, context size by step, the models table, the tool-calls
   table and *Offered on every step, almost never called*. `ledger-gap` and `no-usage` states.
5. **Library — notebooks, the half with a source** (decision 5). `no-notebooks` state.
6. **The e2e journey and the console sweep.** One spec on the ci-like lane: an operator opens
   each tab, filters to an account, opens its page, grants and revokes, and comes back with the
   filter kept. `admin.console.test.ts` updated for the deleted panel and the new tabs.

## Out of scope

- **Growth per tier** — decision 4; a candidate.
- **Notebook shares, copies and trips started** — decision 5; D21.
- The console on the phone (unchanged from §17.2: not on the phone, entry point included).
- Any new write: publishing plan versions, migrating holders, editing prices, editing an
  account. Granting and revoking only.
- Showing a question, an answer or a trip from the ledger.
- A public API endpoint for any of it.

## Exit gate

- [ ] **Four tabs, URL-driven**: each `?tab=` value renders its tab, an unknown one renders
      Financial, and `?account=` is dropped on a tab switch. Held by a test seen red.
- [ ] **`GrantSourcePanel` is gone** — `ls apps/web/src/components/admin/GrantSourcePanel*`
      finds nothing — and *Underwater by construction* still counts per grant source.
- [ ] **How each tier is doing is one tier per tab** with the 2×2, the versions table and the
      read-only footer, and no publish or migrate control (`admin.console.test.ts`).
- [ ] **All six filters, counted over the search**, including Past due and Costs more than it
      pays; *Show them in Users* lands on the latter. Held by a component test seen red.
- [ ] **Asked 30d and Last active are read from the ledger and the event log**, held by an
      integration test against real Postgres seen red (another account's events do not count;
      events older than 30 days do not count toward *active N of 30*).
- [ ] **The account page renders usage, activity and grants for one account**, and its
      assistant section carries no question or answer text — held by a test seen red.
- [ ] **Revoke confirms, and a failed revoke says nothing changed**, held by a component test
      seen red against a refused `DELETE`.
- [ ] **The AI models tab's aggregates are integration-tested** — turns, tool calls a turn,
      context per step by `step_index`, per-model and per-tool rows — each seen red.
- [ ] **Library shows Reports first, then the notebook tile and table**, and no tile for a number
      with no source.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**, and the existing admin and
      report specs still pass.
- [ ] **[walk]** On the PR preview, as an operator: each tab against the artboard
      (`OperatorConsole.dc.html`, `startTab`), an account page opened from the table and closed
      back to the same filter, and a grant then a revoke on a test account.
- [ ] **[walk]** As a non-admin, `/admin` and every `?tab=` answer 404.
- [ ] A retro is appended at gate close.

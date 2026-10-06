# Operator console — four tabs, an account page, reports, AI and notebook analytics (2026-10-05)

Design: `design/OperatorConsole.dc.html` (standalone; also mounted by
`design/Trip Planner Redesign.dc.html` on the `admin` route via `<dc-import name="OperatorConsole">`).
Supersedes the single-scroll console in SPEC §17.2 and the layout notes in `app/admin/page.tsx`.
Compares against: `app/admin/page.tsx`, `components/admin/*`, `lib/adminOverview.ts`,
`server/entitlements/admin.ts`, `server/db/schema.ts` (`ai_usage`, `ai_usage_steps`,
`ai_usage_tool_calls`, `saved_notebooks`).

Unchanged from §17.2: admin only and 404 for anyone else, not on the phone (entry point
included), header present with no assistant, plain primitives, no accent language.
Granting and revoking are still the only writes.

## Structure

`Heading` *Operator console* + one subtitle line, and a `TabStrip` right-aligned on the same row:

**Financial · Users · Library · AI models** — default **Financial**. The tab is view state
(a `?tab=` query param is fine); switching tabs closes an open account page.

Banners sit above the tabs, scoped:
- `webhooks-behind` → danger Banner on Financial and Users (revenue and *Pays* are stale), not on AI models or Library.
- `version-conflict` → warning Banner on Financial only.

## Financial

What the current page already has, minus the accounts table and the grant-cost panel:

1. **Four-number strip** — MRR (+ added delta), ARPU · all accounts, ARPU · paying only, median margin per paying account. Copy unchanged.
2. Two panels, `repeat(auto-fit, minmax(340px, 1fr))`:
   - **Costs more than it pays** — paying-and-underwater count in a danger-tint box; **Show them in Users** switches to Users with the `Costs more than it pays` filter on. *Underwater by construction* counts per grant source. **Delete `GrantSourcePanel`** — this is the same information (rule 4).
   - **How each tier is doing** — **one tier per tab** (`TabStrip`: premium · plus · free, default premium). Per tier:
     - Name (display 20px/600) + live price (`$16.00 / month`, or `free`), and one sentence saying what it grants (`Grants ai.ask · ai.command · trip.collaborators`; free: `Planning only — no ai.*, no collaborators`).
     - A 2×2 grid of hairline-separated cells: **Accounts**, **MRR**, **Median cost · 30 days**, **Median margin · payers**. Label 12px slate above the value, mono 20px/600.
     - **Published versions** table: Version (`v2 · live`), Price, Published (`1 Sep by mitchell`), Accounts on it.
     - Footer: *Read-only. Versions are published from the repo, not from here.*
3. `PriceCheckPanel` stays as is, below the panels (not drawn; no change).

## Users

### Accounts by tier (growth)
One small area chart **per tier**, side by side (`minmax(220px, 1fr)`). **Each has its own
y-scale** on purpose — on a shared scale free flattens the other two. Per card: tier name,
current count (mono 22px), `+N added` (success ink) and `−N lost` (slate) for the last 30 days,
a 72px area (ink stroke 1.6px, ink fill at 8%), x labels: first week's date · `peak N` · `now`.
Series: accounts holding the tier at the end of each week, last 26 weeks. *Added/lost* include
upgrades and lapses.

**Build owes:** a weekly snapshot of plan holdings. Neither `users.plan_id` nor grants is
history-preserving today; this needs either a weekly rollup table or derivation from
`entitlement_grants` + subscription events. Flag before estimating.

### Accounts table
As today, plus:
- **All six filters:** All · Paying · Granted · Free · Past due · Costs more than it pays. Counts are over the search, not the page. (`Holds a paid plan` goes back to **Paying** — the *Pays* column now exists.)
- Columns: Account · Holds · Why · Pays · Costs 30d · **Asked 30d** · **Last active** · State · `›`.
- **The whole row opens the account page.** Hover = moss background. The *Grant* button and the inline grant list **leave the row** — they live on the account page.
- Underwater rows keep the danger-tint background and danger-ink cost.

### Account page (`?tab=users&account=<id>`)
Replaces the table in place; `← All accounts` (ghost, sm) returns with the filter and page kept.

1. **Header** — address (mono 22px/600); badges: holds (neutral), state (`success` active · `info` granted · `warning` past due · `neutral` free), and `Costs more than it pays` (danger) when true. **Grant a plan** (secondary) right-aligned → the grant Dialog.
2. **Facts strip** — six cells `minmax(120px, 1fr)`: Joined (+ days ago) · Last active (+ active N of 30 days) · Trips (own · invited to) · Notebooks (N shared · started N trips) · Pays (a month / comped / nothing) · Costs 30d (danger ink if underwater).
3. **Assistant · last 30 days** (full width):
   - Stat row: questions asked · steps (+ per question) · tool calls a turn (median) · context per step (median · p95; danger ink when p95 > 24k) · failed turns.
   - **Questions a day** — 30 bars. When the account's peak is over 40% of its plan's daily ceiling, the scale is the ceiling × 1.1 and the ceiling draws as a dashed danger line; days at the ceiling are danger bars. Otherwise the line is omitted and the label says *ceiling N a day — well above this*. **A day never exceeds the ceiling** (it is a hard cap).
   - **Tools it called most** — up to four mono chips with counts.
   - **Recent turns** table: When · Kind (question / change) · Model · Steps · Tool calls · Peak context (danger when > 24k) · Took · Outcome (Badge: `answered`/`proposed` neutral, `failed` danger).
   - Footer, verbatim: *The ledger keeps counts and sizes, never the question or the trip — so this shows what a turn cost, not what was asked.* This is the `ai_usage` no-content rule (usage.int.test.ts); **the page must not grow a "view question" affordance.**
   - Empty: free plan → *No assistant on this plan* + why; plan with ai.* and zero turns → *Hasn't asked anything in 30 days*.
4. Two panels, `minmax(340px, 1fr)`:
   - **Activity** — 30-day edits-a-day strip (34px), then six recent events (`74px` date column + sentence).
   - **Plan and grants** — each active grant as a card (`trial grant · plus v2`, expiry · by whom) with **Revoke** → inline danger-tint confirm: *They drop to free v1 on their next request. The grant row stays, marked revoked.* `Keep it` / `Revoke` (destructive). Failure: *The revoke didn't reach the server. Nothing changed — they still hold it.* Then plan history (bought / granted / revoked / signed up).

**Grant Dialog** (unchanged fields minus version): Account (read-only), Plan, Because (admin · trial · referral · founder), Runs out (date; *Empty means permanent*), info Banner: *Pins {plan} v2, the version live now — publishing a newer one later does not move it. Applies on their next request, no sign-out.* No version picker (matches `GrantForm`). Success closes and toasts; refusal stays open.

## Library

Everything people share: the report queue first (it is the only part that needs action), then notebook use.

### Reports (moves here from the bottom of the old page — `ReportsPanel` / `ReportRow`, unchanged behaviour)
- Counted pill filters **Open · Actioned · Dismissed**, default Open — the same pill style as the accounts filters.
- One row per report, hairline-separated:
  - Line 1: Badge `Day` / `Review`, the day's name (600), **by {owner}** (link → that account page), Badge `N reports on this` (`warning` when > 1).
  - Review only: stars (mono), the review's note in quotes, *review by {name}*.
  - Reason Badge (danger), the reporter's note in quotes, *Reported by {name} on {date}*.
  - Resolution line in warning ink when not open: *Hidden from the library since … — note to the author: “…”* / *Dismissed by … on …*.
  - Actions by state: open day → **Hide from the library** (opens an optional *Note to the author* textarea, then **Hide it** destructive / Cancel) + **Dismiss** (ghost); open review → **Hide review** + **Dismiss**; actioned → **Restore to the library** / **Restore review**.
- One decision settles every open report on the same target — the queue re-reads, never splices.
- Empty per status: *No open reports* + *Nothing open. Reports people file on shared days and reviews land here.*
- Failure (`offline`): toast *The action did not reach the server. Nothing changed.*; re-read failure keeps the existing *Reload the page before acting again* line.
- Footer: *Hiding a day takes it off Discover, the board and profiles; the author keeps their copy. One decision settles every open report on the same day.*

### Notebooks

1. Strip: **Saved to a library** (all time, +30d delta) · **Shared** (saved notebooks with a share link someone has opened) · **Saved by someone else** (copies from a shared link; per-shared ratio) · **Trips started from one** (+30d; share of copies).
2. **Each week** — three area cards (Saved · Shared · Trips started), 26 weeks, own scales.
3. **Notebooks that start the most trips** — Notebook · By (link → that account page) · Saved · Pages · Shares · Trips started (600) · Last used. Footer defines *share* and *trip started* (author's own don't count).
4. Empty: *No notebooks saved yet* + one line.

**Build owes (DRIFT D21):** `SavedNotebookVisibility` is `["private"]` only — there is no share
link, so *Shared* and *Saved by someone else* have no source. Nothing records a trip seeded from
a saved notebook — needs an adds ledger like `saved_day_adds`. Ship tile 1 and the table's
Saved/Pages columns first; the rest waits on those two.

## AI models

Reads `ai_usage`, `ai_usage_steps`, `ai_usage_tool_calls`, trailing 30 days.

1. Strip: **Turns** (+% vs previous 30d; accounts; median steps a turn) · **Tool calls a turn** (median, p95; failed % and repaired %) · **Context per step** (median `tokens_in`, p95) · **Failed turns** (% and count; names the worst day and why when one stands out).
2. **Turns a day** — 120px area of turns per day, failed turns as a danger area at the base. Below: % questions · % changes (`task_class`) · % escalated to the strong model · failed count.
3. Two panels, `minmax(380px, 1fr)`:
   - **Context size by step** — one column per `step_index` (1–7, then 8+): median as an ink bar, p95 as a moss bar with border behind it; step number + median under each. Hover: median, p95, turns that got that far. Footer states growth per step, cache-read share (`cache_read_tokens / tokens_in`), and turns crossing 32k.
   - **Models** — per resolved model (`ai_usage_steps.model`, classifier from `ai_usage.classifier_model`): id (mono), role (cheap · default / strong / classifier), steps, input tokens, median step duration (`duration_ms`), cost 30d (gateway-priced, same rule as the cost column elsewhere), one sentence.
4. **Tool calls** table — Tool · Calls · In turns (% of turns calling it) · Failed (count · %, danger ink above 5%) · Repaired · Median time · Median result (`output_bytes`) · Reached a proposal (`reached_proposal`, `—` for read tools). Then **Offered on every step, almost never called** — tools under 1% of turns, with their schema cost per step. This is the efficiency question the ledger comment names.

## States (rule 6)

| Prop `ops` | Where | What |
|---|---|---|
| `healthy` | all | as above |
| `webhooks-behind` | Financial, Users | danger Banner — revenue as of last processed event; grants still apply |
| `version-conflict` | Financial | warning Banner — reload before granting |
| `ledger-gap` | AI models | warning Banner — *142 turns since 09:40 have no step or tool-call rows*; turn counts right, tool/context numbers undercount |
| `no-usage` | AI models | dashed empty box replacing the tab body |
| `no-notebooks` | Library (notebooks only; Reports stays) | dashed empty box replacing the tab body |
| `offline` | Account page, Library | Revoke fails with the inline message; a report action toasts *did not reach the server*; nothing changes |

Users with no match: the existing *No account matches* + *Clear the filter*.
Also `startTab`: `financial · users · library · ai`.

## Tokens used

All from the DS: `--color-ink`, `--color-slate`, `--color-hairline`, `--color-border-strong`,
`--color-moss`, `--color-surface`, `--color-danger-ink`, `--color-danger-tint`,
`--color-success-ink`; `--font-next-mono` for every number, date and id; `--font-next-display`
for tier names. Table heads: mono 10.5px/600, 0.07em, uppercase, slate on moss, strong bottom
border. Section labels: 11px/600, 0.05em, uppercase, slate. Charts: ink stroke 1.6px
non-scaling, ink fill 8%; no brand colour anywhere on the console. In the app, money and
counts go through `DataText`.

## Open questions

1. `PriceCheckPanel` — keep on Financial (assumed) or fold a mismatch into a Banner and drop the panel?
2. Growth history — rollup table vs derived; decides whether the Users charts ship with the tabs or after.

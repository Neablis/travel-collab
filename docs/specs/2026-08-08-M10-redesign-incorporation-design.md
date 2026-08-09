# M10 — Trip Planner Redesign incorporation (design)

**Status:** Accepted — 2026-08-08
**Deciders:** Mitchell (product/eng), Claude (architect)
**ADR:** `docs/architecture/ADR-018-visual-pass-ahead-of-ai-behind-preview-seam.md`
**Source materials (external handoff bundle, not in repo):**
`~/Downloads/design_handoff_trip_planner/` — `README.md` (the written handoff)
and `Trip Planner Redesign.dc.html` (a 1,412-line HTML prototype; markup +
imperative logic in one file). Key anchors inside the prototype:
`buildDays(` (day/activity model), `celebrate(` (the keep-a-day animation),
`data-r="dayhead"` (day header), `data-pb="flag"` (keep-day control), the
`PLAYBOOKS` / trips / suggestions fixtures near the bottom.

## What this is

An Anthropic design team produced an idealized, high-fidelity redesign of the
whole product. It is **not a new design system** — every component it names
(`Button`, `Card`, `Badge`, `Heading`, `Text`, `DataText`, `Panel`,
`PageContainer`, `Dialog`, `Sheet`, `Banner`, `TabStrip`, `SegmentedControl`,
`Input`, `Textarea`, `NativeSelect`, `FormField`, `EmptyState`) already exists in
`apps/web/src/components/ui`, and the tokens it references
(`--color-paper/-surface/-moss/-hairline/-brand/-brand-tint`, the
danger/warning/success/info tint+ink families, the three `--font-next-*`
families) are already in `apps/web/src/app/globals.css`. The prototype's
"TravelCollabUI" **is** this repo's M5 design system. So this is a *visual
arrangement* problem, not an adoption problem.

The redesign is idealized: it shows functionality that does not exist yet —
Playbooks (save-and-share a single day), an AI Assistant rail, AI "proposals",
a "Keep this day" delight moment. This spec's job is to say **what we build now,
what we mark incomplete, and where the incomplete parts get wired up later** —
without violating milestone discipline or the six invariants.

## The core decision (see ADR-018 for the argument)

Bring the **M10 visual craft pass forward, ahead of M9**, and build it as one
coherent pass over the *now-specified* full surface inventory — including inert,
clearly-marked shells for the surfaces M9 (AI) and M11 (Fork & remix) will later
make functional. The reorder is safe only because those future surfaces are now
*designed* (the handoff supplies them) and because the shells are behavior-free
(a `<Preview>` seam guarantees it). New order:

```
M8 ✓ → [Phase 1 gate review — done, 2026-08-08] → M10 (this) → M9 → M11 → M12 → M13 → M14
```

## Redesign → milestone map

| Redesign element | Owner | Built in M10-now as |
|---|---|---|
| Home: page head, next-trip hero, stat tiles, avatar stack, **sparkline**, all-trips grid | **M10** | Real restyle, real data |
| Trip plan: sticky header, TabStrip, **day-chips row**, Timeline, Day columns, Calendar, day headers, activity rows, legs | **M10** | Real restyle, real data |
| New-trip / Add-stop dialogs | **M10** | Real restyle of existing editors |
| Assistant rail; in-timeline **proposals ("ghosts")**; home **"Worth your attention"** | **M9** | `<Preview>` shell, inert, sample data |
| Playbooks route; home "Your Playbooks" strip; **keep-a-day flag + dialog**; "Add a saved day" / Insert-a-Playbook; "Share" buttons | **M11** | `<Preview>` shell, inert, sample data |

## Does the redesign's AI surface align with M9? (yes — it is M9's visual spec)

M9 has a *visible* half and an *invisible* half. The redesign covers the visible
half almost exactly and correctly omits the invisible half.

**Visible half — redesign supplies it:**

| M9 scope | Redesign surface | Fit |
|---|---|---|
| Propose → review → approve ("reviewable diff, accept/reject before it's truth") | The "ghosts": dashed brand cards inserted inline with **Keep** / **Discard** | Near-exact. M9's exit gate — *"committed only on approval… rejecting leaves the trip untouched"* — is Keep/Discard. |
| Thread contract (messages, persisted conversation) | Assistant rail: input + "Ask", chat, context line | Direct — the rail is the thread surface. |
| Refinement ("no, make it Tuesday") | Ongoing rail chat against the standing ghosts | Direct. |
| Proactive help | Rail suggestion cards + home "Worth your attention" | Natural extension of the propose flow. |

**Invisible half — no redesign surface, correctly:** Grounding (SearchPlaces /
`placeRef` / LocationIQ), honest unknowns (never fabricate `cost: 0`), and
observability (persisted `meta`, replay harness, eval set) are backend/agent
plumbing. Grounding only peeks through in the Add-stop dialog's "suggested
matching places."

**Two gaps the redesign does NOT hand over (M9 designs these regardless):**
1. **The move/modify proposal case.** The ghosts show AI *adding* activities. M9
   must also show a *diff of an existing* activity ("move X to day 2", "shorten
   lunch") — strike-through-old + ghost-new, or similar. The redesign gives the
   add case only.
2. **Streaming-in-progress.** M9 wants `streamText` so a plan appears as it is
   built; the redesign shows a finished proposal doing a `riseIn`, not rows
   arriving progressively.

**Architecture signal for M9 (input, not a decision):** the prototype's ghosts
are ephemeral client state (`ghosts[]`, Keep/Discard), which nudges M9's open
choice toward the *intermediate validated model surfaced to the frontend*
direction over the *persisted history branch* direction (`TODO.md`'s "AI Preview"
item). M9 still owns that call.

Consequence: building the rail + ghost shells now does not gamble on M9 — it is
drawn from M9's own exit-gate language, so it *de-risks* M9.

## Scope split

### Real restyle now (existing, working surfaces; real data; behavior unchanged)

- **Home** (`apps/web/src/app/page.tsx`): mono date line + `Heading` head; the
  next-trip hero (raised `Card`, two-column, mono meta row, avatar stack, three
  stat tiles, "Open plan"/"Share" — **"Share" is a Preview control**); the
  **sparkline** ("shape of the trip", one column per day, stacked bars per stop)
  built from the real next trip's days; the all-trips grid (accent bar, display
  name, mono dates, summary, avatars + state `Badge`); responsive collapse rules.
- **Trip plan** (`apps/web/src/app/trips/[tripId]/page.tsx` and the lenses):
  sticky header (back link, name + state `Badge`, mono meta, actions), the
  `TabStrip` (Timeline / Day columns / Calendar — all three lenses exist), the
  **day-chips row** (new), and a restyle of `TimelineLens`, `Board`/`Column`
  (Day columns), and `CalendarLens` to the handoff's day headers, activity rows,
  legs, compact cards, and 7-column calendar.
- **Dialogs**: restyle the existing New-trip and Add-stop/`ActivityEditor`
  surfaces to the handoff (fields, slot-availability note). The New-trip 4-step
  wizard shape is M10 layout; any AI "suggested matching places" inside Add-stop
  is a Preview affordance (M9 grounding).

### `<Preview>` shells now (real visual, inert, sample data)

- **M9:** Assistant rail (356px right rail, header + Hide, context line,
  suggestion cards, quick-ask chips, input + Ask, <1180px overlay + scrim);
  in-timeline proposals/ghosts (dashed brand card, Keep/Discard); home "Worth
  your attention" panel.
- **M11:** Playbooks route (intro, info `Banner`, `SegmentedControl` +
  `NativeSelect` filters, grid of playbook cards, Community placeholder card);
  home "Your Playbooks" strip; **keep-a-day flag button + "Keep this day"
  dialog** (shell only — see below); "Add a saved day" and Insert-a-Playbook
  dialog; "Share" buttons wherever they appear.

### "Keep this day" — flag shell only, celebration deferred (decided)

Build the pennant-flag button in the day header and the "Keep this day" dialog
as an inert `<Preview milestone="M11">` shell. **Do not** build the celebration
choreography (spring, ring, sparks, kept-pill, "Kept · link copied" toast) —
there is no saved Playbook or real link to celebrate until M11, and a toast that
says "link copied" when nothing was copied is dishonest. The full `celebrate(`
sequence (timings preserved in the prototype README) lands in M11 with real
behavior behind it, implemented as CSS transitions/keyframes on a mounted state
class (the prototype's Web Animations API approach was a prototype-runtime
workaround, per the handoff's own implementation note).

## The `<Preview>` seam

One shared component is the single seam for everything not-yet-functional.

```tsx
// apps/web/src/components/ui/preview.tsx
<Preview id="assistant-rail" milestone="M9" note="AI thread — wired in M9">
  <AssistantRail ... />
</Preview>
```

- Renders its children (the real visual) so the design reads as intended.
- Overlays a small corner chip — `Preview · M9` — and sets `aria-disabled`.
- **Inerts interactive controls** inside it (a shield layer / `pointer-events`),
  so no shell button ever fires a real or fake action.
- `id` and `milestone` are typed; `milestone` is `'M9' | 'M11'`.

A registry is the grep target M9/M11 use to find and remove *their* shells:

```ts
// apps/web/src/lib/preview-registry.ts
export const PREVIEW_REGISTRY = {
  'assistant-rail':      { milestone: 'M9',  wiredUpBy: '…' },
  'timeline-ghost':      { milestone: 'M9',  wiredUpBy: '…' },
  'worth-your-attention':{ milestone: 'M9',  wiredUpBy: '…' },
  'playbooks-route':     { milestone: 'M11', wiredUpBy: '…' },
  'home-playbooks-strip':{ milestone: 'M11', wiredUpBy: '…' },
  'keep-day-flag':       { milestone: 'M11', wiredUpBy: '…' },
  'insert-playbook':     { milestone: 'M11', wiredUpBy: '…' },
  'share-button':        { milestone: 'M11', wiredUpBy: '…' },
} as const;
```

**Test (house rule — an invariant with no test is a lie with a timer):** a unit
test asserts registry ↔ usage are in sync — every `<Preview id>` used in the app
exists in the registry, and every registry entry is used at least once. When M9
removes the last `assistant-rail` shell, the same test forces the registry entry
to go with it.

## Component & context architecture (Mitchell's guidance)

`<Preview>` marks a surface incomplete; it **does not excuse a fake component
API.** Every shell inside a `<Preview>` is a real, flexible component with the
prop contract it will eventually need — fed **sample data + no-op handlers now**,
real data + real handlers at M9/M11. The seam then moves the *data source and
handlers*, never the *component shape*.

- Example: `<AssistantRail suggestions={…} contextLine={…} quickAsks={…}
  onAsk={…} onKeepGhost={…} onDismiss={…} onHide={…} />` — props shaped to what
  is presented, so M9 supplies live data + real callbacks and deletes only the
  `<Preview>` wrapper.
- Shared cross-surface state — **focused day**, **ghosts**, **kept days** — lives
  in properly-structured React context providers built now (co-located with, and
  extending, the existing trip client-state architecture, ADR-012). M10 seeds
  them with sample/no-op values; M9/M11 replace the *provider internals*, so
  consumers do not change. This is the difference between M9/M11 being a wiring
  job and being a rebuild.

## Token & bespoke-element deltas

Tokens are already ~1:1 with the handoff (verified against `globals.css`). The
only additions M10-now needs:

- **Per-city day accents** — the handoff derives a per-city tint/ink/solid
  family used by day chips and day headers. Add these as a small, documented
  derivation (a fixed palette keyed by city, or an index cycle), not off-system
  colors.
- **Bespoke hand-styled elements** the handoff calls out (not `ui/*` components):
  day chips, the keep-day pennant flag, and sparkline bars. Add each as a small
  focused component; everything else reuses `ui/*`.

## Sample / preview data strategy (default confirmed)

Preview-only surfaces (Playbooks, Assistant, Worth-your-attention) render
**representative sample data**, wrapped in `<Preview>`, not empty states — the
point of pulling M10 forward is to make the *design* legible as a target, and an
empty state hides the very thing being shown. Source the sample fixtures from the
prototype's own `PLAYBOOKS` / suggestions fixtures so they read as intended, and
keep them isolated (e.g. `apps/web/src/components/**/__preview-fixtures__` or a
single `preview-fixtures.ts`) so M9/M11 delete them cleanly. Real surfaces
(home, trip plan) use real data throughout.

## Testing & Definition of Done

- **Presentational-only invariant (M10's existing exit-gate rule):** zero diff to
  `packages/`, `apps/web/src/server`, and the API routes. This plan is UI-only by
  construction, which also means the six invariants are untouched — the shells
  are inert, so nothing "builds ahead" of M9/M11 behavior.
- Existing unit/e2e stay green; update DOM assertions and snapshots where markup
  changes (the restyle moves markup even when behavior does not — budget for
  `TripBoardScreen`, `TripHeader`, lens, and `page.tsx` test churn).
- New: the `<Preview>` registry ↔ usage sync test; render tests for the new
  bespoke elements (day chips, flag shell, sparkline).
- Clear the cosmetic debt already assigned to M10 — **KI-2** (money formatted two
  ways on one screen), **KI-3**, **KI-4** — or explicitly re-defer with a reason.
- Milestone hygiene: rewrite `docs/milestones/M10-visual-craft.md` scope + exit
  gate to this plan before the first build commit; update `docs/milestones/
  README.md` (table + Current milestone), `TODO.md`, and `docs/STATUS.md` to the
  new order; append a retro at gate close.

## What this explicitly does NOT do

- No domain, contract, event, or server change of any kind.
- No AI behavior (rail and ghosts are inert; M9 owns behavior).
- No Playbook persistence, save, or share; no share links (M11).
- No "Keep this day" celebration or toast (M11).
- No new capability — an activity is still added via the existing
  `ActivityEditor`; the deferred M8 Wave C/D ergonomics (quick-add,
  search-to-add, move-via-menu) remain deferred and are not smuggled in here.

## Open questions handed to later milestones

- **M9:** the move/modify proposal diff; streaming-in-progress reading; the
  propose→review→approve architecture choice (pending branch vs. intermediate
  model — the prototype signals the latter).
- **M11:** the "Keep this day" celebration; what a Playbook *is* as a domain/CRUD
  object; share-link semantics and access.

<!-- GENERATED — do not edit. Exported from the project root at the 2026-09-12 handoff.
     Edit the root file and regenerate; two copies drift. -->

# Design ↔ build drift — Caesura / travel-collab

Design: `Trip Planner Redesign.dc.html` (desktop + phone surfaces, landing, auth, first run),
plus the three Notebook widget components.
Build: `Neablis/travel-collab@main`, read from the attached working tree.

**Resynced 2026-09-12, then extended the same day by a large design pass** (tabs, the trip's
Overview page, widget settings out of flow, trip lifecycle, read-only, the mark and the
Ledger default, the phone front door — SPEC §24–§28).

**Resynced 2026-09-12.** The previous pass was 2026-09-04 and this one is a large
correction: **five of the eight open items in §1 are closed by shipped code**, most of
them by M11a/M11b (2026-08-31) and M17 (2026-09-11), which the design side never read.
The closed items are condensed into §5 rather than argued again.

Two files stay authoritative on the build side and are not restated here:
`apps/web/src/lib/preview-registry.ts` (now **11** shelled surfaces, down from 18) and
`docs/known-issues/` — which is now a **directory** (`open/`, `resolved/`, `dormant/`),
not the single `known-issues.md` this document used to cite. Preview-wrapped UI is
*designed and shelled, not missing* — it is not a design gap.

---

## 0. What moved since the last sync

Read this before §1; it is why §1 is short now.

- **M11a (invite gate) and M11b (Playbooks) both closed 2026-08-31.** Playbooks is real:
  four routes, the `cities[]` field, a city endpoint, public visibility and an adds
  counter. This was the single largest block of "design is far ahead" on the old list.
- **M17 (account customization) closed 2026-09-11**, nine days after its code shipped.
- **M9 Phase 0 — the assistant kernel — completed 2026-09-11** (`bbc5bdb` #162,
  `845fc48` #163, ADR-043). It introduced an **entitlements port** that changes D10's shape.
- **The roadmap order is `M17 ✓ → M9 → M20 → M21 → M12 → M13 → M14 → M19`.** M9 is the
  current work. This document's old closing line ("M10 Wave 2 Phase 9 is the next work")
  was wrong — M10's gate closed 2026-08-27.
- **`docs/STATUS.md` was cut twice** (2026-08-28, 2026-09-11) and is now the short
  resume-from-here file. History lives in `docs/retros/*-status-archive.md`.

## 1. Open drift — code and design still disagree

| # | Thing | Code | Design | Call |
|---|---|---|---|---|
| **D3** | Trip status badge | `TripHeader` renders a status `Badge` | No badge | Code wins, or design adds it back. **Not re-verified this pass** — carried forward as stated, flag if it has since changed. |
| **D6** | "Next trip" | `TripSummary` still carries only `createdAt`; `nextTrip` is `visibleTrips[0]` | Upcoming-by-date hero + "in 47 days" countdown | **= KI-34, still open and unchanged.** The only survivor of the original list. With nothing to sort by the hero can surface the *wrong trip*. KI-34 names the fix path: add a start date to `TripSummary`, then date-sort. |
| **D10** | Billing | **Changed shape.** No `plan`, `plan_versions`, `entitlement_grants`, `is_admin`, `subscriptions` or `ai_usage` table — but the **port now exists**: `server/assistant/entitlements.ts` defines `ResolvedEntitlements` (a `has()` set, never a rank), `EntitlementCeilings` and `planVersionRef`; `EVERYONE_IS_ENTITLED` was widened to `permitEverything`, and a `TurnLedger` is already shaped as M20 link 9's `ai_usage` row with model identity and cost as variable inputs | Four surfaces: pricing, operator console, collaboration gate, plan + usage (§2c) | Design is still ahead and still blocked on M20/M21 **tables**, but no longer on the *seam*. The gate the design shows (AI, 402 `ai-not-entitled`) has a real resolver behind it now. Not a defect on either side. |
| **D11** | First-run "roughly when?" | **New.** A `NewTripWizard` exists, with four Preview shells: `wizard-destination-chips` and `wizard-longer-chip` (both tagged **`unplaced`** — no milestone will wire them), `wizard-pace-tags` and `wizard-assistant-draft` (M9) | First-run screen offers date-range chips, pace and tags | **Supersedes the old D4.** The contract question moved: it is no longer "add a field to `CreateTrip`" but "does any milestone own the wizard's chips at all". Two of the four shells are honestly orphaned. Design should either drop the destination chips and the longer-chip, or Mitchell places them. |

D1, D2, D4, D5, D7, D8 and D9 are closed — §5.

## 2. Design intent still ahead of the build, deliberately

Unchanged from the previous pass except where noted. These are not defects.

**§2c — billing surfaces (M20/M21).** `SPEC.md` §17. All fixture data; the two prices are
placeholders and remain Mitchell's decision. The design asserts no new gate. The plan
ladder is presentation only. Publishing and migrating plan versions are deliberately
absent from the UI (Mitchell, 2026-09-02), which narrows M20 link 7 to: accounts list,
effective entitlements, grant history, grant/revoke, per-tier stats. The console is not
a product surface and does not exist on the phone.

Two carried notes, both still live. `Money` must not appear on these screens' data path —
a request costing $0.0011 rounds to zero in `amountMinor`; dollars are derived at read
time from tokens plus a dated rate table. And the account's meters read the **pinned
version's** per-user ceilings, not the environment's global ceiling.

**New this pass:** M9 Phase 0 left three open questions that are Mitchell's and that this
design touches — whether the usage row carries a `planVersionRef`, **which quota window a
*sold* ceiling binds** (implemented per-day, stated nowhere), and whether the tier map is
a Vercel Flag or an env var. The second one is the expensive one, and the plan-and-usage
screen is where a wrong answer becomes visible to a customer. Settle it before M20 opens.

**§2e / §18 — Notebook widgets.** A page has no scope; each widget owns its inputs.
Still the correct model and now largely agreed with the build (ADR-037). The design was
re-cut onto the build's model in the 2026-09-04 pass — insert is a sidebar + click-at-cursor
+ drag + slash, binding lives in the chrome row, one entry per bound widget. See §4.

**The landing page** is buildable today, static fixture, no session and no network. It
deliberately shows two things that do not fully exist. That is the intent, not drift; do
not water it down. Decorative hero SVG layers are `pointer-events: none` so the day pills
stay clickable — the same trap exists in any real implementation.

## 3. Designed, shelled in code behind `<Preview>`

**11 entries, down from 18.** Seven were removed by M11 links 3/4/6 and M11b — *deleted
rather than re-pointed*, because the features are real now.

**Blocked on a missing contract field:**
- `rack-provenance` → **M13** (who parked a stop, which day it came from)
- `add-stop-who` → **M13** (per-stop attribution — the same absence from the other side)
- `cost-estimate-state`, `budget-breakdown` → **M19** (minted 2026-08-31 for exactly these)
- `map-legend-modes` → **`unplaced`** (transport mode per leg; in TODO.md's candidate ideas)
- `wizard-destination-chips` → **`unplaced`** (no destination field on `TripSummary`/`TripDetail`)

**Blocked on a feature, not a field:**
- `timeline-ghost` → M9, and **narrower than it was**: propose→review→approve shipped in
  PR #88 (`ProposalCard`, `POST /ask/apply`). What is unbuilt is rendering an approved-or-
  pending proposal *inline in the timeline*, not the approval mechanism.
- `add-stop-suggestions`, `wizard-pace-tags`, `wizard-assistant-draft` → M9
- `wizard-longer-chip` → `unplaced`, and the only entry here that is **purely unbuilt UI** —
  no field blocks it, so any milestone could take it.

**Gone from this list entirely** (built, or deleted as unwanted): `trip-invites`,
`share-button`, `keep-day-flag`, `keep-day-dialog`, `add-saved-day`, `playbooks-route`,
`insert-playbook`, `home-playbooks-strip`, `wizard-playbook-panel`, `landing-peek-trip`,
`landing-see-finished`, `home-worth-attention`, `home-decisions`, `assistant-suggestions`,
`assistant-quick-asks`. The last two were **deleted rather than shelved** — the design's
panel has only the conversation and the ask box, so there was nothing to wire.

**KI-47 is closed.** `tags` exists: `ActivityTag` arrays on `activity.ts` (create, update
and stored), `detail.ts` and `saved.ts`, plus `TripGlobals.tags`. The tag chips and
dim-in-place filtering on five designed surfaces are unblocked. See KI-052 for what
shipped vs. what the design shows.

## 3b. Designed 2026-09-12 — was absent, now specified

Four things on this list are no longer gaps. Each has a spec section and none needs a new
contract field:

- **The trip had no landing page.** Now Overview, and it is the trip's undeletable notebook
  page rather than a dashboard (SPEC §25). **One registry addition owed: `w-open`.**
- **Trip lifecycle** — optimistic delete, undo toast, restore, duplicate (SPEC §27). Maps onto
  `RestoreTrip` and `duplicateTrip` as built.
- **Read-only** — one mode, two entrances, and the answer to what `/demo` should be
  (SPEC §27, DRIFT §5b).
- **The phone front door** — a pinned scroll sequence (SPEC §28).

And one thing the build asked for is answered: **a day column sorts by start time.**

## 4. Real in code, absent from design

- **Trip lifecycle — designed 2026-09-12, no longer a gap.** Delete is optimistic (the
  card goes on the click), the toast carries a single **Undo** that restores it, and
  `duplicateTrip` lands a real card named "(copy)" with dates and travellers cleared —
  a copy is a starting point, not a commitment. Both verbs live in one per-card popover,
  one level deep. A trip someone shared with you offers **Leave this trip** instead of
  Delete. This maps onto `RestoreTrip` and `duplicateTrip` as built; the one thing the
  design asserts beyond the contract is that the undo window is a toast, not a trash view.
- **Dev login.** `dev-login` credentials provider behind `AUTH_DEV_LOGIN`. Probably
  intentionally undesigned.
- **Notebook / Pages** came off this list in the 2026-09-04 pass — the design was rebuilt
  on the build's widget model. What remains is the one open decision ADR-037 names
  (ghosts are editing-only) and the phone's per-widget rebinding, both in §8.

## 5. Closed — one line each

Newly closed this pass, all by shipped code:

- **D1 — the rename is done.** `lib/siteMetadata.ts` has `SITE_NAME = "Caesura"`, the
  layout template is `%s — Caesura`, and `AppHeader.test.tsx` asserts the wordmark. The
  oldest item on this list for three weeks; closed without the design side noticing.
- **D2 / D8 — the front door is a real route group.** `app/(front)/` holds `welcome`,
  `demo`, `s`, `signin` and `signup`, separate from `app/(app)/`. The landing page is no
  longer a conditional inside `page.tsx`, and `/demo` replaced `/s/featured`'s dead end.
- **D4 → superseded by D11.** The first-run screen became a `NewTripWizard`.
- **D9 / §2b — Playbooks is built (M11b, gate closed 2026-08-31).** All four designed
  routes exist: `playbooks/`, `playbooks/day/[savedDayId]`, `playbooks/board`,
  `playbooks/profile/[userId]`. And the build took the design's hard constraints
  literally, which is worth recording:
  - `cities: z.array(z.string())` on a saved day, **derived at save time** from
    `stops[].location.city` by `citiesOfStops`, the same function `citiesOfDay` folds —
    so "a profile's cities cannot disagree with Discover's" is enforced, not hoped for.
  - `GET /api/cities` exists — the endpoint the design asserted.
  - `visibility: "private" | "public"`, kept explicitly separate from moderation state.
  - `adds` is a **counter over an adds ledger** (M11b link 4), and the contract comment
    states the design's rule verbatim: once per trip, only for a dated trip, not your own
    day into your own trip, "a build that counts raw inserts produces a different and
    gameable order". This was the credibility argument in §2b; it survived into the schema.
  - Moderation is deferred on the grounds that the population is invited — **M11a is the
    gate that makes that true**, and M12 adds reviews and moderation on top.

Previously closed, kept as pointers: D5/R6 rename (title *is* the settings button);
D7 sync failure (one banner pattern, `ConflictBanner`'s vocabulary); the 2026-08-25 rules
pass; Calendar as the city/shape view (SPEC §12); mobile folded into the prototype
(answers KI-46 from the design side — **KI-46 itself is still open in the build**, as
"below 1100px the app's desktop layout is not…"); seed data dated Sep 20 – Oct 3 2026;
one handoff folder; DS findings split to `DS-UPSTREAM.md` (U1–U6).

## 5b. Read-only is one mode, two ways in

New 2026-09-12, and the answer to what `/demo` should be. The landing page's "look around
a real trip" and a trip shared with you to read are **the same screen** — one `readOnly`
mode over the ordinary trip surface, not a separate demo route. Only the banner copy
differs (why you are here, and what the one useful next step is: sign up, or ask the owner
for editing).

The rule the design commits to: **nothing renders disabled.** Add stop, the per-day add,
the Keep pennant, Edit in Notebook and the unscheduled drawer are simply absent, so the
page reads as a finished thing rather than a form you lack permission for — the drawer in
particular because a view that cannot drag has no use for it. Mutation entry points are
*also* gated at source, so a keyboard shortcut or a drag that slips past the missing UI
stops with one explanation rather than half-applying.

For the build this lines up with M11a's invite gate: an invited reader and a not-signed-in
visitor get the identical presentation, which is worth preserving — it means the demo is
never a separately-maintained fiction that can drift from the real read-only experience.

## 6. Build-check list

Each one is a bug the design already hit. Carried forward unchanged — **none of these has
been invalidated by the build's progress**, and #2 and #5 were both re-confirmed live in
the design file during the theming pass.

1. **Day labels derive month from start date + day index**, never from the trip start.
2. **Accents are `oklch` and most non-CSS consumers cannot read them.** MapLibre parses
   CSS Color 3 only and silently falls back to black; canvas `fillStyle` and
   `getComputedStyle` both *preserve* `oklch()` verbatim, so they look like a fix and are
   not. Convert arithmetically wherever an accent reaches a map paint property, a chart
   library or an SVG attribute. Hue ramp has a 35° minimum gap.
3. **One `focus` per trip, but derivation is per surface.** The phone must not run the
   timeline's scroll-spy.
4. **The tab is the route.** No independent tab state.
5. **Maps inside conditional markup need a container-identity guard** — remount leaves the
   instance bound to a detached node and the style load aborts silently. Recovery is per
   instance: rebuild at 3.5s and 7.5s, list-only fallback at 11s.
6. **Gesture handlers go on the element, not `document` with `capture: true`.**
7. **Saving a stop must actually move it** (keep duration, snap to 15 min, re-sort the day).

**New, from the build's own blocking list — KI-49.** The Map lens's tiles **have never
been confirmed to paint, in any environment**. A cloud session's egress proxy blocks the
tile host; from a laptop the transport verifies and the pixels still do not (the WebGL
canvas captures blank, and MapLibre fetches data tiles from a worker the main thread
cannot observe). Nothing on the roadmap is blocked by it, but it bounds what a browser
walk may claim about any map surface the design owns. **A blank canvas is not a pass.**

## 7. Their open items that touch design

The KI id scheme changed — older numeric ids (`KI-034`) coexist with dated ones
(`KI-20260912-e`). `docs/known-issues/open/` is the authoritative list.

| KI | Meaning for us |
|---|---|
| **KI-034** | = D6. Blocks the countdown and correct next-trip selection. **Still the top blocker on the home hero.** |
| **KI-046** | Below 1100px the app's desktop layout does not hold. Our phone surface answers the mobile half; this is the *tablet gap* and no design covers it. |
| **KI-048** | Small design-audit cosmetics, still open, including `1 travellers`. Our copy says "4 travelers". |
| **KI-049** | Map tiles never visually confirmed — see §6. |
| **KI-052** | The tag chip row ships four tags. Our designed chip rows assume more; check the two don't contradict before the next tag pass. |
| **KI-20260905-c** | The widget editor is inline with its value — relevant to ADR-037 d6 and our chrome-row design. |
| **KI-20260905-i** | Widget vocabulary and coverage debt — bears on the 21-designed / 7-in-registry catalogue gap. |
| **KI-20260912-e** | `NewTripWizard` retry cannot survive a lost response. Touches D11's screen; rule 6's offline state is the design's answer and should be checked against it. |

**KI-43, KI-44, KI-45 and KI-47 are no longer in `open/`** — the conflict-banner wall, the
undefined `.tc-page-editor`, `Preview size="container"` covering host content, and the
missing `tags` field are all resolved. Four items this document argued for, all won.

## 8. Still open, on our side

- **The billing surfaces are desktop and landing only.** No phone treatment for plan and
  usage or the collaboration gate; the console is deliberately never on the phone. Rule 6's
  two phone states for the plan section are undesigned.
- **The phone Notebook has one hardwired widget** — its stop repeater follows the focused
  day rather than carrying a binding. Deliberate: per-widget rebinding on 390px needs its
  own pass.
- **The phone has no conflict state.** Offline/sync-fail landed; conflict is still missing
  and rule 6 requires all three.
- **No tablet design at all** — KI-046. New on this list.
- **The landing page needs no empty / offline / conflict state.** Rule 6 satisfied
  trivially; noted so it is not re-raised.
- **The phone front door is designed (2026-09-12).** The desktop landing's long scroll and
  rotating hero is the wrong shape at 390px, so the phone gets a **pinned sequence**: the
  map and the headline hold still while four claims pass through underneath, driven by
  scroll position rather than time, then the map clears out and the call to action arrives
  on empty paper. Written to the DOM per scroll event (transform and opacity only, never
  state). Two notes for whoever builds it: the rest state must be authored into the markup
  (first chunk visible, the rest at zero) or a cold load stacks them; and do **not** wrap
  the scroll work in `requestAnimationFrame` — in a throttled or hidden frame the callback
  never runs and the "already scheduled" guard latches forever, silently killing the effect.
- **Day 6's phone Plan cards** still carry pre-seed times and one wrong estimate treatment.
- **Whether a day column sorts by start time** the way the design does. Still unanswered.

## Suggested order

1. **Answer the quota-window question** with Mitchell before M20 opens — the plan-and-usage
   screen is where a wrong answer reaches a customer (§2c).
2. **Resolve D11**: drop the two `unplaced` wizard shells from the design, or get them
   placed. Two orphaned shells is the honest signal that the design asked for something
   nobody owns.
3. **Land KI-034** so the home hero can be honest. Unchanged, and now the oldest.
4. Design the phone **conflict** state — the last of rule 6.
5. ~~Look at KI-046 / tablet~~ — **out of scope, Mitchell 2026-09-12.** No tablet design.

Build status, for planning: **M9 is the current work**, Phase 0 complete, exit gate 0 of 10
ticked (smaller than it looks — three boxes are satisfied by shipped code and deliberately
unticked). Three real pieces remain: grounding (a `SearchPlaces` read tool with `placeRef`
citations), conversation durability, and an eval/replay harness. Nothing in this document
holds it.

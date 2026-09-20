# Design ↔ build drift — Caesura / travel-collab

Design: `Trip Planner Redesign.dc.html` (desktop + phone surfaces, landing, auth, first run),
plus the three Notebook widget components.
Build: `Neablis/travel-collab@main`, read from the attached working tree.

**Resynced 2026-09-19** against the attached working tree. Four milestones closed since the
last read — **M20** (tiers and entitlements), **M22** (a public REST API and scoped tokens,
paused at 18/19), **M25** (a trip is a file) and **M23** (multi-day playbooks) — and the
design side had a surface for none of the first three. This pass designs them: **API
tokens in Account settings**, **Download as a file** on a trip, **Import a file** on Home,
and the mobile remainder those exposed (§3c). M23 was already answered by SPEC §33.

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

## 0b. What moved since 2026-09-12

- **M20 ✓ (2026-09-14)** — tiers, entitlements, the operator console, migrations 0019/0020
  in production. The design's billing surfaces (§2c) are no longer ahead of the seam.
- **M21 OPEN, paused at 11 of 17** — Stripe subscriptions are built and a real purchase and
  downgrade were walked in production; the failure half of the gate is what is left.
- **M22 OPEN, paused at 18 of 19** — **a public REST API and scoped account tokens are
  built.** `api/v1/**` IS the registry (a route is public iff its file lives there), one
  `route()` wrapper does auth, scope, role, parse, envelope, rate limit and the OpenAPI
  entry, and `openapi.json` is derived. Eight scopes, mandatory expiry capped at 365 days,
  SHA-256 at rest, shown once. `api.tokens` is **premium@v2** and is checked at mint AND on
  every request. The one open gate box is a preview walk blocked on `ADMIN_USER_IDS`
  (KI-20260916-d), not on code.
- **M25 ✓ (2026-09-19)** — **a trip downloads as a `content-bundle/v1` file and uploads
  back**, through the same two `v1` endpoints the browser calls with its own cookie.
  Export is **free on every plan** (Mitchell, 2026-09-18) and carries no entitlement; the
  export is a **snapshot, not the event log**, so a re-imported trip starts a fresh undo
  stack.
- **M23 ✓ (2026-09-19)** — a saved day generalises into a saved **sequence** (flat
  `stops[]` with `dayIndex`, stored `day_count`). The design already answered this in
  SPEC §33 on the same day; nothing is owed.
- **M13 (collaboration) is the current milestone as of 2026-09-19**, by M23's gate closing.
  Its preflight — the activity-field descriptor refactor, `KI-20260905-o` — is a gate box.

## 1. Open drift — code and design still disagree

| # | Thing | Code | Design | Call |
|---|---|---|---|---|
| **D3** | Trip status badge | `TripHeader` renders a status `Badge` | No badge | Code wins, or design adds it back. **Not re-verified this pass** — carried forward as stated, flag if it has since changed. |
| **D6** | "Next trip" | **HALF CLOSED 2026-09-20 (M26 link 9d).** The countdown is built: the hero already fetched the whole `TripDetail` for its sparkline, so the date it counts to was always real. `TripSummary` still carries only `createdAt`, so `nextTrip` is still `visibleTrips[0]` | Upcoming-by-date hero + "in 47 days" countdown | **= KI-34, and now precisely scoped.** D6 was two things and only the SELECTION was ever blocked. The countdown says *"12 days ago"* and *"yesterday"* as readily as *"in 47 days"*, deliberately — with nothing to sort by the hero can surface a trip that has already gone, and a countdown that only counted down would print nothing in exactly that case. KI-34's fix path is unchanged: add a start date to `TripSummary`, then date-sort. |
| **D10** | Billing | **Changed shape.** No `plan`, `plan_versions`, `entitlement_grants`, `is_admin`, `subscriptions` or `ai_usage` table — but the **port now exists**: `server/assistant/entitlements.ts` defines `ResolvedEntitlements` (a `has()` set, never a rank), `EntitlementCeilings` and `planVersionRef`; `EVERYONE_IS_ENTITLED` was widened to `permitEverything`, and a `TurnLedger` is already shaped as M20 link 9's `ai_usage` row with model identity and cost as variable inputs | Four surfaces: pricing, operator console, collaboration gate, plan + usage (§2c) | Design is still ahead and still blocked on M20/M21 **tables**, but no longer on the *seam*. The gate the design shows (AI, 402 `ai-not-entitled`) has a real resolver behind it now. Not a defect on either side. |
| **D11** | First-run "roughly when?" | **CLOSED 2026-09-20.** The wizard's four Preview shells are down to one: `wizard-destination-chips` and `wizard-longer-chip` are **built** (decisions D-A / D-B, 2026-09-16 — `Longer: 21` is a real day count), `wizard-pace-tags` is gone, and `wizard-assistant-draft` is M9's remaining half (§30.3's with-access draft; the fork around it shipped in M26 link 9a) | First-run screen offers date-range chips, pace and tags | **Resolved, and the resolution is the opposite of the old note's.** That note said "two of the four shells are honestly orphaned" and asked the design side to drop them or Mitchell to place them; he placed them, they were built, and this row plus §3 and *Suggested order* item 3 all went two passes stale saying otherwise. Nothing is owed on either side. |

| **D12** | Trip-scoped tokens | `api_tokens.trip_ids` is real and `route()` checks a token's set against `[tripId]`, but `TokensSection.tsx` posts `tripIds: null` **always** — the UI can only mint account-wide tokens | The token form offers **All trips / Chosen trips**, with the build's own rule stated where it applies: a trip-scoped token cannot create a trip, because that is a widening (Decision 5) | Design is ahead by one control over a field that already exists. Cheap, and the alternative is a capability nobody can reach. |
| **D13** | Where a trip's lifecycle lives | `SettingsSheet.tsx` carries **Download, Duplicate and Delete** together at the foot of the sheet | Download is in Trip settings; **duplicate and delete stay on the trip card's popover** on Home (SPEC §27) | **Duplication, and the design's call stands** (project rule 4): a trip you are inside is not where you delete it, and two homes for one verb is how they drift. Build should drop the two from the sheet, or say why. |

| **D14** | Where account settings live | `AccountSettingsSheet.tsx` — one sheet holding plan, meters, referrals, identity, preferences and tokens | A route with three tabs (§3d, SPEC §34.4) | Design is ahead by a container. The sections themselves are unchanged, so this is a move rather than a rewrite. |

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

**RESYNCED 2026-09-20 (M26 link 9). This section said 11; the registry holds SIX**, and the
difference is not drift in one direction — it is four separate decisions, each recorded in
`preview-registry.ts` beside the entry it removed.

**All six are blocked on something outside the UI**, which is the opposite of what this
section used to say. Its closing line named `wizard-longer-chip` as "the only entry here
that is purely unbuilt UI — no field blocks it, so any milestone could take it"; that shell
is gone because the feature **shipped** (decision D-B, 2026-09-16, and `Longer: 21` is a
real day count). There is no purely-unbuilt-UI shell left.

**Blocked on a missing contract field — four:**
- `rack-provenance` → **M13** (who parked a stop, which day it came from)
- `add-stop-who` → **M13** (per-stop attribution — the same absence from the other side)
- `budget-breakdown` → **M19** (no field classifies a cost)
- `map-legend-modes` → **`unplaced`** (transport mode per leg; in TODO.md's candidate ideas)

**Blocked on a feature, not a field — two, both M9's:**
- `add-stop-suggestions` → grounded place search; nothing generates matches yet.
- `wizard-assistant-draft` → **narrower than it was.** M26 link 9a built §30.3's fork, so
  this is no longer "the entitlement fork and the draft it generates — neither exists". The
  fork is real and splits on `ai.ask`; a free account gets a finished answer, not this
  shell. What remains shelled is the assistant's own draft, mid-task, for an account that
  holds the capability.

**The five that left this list since it was written, and why:**
- `timeline-ghost` and `cost-estimate-state` — **the surface was deleted.** SPEC §24 removes
  the Timeline lens rather than hiding it, and it was the only host either shell had.
  Removed rather than re-pointed at Plan, on the registry's own rule that a tag is a claim:
  nothing in the design places a proposal ghost or an estimate flag on a day card, and
  moving a shell to a screen the design has not drawn it on invents the placement. M9 and
  M19 keep the work; they lose the shells.
- `wizard-destination-chips` and `wizard-longer-chip` — **built** (decisions D-A and D-B,
  2026-09-16). This section and **D11 both still describe them as "honestly orphaned"**,
  which is now two passes stale.
- `wizard-pace-tags` — gone with them.

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

**Loading and not-yet-data (2026-09-12).** Four surfaces — account home, the trip's
Overview, the Map lens and the Notebook — now paint their own shape before any data
arrives and fill in **region by region**, each swapping the moment its own request lands.
Placeholders are hairline outlines only, never invented values, with one slow breathe
(`prefers-reduced-motion` off). Three rules the build should take literally: a page's
chrome and its primary actions are real from the first frame and never placeholdered;
a failed region is a retry **in place** while every region that did arrive stays on the
page (partial failure, not a dead screen); and an account with nothing in it gets one
empty state per surface, not one per section. `dataState` on the design component
(`live` / `loading` / `empty` / `failed`) drives all four for review.

**BUILT 2026-09-20 (M26 link 7), with five differences that are decisions rather than
omissions.** Everything above is now real on Home, Overview and the Notebook index: a
`Skeleton` primitive (hairline outline, no fill, one 1.8s breathe, `data-sk` stagger),
`SkeletonRegion` (`role="status"` with the region's own name), and `RegionError`
(`role="alert"`, a retry in place, and the sentence saying the rest of the page is still
current). The five places the build does not match the artboard, each with its reason:

1. **`homePb` has no build counterpart at all.** The Playbooks strip the region stands for
   was deleted in M11b. This is a divergence to record, not a region to build — the design
   side should drop `homePb` from `LOAD_PLAN.home` or say what it is now for.
2. **`homeHero` and `homeTrips` resolve TOGETHER**, where the artboard lands them at 320ms
   and 680ms. Both are the one `/api/trips` read here, so they arrive in the same frame.
   Painting both *shapes* is what "a page paints its own shape immediately" asks for;
   making one appear before the other would invent a seam that does not exist, which §3b
   itself names as the thing not to do. Home's real second wave is per-card (each trip's
   `TripDetail`, for the budget line and the hero's sparkline) and already degrades to
   honest absence.
3. **The Map lens gets no rail-then-canvas seam, and this is the "different answer" M26
   link 7 allowed for.** `TripProvider` loads the whole `TripDetail` before the lens
   mounts, so `mapRail` at 360ms and `mapCanvas` at 940ms have nothing to attach to — the
   rail's data is already in hand when the first frame paints. Faking the stagger would be
   inventing a wait. What the lens got instead is the thing it actually lacked: a
   **style-load recovery ladder** (`mapRecovery.ts`) — a rebuild at 3.5s, a second at
   7.5s, the offline panel at 11s — because MapLibre's worst failure emits no `error` at
   all, `map.on("load")` simply never fires, and the reader got a paper rectangle forever
   with nothing said about it.
4. **The Map lens does NOT keep its day rail in the failed or the empty canvas.** The
   artboard keeps it in both, and its failed panel says so out loud ("Your days are still
   listed on the left"). The build hides it, because with no map underneath, a rail row
   highlights a day and moves nothing — a control that appears to do something and does
   not. That call was made for the failed state as `KI-2026-09-20-c` (where the panel was
   also physically covering the rail, leaving Playwright to retry one click 170 times) and
   is now matched in the empty state so the two do not disagree. **Design should either
   accept it or say what a rail over a dead canvas is meant to do.**
5. **Overview's *Edit in Notebook* points at the Notebook INDEX until the page id is
   known.** The artboard's action is `openTripHomeDoc`, resolved when clicked rather than
   when drawn, which is what lets it exist from the first frame; spelled in hrefs that is
   the index first and the page itself after. One click further away and never wrong.

Two things the build got right by accident and has now made deliberate: the templates
gallery on the Notebook index is a module constant, so it is real from the first frame and
survives a failed read — which is why `nbTpl` needs no counterpart, and a test now holds it
outside the branch. And `nbTpl`'s own exemption from the empty state ("an account with
nothing in it still has them") applies here for the same reason.

**§9's "the user picks" and §29's "hidden, not unmounted" — BUILT 2026-09-20 (M26 link
10), with two differences the design side should accept or push back on.**

All three geometries existed and nobody could choose between them; the trip board hardcoded
`docked` and the notebook hardcoded `floating`. There is now one control whose name flips
(`Dock to the side` / `Float it free`, as the artboard draws it), the floating panel drags
by its header, and the position is clamped to §9's 16px pad and re-clamped on resize.

1. **Only the trip board offers the choice.** §9's own table says docked costs *"real — a
   flex sibling, so the plan shrinks instead of hiding"*. A notebook page is not a plan: it
   renders inside a centred measure, and docking there would take 356px off the column that
   IS the reading experience. Mitchell asked for floating there by name (*"it should be on
   the bottom right on desktop, floating till open, and always available in both editing and
   reading mode"*). `PageScreen` therefore offers no Dock at all rather than a half-working
   one. **Design should either accept that the notebook is float-only, or say what a docked
   rail does to a document's measure.**
2. **§29's `visibility: hidden` is delivered by outliving the unmount, not by hiding the
   element.** *"On `plans` the floating dock keeps its place in the tree… unmounting it
   loses the thread, the open/closed state and the dragged position, so coming back from
   Plans would reset it."* There is nothing in that route's tree to hide — `/plans` is an
   account-scope route that renders neither the board nor the trip, so the subtree is
   genuinely gone. The RESULT is delivered instead: the thread already survived
   (`useAskThread`'s `persistAs`), the shape survives, and the position now survives.

   **The open/closed state deliberately does not, and that is the one shortfall.**
   `TripBoardScreen`'s own note is the reason: the presentation is chosen with
   `useIsPhone()`, which is `false` on the server and the first client paint, and the flash
   that would cause is unreachable only because the open flag is *"`useState(false)`, with
   no restore from storage, no URL parameter and no server prop, so `assistant.open` is
   false on EVERY first paint."* Restoring it would paint a 356px docked rail on a phone for
   a frame — reintroducing a defect that file guards by construction, to save a reader one
   click. **Traded openly rather than quietly: if the open state matters more than the
   flash, the fix is a layout-level mount, which is a bigger change than §29 implies.**

## 3c. Designed 2026-09-19 — the three new features, and the mobile remainder they exposed

**API tokens (M22).** In **Account settings**, not a route and not anywhere trip-scoped:
minting is session-only in the build, and a token is a thing you hold. The screen carries
the three obligations mandatory expiry forces — **time remaining, never a creation date**;
**expired reads differently from revoked** (a schedule versus a decision); and **rotation
stated as two acts**, mint then revoke, because it is not a feature. The secret is a
one-time reveal in a selectable field with a Copy that can honestly fail. `free` and
`plus` see the section **locked, not hidden** — hiding it answers "this product has no
API", which is false. Eight scopes, each with the sentence `SCOPE_CATALOGUE` already
makes mandatory; lifetime is **30 / 90 / a year** rather than a raw day field, and the
ceiling is stated rather than enforced silently.

**Download a trip (M25 link 2).** In Trip settings under *Take it with you*, a navigation
rather than a button, free on every plan, and it says what the file is and what it does
**not** carry (history does not travel).

**Import a trip (M25 link 3).** On Home beside New trip, and in the empty state, where the
sentence about what a file is belongs. A refusal is the server's own words in a banner and
nothing on the page changes — the new `importOutcome` prop shows that state for review.

**The mobile remainder, which is the answer to "what did we forget".**

- **The phone had no account surface at all.** The avatar in the phone header was a
  decoration: plan, usage, preferences and now tokens were desktop-only, so the one place
  you see what you are paying for could not be reached from the surface most people open.
  It is now a screen — a task, so it takes the whole frame and the tab bar steps aside,
  the same shape as the new-trip conversation.
- **Plans was a desktop route with no phone treatment**, so every CTA that points at it —
  Change plan, the invite gate, and now the token gate — landed a phone user on a blank
  screen. Same three cards, same confirm step, same Stripe hand-off, one column.
- **Download is on the phone's Trip settings**, and **Import is on the phone's trips
  list**. A file is not a desktop idea.
- Still open on the phone, and listed in §8: the operator console (deliberately never),
  and the conflict state.

### 3d. Account became a page — 2026-09-19

Its styling rules are SPEC §34.5 and they are the part a build should copy rather than
re-derive: panels on a 580px measure inside labelled cards, a 170px label column, controls
sized to their content, and **a list of like things rendered as a table** (the token list)
rather than a stack of per-row cards.

The design's Account settings is no longer a `Sheet`: it is the route `/account` with
**Profile · Plan & usage · API tokens** (SPEC §34.4). The build still renders
`AccountSettingsSheet` with `PlanSection` and `TokensSection` inside it — **D14**, and
the cheapest kind: the two sections move unchanged into a route, and Plans' back link
points at the tab instead of re-opening a sheet. Inviting stays trip-scoped, which the
build already has right.

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
| **KI-2026-09-19-a** | `API_TOKEN_PEPPER` ships empty in `.env.local`, so ~91 token tests fail in a fresh container. Ours only in that it is why a token walk may look broken when it is not. |
| **KI-20260916-d** | M22's last gate box: `POST /api/admin/grants` answers 404 on a preview, so no preview account can hold `api.tokens` — the token surface cannot be walked there yet. Hypothesis is the **value** of `ADMIN_USER_IDS`, not its absence. |
| **KI-052** | The tag chip row ships four tags. Our designed chip rows assume more; check the two don't contradict before the next tag pass. |
| **KI-20260905-c** | The widget editor is inline with its value — relevant to ADR-037 d6 and our chrome-row design. |
| **KI-20260905-i** | Widget vocabulary and coverage debt — bears on the 21-designed / 7-in-registry catalogue gap. |
| **KI-20260912-e** | `NewTripWizard` retry cannot survive a lost response. Touches D11's screen; rule 6's offline state is the design's answer and should be checked against it. |

**KI-43, KI-44, KI-45 and KI-47 are no longer in `open/`** — the conflict-banner wall, the
undefined `.tc-page-editor`, `Preview size="container"` covering host content, and the
missing `tags` field are all resolved. Four items this document argued for, all won.

## 8. Still open, on our side

- ~~**The billing surfaces are desktop and landing only.**~~ **Closed 2026-09-19** — the
  phone has an account screen (plan, usage, preferences, tokens) and a Plans screen with
  the confirm step. The console is still deliberately never on the phone. What remains
  undesigned is rule 6's two phone states **for the plan section itself** (offline, and a
  failed read of the plan).
- **The phone's token surface has no loading or failed region — DESIGN-OWED, not
  build-owed.** The desktop sections got the 2026-09-12 region-by-region treatment and M26
  link 7 BUILT it (`Skeleton`, `SkeletonRegion`, `RegionError`, all three rules of §3b).
  The primitives are there and a token section can mount them in an afternoon. What is
  missing is the design: §3b's `LOAD_PLAN` names nine regions across five surfaces and none
  of them is the phone's tokens or its plan. **Draw them and the build is short.**
- ~~**The phone Notebook has one hardwired widget.**~~ **Struck 2026-09-20 — this bullet
  was dated by its own §19.** §19 (2026-09-03) gave the phone Notebook the full widget
  model, and DRIFT §3b's own entry on it already says *"this bullet is kept because it
  dated the gap"*. Keeping it on "still open" made a closed gap look live for two passes.
  The real remainder is narrower and is stated where it belongs: per-widget REBINDING at
  390px, which is a design question nobody has drawn.
- **The phone has no conflict state — DESIGN-OWED.** Offline/sync-fail landed (M26 link 7
  gave the map a recovery ladder and every desktop region a retry in place); conflict is
  the last of rule 6 and the only one of the three the design has never drawn. The desktop
  reuses `ConflictBanner`; the phone equivalent is undecided, and §13's own "still open"
  list says so. **This is the wave's one genuine design debt.**
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
- ~~**A phone renders the desktop day-column board.**~~ **Closed 2026-09-20 (M26 link
  13).** Never on this list by name, and it should have been: `DAY_COLUMN_WIDTH_PX` was a
  fixed 268px at every width, so a 390px phone showed one and a bit day columns side by
  side and a stop card measured 241px with 141px of text in it. Plan now holds one day at
  a time at full width, which is what §13.4 said all along — the text column measures
  **215px of a 315px card**, against KI-046's 82px-of-364px. The design owes nothing here;
  the build was not reading its own §13.
- **Whether a day column sorts by start time** the way the design does. Still unanswered.

## Suggested order

1. ~~**Settle D12 and D13**~~ — **both closed by M26** (link 1c gave the token form its
   All trips / Chosen trips control; links 6a and 6b moved Delete and Duplicate to the trip
   card's popover and gave a shared trip *Leave this trip*).
2. **Answer the quota-window question** with Mitchell before M20 opens — the plan-and-usage
   screen is where a wrong answer reaches a customer (§2c).
3. ~~**Resolve D11**~~ — **resolved 2026-09-16 and this line went stale for two passes.**
   Mitchell placed the two shells rather than dropping them; both are built. See D11.
4. **Land KI-034** so the home hero can pick the right trip. Unchanged, and now the oldest —
   **but narrower than it was.** D6 is two things, and M26 link 9d shipped the half that was
   never blocked: the hero already fetches the whole `TripDetail`, so the *"in 47 days"*
   countdown is real now (and says *"12 days ago"* just as readily, which the selection bug
   makes likely rather than theoretical). What KI-034 still blocks is WHICH trip the hero
   picks — `nextTrip` is `visibleTrips[0]`, with nothing to sort by.
5. Design the phone **conflict** state — the last of rule 6.
6. ~~Look at KI-046 / tablet~~ — **out of scope, Mitchell 2026-09-12.** No tablet design.

Build status, for planning: **M9 is the current work**, Phase 0 complete, exit gate 0 of 10
ticked (smaller than it looks — three boxes are satisfied by shipped code and deliberately
unticked). Three real pieces remain: grounding (a `SearchPlaces` read tool with `placeRef`
citations), conversation durability, and an eval/replay harness. Nothing in this document
holds it.

# Design ↔ build drift — Caesura / travel-collab

Design: `Trip Planner Redesign.dc.html` (desktop + phone surfaces, landing, auth, first run),
plus the three Notebook widget components.
Build: `Neablis/travel-collab@main`, read from the attached working tree.

**Resynced 2026-09-25** against `main` at `7892bed` — the first sync with a commit sha. Six
milestones closed or merged since 2026-09-19: **M13** (collaboration), **M26** (design parity),
**M27** (the simplify pass — built from our §35), **M12** (reviews, moderation, country search),
**M14** (the rich layer, merged at 17 of 22) and **M24** (travel legs, 9 of 11 on an unmerged
stack). The build drew four things the design never had; this pass draws them (§3e) and closes
three §1 items the build fixed (D12, D13, D14).

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

## 0c. What moved since 2026-09-19

- **M26 ✓** — the build caught up with the handoff. Account is a route (`app/(app)/account`),
  Duplicate/Delete left `SettingsSheet`, trip-scoped tokens can be minted. **D12, D13, D14 closed.**
- **M27 ✓ (2026-09-23)** — our SPEC §35, built. Its file records thirteen calls where code and
  design disagreed (D1–D13 in `M27-simplify-pass.md`); the ones that bind us are **D2** (*Open trip*,
  not *Open plan*), **D8** (Discover intro — M12 has since put ratings back) and **D9–D11** (invite
  landing: no `expired`, revoked names nobody, no invite note).
- **M13 ✓ (2026-09-22)** — co-travellers' edits arrive by a 5 s cursor poll (ADR-049); two
  people editing one stop become a **conflict with two resolutions**, not a modal; stops carry
  **`bookedBy`** and **`participants`** — two relations, not one `who`.
- **M12 ✓ (2026-09-23)** — reviews are real (`saved_day_reviews`, 140-char note), all four sorts
  and the rating floor ship, **Report** exists for a day and a review, and search returns
  **cities and countries, labelled**.
- **M14 merged 2026-09-24 at 17 of 22** — seven new widgets (weather on MET Norway + NASA POWER),
  **save a notebook as a template**, one repeater (*A sentence for each…*), ghosts in Editing only,
  person widgets removed, calendar sync dropped.
- **M24 is current, 9 of 11** — `mode` (seven values, ADR-053) and `endLocation` on a transit stop,
  legs drawn on the map, `map-legend-modes` deleted. The Preview registry is down to **3** entries.

## 1. Open drift — code and design still disagree

| # | Thing | Code | Design | Call |
|---|---|---|---|---|
| **D3** | Trip status badge | `TripHeader` renders a status `Badge` | No badge | Code wins, or design adds it back. **Not re-verified this pass** — carried forward as stated, flag if it has since changed. |
| **D6** | "Next trip" | `TripSummary` still carries only `createdAt`; `nextTrip` is `visibleTrips[0]` | Upcoming-by-date hero + "in 47 days" countdown | **= KI-34, still open and unchanged.** The only survivor of the original list. With nothing to sort by the hero can surface the *wrong trip*. KI-34 names the fix path: add a start date to `TripSummary`, then date-sort. |
| **D10** | Billing | **Changed shape.** No `plan`, `plan_versions`, `entitlement_grants`, `is_admin`, `subscriptions` or `ai_usage` table — but the **port now exists**: `server/assistant/entitlements.ts` defines `ResolvedEntitlements` (a `has()` set, never a rank), `EntitlementCeilings` and `planVersionRef`; `EVERYONE_IS_ENTITLED` was widened to `permitEverything`, and a `TurnLedger` is already shaped as M20 link 9's `ai_usage` row with model identity and cost as variable inputs | Four surfaces: pricing, operator console, collaboration gate, plan + usage (§2c) | Design is still ahead and still blocked on M20/M21 **tables**, but no longer on the *seam*. The gate the design shows (AI, 402 `ai-not-entitled`) has a real resolver behind it now. Not a defect on either side. |
| **D11** | First-run "roughly when?" | **New.** A `NewTripWizard` exists, with four Preview shells: `wizard-destination-chips` and `wizard-longer-chip` (both tagged **`unplaced`** — no milestone will wire them), `wizard-pace-tags` and `wizard-assistant-draft` (M9) | First-run screen offers date-range chips, pace and tags | **Supersedes the old D4.** The contract question moved: it is no longer "add a field to `CreateTrip`" but "does any milestone own the wizard's chips at all". Two of the four shells are honestly orphaned. Design should either drop the destination chips and the longer-chip, or Mitchell places them. |



| **D15** | Insert picker previews | Open gate box in M14: should each row show a *real resolved* preview or ADR-037's fixed sample? | **Fixed sample.** The rail's previews stay generic on purpose (design file, `resolveW` comment) — the rail and the page can then never disagree, and a row does not depend on which trip is open | **Design answers the build's open box.** Also: SPEC §18/§19's two-step sheet is superseded by the one-step picker the build ships — convergent, recorded in §36.5 |
| **D16** | Repeaters | One widget, *A sentence for each…*, with the collection (day / stop / city) as an input and a template string with tokens (Mitchell, PR #221) | Four widgets: *A line for every day / city / stop / booking* | **Build is right** — a direct instruction. Design owes the consolidation; **not redrawn this pass** |
| **D17** | Know before you go | Emergency numbers carry no service label; 57 of 244 countries have none (KI-2026-09-24-n) | Every number labelled — *Police 110*, *Fire and ambulance 119* | Design wins. An unlabelled number is worse than none |
| **D18** | Concurrent-edit conflict | In `ConflictBanner`, with the other conflicts | **On the stop's own card**, same two resolutions (*Keep yours* / *Keep Mei's*) | Same data, different place. The card is where the edit was made; the banner is a list of things to go and find. Build call — flag if the banner is deliberate |

| **D19** | Kind | Five values — `planned · idea · hold · booked · transit`; the editor asks for a start **and** a *Going to* place for travel | Three — **Planned · Pending · Transit**, with Pending's reason and Transit's mode as one second row; booked is a fact; transit's two ends are **implied** from its neighbours | **Proposal, maps onto today's enum with no migration** (SPEC §36.9). Collapsing the enum is the build's call; the implied ends are the part that removes typing |

D1, D2, D4, D5, D7, D8, D9, D12, D13 and D14 are closed — §5.

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
- `cost-estimate-state`, `budget-breakdown` → **M19** (minted 2026-08-31 for exactly these).
  **Both gone since**: `cost-estimate-state` with SPEC §24's timeline, and `budget-breakdown`
  on 2026-09-26, rebuilt as the notebook widget "Spend by kind" (`cost.breakdown`) on M28's kinds, beside
  "Spend by tag" on the same primitive.
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

### 3e. Designed 2026-09-25 — what the build drew first

All in the design file; SPEC §36 has the rules.

- **Travel legs (M24).** A stop tagged *Travel* grows **By** (the seven ADR-053 modes) and
  **To** in Add/Edit a stop. The Plan card's badge names the mode (*By train*, *Ferry*). The
  shared-day map legend names the day's real modes instead of *By train or taxi*.
- **Kind, three values (proposal).** Planned · Pending (needs booking / if there's time) · Transit
  (seven modes); booked is a fact, not a kind. Solid / dashed / dotted everywhere — cards, pins,
  lines. **Implied transit**: a day whose start city differs, with no travel on it, draws a dotted
  *Moving* leg and asks only *how* (SPEC §36.9–§36.10). Answers KI-2026-08-30-g.
- **Time format (build, `ProfileSection.tsx`).** Account → Display gains **Time: 12-hour (2:30 pm) · 24-hour (14:30)**, the build's own copy; every clock time in the prototype follows it.
- **Booked by (M13 link 5).** One select beside *Who is in* — who booked it is not who is going.
- **Concurrent edit (M13 link 4).** Tweak `coEditConflict`: *Mei moved this to 3:30 pm while your
  change was still sending* on the Nijō Castle card, *Keep yours* / *Keep Mei's*. Not dismissible.
- **Seven widgets (M14 link 11)** in the insert rail: Trip strip, Still to book, Spend by day,
  Weather, Sunrise and sunset, Time difference from home, Know before you go. Weather always says
  which number it is (*Forecast* / *Typical for Oct*), credits its sources with an as-of time,
  and goes quiet under `showSyncError`. The two person widgets are **gone**, per M14 decision 5.
- **Save as a template (M14 link 10)** — a ghost button beside *Edit* on a page in Reading; the
  saved page joins the Notebook's template cards as *Your template*.
- **Report (M12 link 6)** — *Report* on others' reviews, *Report this day* under the shared
  day's CTAs, one dialog with the build's five reasons and an optional note.
- **Place search (M12 link 7)** — every result row is tagged *City* or *Country*; a country
  filters to every day in it.

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

**New since 2026-09-19** — each bounds what a design screen may promise:

- **KI-2026-09-24-i** — the phone trip header takes a third of the screen. The design's phone
  header (SPEC §10, §35.3) is the answer; point the fixer at it.
- **KI-2026-09-25-f** — the phone Overview is the desktop notebook in a card. SPEC §19 draws a
  phone notebook; same answer.
- **KI-2026-09-24-o** — weather sends rounded stop locations to two outside services and **no
  privacy page says so**. The design has no privacy page either. Owed by both.
- **KI-2026-09-24-p** — cost totals add across currencies. Spend by day in the design is
  single-currency; it must not be read as permission to sum mixed ones.
- **KI-2026-09-22-d** — an open notebook editor does not show a co-traveller's edit, deliberately.
  The design does not claim it does.


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
- **The phone's token surface has no loading or failed region.** The desktop sections got
  the 2026-09-12 region-by-region treatment; this one was written live-only and owes the
  same two states.
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

1. **Settle D12 and D13** — one control the build already has the field for, and one
   duplicated verb. Both are small and both get worse once somebody builds around them.
2. **Answer the quota-window question** with Mitchell before M20 opens — the plan-and-usage
   screen is where a wrong answer reaches a customer (§2c).
3. **Resolve D11**: drop the two `unplaced` wizard shells from the design, or get them
   placed. Two orphaned shells is the honest signal that the design asked for something
   nobody owns.
4. **Land KI-034** so the home hero can be honest. Unchanged, and now the oldest.
5. Design the phone **conflict** state — the last of rule 6.
6. ~~Look at KI-046 / tablet~~ — **out of scope, Mitchell 2026-09-12.** No tablet design.

Build status, for planning: **M9 is the current work**, Phase 0 complete, exit gate 0 of 10
ticked (smaller than it looks — three boxes are satisfied by shipped code and deliberately
unticked). Three real pieces remain: grounding (a `SearchPlaces` read tool with `placeRef`
citations), conversation durability, and an eval/replay harness. Nothing in this document
holds it.

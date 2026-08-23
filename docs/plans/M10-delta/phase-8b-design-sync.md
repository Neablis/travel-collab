# Phase 8b — the 2026-08-23 design sync's M10-scoped items

> **STATUS: STAGED, NOT APPROVED. Do not execute.**
>
> `docs/milestones/README.md` is explicit that a gate definition changes only by
> Mitchell's decision, recorded. `AGENTS.md` lists "scope creep past the current
> milestone's gate definition" as a drift signal to surface rather than absorb.
> These five tasks are the design sync's only items that belong inside M10's
> stated theme — a coherent restyle of Home/Trip-plan against the handoff — and
> they are staged here so the decision is a yes/no on a written scope rather than
> on a description. **Everything else from the sync is routed to M11, M14, M15 or
> its own step** — see `docs/design-feedback/2026-08-23-design-sync-review.md` §6.
>
> If approved: execute **after Phase 8**, before Phase 9's gate. Phase 9's exit
> checklist then covers these five too.
> If declined: they move to M15 Front door (8b.1, 8b.2) and a post-M10 polish
> pass (8b.3, 8b.4, 8b.5). Nothing here blocks Phase 9 as it stands.

Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first. Its Global
Constraints apply verbatim — in particular **no new contract fields, no new
commands, no new domain rules**, and no UI module may import `@tc/domain`.

**Design source of truth (changed 2026-08-23):**
`.design-sync/handoff/design/Trip Planner Redesign.dc.html`, in-repo. The
`~/Downloads/design_handoff_update/` path the index and older phase files name
is dead — it does not exist in any session. Companion spec:
`.design-sync/handoff/SPEC.md`.

Every literal value these tasks need is inlined below with its source line.

---

## Task 8b.1: The product is called Caesura

`DRIFT.md` D1, decided 2026-08-22. Two strings and their tests. The redesign
should not ship under the placeholder name.

**Current:** `AppHeader.tsx:19` renders `Trip Planner`;
`apps/web/src/app/layout.tsx:13` is `export const metadata = { title: "travel-collab" };`.

**Design (`…dc.html:79`):** the wordmark reads `Caesura`, same `◎` glyph, same
`font-display` treatment. The DC's own landing and auth screens use it too.

**Files:** `apps/web/src/components/AppHeader.tsx`, `apps/web/src/app/layout.tsx`,
`apps/web/src/components/AppHeader.test.tsx`, plus any e2e spec asserting the
old name.

- [ ] **Step 1** — `grep -rn "Trip Planner\|travel-collab" apps/web/src apps/web/e2e` and read every hit before changing anything. Package names, the workspace name and doc references stay `travel-collab`; only user-visible product copy changes.
- [ ] **Step 2** — write the failing test:

```tsx
it("wordmarks the product as Caesura", () => {
  render(<AppHeader />);
  expect(screen.getByText("Caesura")).toBeTruthy();
});
```

- [ ] **Step 3** — change the two strings, update the tests and any e2e selector.
- [ ] **Step 4** — `pnpm typecheck && pnpm lint && pnpm --filter web test`, then the e2e suite per KI-27 (production build, `CI=true`). Commit: `feat(web): the product is called Caesura`.

**Do not** rename the repo, the pnpm workspace, the packages, or the deployment.

---

## Task 8b.2: Sign out — a real capability gap

Today nothing in `apps/web/src` calls `signOut`, which `server/auth.ts` already
exports. There is no way to sign out of the deployed app. That is a capability
gap, not polish, which is why it is in this phase and not M15.

**Design (`…dc.html:94-103`, `3091-3095`):** a 30px round avatar button at the
header's right edge — `aria-label="Account menu"`, `title` = the user's name,
`bg-moss`, `border-hairline`, initials in 12px semibold slate — opening a
`Popover` with `align="end"` and `contentClassName="w-56 p-1"`. Inside: the
user's name (13px semibold ink) over their email (mono, 11.5px, slate) above a
hairline, then **Your account** and **Sign out**.

**Scope decision:** ship **Sign out** only. The DC's own handler for the other
item is `openAccount: () => this.flash('Account settings aren't built yet')` —
we do not ship a button that apologises. Either omit it, or wrap it in
`<Preview>` with a new registry id `account-settings` at **M15**. Prefer
omitting it until M15 exists.

**Keeping `AppHeader` a server component.** `AppHeader.tsx:3-7` records that it
is deliberately a server component so it does not force `layout.tsx` client-side.
Preserve that: `AppHeader` stays a server component, calls `auth()` for the
session, and renders a small **client island** (`AccountMenu.tsx`) with the name,
email and initials passed as props. The island owns the Popover's `open` state.

This is *not* the scope-aware header of `SPEC.md` §1 (Share / Quick add inside a
trip) — that reverses a recorded Phase 1 decision and is explicitly out of scope
here. See the review's §4.1.

**`SPEC.md` §5, and this is not hypothetical:** the `Popover`'s `trigger` must
keep a **stable element identity across renders**. A fresh React element every
render makes Radix re-render in a loop and hard-locks the main thread — it
happened in the design file. Hoist the trigger or memoise it.

**Files:** create `apps/web/src/components/AccountMenu.tsx` + test; modify
`AppHeader.tsx` and `AppHeader.test.tsx`.

- [ ] **Step 1** — failing tests:

```tsx
it("shows the signed-in identity behind the avatar", async () => {
  render(<AccountMenu name="Sam K" email="sam@example.com" />);
  await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
  expect(screen.getByText("sam@example.com")).toBeTruthy();
});

it("signs out", async () => {
  const onSignOut = vi.fn();
  render(<AccountMenu name="Sam K" email="sam@example.com" onSignOut={onSignOut} />);
  await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(onSignOut).toHaveBeenCalled();
});
```

- [ ] **Step 2** — run, confirm they fail.
- [ ] **Step 3** — implement. Sign out goes through NextAuth's `signOut` (a server action, or `next-auth/react`'s client `signOut` — whichever matches how the app already dispatches auth), landing on `/`.
- [ ] **Step 4** — verify in a browser that signing out actually ends the session; commit `feat(web): account menu with a working sign out`.

---

## Task 8b.3: Save state is three states, not two strings

`SPEC.md` §2 replaces the text indicator. `SyncIndicator.tsx` currently renders
`DataText` reading `Saving…` or `All changes saved`.

**Design (`…dc.html:310-320`, `3106-3109`, keyframes at `:18`):**

| state | dot | label |
|---|---|---|
| saved | 11px, `--color-success-ink` | none visible |
| saving | 11px `--color-brand`, plus **two** 12px haloes, `om-save-pulse 1.4s ease-out infinite`, the second at `animation-delay: 0.7s` | `Saving…`, mono 12px 500, in `--color-brand` |
| error | 11px, `--color-danger` | `Couldn't save — retrying`, same mono treatment, in `--color-danger` |

```css
@keyframes om-save-pulse {
  0%   { transform: scale(0.5); opacity: 0.7; }
  75%  { transform: scale(2.1); opacity: 0; }
  100% { transform: scale(2.1); opacity: 0; }
}
```

The whole indicator is a 22px square `role="status"` with `title` and
`aria-label` set to the state's label — including the saved state, whose
accessible name stays **`All changes saved`** even though nothing is drawn.
Do not lose that: it is the only thing a screen reader gets for "saved".

**Two notes:**

- `SPEC.md` §2 claims `--color-success` "does not exist". It does —
  `globals.css:31`. The design's own choice of `--color-success-ink` for the dot
  is fine; use it. Just do not take the claim as a rule about the token set.
- Honour `prefers-reduced-motion`: drop the haloes and keep the label.

**Files:** `apps/web/src/components/trip/SyncIndicator.tsx` + a new test,
`apps/web/src/app/globals.css` (the keyframes).

**Contract note:** `SyncIndicator` takes `pending: boolean | number` today — two
states. A third requires the caller to distinguish a failing queue from a busy
one. **Check what `TripHeader`'s caller actually has before widening the prop.**
If the send queue cannot report failure yet, ship saved/saving faithfully and
leave the error state out rather than inventing a signal — say so in the commit.

- [ ] **Step 1** — failing tests for all three states, including the saved state's accessible name.
- [ ] **Step 2** — run, confirm they fail.
- [ ] **Step 3** — implement; keyframes into `globals.css`; run `node scripts/check-color-wall.mjs`.
- [ ] **Step 4** — commit `feat(web): three-state save indicator`.

---

## Task 8b.4: One banner pattern for sync failure

`DRIFT.md` D7 — decided: **reuse `ConflictBanner`'s vocabulary, do not add a
second banner treatment.**

**Design (`…dc.html:107-113`, `3195-3196`, `3138-3145`):** a `Banner`
`variant="danger"` above the main scroll region, full width inside 12px/24px
padding.

Copy, verbatim:

- body — `Your last three changes are saved on this device but haven't reached the trip yet.`
- suffix — the time, in parentheses, mono 12px at 0.8 opacity: `(since 4:12 pm)`
- actions — **Retry now** (semibold) and a **Work offline for now**-style dismiss, both `--color-danger-ink`

The "three" is a real count and the time is a real timestamp; render both from
the queue's actual state, never as literals.

**Same caveat as 8b.3:** if the send queue cannot report a *persistent* failure
distinct from in-flight work, this banner has no honest trigger. In that case
**stop and report it** rather than firing it on the first transient error —
`AGENTS.md`'s "if an invariant blocked you, that is a finding to report, not a
rule to bend" applies to product truth too.

**Files:** `apps/web/src/components/board/ConflictBanner.tsx` (read it first —
match its structure), the trip screen that mounts it, plus tests.

- [ ] **Step 1** — read `ConflictBanner.tsx` and confirm the shared shape before writing anything.
- [ ] **Step 2** — failing test asserting the copy, the `danger` variant, and both actions.
- [ ] **Step 3** — implement, honouring `SPEC.md` §5: `Banner`'s `actions` must keep a **stable element identity across renders** for the same Radix reason as 8b.2.
- [ ] **Step 4** — commit `feat(web): persistent sync-failure banner, reusing the conflict pattern`.

---

## Task 8b.5: The calendar is stacked month blocks, not one padded grid

The largest of the five, and the only one with a visible correctness cost today.

**Current (`apps/web/src/components/lenses/calendarData.ts:46-70`):** one
continuous grid from the **first month's start** to the **last month's end**,
Monday-start, no month headers. A Nov 27 → Dec 10 trip renders about nine weeks,
most of them empty.

**Design (`…dc.html:655-700`, `3030-3066`):** one block per month the trip
touches, stacked with `gap: 26px`, **Sunday-start**, each block trimmed to the
weeks that actually matter.

The rule, exactly:

1. `gridStart` = trip start, walked back to that week's **Sunday**.
   `gridEnd` = trip end, walked forward to that week's **Saturday**.
2. For each month from the trip's first to its last: the window is that month
   clipped to `[gridStart, gridEnd]`. Leading blanks pad to the window's first
   weekday; trailing blanks pad to a multiple of 7.
3. Header: `label` = `November 2026` (`font-display`, 17px, 600).
4. Beside it: `note` = the days that month holds — `Day 8 – Day 14`, or a bare
   `Day 8` when it holds one, or nothing when it holds none (mono, 12px, slate).
5. Weekday heads are `Sun Mon Tue Wed Thu Fri Sat` — **the current
   `WEEKDAY_LABELS` is Monday-start and must flip.**

**What is already right — do not "fix" it.** `calendarData.ts:63-67` matches
days by full ISO date via a `Map`. `SPEC.md` §4 warns about day-of-month
matching scattering a trip's December days onto November; that was the design's
own bug. Ours has never done it. Keep the `Map`.

**Reconcile with Task 8.6 before starting.** 8.6 restyles the cell (inner tinted
button, 116px min height, a `+N more` line). This task restructures the grid
around it. **Do 8.6 first**, then this. Also note 8.6's `+N more` is superseded:
the current design's per-day line reads `3 stops · 9:00 AM – 5:30 PM`, or
`Nothing planned yet` for an empty in-trip day (`…dc.html:3054`). Take the newer
copy and say so in the commit.

**Files:** `apps/web/src/components/lenses/calendarData.ts` +
`calendarData.test.ts` (the month grouping is pure — test it there, not through
the component), `CalendarLens.tsx` + test.

- [ ] **Step 1** — failing tests against the pure function:

```ts
it("groups a trip that crosses a month boundary into two blocks", () => {
  const months = calendarMonths(novemberToDecemberTrip);
  expect(months.map((m) => m.label)).toEqual(["November 2026", "December 2026"]);
});

it("names the days each month holds", () => {
  const months = calendarMonths(novemberToDecemberTrip);
  expect(months[0].note).toBe("Day 1 – Day 4");
});

it("does not render weeks before the trip's first week", () => {
  const months = calendarMonths(novemberToDecemberTrip);
  expect(months[0].cells).toHaveLength(7); // one week, not the whole of November
});
```

Build the fixture with `@tc/factories` (ADR-020) — do not hand-build a
`TripDetail` literal.

- [ ] **Step 2** — run, confirm they fail.
- [ ] **Step 3** — implement. Keep `calendarCells` exported if anything else uses it (`grep -rn calendarCells apps/web/src`); otherwise replace it.
- [ ] **Step 4** — verify a month-crossing trip in a browser; commit `fix(web): calendar renders one trimmed block per month`.

---

## Phase 8b exit checklist

- [ ] The wordmark and the browser tab both read **Caesura**; nothing else was renamed.
- [ ] A signed-in user can sign out from the header, and `AppHeader` is still a server component.
- [ ] "Your account" is either absent or a registered `<Preview>` — never a toast saying it does not exist.
- [ ] The save indicator has three states, the saved state keeps its accessible name, and reduced motion is honoured.
- [ ] Sync failure uses `Banner variant="danger"` with `ConflictBanner`'s vocabulary — or is deliberately not shipped, with the reason recorded, because the queue cannot report persistent failure.
- [ ] The calendar renders one trimmed, headed block per month, Sunday-start, still matching days by full date.
- [ ] Every `Popover` trigger and `Banner` `actions` value added here keeps a stable element identity across renders (`SPEC.md` §5).
- [ ] `pnpm typecheck && pnpm lint`, unit, int and the full e2e suite green against a **production** build with `CI=true` (KI-27).
- [ ] `node scripts/check-color-wall.mjs` clean.
- [ ] `docs/design-feedback/2026-08-23-design-sync-review.md` §6 updated: these five marked done, and any item that turned out not to be shippable moved to its real milestone with the reason.

# Phase 0 — Blockers

> Read `docs/plans/2026-08-14-M10-redesign-delta.md` (the index) first — its
> **Global Constraints** section applies to every task here.

**Goal:** the trip page is usable at every viewport width and no overlay is
covered by the assistant rail.

**Why first:** these are bugs, not design gaps. Everything in later phases is
harder to verify while the page is inert below 1180px.

**Gate for this phase:** at 1280, 1100 and 820px, with the rail both shown and
hidden, every control on the trip page responds and no dialog is obscured.

---

## Background you need

`AssistantRail` is rendered by `TripBoardScreen` as a **fixed-position sibling**
of the page content, not as a layout column. It sets `z-50`. Radix overlays
(`Sheet`, `Dialog`) currently set **no z-index at all**, so they lose to the rail
purely by DOM order. `globals.css` reserves `padding-right: 356px` on
`.trip-board-content` only at `min-width: 1180px`.

Measured on the running branch (2026-08-14):

| what | measurement |
|---|---|
| `elementFromPoint(200, 500)` at 1100px, trip page | `div.assistant-rail-scrim` — not the day column |
| Clicking the "Timeline" tab at 1100px | no effect; view stays on Day columns |
| `[role="dialog"]` (Add stop) at 1280px | x 640 → 1280, `z-index: auto` |
| `aside[aria-label="Assistant"]` at 1280px | x 924 → 1280, `z-index: 50` |

---

## Task 0.1: The assistant scrim must dismiss, not block

Today the scrim is an `aria-hidden` `<div>` with `pointer-events: auto` and no
click handler. In the prototype (`current/…dc.html:546`) it is
`onClick="{{ closeAsst }}"` — dismissing the rail is its entire job.

**Files:**
- Modify: `apps/web/src/components/assistant/AssistantRail.tsx:71-74`
- Test: `apps/web/src/components/assistant/AssistantRail.test.tsx`

**Interfaces:**
- Consumes: `AssistantRail`'s existing `onHide: () => void` prop. No signature change.
- Produces: an accessible control named **"Close the assistant"**. Later tasks
  (0.3) assert on it.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/components/assistant/AssistantRail.test.tsx`. The file
already defines `renderRail(overrides)` at the top — reuse it, do not write a
new render helper.

```tsx
it("dismisses the rail when the scrim is clicked", async () => {
  const onHide = vi.fn();
  renderRail({ onHide });

  await userEvent.click(screen.getByRole("button", { name: "Close the assistant" }));

  expect(onHide).toHaveBeenCalledTimes(1);
});

it("does not leave an inert pointer-blocking layer over the page", () => {
  renderRail();

  const scrim = document.querySelector(".assistant-rail-scrim");
  expect(scrim).not.toBeNull();
  // A blocking layer must be a real control, not an aria-hidden div — otherwise
  // it swallows every click on the page behind it (the 1100px dead-page bug).
  expect(scrim?.tagName).toBe("BUTTON");
  expect(scrim?.getAttribute("aria-hidden")).toBeNull();
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/assistant/AssistantRail.test.tsx -t "scrim"
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Close the assistant"`.

- [ ] **Step 3: Replace the inert div with a real dismiss control**

In `apps/web/src/components/assistant/AssistantRail.tsx`, replace this block:

```tsx
      <div
        aria-hidden
        className="assistant-rail-scrim fixed inset-0 z-40 bg-ink/32"
      />
```

with:

```tsx
      {/* Handoff `current/…dc.html:546`: the scrim's job is to dismiss the rail.
          It was previously an aria-hidden div with pointer-events on and no
          handler, which made it a full-page click sink — below 1180px, where
          globals.css turns it on, every control on the trip page became inert. */}
      <button
        type="button"
        aria-label="Close the assistant"
        onClick={onHide}
        className="assistant-rail-scrim fixed inset-0 z-40 cursor-default bg-ink/32"
      />
```

Leave `globals.css:101-108` exactly as it is — `display: none` by default and
`display: block` under `@media (max-width: 1179px)` is the correct overlay-mode
gate. The bug was never the breakpoint.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/assistant/AssistantRail.test.tsx
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Verify in the browser**

Start the dev server (`pnpm --filter web dev`, port 3001), open any trip, set the
window to 1100px wide, and run in the devtools console:

```js
document.elementFromPoint(200, 500).className
```

Expected: a day column or card class — **not** `assistant-rail-scrim`. Clicking
the dimmed area hides the rail.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/assistant/AssistantRail.tsx apps/web/src/components/assistant/AssistantRail.test.tsx
git commit -m "fix(web): the assistant scrim blocked the trip page instead of dismissing the rail"
```

---

## Task 0.2: Sheets and dialogs must stack above the assistant rail

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/ui/sheet.tsx:29-30`
- Modify: `apps/web/src/components/ui/dialog.tsx:11-12`
- Test: `apps/web/src/components/ui/overlays.test.tsx`

**Interfaces:**
- Produces: a named class `.overlay-layer` in `globals.css`, applied to every
  Radix overlay and content surface. Later phases that add overlays use the same
  class rather than inventing a z-index.

**Why a named class and not `z-60`:** Tailwind's default z-index scale stops at
`z-50`, and `z-[60]` is a **build failure** — `scripts/check-color-wall.mjs:28`
rejects any `className` containing `[`. Named classes in `globals.css` are the
established escape hatch (`.assistant-rail-scrim`, `.trip-board-content`).

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/components/ui/overlays.test.tsx`:

```tsx
it("stacks sheet surfaces above the fixed assistant rail", () => {
  render(
    <Sheet title="Add a stop" open onOpenChange={() => {}}>
      <p>body</p>
    </Sheet>,
  );

  // The rail is a fixed z-50 sibling rendered OUTSIDE the Radix portal, so the
  // portal content must carry its own stacking class or it loses by DOM order.
  expect(screen.getByRole("dialog").className).toContain("overlay-layer");
});

it("stacks dialog surfaces above the fixed assistant rail", () => {
  render(
    <Dialog title="Delete trip" open onOpenChange={() => {}}>
      <p>body</p>
    </Dialog>,
  );

  expect(screen.getByRole("dialog").className).toContain("overlay-layer");
});
```

If `Sheet` / `Dialog` are not already imported at the top of that file, add:

```tsx
import { Sheet } from "./sheet";
import { Dialog } from "./dialog";
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/ui/overlays.test.tsx -t "stacks"
```

Expected: FAIL — `expected '…bg-surface p-5 shadow-overlay' to contain 'overlay-layer'`.

- [ ] **Step 3: Add the named class**

In `apps/web/src/app/globals.css`, inside the same `@layer components` block that
holds `.assistant-rail-scrim` and `.trip-board-content`, add:

```css
  /* Radix portals render outside the React tree that holds the assistant rail
     (a fixed z-50 aside), so overlay surfaces need an explicit layer above it.
     Tailwind's scale stops at z-50 and the color wall bans z-[60], so this is
     a named class. Every dialog/sheet/popover surface uses it. */
  .overlay-layer {
    z-index: 60;
  }
```

- [ ] **Step 4: Apply it in both primitives**

`apps/web/src/components/ui/sheet.tsx` — two lines:

```tsx
        <RadixDialog.Overlay className="overlay-layer fixed inset-0 bg-ink/40" />
        <RadixDialog.Content className="overlay-layer fixed inset-y-0 right-0 flex w-full max-w-measure flex-col gap-3 bg-surface p-5 shadow-overlay">
```

`apps/web/src/components/ui/dialog.tsx` — two lines:

```tsx
        <RadixDialog.Overlay className="overlay-layer fixed inset-0 bg-ink/40" />
        <RadixDialog.Content className="overlay-layer fixed top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-5 shadow-overlay">
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/ui/overlays.test.tsx
node scripts/check-color-wall.mjs
```

Expected: tests PASS; color wall prints `color wall OK (…)`.

- [ ] **Step 6: Verify in the browser**

At 1280px on a trip page, click **Add stop**. The whole sheet — its "Add a stop"
title and its Close button at the top-right — must be visible and clickable over
the rail. Confirm in the console:

```js
const d = document.querySelector('[role="dialog"]');
getComputedStyle(d).zIndex   // "60"
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/ui/sheet.tsx apps/web/src/components/ui/dialog.tsx apps/web/src/components/ui/overlays.test.tsx
git commit -m "fix(web): stack sheets and dialogs above the fixed assistant rail"
```

---

## Task 0.3: The rail defaults to hidden below 1180px

The prototype's `componentDidMount` (`current/…dc.html:1111-1119`) auto-hides the
rail below 1180px unless the user opened it, and restores it above. We render it
open at every width, so below 1180px it covers content that `.trip-board-content`
only reserves space for at `min-width: 1180px`.

**Files:**
- Modify: `apps/web/vitest.setup.ts`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx:39`
- Test: `apps/web/src/components/board/TripBoardScreen.test.tsx`

**Interfaces:**
- Produces: `useAssistantVisibility(): { open: boolean; show: () => void; hide: () => void }`,
  defined and used inside `TripBoardScreen.tsx`. Not exported — no other module
  needs it.

**⚠️ jsdom does not implement `window.matchMedia`.** It appears nowhere in this
repo today. Without Step 1 below, the hook throws
`TypeError: window.matchMedia is not a function` in every test that renders
`TripBoardScreen`, and you will misread that as a bug in your own code.

- [ ] **Step 1: Add a matchMedia polyfill to the shared test setup**

Append to `apps/web/vitest.setup.ts`:

```ts
// jsdom ships no matchMedia. Components that adapt to a breakpoint (the
// assistant rail's 1180px overlay threshold) call it on mount, so without this
// every test rendering them throws. Default: no query matches — i.e. tests run
// at the "narrow" end unless a test overrides it via setViewportMatches below.
const mediaMatches = new Map<string, boolean>();

export function setViewportMatches(matches: Record<string, boolean>): void {
  mediaMatches.clear();
  for (const [query, value] of Object.entries(matches)) mediaMatches.set(query, value);
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: mediaMatches.get(query) ?? false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
```

- [ ] **Step 2: Write the failing tests**

Add to `apps/web/src/components/board/TripBoardScreen.test.tsx`. The file already
defines `renderScreen(tripId)` — reuse it, do not write a new helper. Import the
setup helper:

```tsx
import { setViewportMatches } from "../../../vitest.setup";
```

```tsx
describe("assistant rail visibility", () => {
  it("starts hidden below the 1180px overlay breakpoint", async () => {
    setViewportMatches({ "(min-width: 1180px)": false });
    renderScreen("trip-1");

    await waitFor(() => expect(screen.getByTestId("timeline-lens")).toBeTruthy());
    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
    expect(screen.getByRole("button", { name: /assistant/i })).toBeTruthy();
  });

  it("starts shown at or above the breakpoint", async () => {
    setViewportMatches({ "(min-width: 1180px)": true });
    renderScreen("trip-1");

    await waitFor(() => expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy());
  });

  it("keeps the rail hidden after the user hides it, even at a wide viewport", async () => {
    setViewportMatches({ "(min-width: 1180px)": true });
    renderScreen("trip-1");

    await waitFor(() => expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));

    expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull();
  });
});
```

Reset the viewport between tests so ordering cannot leak — add to the file's
existing `beforeEach`, or add one:

```tsx
beforeEach(() => setViewportMatches({ "(min-width: 1180px)": true }));
```

- [ ] **Step 3: Run them and confirm they fail**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/board/TripBoardScreen.test.tsx -t "assistant rail visibility"
```

Expected: the first test FAILS — the rail renders regardless of width.

- [ ] **Step 4: Implement the hook**

In `apps/web/src/components/board/TripBoardScreen.tsx`, add above the
`TripBoardScreen` function:

```tsx
// Handoff `current/…dc.html:1111-1119`: the rail is an inline column at wide
// widths and an overlay below 1180px, where it starts hidden so it never covers
// the plan. A resize moves it back and forth — but only until the user makes
// their own choice, after which their preference wins at every width.
function useAssistantVisibility() {
  const [open, setOpen] = useState(true);
  const userChose = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1180px)");
    const sync = () => {
      if (!userChose.current) setOpen(mq.matches);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return {
    open,
    show: () => {
      userChose.current = true;
      setOpen(true);
    },
    hide: () => {
      userChose.current = true;
      setOpen(false);
    },
  };
}
```

Add `useEffect` and `useRef` to the existing `import { useState } from "react";`
at line 3.

Replace line 39:

```tsx
  const [assistantOpen, setAssistantOpen] = useState(true);
```

with:

```tsx
  const assistant = useAssistantVisibility();
```

Then update the three usages further down:

- `!assistantOpen && "assistant-hidden"` → `!assistant.open && "assistant-hidden"`
- `{assistantOpen ? (` → `{assistant.open ? (`
- `onHide={() => setAssistantOpen(false)}` → `onHide={assistant.hide}`
- `onClick={() => setAssistantOpen(true)}` → `onClick={assistant.show}`

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
pnpm --filter web vitest run -c vitest.unit.config.ts src/components/board/TripBoardScreen.test.tsx
```

Expected: PASS, whole file. If other tests in the file now fail because the rail
is absent, they were relying on the old always-open behaviour — the `beforeEach`
in Step 2 sets the wide viewport, so they should not. If one still fails, read it
before changing it; do not delete assertions to go green.

- [ ] **Step 6: Verify in the browser**

1. Load a trip at 1100×800 → the rail is hidden, nothing is covered, every
   control responds.
2. Open the rail → the page dims and clicking the dim area closes it (Task 0.1).
3. Widen past 1180px → the rail returns.
4. Hide it manually, then resize both ways → it stays hidden.

- [ ] **Step 7: Run the full phase gate**

```bash
pnpm typecheck && pnpm lint && pnpm --filter web test
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/vitest.setup.ts apps/web/src/components/board/TripBoardScreen.tsx apps/web/src/components/board/TripBoardScreen.test.tsx
git commit -m "fix(web): auto-hide the assistant rail below its overlay breakpoint"
```

---

## Phase 0 exit checklist

- [ ] At 1100px, `document.elementFromPoint(200, 500)` returns page content, not the scrim.
- [ ] Clicking the "Timeline" tab works at 1100px.
- [ ] The Add-stop sheet is fully visible and clickable at 1280px with the rail open.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter web test` and
      `node scripts/check-color-wall.mjs` all pass.
- [ ] Three commits, one per task.

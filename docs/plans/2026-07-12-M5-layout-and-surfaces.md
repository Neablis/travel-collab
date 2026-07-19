# M5 Layout & Surfaces (Wave 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> If anything requires a decision this plan does not cover, STOP and ask Mitchell — do not improvise.

**Goal:** Add the layout & surfaces foundation to M5 — responsive container/breakpoint tokens, two overlay primitives (Sheet, Popover), a URL-backed client-state spine (`TripProvider → EditorHost → LensRouter`), and a scope→surface editing paradigm — then apply it to resolve all 15 PR #11 comments.

**Architecture:** A hierarchy of React contexts (UI layer only) replaces the prop-drilling in `TripBoardScreen`. `TripProvider` wraps the fetched trip read-model + `dispatch` (a server-cache, never a store — the event log stays the source of truth). `EditorHost` renders one portable activity **Sheet** at the tree root, opened via owned state (never a Radix Trigger) so `fireEvent.click` keeps working. `LensRouter` derives view state from the URL search params with no `useState` mirror — unidirectional, URL-as-truth. New surfaces (Settings sheet, History popover, merged Schedule lens, portable editor) are composed from new `components/ui/` primitives. Spec: `docs/specs/2026-07-12-M5-layout-and-surfaces-design.md`. Decisions: **ADR-011** (surfaces model), **ADR-012** (state architecture).

**Tech Stack:** Everything Wave 1 used, plus new **dependencies** in `apps/web`: `@radix-ui/react-popover` (Sheet reuses the already-present `@radix-ui/react-dialog`). No new env var, no DB migration, **no contract change**.

## Global Constraints

- Read `AGENTS.md`, `docs/guidelines/design-system.md`, and the spec before starting. The design-system doc is normative; token names, palette semantics, the surface vocabulary, and the component registry are not yours to reinterpret.
- **UI layer only.** The diff may touch ONLY `apps/web/src` (never `src/server/**` or `src/app/api/**`), `apps/web` config, `apps/web/e2e`, `scripts/`, and `docs/`. `packages/contracts` and `packages/domain` show **zero diff** at PR time. **No `docs/contracts/CHANGELOG.md` entry** — needing one means scope crept; STOP. The portable editor dispatches the existing `AddActivity`/`UpdateActivity` commands unchanged.
- **`TripProvider` is a server-cache + dispatch, never a client store** (ADR-012 / AGENTS.md Invariant 1). Trip state is mutated ONLY by `dispatch(command)` → refetch. Writing into trip context to "optimistically update" is the drift smell — STOP and escalate.
- **View state is URL-as-truth, unidirectional** (ADR-012). `LensRouter` derives its value from `useSearchParams()` every render; **no `useState` mirror**, **no effect syncing state→URL**. `setLens`/`setView` do exactly one thing: `router.replace(..., { scroll: false })`.
- **Overlays are opened by owned state, never a library `*Trigger`** (ADR-012). Sheet/Popover `open` comes from context or local state; the trigger is a plain `<Button onClick={open}>`. This preserves the `fireEvent`-driven unit tests (the documented Track-B1 constraint from comment #11).
- **Wave 2 changes behavior** — unlike Wave 1, behavioral e2e updates ARE expected (Enter-to-search, editor-as-sheet, budget-in-settings, merged Schedule lens). Each behavioral test change is justified in its commit message. Preserve every `data-testid`/`aria-label` on elements that still exist; when an element moves surface (e.g. budget → Settings sheet), keep its `aria-label` byte-identical so tests re-target by role/label, not by DOM path.
- **Enforcement wall stays green.** Raw color literals live only in `globals.css`; new primitives live in `components/ui/`; no Tailwind arbitrary values; no inline `style` outside the enumerated exceptions. Every new primitive is added to the design-system.md inventory in the same task.
- At most **one `variant="primary"` Button per view**. Conflict UI is `warning`, never `danger`. All times/dates/currency render through `DataText`.
- Node ≥ 20, pnpm ≥ 9, commands from repo root. Local Postgres for e2e: `docker compose up -d` (port 5433); dev server 3001. `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test` passes at the end of **every** task; `pnpm check` at integration.
- **Branch:** continue on `m5-design-foundations`. One PR updates/extends PR #11 (or a stacked follow-up PR — Task I3). **Do not merge — Mitchell merges.**
- **Worktree isolation (binding, AGENTS.md):** parallel implementers each run in their own git worktree via `superpowers:using-git-worktrees` and merge back sequentially. Never a shared tree.
- Commit after every task with the exact message given (conventional commits). Co-author footer per repo convention.

## Workstreams & parallel dispatch

**Track F (foundation) lands first, sequentially, in one worktree** — it is the meeting point. After F6, the application tracks own disjoint files and can be dispatched as parallel subagents in separate worktrees, EXCEPT Track P (page shell) which several depend on and so lands right after F, before E/L/O.

| Track | Tasks | Files owned | Depends on |
|---|---|---|---|
| **F — Foundation** | F1 → F2 → F3 → F4 → F5 → F6 | `docs/`, `globals.css`, `components/ui/**`, `components/trip/context/**`, `lib/**` | Task 0 |
| **P — Page shell & header/settings** | P1 → P2 | `TripBoardScreen.tsx`, `components/trip/TripHeader.tsx`, `SettingsSheet.tsx`, `page.tsx`, `trips/[tripId]/page.tsx` | F |
| **E — Portable entity editor** | E1 → E2 | `ActivityEditor.tsx`, `components/trip/editor/**`, trigger sites in `Board`/`Column`/lenses | F, P |
| **L — Lenses & routing** | L1 → L2 | `components/lenses/**` (Schedule merge), lens-switcher region | F, P |
| **C — Field-with-context** | C1 → C2 | `LocationInput.tsx`, `AnchorEditor.tsx`, `TripDateControl.tsx`, `MoneyInput.tsx` | F |
| **O — Overflow / board-at-scale** | O1 | `Board.tsx`, `Column.tsx` | F, P |

Integration (single coordinating session): **I1** (merge + full check + e2e) → **I2** (web-design-guidelines review) → **I3** (verification + PR + two-ADR gate).

```
Task 0 ► F1 docs ► F2 container ► F3 overlays ► F4 controls ► F5 spine ► F6 dates
                                                                            │
                                                                            ▼
                                                                     P1 ► P2 shell
                                                                            │
                                              ┌────────────┬────────────┬───┴────────┐
                                              ▼            ▼            ▼            ▼
                                          E1 ► E2      L1 ► L2      C1 ► C2         O1
                                              └────────────┴────────────┴────────────┘
                                                                            │
                                                                     I1 ► I2 ► I3
```

---

### Task 0: Preflight

- [ ] **Step 1: Verify Wave-1 state.** `git log --oneline -5` shows the Track A/B/C merges and the PR #11 review-fix commits on `m5-design-foundations`. `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test` PASS on the current tip. `scripts/design-wall-pending.json` is `[]` (Wave-1 ratchet closed).
- [ ] **Step 2: Confirm ADR numbering.** `ls docs/architecture/` shows the latest is `ADR-010`. This wave takes **ADR-011** and **ADR-012**; M6's reserved pointer (milestone README line for M6) bumps to **ADR-013** in Task F1. If ADR-011 already exists, STOP and ask Mitchell.
- [ ] **Step 3:** No new preflight commit needed if steps 1–2 are clean. Otherwise report to Mitchell before F1.

---

## Track F — Foundation (sequential, one worktree)

### Task F1: Decision records — ADR-011, ADR-012, milestone amendment

**Files:**
- Create: `docs/architecture/ADR-011-editing-surfaces-model.md`, `docs/architecture/ADR-012-trip-client-state-architecture.md`
- Modify: `docs/milestones/M5-design-foundations.md`, `docs/milestones/README.md`

**Interfaces:** Produces the two authoritative decision records the code tasks reference, and the amended milestone gate.

- [ ] **Step 1: Write ADR-011** (`docs/architecture/ADR-011-editing-surfaces-model.md`), house format (Status/Deciders → Context → Decision → Consequences):

```markdown
# ADR-011: Editing-surfaces model — scope decides surface

**Status:** Accepted — 2026-07-12
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

PR #11's UI feedback (docs/design-feedback/2026-07-12-pr11-vercel-ui-comments.md)
showed the trip screen deciding per-control where editing lives: budget jammed
into permanent header chrome, the activity editor inline in one spot only,
history pushing content down. Adding any new feature meant re-deciding these
placements. We need a paradigm so surfaces are chosen by rule, not per feature.

## Decision

Editing lives in a surface chosen by the **scope** of the thing edited:
trip-global → a **Settings sheet**; identity → a read-only **header**; an
**entity (activity)** → a **portable editor sheet** raised with prefill from any
trigger; structural (day) → **inline** board affordances.

Two binding rules:
1. **R1 — scope decides surface, not screen.** A new global setting goes in the
   Settings sheet; a new activity field goes in the entity editor. No
   per-feature surface decision.
2. **R2 — triggers carry context; the surface is reused.** The editor is raised
   via `openCreate(prefill)` / `openEdit(activityId)`; the prefill payload is
   sourced at the trigger site, not derived from the active lens.

Surface vocabulary (fixed): **Sheet** (roomy forms that keep context: activity
editor, settings) · **Popover** (small anchored controls: history, clear-date,
row menus) · **Dialog** (destructive confirms only).

## Consequences

- New `components/ui/` composites: `Sheet`, `Popover`, `PageContainer`,
  `SegmentedControl`, `TabStrip`; `FormField` gains a mandatory label + a
  `description` slot. All added to the design-system.md inventory.
- The activity editor becomes a raised sheet (behavior change): e2e that drove
  the inline editor updates to open/close the sheet.
- Validation (gated in the M5 Wave-2 exit gate): a new global setting lands in
  Settings and a new activity field in the editor with no surface decision (R1);
  the editor is raised with prefill from ≥2 distinct triggers (R2).
- This is separate from ADR-012 (how the state that drives these surfaces is
  wired). The two are gated independently.
```

- [ ] **Step 2: Write ADR-012** (`docs/architecture/ADR-012-trip-client-state-architecture.md`):

```markdown
# ADR-012: Trip client-state architecture — a context spine, URL-as-truth

**Status:** Accepted — 2026-07-12
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

`TripBoardScreen` prop-drills dispatch, history, preview state, and every
callback through the board. The surfaces model (ADR-011) needs any component to
read trip state and raise the portable editor. We need shared UI state without
turning it into a second source of truth (the event log is Invariant 1) and
without reintroducing the Radix-trigger test breakage documented for the lens
switcher.

## Decision

A hierarchy of UI-layer React contexts: `TripProvider → EditorHost →
LensRouter`. Three binding invariants:

1. **TripProvider is a server-cache + dispatch, never a store.** It wraps the
   fetched `TripDetail`/`TripHistory` + preview state + `dispatch`. Trip state is
   mutated ONLY by `dispatch(command)` → refetch. No direct context writes.
2. **View state is URL-as-truth, unidirectional.** `LensRouter` derives `{ lens,
   view }` from `useSearchParams()` each render — no `useState` mirror, no
   state→URL effect. `setLens`/`setView` call `router.replace(..., { scroll:
   false })` and nothing else. The URL is the log; the context is its projection.
3. **Overlays are opened by owned state, never a library `*Trigger`.** Sheet /
   Popover `open` comes from `EditorHost` or local state; triggers are plain
   `<Button onClick>`. Radix `*Trigger` components respond only to pointer
   events, so `fireEvent.click` would silently fail to open them.

## Consequences

- `components/trip/context/{TripProvider,EditorHost,LensRouter}.tsx` with hooks
  `useTrip()`, `useEditor()`, `useLens()`.
- Deep-linkable tabs + Calendar↔Timeline toggle + refresh-survival fall out of
  invariant 2 for free.
- Validation (gated independently in the Wave-2 exit gate): grep shows no direct
  trip-context writes; `LensRouter` has no `useState`; a test proves
  `fireEvent.click` opens every overlay.
- No contract/domain change; UI layer only.
```

- [ ] **Step 3: Amend the milestone file** `docs/milestones/M5-design-foundations.md`. After the "Kickoff record (2026-07-11)" section, insert a "Wave 2 scope expansion (2026-07-12)" section and a Wave-2 exit gate:

```markdown
## Wave 2 — Layout & surfaces (scope expansion, 2026-07-12)

Wave 1 (PR #11) re-skinned every surface presentationally. Mitchell's 15 Vercel
comments surfaced four missing patterns. Wave 2 **reverses the "responsive out
of scope" exclusion inside M5** (Mitchell's call) and adds: responsive
container/breakpoint tokens, Sheet + Popover primitives, a client-state context
spine (ADR-012), URL-backed view routing, and a scope→surface editing paradigm
(ADR-011). It is desktop-first with mobile-capable tokens; no phone pass.
Spec: `docs/specs/2026-07-12-M5-layout-and-surfaces-design.md` ·
Plan: `docs/plans/2026-07-12-M5-layout-and-surfaces.md`.

Wave 1's "e2e changes are selector-only" rule does **not** apply to Wave 2:
Enter-to-search, editor-as-sheet, budget-in-settings, and the merged Schedule
lens are intentional behavior/structure changes, each justified in its commit.

### Wave 2 exit gate — all must be true

- [ ] Every one of the 15 PR #11 comments is resolved (map in the spec) and
      demoed on the deployed Vercel URL at ≥1024px.
- [ ] **ADR-011 validated:** a new global setting lands in Settings and a new
      activity field in the editor with no per-feature surface decision (R1);
      the editor is raised with prefill from ≥2 triggers (R2).
- [ ] **ADR-012 validated:** grep shows no direct trip-context writes;
      `LensRouter` holds no `useState` mirror; a test proves `fireEvent.click`
      opens every overlay.
- [ ] `docs/guidelines/design-system.md` amended: breakpoints/containers,
      overflow policy, surface vocabulary, field-with-context, date format, and
      the new inventory entries.
- [ ] Enforcement green (color/element/style walls); `pnpm check` passes.
- [ ] All M0–M4 e2e green; Wave-2 behavioral test changes each justified.
- [ ] Still no `docs/contracts/CHANGELOG.md` entry (any contract change means
      scope crept).
- [ ] Wave-2 retro note appended.
```

- [ ] **Step 4: Bump M6's ADR pointer** in `docs/milestones/README.md`. The M6 row currently reads `... ADR-011 due here (ADR-010 was taken by M5's shadcn/ui adoption)`. Change `ADR-011` → `ADR-013` and append `; ADR-011/012 taken by M5 Wave 2 layout & surfaces`.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/ADR-011-editing-surfaces-model.md docs/architecture/ADR-012-trip-client-state-architecture.md docs/milestones/M5-design-foundations.md docs/milestones/README.md
git commit -m "docs(m5): ADR-011 surfaces model + ADR-012 state architecture + wave-2 milestone gate"
```

### Task F2: Responsive tokens + `PageContainer`

**Files:**
- Modify: `apps/web/src/app/globals.css`, `docs/guidelines/design-system.md`
- Create: `apps/web/src/components/ui/page-container.tsx`, `apps/web/src/components/ui/page-container.test.tsx`

**Interfaces:**
- Produces: container-width theme values and `PageContainer({ width?: "content"|"measure"|"full", as?: "div"|"main", className?, children })`. Consumed by P1 (page shell) and L1 (lens widths).

- [ ] **Step 1: Add container tokens to `globals.css`** inside the existing `@theme` block (after the shadow tokens):

```css
  /* Content-width tiers (design-system.md "Breakpoints & containers"). */
  --container-measure: 40rem;   /* 640px — forms, settings sheet, prose */
  --container-content: 70rem;   /* 1120px — default page + non-full lenses */
```

- [ ] **Step 2: Write the failing test** `apps/web/src/components/ui/page-container.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageContainer } from "./page-container";

describe("PageContainer", () => {
  it("centers content and applies the content max-width by default", () => {
    render(<PageContainer data-testid="pc">body</PageContainer>);
    const el = screen.getByTestId("pc");
    expect(el.className).toContain("mx-auto");
    expect(el.className).toContain("max-w-content");
  });

  it("full width applies no max-width", () => {
    render(<PageContainer width="full" data-testid="pc">body</PageContainer>);
    expect(screen.getByTestId("pc").className).not.toContain("max-w-content");
  });

  it("renders as <main> when asked", () => {
    render(<PageContainer as="main" data-testid="pc">body</PageContainer>);
    expect(screen.getByTestId("pc").tagName).toBe("MAIN");
  });
});
```

> Note: Tailwind v4 auto-generates `max-w-*` utilities from the `--container-*` theme namespace, so `--container-content: 70rem` yields a real `max-w-content` utility — no arbitrary value, nothing for the arbitrary-value wall to flag. (Only `--color-*` is wiped in the theme; `--container-*` extends Tailwind's default container scale.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter web test apps/web/src/components/ui/page-container.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement** `apps/web/src/components/ui/page-container.tsx`:

```tsx
import { cn } from "../../lib/cn";

const widths = {
  content: "max-w-content",   // Tailwind v4 generates these from --container-* (globals.css)
  measure: "max-w-measure",
  full: "",
} as const;

export function PageContainer({
  width = "content",
  as: Tag = "div",
  className,
  ...props
}: { width?: keyof typeof widths; as?: "div" | "main" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("mx-auto w-full px-6", widths[width], className)} {...props} />;
}
```

- [ ] **Step 5: Amend design-system.md.** Replace the "Breakpoints" bullet in "Spacing, radii, shadows, breakpoints" with a "Breakpoints & containers" subsection: keep Tailwind's default breakpoint *values* (mobile-capable); state the **minimum supported width is 1024px** (desktop-first, below is best-effort until the mobile milestone); document the `--container-measure`/`--container-content` tiers (which generate `max-w-measure`/`max-w-content`) + `PageContainer` (with `full` for board/map); document the one **board-stack breakpoint (`lg`)**. Add `PageContainer` to the composite inventory.

- [ ] **Step 6: Run wall + tests + commit**

Run: `pnpm --filter web test apps/web/src/components/ui/page-container.test.tsx && pnpm lint && pnpm --filter web typecheck`
Expected: PASS (`pnpm lint` proves the container utilities aren't flagged as arbitrary values).

```bash
git add apps/web/src/app/globals.css apps/web/src/components/ui/page-container.tsx apps/web/src/components/ui/page-container.test.tsx docs/guidelines/design-system.md
git commit -m "feat(ui): responsive container tokens + PageContainer composite"
```

### Task F3: Overlay primitives — `Sheet` + `Popover`

**Files:**
- Create: `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ui/popover.tsx`, `apps/web/src/components/ui/overlays.test.tsx`
- Modify: `apps/web/package.json` (add `@radix-ui/react-popover`), `docs/guidelines/design-system.md`

**Interfaces:**
- Produces:
  - `Sheet({ open, onOpenChange, title, side?: "right", children })` — Radix Dialog, side-positioned, `shadow-overlay`, `bg-ink/40` overlay. **State-controlled** (`open` prop); no `SheetTrigger` export.
  - `Popover({ open, onOpenChange, trigger, children, align? })` — Radix Popover; `trigger` is a plain element the caller renders (a `<Button>`); content is `shadow-overlay` `rounded-lg`. Controlled via `open`/`onOpenChange`; the caller owns the state.

- [ ] **Step 1: Install**

Run: `pnpm --filter web add @radix-ui/react-popover`

- [ ] **Step 2: Write the failing test** `apps/web/src/components/ui/overlays.test.tsx` (proves `fireEvent.click` opens both — the ADR-012 invariant-3 guard):

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Popover } from "./popover";
import { Sheet } from "./sheet";

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet open={open} onOpenChange={setOpen} title="Trip settings">
        <p>sheet body</p>
      </Sheet>
    </>
  );
}

function PopoverHarness() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={<Button onClick={() => setOpen(true)}>History</Button>}>
      <p>popover body</p>
    </Popover>
  );
}

describe("overlays open via fireEvent.click (owned state, no Radix trigger)", () => {
  it("Sheet opens on a plain-button click", () => {
    render(<SheetHarness />);
    expect(screen.queryByText("sheet body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open sheet" }));
    expect(screen.getByRole("dialog", { name: "Trip settings" })).toBeTruthy();
    expect(screen.getByText("sheet body")).toBeTruthy();
  });

  it("Popover opens on a plain-button click", () => {
    render(<PopoverHarness />);
    expect(screen.queryByText("popover body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("popover body")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter web test apps/web/src/components/ui/overlays.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement** `apps/web/src/components/ui/sheet.tsx`:

```tsx
"use client";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./button";
import { Heading } from "./heading";

// A side-anchored Dialog (design-system.md surface vocabulary): roomy forms that
// keep spatial context. State-controlled — no SheetTrigger, so fireEvent.click
// on a plain caller button opens it (ADR-012 invariant 3).
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: "right";
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-ink/40" />
        <RadixDialog.Content className="fixed inset-y-0 right-0 flex w-full max-w-measure flex-col gap-3 bg-surface p-5 shadow-overlay">
          <div className="flex items-start justify-between gap-3">
            <RadixDialog.Title asChild>
              <Heading level={3}>{title}</Heading>
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" aria-hidden />
              </Button>
            </RadixDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
```

`apps/web/src/components/ui/popover.tsx`:

```tsx
"use client";
import * as RadixPopover from "@radix-ui/react-popover";

// Anchored, small: never pushes page content down (design-system.md). Controlled
// via open/onOpenChange; the caller renders `trigger` (a plain Button) and owns
// its onClick, so fireEvent.click drives it (ADR-012 invariant 3).
export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "end",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  children: React.ReactNode;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={6}
          className="z-50 w-80 rounded-lg border border-hairline bg-surface p-3 shadow-overlay"
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
```

> `RadixPopover.Trigger asChild` wraps the caller's plain `<Button>`; because the button keeps its own `onClick` that sets state, `fireEvent.click` opens it even though Radix's own pointer handler is a no-op under jsdom. Verify the test passes; if Radix swallows the click in jsdom, fall back to rendering `trigger` directly (outside `RadixPopover.Trigger`) and driving `open` purely from the caller's state.

- [ ] **Step 5: Run + design-system.md + commit**

Run: `pnpm --filter web test apps/web/src/components/ui/overlays.test.tsx && pnpm lint && pnpm --filter web typecheck`
Expected: PASS.

Amend design-system.md: add the **surface vocabulary** subsection (Sheet/Popover/Dialog table from ADR-011) and add `Sheet`, `Popover` to the composite inventory.

```bash
git add apps/web/src/components/ui/sheet.tsx apps/web/src/components/ui/popover.tsx apps/web/src/components/ui/overlays.test.tsx apps/web/package.json pnpm-lock.yaml docs/guidelines/design-system.md
git commit -m "feat(ui): Sheet + Popover overlay primitives (state-opened, fireEvent-safe)"
```

### Task F4: `SegmentedControl`, `TabStrip`, `FormField` description slot

**Files:**
- Create: `apps/web/src/components/ui/segmented-control.tsx`, `apps/web/src/components/ui/tab-strip.tsx`, `apps/web/src/components/ui/navigation.test.tsx`
- Modify: `apps/web/src/components/ui/form-field.tsx`, `apps/web/src/components/ui/composites.test.tsx`, `docs/guidelines/design-system.md`

**Interfaces:**
- Produces:
  - `SegmentedControl<T>({ value, onValueChange, options: {value,label}[], "aria-label" })` — plain `role="radiogroup"` of buttons; the Calendar↔Timeline toggle.
  - `TabStrip<T>({ value, onValueChange, options: {value,label}[], "aria-label" })` — the moss-pill visual of `TabsList`/`TabsTrigger` applied to plain `role="tab"` buttons (NOT Radix). The lens switcher (comment #11).
  - `FormField({ id, label, description?, hint?, error?, children })` — label now required; `description` renders a one-line explainer between label and control.

- [ ] **Step 1: Write the failing tests.** Append to `composites.test.tsx` a FormField description case, and create `navigation.test.tsx`:

```tsx
// navigation.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";
import { TabStrip } from "./tab-strip";

const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];

describe("navigation controls (non-Radix, fireEvent-driven)", () => {
  it("TabStrip renders role=tab buttons and fires onValueChange on click", () => {
    const onValueChange = vi.fn();
    render(<TabStrip value="a" onValueChange={onValueChange} options={opts} aria-label="Trip view" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("SegmentedControl is a radiogroup and fires onValueChange", () => {
    const onValueChange = vi.fn();
    render(<SegmentedControl value="a" onValueChange={onValueChange} options={opts} aria-label="View" />);
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});
```

```tsx
// add to composites.test.tsx
it("FormField renders a description between label and control", () => {
  render(
    <FormField id="anchor" label="Lock to a date rule" description="Keeps this event tied to a rule (e.g. every Monday) even if dates shift.">
      <input id="anchor" />
    </FormField>,
  );
  expect(screen.getByText(/Keeps this event tied to a rule/)).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify failure.** Run the two files; expect FAIL (modules/prop missing).

- [ ] **Step 3: Implement** `apps/web/src/components/ui/tab-strip.tsx`:

```tsx
"use client";
import { cn } from "../../lib/cn";

// The moss-pill tab look of ui/tabs.tsx applied to plain role="tab" buttons —
// NOT Radix Tabs. Radix TabsTrigger is pointer-only, which silently breaks
// fireEvent.click tests (comment #11 / M5 Track B1). Driven by owned state.
export function TabStrip<T extends string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  "aria-label": string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex gap-0.5 rounded-md bg-moss p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onValueChange(o.value)}
          className={cn(
            "cursor-pointer rounded-sm px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
            value === o.value ? "bg-surface font-semibold text-ink shadow-raised" : "text-slate hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

> This is the ONE sanctioned raw-`<button>` outside `components/ui/` rules — it lives *inside* `ui/`, so the element wall already exempts it. Do not recreate raw tab buttons in feature code; import `TabStrip`.

`apps/web/src/components/ui/segmented-control.tsx` — same idiom with `role="radiogroup"` / `role="radio"` + `aria-checked`:

```tsx
"use client";
import { cn } from "../../lib/cn";

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  "aria-label": string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex gap-0.5 rounded-md bg-moss p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onValueChange(o.value)}
          className={cn(
            "cursor-pointer rounded-sm px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand",
            value === o.value ? "bg-surface font-semibold text-ink shadow-raised" : "text-slate hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add the `description` slot to `FormField`.** Modify `form-field.tsx` to render `description` (as `Text variant="secondary"`) directly under the label, before the control; keep the existing hint/error behavior:

```tsx
import { Label } from "./label";
import { Text } from "./text";

export function FormField({ id, label, description, hint, error, children }: { id: string; label: string; description?: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {description ? <Text variant="secondary">{description}</Text> : null}
      {children}
      {error ? <Text variant="muted" className="text-danger-ink">{error}</Text> : hint ? <Text variant="muted">{hint}</Text> : null}
    </div>
  );
}
```

- [ ] **Step 5: Run + design-system.md + commit**

Run: `pnpm --filter web test apps/web/src/components/ui && pnpm lint && pnpm --filter web typecheck`
Expected: PASS.

Amend design-system.md: add `SegmentedControl`, `TabStrip` to the inventory; note `FormField` now requires a label and offers a `description`; add the **field-with-context** convention (mandatory label; `description` for domain concepts; combobox for search — forward ref to C1).

```bash
git add apps/web/src/components/ui/segmented-control.tsx apps/web/src/components/ui/tab-strip.tsx apps/web/src/components/ui/navigation.test.tsx apps/web/src/components/ui/form-field.tsx apps/web/src/components/ui/composites.test.tsx docs/guidelines/design-system.md
git commit -m "feat(ui): TabStrip + SegmentedControl (non-Radix) + FormField description slot"
```

### Task F5: The context spine — `TripProvider`, `EditorHost`, `LensRouter`

**Files:**
- Create: `apps/web/src/components/trip/context/TripProvider.tsx`, `EditorHost.tsx`, `LensRouter.tsx`, `apps/web/src/components/trip/context/context.test.tsx`

**Interfaces:**
- Consumes: `fetchTripDetail`, `fetchTripDetailAt`, `fetchTripHistory`, `sendTripCommand`, `BoardCommand` from `@/lib/apiClient`; `TripDetail`, `TripHistory` from `@tc/contracts`; `useSearchParams`, `useRouter`, `usePathname` from `next/navigation`.
- Produces:
  - `useTrip(): { trip, history, activeTrip, status, error, pending, dispatch(cmd), preview: { seq, enter(seq), exit } }`.
  - `useEditor(): { openCreate(prefill?: ActivityPrefill), openEdit(activityId: string), close(), state: { mode: "create"|"edit"|null, prefill?, activityId? } }` where `ActivityPrefill = { dayId?: string; location?: {...}; timeWindow?: {...} }`.
  - `useLens(): { lens: Lens, view: ScheduleView, setLens(l), setView(v) }` derived from URL `?lens=&view=`.

- [ ] **Step 1: Write the failing tests** `context.test.tsx` — assert the three invariants:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the API client the provider wraps.
const dispatchSpy = vi.fn().mockResolvedValue({ ok: true, value: {} });
vi.mock("@/lib/apiClient", () => ({
  fetchTripDetail: vi.fn().mockResolvedValue({ ok: true, value: { name: "Italy", currency: "USD", days: [], activities: {} } }),
  fetchTripHistory: vi.fn().mockResolvedValue({ ok: true, value: { entries: [], canUndo: false, canRedo: false } }),
  fetchTripDetailAt: vi.fn(),
  sendTripCommand: (...a: unknown[]) => dispatchSpy(...a),
}));

// Mock next/navigation: URL is the store.
let search = new URLSearchParams("");
const replaceSpy = vi.fn((url: string) => { search = new URLSearchParams(url.split("?")[1] ?? ""); });
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: replaceSpy }),
}));

import { TripProvider, useTrip } from "./TripProvider";
import { EditorHost, useEditor } from "./EditorHost";
import { LensRouter, useLens } from "./LensRouter";

beforeEach(() => { search = new URLSearchParams(""); replaceSpy.mockClear(); dispatchSpy.mockClear(); });

function Consumer() {
  const { activeTrip, dispatch } = useTrip();
  const { openCreate, state } = useEditor();
  const { lens, setLens } = useLens();
  return (
    <div>
      <span data-testid="trip">{activeTrip?.name}</span>
      <span data-testid="lens">{lens}</span>
      <span data-testid="editor">{state.mode ?? "closed"}</span>
      <button onClick={() => setLens("Map")}>go map</button>
      <button onClick={() => openCreate({ dayId: "d1" })}>add</button>
      <button onClick={() => dispatch({ type: "AddDay", tripId: "x", dayId: "d9" } as never)}>day</button>
    </div>
  );
}

function Harness() {
  return (
    <TripProvider tripId="x">
      <EditorHost>
        <LensRouter>
          <Consumer />
        </LensRouter>
      </EditorHost>
    </TripProvider>
  );
}

describe("trip context spine", () => {
  it("TripProvider exposes the fetched read-model", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("trip").textContent).toBe("Italy"));
  });

  it("dispatch calls the command API (server-cache, not a store)", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("trip").textContent).toBe("Italy"));
    fireEvent.click(screen.getByRole("button", { name: "day" }));
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "AddDay" })));
  });

  it("setLens writes the URL, and lens derives from it (unidirectional)", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("lens").textContent).toBe("Board"));
    fireEvent.click(screen.getByRole("button", { name: "go map" }));
    expect(replaceSpy).toHaveBeenCalledWith(expect.stringContaining("lens=Map"));
  });

  it("openCreate opens the editor with prefill", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    expect(screen.getByTestId("editor").textContent).toBe("create");
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run the file; expect FAIL (modules missing).

- [ ] **Step 3: Implement `TripProvider.tsx`** — lift the current `TripBoardScreen` data logic verbatim (load/dispatch/preview) into context. It is a cache + dispatch: `dispatch` calls `sendTripCommand` then `load()` (refetch). No direct trip-state mutation API is exposed.

```tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { TripDetail, TripHistory } from "@tc/contracts";
import { fetchTripDetail, fetchTripDetailAt, fetchTripHistory, sendTripCommand, type BoardCommand } from "@/lib/apiClient";

type Status = "loading" | "ready" | "unauthenticated" | "error";
type TripCtx = {
  trip: TripDetail | null;
  history: TripHistory | null;
  activeTrip: TripDetail | null;
  status: Status;
  error: string | null;
  pending: boolean;
  dispatch: (command: BoardCommand) => Promise<void>;
  preview: { seq: number | null; enter: (seq: number) => Promise<void>; exit: () => void };
};

const Ctx = createContext<TripCtx | null>(null);
export const useTrip = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTrip outside TripProvider");
  return v;
};

export function TripProvider({ tripId, children }: { tripId: string; children: React.ReactNode }) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [history, setHistory] = useState<TripHistory | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  const [previewTrip, setPreviewTrip] = useState<TripDetail | null>(null);

  const load = useCallback(async () => {
    const [d, h] = await Promise.all([fetchTripDetail(tripId), fetchTripHistory(tripId)]);
    if (!d.ok) { setStatus(d.error.status === 401 ? "unauthenticated" : "error"); setError(d.error.message); return; }
    setTrip(d.value); setHistory(h.ok ? h.value : null); setStatus("ready");
  }, [tripId]);

  useEffect(() => { void load(); }, [load]);

  const enter = useCallback(async (seq: number) => {
    const r = await fetchTripDetailAt(tripId, seq);
    if (r.ok) { setPreviewSeq(seq); setPreviewTrip(r.value); } else setError(r.error.message);
  }, [tripId]);
  const exit = useCallback(() => { setPreviewSeq(null); setPreviewTrip(null); }, []);

  const dispatch = useCallback(async (command: BoardCommand) => {
    setError(null); setPending(true);
    try {
      const r = await sendTripCommand(command);
      if (!r.ok) setError(r.error.message);
      await load();  // event log is source of truth — refetch, never mutate context
      exit();
    } finally { setPending(false); }
  }, [load, exit]);

  const activeTrip = previewSeq !== null && previewTrip !== null ? previewTrip : trip;
  return (
    <Ctx.Provider value={{ trip, history, activeTrip, status, error, pending, dispatch, preview: { seq: previewSeq, enter, exit } }}>
      {children}
    </Ctx.Provider>
  );
}
```

- [ ] **Step 4: Implement `EditorHost.tsx`** — holds editor open-state + prefill; renders nothing here (E1 mounts the actual Sheet consuming this state), exposes `useEditor`:

```tsx
"use client";
import { createContext, useContext, useMemo, useState } from "react";

export type ActivityPrefill = { dayId?: string; location?: { name: string; lat?: number; lng?: number }; timeWindow?: { start: string; end: string } };
type EditorState = { mode: "create" | "edit" | null; prefill?: ActivityPrefill; activityId?: string };
type EditorCtx = { state: EditorState; openCreate: (prefill?: ActivityPrefill) => void; openEdit: (activityId: string) => void; close: () => void };

const Ctx = createContext<EditorCtx | null>(null);
export const useEditor = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor outside EditorHost");
  return v;
};

export function EditorHost({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EditorState>({ mode: null });
  const api = useMemo<EditorCtx>(() => ({
    state,
    openCreate: (prefill) => setState({ mode: "create", prefill }),
    openEdit: (activityId) => setState({ mode: "edit", activityId }),
    close: () => setState({ mode: null }),
  }), [state]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 5: Implement `LensRouter.tsx`** — value derived from `useSearchParams()`, NO `useState`:

```tsx
"use client";
import { createContext, useContext, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const LENSES = ["Board", "Map", "Schedule", "Itinerary", "Daily", "Trip"] as const;
export type Lens = (typeof LENSES)[number];
export const SCHEDULE_VIEWS = ["Timeline", "Calendar"] as const;
export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];

type LensCtx = { lens: Lens; view: ScheduleView; setLens: (l: Lens) => void; setView: (v: ScheduleView) => void };
const Ctx = createContext<LensCtx | null>(null);
export const useLens = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLens outside LensRouter");
  return v;
};

export function LensRouter({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const value = useMemo<LensCtx>(() => {
    const lens = (LENSES as readonly string[]).includes(params.get("lens") ?? "") ? (params.get("lens") as Lens) : "Board";
    const view = (SCHEDULE_VIEWS as readonly string[]).includes(params.get("view") ?? "") ? (params.get("view") as ScheduleView) : "Timeline";
    const write = (next: URLSearchParams) => router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    return {
      lens,
      view,
      setLens: (l) => { const n = new URLSearchParams(params); n.set("lens", l); write(n); },   // one direction: click → URL → derive
      setView: (v) => { const n = new URLSearchParams(params); n.set("view", v); write(n); },
    };
  }, [params, router, pathname]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 6: Run + commit**

Run: `pnpm --filter web test apps/web/src/components/trip/context/context.test.tsx && pnpm --filter web typecheck && pnpm lint`
Expected: PASS. (`LensRouter` contains no `useState` — grep-verify: `grep -n useState apps/web/src/components/trip/context/LensRouter.tsx` returns nothing.)

```bash
git add apps/web/src/components/trip/context
git commit -m "feat(trip): client-state spine — TripProvider (cache+dispatch), EditorHost, LensRouter (url-as-truth)"
```

### Task F6: Human-readable date formatter

**Files:**
- Create: `apps/web/src/lib/formatDate.ts`, `apps/web/src/lib/formatDate.test.ts`
- Modify: `docs/guidelines/design-system.md`

**Interfaces:**
- Produces: `formatTripDate(iso: string): string` → e.g. `"Sun, Jul 12"`; `formatTripDateLong(iso)` → `"Sun, Jul 12, 2026"`. Consumed anywhere a bare ISO date currently renders in `DataText` (L1, C-track, P1).

- [ ] **Step 1: Write the failing test** `formatDate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTripDate, formatTripDateLong } from "./formatDate";

describe("formatTripDate", () => {
  it("renders a short human date without a year", () => {
    expect(formatTripDate("2026-07-12")).toBe("Sun, Jul 12");
  });
  it("renders a long human date with the year", () => {
    expect(formatTripDateLong("2026-07-12")).toBe("Sun, Jul 12, 2026");
  });
  it("is timezone-stable (parses the calendar date, not an instant)", () => {
    expect(formatTripDate("2026-01-01")).toBe("Thu, Jan 1");
  });
});
```

- [ ] **Step 2: Run to verify failure.** Expect FAIL — module missing.

- [ ] **Step 3: Implement** `formatDate.ts` (parse as a local calendar date to avoid UTC off-by-one):

```ts
// Dates are calendar dates (YYYY-MM-DD), not instants — construct in local time
// so "2026-01-01" never renders as Dec 31 in a negative-offset zone.
function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function formatTripDate(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
export function formatTripDateLong(iso: string): string {
  return parse(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
```

- [ ] **Step 4: Run + design-system.md + commit**

Run: `pnpm --filter web test apps/web/src/lib/formatDate.test.ts && pnpm --filter web typecheck`
Expected: PASS.

Amend design-system.md (Typography → Data row): dates rendered in `DataText` use `formatTripDate`/`formatTripDateLong`, never bare ISO.

```bash
git add apps/web/src/lib/formatDate.ts apps/web/src/lib/formatDate.test.ts docs/guidelines/design-system.md
git commit -m "feat(ui): human-readable trip date formatter (DataText convention)"
```

---

## Track P — Page shell & header/settings (after F; precedes E/L/O)

### Task P1: Refactor `TripBoardScreen` onto the spine

**Files:**
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx`, `apps/web/src/app/trips/[tripId]/page.tsx`

**Interfaces:**
- Consumes F5 (`TripProvider`/`EditorHost`/`LensRouter`, `useTrip`/`useEditor`/`useLens`), F2 (`PageContainer`), F4 (`TabStrip`).
- Produces the shell E/L/O slot into: providers wrap the screen; a `LensOutlet` renders the active lens; the lens switcher is a `TabStrip` bound to `useLens()`.

- [ ] **Step 1:** Wrap the page. `trips/[tripId]/page.tsx` renders `<TripProvider tripId><EditorHost><LensRouter><TripBoardScreen/></LensRouter></EditorHost></TripProvider>` inside `<PageContainer as="main" width="full">` (the board wants width; inner lenses set their own container in L1). Remove the old `max-w-none` wrapper.
- [ ] **Step 2:** Gut `TripBoardScreen`'s local state — it now reads `useTrip()`/`useLens()` instead of its own `useState` for trip/history/preview/lens. Keep the loading/unauthenticated/error branches, sourcing `status`/`error` from `useTrip()`. Delete the prop-drilled callbacks; `Board` and lenses will read context in their own tasks (E/L/O). Keep every `data-testid`/`aria-label`.
- [ ] **Step 3:** Replace the raw `role="tablist"` + mapped ghost `Button`s (current lines ~174–187) with `<TabStrip value={lens} onValueChange={setLens} options={LENSES.map(l => ({ value: l, label: l }))} aria-label="Trip view" />`. This alone resolves **#11** — verify the existing e2e that selects a lens by `getByRole("tab")` still passes (it should; TabStrip keeps `role="tab"`).
- [ ] **Step 4:** Render `{lens === "Board" && <Board/>}` etc. via a small `LensOutlet` block (Board full-bleed; other lenses wrapped by L1's container). Leave the actual lens components for L1; here just wire `useLens().lens`.
- [ ] **Step 5:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Some `TripBoardScreen.test.tsx` assertions may need re-pointing at the provider-wrapped render (wrap the render in the providers); this is a test-harness change, not a behavior change — note it in the commit.

```bash
git add apps/web/src/components/board/TripBoardScreen.tsx apps/web/src/app/trips/[tripId]/page.tsx apps/web/src/components/board/TripBoardScreen.test.tsx
git commit -m "refactor(trip): TripBoardScreen reads the context spine; lens switcher is TabStrip (#11)"
```

### Task P2: `TripHeader` + `SettingsSheet` (budget moves here)

**Files:**
- Create: `apps/web/src/components/trip/TripHeader.tsx`, `apps/web/src/components/trip/SettingsSheet.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx`, `apps/web/src/components/board/TripMoneySettings.tsx`, `apps/web/src/components/board/TripDateControl.tsx`, `apps/web/src/components/board/HistoryPanel.tsx`, `apps/web/src/components/board/UndoRedoControls.tsx`

**Interfaces:**
- Consumes F3 (`Sheet`, `Popover`), F6 (`formatTripDate`), the spine.
- Produces `TripHeader` (read-only identity + budget-vs-total glance + action affordances) and `SettingsSheet` (trip-global edits).

- [ ] **Step 1: `TripHeader`** — a bounded surface (`bg-surface border-b border-hairline`) with: `← Your trips` link; `Heading level={2}` trip name; `DataText` date range via `formatTripDate`; a **read-only** budget-vs-total glance (`DataText`, `text-warning-ink` when over budget); then action affordances — undo/redo icon `Button`s (from `UndoRedoControls`, reading `useTrip().history`), a **History** `Popover` trigger, and a **gear** `Button` opening `SettingsSheet`. This visual boundary resolves **#14**; the header no longer holds editable date/budget rows, resolving **#15**.
- [ ] **Step 2: `SettingsSheet`** — a `Sheet title="Trip settings"` holding the trip-global fields moved out of the header: the start-date control (`TripDateControl`, re-homed) and the money settings (`TripMoneySettings`). Budget/currency now live here (**#12b**); the budget field is a proper `FormField label="Trip budget"` with a `description` ("Used for the over-budget warning across lenses"), fixing **#12a**. Keep `TripDateControl`/`TripMoneySettings`' existing handlers and `aria-label`s byte-identical — they dispatch the same commands, just from a new surface.
- [ ] **Step 3: History as Popover (#13).** Change `HistoryPanel` so its trigger is the header's History `Popover` trigger and its list renders inside the popover content, not an inline `Panel` that pushes content down. The entries list gets `max-h-80 overflow-y-auto` and a bounded page size (render the most recent N, with a "Show older" affordance) — resolves **#1**'s "too wide / paginate" (the popover is `w-80`, and the list scrolls internally). Timestamps via `DataText` + `formatTripDate` where dates appear.
- [ ] **Step 4:** In `TripBoardScreen`, replace the old flat header siblings (`TripDateControl`, `TripMoneySettings`, `UndoRedoControls`, inline `HistoryPanel`) with `<TripHeader/>` above the `TabStrip`.
- [ ] **Step 5:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. e2e that edited budget/date will now open the Settings sheet first — update those specs (behavioral; justify in commit). History-panel e2e now opens a popover — update selector/interaction.

```bash
git add apps/web/src/components/trip apps/web/src/components/board/TripBoardScreen.tsx apps/web/src/components/board/TripMoneySettings.tsx apps/web/src/components/board/TripDateControl.tsx apps/web/src/components/board/HistoryPanel.tsx apps/web/src/components/board/UndoRedoControls.tsx
git commit -m "feat(trip): TripHeader (identity + glance) + SettingsSheet (budget/date moved); History is a Popover (#1,#12,#13,#14,#15)"
```

---

## Track E — Portable entity editor (after P)

### Task E1: `ActivityEditor` becomes the portable Sheet

**Files:**
- Create: `apps/web/src/components/trip/editor/ActivityEditorSheet.tsx`
- Modify: `apps/web/src/components/board/ActivityEditor.tsx`, `apps/web/src/components/board/TripBoardScreen.tsx`

**Interfaces:**
- Consumes F3 (`Sheet`), F5 (`useEditor`, `useTrip`, `ActivityPrefill`).
- Produces `ActivityEditorSheet` mounted once at the screen root; reads `useEditor().state`; on `create`/`edit` renders the existing `ActivityEditor` **form** inside a `Sheet`.

- [ ] **Step 1:** Extract `ActivityEditor`'s form body so it can render either inline (existing lens-edit usage) or inside the sheet — keep its `ActivityFormValue`, all fields, and every `aria-label`/`data-testid` unchanged.
- [ ] **Step 2: `ActivityEditorSheet`** — reads `useEditor().state`; `open = state.mode !== null`; `title = state.mode === "edit" ? "Edit activity" : "New activity"`. On create, seed the form from `state.prefill` (dayId → target day, location, timeWindow). On save, `useTrip().dispatch(AddActivity|UpdateActivity)` then `useEditor().close()`. This is **behavior change #2** (editor is now a raised sheet). Resolves **#9** (the form is a sized, scrollable sheet — no overflow).
- [ ] **Step 3:** Mount `<ActivityEditorSheet/>` once in `TripBoardScreen` (inside the providers, outside the `LensOutlet`).
- [ ] **Step 4:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Update the ActivityEditor e2e to open/close the sheet (behavioral; justify).

```bash
git add apps/web/src/components/trip/editor apps/web/src/components/board/ActivityEditor.tsx apps/web/src/components/board/TripBoardScreen.tsx
git commit -m "feat(trip): activity editor is a portable Sheet raised via EditorHost (#9)"
```

### Task E2: Context-prefill triggers from every surface (R2)

**Files:**
- Modify: `apps/web/src/components/board/Board.tsx`, `Column.tsx`; `apps/web/src/components/lenses/ScheduleLens.tsx` (from L1); `apps/web/src/components/lenses/MapLens.tsx`

**Interfaces:** Consumes `useEditor().openCreate(prefill)`.

- [ ] **Step 1: Board (#R2).** The board's "Add activity" and each column's foot get a "+" `Button` that calls `openCreate({ dayId })` with the column's own `dayId`. The board's single `primary` Button remains "Add activity".
- [ ] **Step 2: Schedule + Map triggers.** A "+" at the foot of a Schedule day calls `openCreate({ dayId, timeWindow })`; a map double-click calls `openCreate({ location: { name, lat, lng } })` (map double-click handler is UI-only; no maplibre behavior change beyond adding the listener). Each trigger is a plain `Button`/handler — no new form.
- [ ] **Step 2 note:** This is the R2 demonstration for the ADR-011 gate: ≥2 distinct triggers raising the same editor with different prefill.
- [ ] **Step 3:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS.

```bash
git add apps/web/src/components/board/Board.tsx apps/web/src/components/board/Column.tsx apps/web/src/components/lenses/ScheduleLens.tsx apps/web/src/components/lenses/MapLens.tsx
git commit -m "feat(trip): context-prefill editor triggers from board/schedule/map (R2)"
```

---

## Track L — Lenses & routing (after P)

### Task L1: Merge Calendar + Timeline into a `Schedule` lens

**Files:**
- Create: `apps/web/src/components/lenses/ScheduleLens.tsx`
- Modify: `apps/web/src/components/board/TripBoardScreen.tsx` (LensOutlet), `apps/web/src/components/lenses/TimelineLens.tsx`, `CalendarLens.tsx` (become inner views)

**Interfaces:** Consumes F4 (`SegmentedControl`), F5 (`useLens` — `view`/`setView`).

- [ ] **Step 1: `ScheduleLens`** — renders a `SegmentedControl` (`Timeline`/`Calendar`, bound to `useLens().view`/`setView`) above the chosen inner view (`TimelineLens` or `CalendarLens`, unchanged internally). The `LENSES` list (F5) already replaced `"Timeline"`,`"Calendar"` with `"Schedule"`.
- [ ] **Step 2:** In the `LensOutlet`, `{lens === "Schedule" && <ScheduleLens/>}`. Wrap non-full lenses in `<PageContainer width="content">` so **#4** (subtotal rows too wide) is fixed by the content max-width; Board and Map stay `full`. **Avoid double padding:** the outer trip-page `main` (P1) provides the full-bleed frame with its own `px-6`; the per-lens `PageContainer width="content"` should be the *only* max-width wrapper — do not also wrap the whole `LensOutlet`. If the outer `main`'s `px-6` visibly doubles against the inner container on table lenses, drop the outer padding (make the page `main` a plain `width="full"` with `px-0`) and let each lens own its horizontal padding.
- [ ] **Step 3:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Update e2e that clicked the separate "Timeline"/"Calendar" tabs to click "Schedule" then the `SegmentedControl` (behavioral/structural; justify).

```bash
git add apps/web/src/components/lenses/ScheduleLens.tsx apps/web/src/components/lenses/TimelineLens.tsx apps/web/src/components/lenses/CalendarLens.tsx apps/web/src/components/board/TripBoardScreen.tsx
git commit -m "feat(lenses): merge Timeline+Calendar into a Schedule lens with a view toggle"
```

### Task L2: Apply `PageContainer` widths + human dates across lenses

**Files:**
- Modify: `apps/web/src/components/lenses/ItineraryLens.tsx`, `DailyOverviewLens.tsx`, `FullTripOverviewLens.tsx`

**Interfaces:** Consumes F2 (`PageContainer`), F6 (`formatTripDate`).

- [ ] **Step 1:** Ensure the three table lenses render inside `PageContainer width="content"` (via LensOutlet from L1) and that their `DataText` **date** cells use `formatTripDate`/`formatTripDateLong` — resolves **#3** (and the Daily lens date the comment pinned). Amounts/times are unchanged.
- [ ] **Step 2:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS.

```bash
git add apps/web/src/components/lenses/ItineraryLens.tsx apps/web/src/components/lenses/DailyOverviewLens.tsx apps/web/src/components/lenses/FullTripOverviewLens.tsx
git commit -m "feat(lenses): content max-width + human-readable dates in table lenses (#3,#4)"
```

---

## Track C — Field-with-context (after F)

### Task C1: `LocationInput` becomes a combobox; Enter searches, not submits

**Files:**
- Modify: `apps/web/src/components/board/LocationInput.tsx`

**Interfaces:** Consumes F4 (`FormField` description). Behavior change #1.

- [ ] **Step 1: Results as a `listbox`.** Re-style the search results `<ul>` as `role="listbox"` with each result `role="option"`: `divide-y divide-hairline`, `px-3 py-2`, primary text `Text` + secondary detail `Text variant="secondary"` on its own line (no overlap). Resolves **#5**.
- [ ] **Step 2: Enter searches (#6).** On the place-name `Input`, add `onKeyDown` — when `key === "Enter"`, `e.preventDefault()` (stop the form submit) and call the existing search function. Keep the `aria-label="Place name"`. Add a `FormField` description clarifying it's a search field if not obvious.
- [ ] **Step 3:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Add/adjust a unit test asserting Enter calls search and does not submit the form (behavioral; justify).

```bash
git add apps/web/src/components/board/LocationInput.tsx
git commit -m "feat(trip): location search is a combobox; Enter searches not submits (#5,#6)"
```

### Task C2: Anchor explainer + clear-date popover

**Files:**
- Modify: `apps/web/src/components/board/AnchorEditor.tsx`, `apps/web/src/components/board/TripDateControl.tsx`, `apps/web/src/components/board/MoneyInput.tsx`

**Interfaces:** Consumes F4 (`FormField` description), F3 (`Popover`).

- [ ] **Step 1: Anchor (#8).** Wrap the `select#anchor-kind` in a `FormField label="Lock to a date rule"` with a plain-language `description` ("Ties this event to a rule — e.g. a specific date or every Monday — so it flags a conflict if trip dates shift"). Keep the native `<select>` (ADR-010 / `NativeSelect`) and its `aria-label="anchor kind"`. If the enum values are opaque, map them to friendly option labels without changing the submitted values.
- [ ] **Step 2: Cost label (#7).** Ensure the per-activity cost `MoneyInput` inside the editor renders through a `FormField label="Cost"` (it currently relies on only an `aria-label`). Keep the `aria-label="cost (USD)"`.
- [ ] **Step 3: Clear-date as a rare op (#2).** Move the standalone "Clear dates" button into a `Popover` on the date control (a small menu with a single "Clear date" action), and fix the copy to singular "Clear date". Keep the underlying clear handler.
- [ ] **Step 4:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS.

```bash
git add apps/web/src/components/board/AnchorEditor.tsx apps/web/src/components/board/TripDateControl.tsx apps/web/src/components/board/MoneyInput.tsx
git commit -m "feat(trip): anchor explainer, cost label, clear-date popover (#2,#7,#8)"
```

---

## Track O — Overflow / board-at-scale (after P)

### Task O1: Board scroll affordance + day pager + stack breakpoint

**Files:**
- Modify: `apps/web/src/components/board/Board.tsx`, `apps/web/src/components/board/Column.tsx`

**Interfaces:** Consumes the overflow policy (design-system.md, F2). Resolves **#10**.

- [ ] **Step 1: Edge-shadow affordance.** Wrap the horizontally-scrolling column row so a right-edge `shadow` cue shows when more days exist off-screen (track scrollLeft/scrollWidth via a small ref+state; the shadow is a token `shadow`, not a gradient). This is the missing "you can scroll right" hint.
- [ ] **Step 2: Day pager.** Above the board, render a compact row of `Day 1…N` chip `Button`s; clicking scrolls the target column into view (`scrollIntoView({ inline: "start" })` on the column ref). Navigation without dragging across the whole width.
- [ ] **Step 3: Stack breakpoint.** Below `lg`, the column row switches from `flex-row overflow-x-auto` to `flex-col` (columns stack vertically) — the one board-stack breakpoint from design-system.md. Drag-drop between days keeps working (adjacency is now vertical below `lg`).
- [ ] **Step 4:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. **Visual check** the pager/edge-shadow feel on the dev server (the one deferred styling decision from the spec) before committing.

```bash
git add apps/web/src/components/board/Board.tsx apps/web/src/components/board/Column.tsx
git commit -m "feat(board): scroll edge-shadow + day pager + stack-below-lg for 7+ day trips (#10)"
```

---

## Integration (single coordinating session)

### Task I1: Converge — merge, full check, all e2e green

- [ ] **Step 1:** Merge the E/L/C/O worktree branches back sequentially (never concurrently — AGENTS.md). P and F are already on the branch.
- [ ] **Step 2:** `pnpm check` — PASS (typecheck, all walls + color wall, all unit tests). Grep the ADR-012 invariants: `grep -rn "useState" apps/web/src/components/trip/context/LensRouter.tsx` returns nothing; no component writes trip state except via `dispatch` (`grep -rn "setTrip\|setActiveTrip" apps/web/src` finds only `TripProvider.tsx`).
- [ ] **Step 3:** Assert the UI-only guarantee: `git diff origin/main --stat -- packages/ apps/web/src/server apps/web/src/app/api docs/contracts` shows **nothing**.
- [ ] **Step 4:** e2e, all milestones: `docker compose up -d && pnpm --filter web test:e2e`. Expected: `smoke`, `m1-board`, `m2-history`, `m3-place-and-time`, `m4-money-and-lenses` PASS. Behavioral updates (editor-as-sheet open/close, budget-via-settings, History popover, Schedule tab + view toggle, Enter-to-search) are committed as `test(e2e): update <flow> for M5 Wave-2 <behavior change>` — each names the intentional change. **A test failing for a reason NOT in the spec's behavior-change list: STOP, report to Mitchell.**
- [ ] **Step 5:** Commit convergence fixes: `git commit -m "chore(trip): converge M5 Wave-2; all M0-M4 e2e green on the new surfaces"`.

### Task I2: web-design-guidelines review gate

- [ ] **Step 1:** Start the dev server; walk every surface at ≥1024px AND at the `lg` boundary (board stacking) with the **web-design-guidelines skill** as the checklist. Record findings.
- [ ] **Step 2:** Fix every finding (or bring to Mitchell if a fix would change behavior). Re-run `pnpm check` + e2e.
- [ ] **Step 3:** Verify the two-ADR validations empirically: **ADR-011** — demonstrate a new dummy global setting rendered in Settings and a dummy activity field in the editor with no surface decision, then revert the demo (or capture it as a note); confirm the editor opens with prefill from board + map. **ADR-012** — the `fireEvent` overlay test (F3) is green; the LensRouter grep is clean.
- [ ] **Step 4:** Commit: `git commit -m "fix(ui): web-design-guidelines review findings (M5 Wave-2)"`.

### Task I3: Verification, docs, PR (no merge)

- [ ] **Step 1:** Invoke `superpowers:verification-before-completion`: fresh `pnpm check`, fresh e2e, `pnpm --filter web build` — paste actual outputs; no claims without evidence.
- [ ] **Step 2:** Docs sync: confirm design-system.md reflects every new token/primitive/convention added; confirm the 15-comment resolution map in the spec is all accounted for; confirm ADR-011/012 statuses are `Accepted`.
- [ ] **Step 3:** Push and update the PR (base `main`, head `m5-design-foundations`). Body: Wave-2 summary, ADR-011/012 pointers, the 15-comment resolution table, behavior-change list with e2e evidence, screenshots (header/settings sheet, portable editor sheet, Schedule lens + toggle, board at 7+ days with pager, a table lens). End with the generated-with footer. **Do not merge. Do not tick gate boxes** — the Wave-2 gate closes only after Mitchell's deployed-URL demo, via the gate-close checklist.
- [ ] **Step 4:** Report to Mitchell: PR link, what to demo (all 15 comments resolved per the map; R1/R2 and the ADR-012 invariants), and any I2 findings/waivers.

---

## Self-review — spec coverage

All 15 comments: #1 P2s3 · #2 C2s3 · #3 L2s1/F6 · #4 L1s2/F2 · #5 C1s1 · #6 C1s2 · #7 C2s2 · #8 C2s1 · #9 E1s2 · #10 O1 · #11 P1s3 · #12 P2s2 · #13 P2s3 · #14 P2s1 · #15 P2s1. Four patterns: P1 container (F2, L1s2, P1s1) · P2 overflow (O1) · P3 field-context (F4, C1, C2) · P4 surfaces (F3, P2, E1) · surface vocabulary (F3, ADR-011) · state spine (F5, ADR-012) · conventions (F6 dates, C2s3 rare-op). ADRs: F1. Milestone amendment + ADR-number bump: F1. Both ADRs gated independently: F1 milestone gate + I2s3.

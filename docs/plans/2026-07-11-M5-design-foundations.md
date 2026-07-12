# M5 Design Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> If anything requires a decision this plan does not cover, STOP and ask Mitchell — do not improvise.

**Goal:** Introduce the Field Kit design system — Tailwind v4 tokens, re-themed shadcn-style primitives and composites, a color/element enforcement wall — then re-skin every Phase-1 surface on it, changing nothing about behavior.

**Architecture:** Tokens live in one `@theme` block in `apps/web/src/app/globals.css` (the single source of truth per the milestone; Tailwind's default color palette is *wiped* so only our tokens produce color utilities). Components are vendored in `apps/web/src/components/ui/` in the shadcn idiom (cva variants + `cn()`), re-themed to Field Kit at birth (ADR-010 condition 1). Radix is used for Dialog and Tabs only; selects stay native (`NativeSelect`), forms keep their existing logic (ADR-010 condition 2). Enforcement is a ratchet: the wall (ESLint + scan script) lands *before* the re-skin with every unconverted file on a pending list; each re-skin task shrinks the list; integration asserts it is empty. Spec: `docs/specs/2026-07-11-M5-design-foundations-design.md` · Normative reference: `docs/guidelines/design-system.md`.

**Tech Stack:** Everything M4 used, plus new **devDependencies** in `apps/web`: `tailwindcss@^4`, `@tailwindcss/postcss`, and new **dependencies**: `@radix-ui/react-dialog`, `@radix-ui/react-tabs`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. Fonts via `next/font/google` (build-time self-hosting — no runtime dep, no external requests in prod). **No new environment variable, no DB migration, no contract change.**

## Global Constraints

- Read `AGENTS.md` and `docs/guidelines/design-system.md` before starting. The design-system doc is normative — token names, palette semantics, and the component registry there are not yours to reinterpret.
- **Purely presentational.** The diff may touch ONLY `apps/web/src` (never `src/server/**` or `src/app/api/**`), `apps/web` config files (`package.json`, `postcss.config.mjs`, `eslint.config.mjs`), `apps/web/e2e` (selector-only — see below), `scripts/`, and `docs/`. `packages/contracts` and `packages/domain` must show **zero diff** at PR time. No entry in `docs/contracts/CHANGELOG.md` — needing one means scope crept; STOP.
- **All M0–M4 e2e specs pass unchanged.** Selector-only updates are acceptable (say so in the commit message); a test that needs a *behavioral* change is a gate red flag — STOP and report to Mitchell. Never remove or rename a `data-testid` or an `aria-label`; the re-skin keeps them byte-identical (this is what keeps e2e updates near zero).
- Node >= 20, pnpm >= 9, commands from repo root. Local Postgres for e2e: `docker compose up -d` (port 5433); dev server 3001.
- **Branch:** work continues on `m5-design-foundations` (already created from `origin/main`; kickoff docs committed as `5ba9a5a`). One PR at the end (Task I3). **Do not merge — Mitchell merges.**
- **Worktree isolation (binding, AGENTS.md "Workstreams"):** each parallel implementer runs in its own git worktree via superpowers:using-git-worktrees and merges back sequentially. M3 lost committed work to a shared-tree `git reset`; never again.
- Color literals (`#hex`, `rgb()`, `hsl()`) exist in exactly one file: `apps/web/src/app/globals.css`. Inline `style={{…}}` only at the enumerated exceptions in Task F4 (drag opacity, map container, computed timeline/calendar geometry), each with an eslint-disable line and a reason. No Tailwind arbitrary values (`p-[13px]`, `text-[#123]`).
- At most **one `variant="primary"` Button per view** (design-system.md). Conflict UI is `warning`, never `danger`. All times/dates/currency render through `DataText`.
- Commit after every task with the exact message given (conventional commits).
- There is **no typecheck red window this milestone** — no cross-package type changes. `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test` must pass at the end of every task.

## Workstreams & parallel dispatch

**The F-track (foundation) is the meeting point — it lands first, sequentially, in one worktree.** After F4, three re-skin tracks are mutually independent (disjoint files) and can be dispatched as parallel subagents in separate worktrees:

| Track | Tasks | Files owned | Depends on |
|---|---|---|---|
| **F — Foundation** | F1 → F2 → F3 → F4 | `globals.css`, `layout.tsx`, `components/ui/**`, configs, `scripts/` | Task 0 |
| **A — Shell & trip list** | A1 | `src/app/page.tsx` | F-track |
| **B — Board & chrome** | B1 → B2 → B3 | `src/components/board/**` | F-track |
| **C — Lenses** | C1 → C2 | `src/components/lenses/**` | F-track |

Integration (single coordinating session): **I1** (merge + ratchet empty + full check + e2e) → **I2** (web-design-guidelines review pass) → **I3** (deploy check + PR).

```
Task 0 ► F1 tokens ► F2 primitives ► F3 composites ► F4 wall ─┬─► A1 shell/trip list ─┐
                                                              ├─► B1 ► B2 ► B3 board ──┼─► I1 ► I2 ► I3
                                                              └─► C1 ► C2 lenses ──────┘
```

---

### Task 0: Preflight — reconcile M4's gate-close checklist

Reconciled at kickoff 2026-07-11 (PR #9 merged; TODO ticked; M4 exit-gate boxes checked; retro present; Current milestone = M5). Re-verify cheaply; this is the standing forcing function.

- [ ] **Step 1: Verify** — `TODO.md` has M4 `- [x]`; `docs/milestones/M4-money-and-lenses.md` has all boxes checked + retro; `docs/milestones/README.md` bottom line reads M5. `git merge-base --is-ancestor origin/main HEAD` from the branch (we branched after the close; expect success).
- [ ] **Step 2:** If any flag is unflipped, flip it in one commit before F1. Otherwise proceed.

---

## Track F — Foundation (sequential, one worktree)

### Task F1: Tailwind v4, `@theme` tokens, fonts, app shell

**Files:**
- Create: `apps/web/src/app/globals.css`, `apps/web/postcss.config.mjs`
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/package.json`

**Interfaces:**
- Produces (consumed by every later task): color utilities `paper, surface, moss, hairline, border-strong, border-input, slate, ink, brand{,-hover,-pressed,-tint}, danger{,-tint,-ink}, warning{,-tint,-ink}, success{,-tint,-ink}, info{,-tint,-ink}` (e.g. `bg-paper`, `text-ink`, `border-hairline`, `border-border-input`); font utilities `font-display`, `font-sans`, `font-mono`; text sizes `text-xs|sm|base|md|lg|xl|2xl`; radii `rounded-sm|md|lg` (6/8/12); shadows `shadow-raised`, `shadow-overlay`. Tailwind default colors are **removed** — `bg-red-500` is a build error, which is half the enforcement wall for free.

- [ ] **Step 1: Install**

Run: `pnpm --filter web add -D tailwindcss@^4 @tailwindcss/postcss`
Expected: lockfile updates only under `apps/web` devDependencies.

- [ ] **Step 2: PostCSS config**

`apps/web/postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

- [ ] **Step 3: Tokens — `apps/web/src/app/globals.css`**

```css
@import "tailwindcss";

/* Field Kit tokens — THE single source of truth (design-system.md is the
   human contract; the two change together). The only file in apps/web/src
   where raw color literals may appear. */
@theme {
  /* wipe Tailwind's default palette: only named tokens below yield color
     utilities, so an off-system color is a build error, not a review nit */
  --color-*: initial;

  --color-paper: #f7f8f6;
  --color-surface: #ffffff;
  --color-moss: #eff2ed;
  --color-hairline: #dde2da;
  --color-border-strong: #c8cfc4;
  --color-border-input: #8a938e;
  --color-slate: #5a6472;
  --color-ink: #151d2e;

  --color-brand: #0e7c66;
  --color-brand-hover: #0c6b58;
  --color-brand-pressed: #0a5a4b;
  --color-brand-tint: #e3f0ec;

  --color-danger: #b3372e;
  --color-danger-tint: #f8e3e0;
  --color-danger-ink: #8f2b23;
  --color-warning: #b07c10;
  --color-warning-tint: #f6ebd4;
  --color-warning-ink: #8a5f0b;
  --color-success: #2e7d43;
  --color-success-tint: #e4f0e7;
  --color-success-ink: #22603a;
  --color-info: #2b6cb0;
  --color-info-tint: #e1ebf7;
  --color-info-ink: #1f5187;

  --text-xs: 12px;
  --text-xs--line-height: 1.35;
  --text-sm: 13px;
  --text-sm--line-height: 1.4;
  --text-base: 14px;
  --text-base--line-height: 1.45;
  --text-md: 16px;
  --text-md--line-height: 1.45;
  --text-lg: 19px;
  --text-lg--line-height: 1.3;
  --text-xl: 24px;
  --text-xl--line-height: 1.2;
  --text-2xl: 30px;
  --text-2xl--line-height: 1.15;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --shadow-raised: 0 1px 2px rgb(21 29 46 / 0.06);
  --shadow-overlay: 0 8px 24px rgb(21 29 46 / 0.12), 0 2px 6px rgb(21 29 46 / 0.08);
}

@theme inline {
  --font-display: var(--font-next-display), ui-sans-serif, sans-serif;
  --font-sans: var(--font-next-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-next-mono), ui-monospace, monospace;
}

@layer base {
  body {
    @apply bg-paper font-sans text-base text-ink antialiased;
  }
}
```

- [ ] **Step 4: Shell — `apps/web/src/app/layout.tsx`**

Replace the file (drop the `margin: "2rem"` inline-styled body; pages own their padding from Task A1 on):

```tsx
import { Analytics } from "@vercel/analytics/next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
// Required by MapLens (maplibre-gl): without this, marker positioning
// transforms and the map's stacking context are undefined.
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-next-display" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-next-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-next-mono" });

export const metadata = { title: "travel-collab" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

> The body margin moves into page components in Tasks A1/B1 — until those land, pages hug the viewport edge. That is expected mid-track and invisible to e2e (which selects by testid/label, not geometry). If an e2e spec fails on this, that's a behavioral coupling to report, not to patch.

- [ ] **Step 5: Verify**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test && pnpm --filter web build`
Expected: all PASS (build proves the PostCSS/Tailwind pipeline; unit tests are jsdom and don't care about CSS).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/postcss.config.mjs apps/web/src/app/globals.css apps/web/src/app/layout.tsx pnpm-lock.yaml
git commit -m "feat(ui): Tailwind v4 + Field Kit @theme tokens + next/font trio + app shell"
```

### Task F2: `cn()` + the ten primitives

**Files:**
- Create: `apps/web/src/lib/cn.ts`, and under `apps/web/src/components/ui/`: `heading.tsx`, `text.tsx`, `data-text.tsx`, `label.tsx`, `button.tsx`, `input.tsx`, `textarea.tsx`, `native-select.tsx`, `badge.tsx`, `card.tsx`
- Test: `apps/web/src/components/ui/primitives.test.tsx`
- Modify: `apps/web/package.json` (deps)

**Interfaces:**
- Produces (the only way later tasks render these elements):
  - `cn(...inputs)` — clsx + tailwind-merge.
  - `Heading({ level: 1|2|3|4, className?, ...h-props })` → `<h{level}>` in display face.
  - `Text({ variant?: "body"|"secondary"|"muted", as?: "p"|"span", ... })`.
  - `DataText({ size?: "xs"|"sm"|"base", as?: "span"|"time", ... })` — mono; **all** times/dates/money.
  - `Label(props)` → styled `<label>`.
  - `Button({ variant?: "primary"|"secondary"|"ghost"|"destructive", size?: "sm"|"md"|"icon", ... })` — default `secondary`.
  - `Input(props)`, `Textarea(props)`, `NativeSelect(props)` — native elements, `border-border-input`, brand focus ring.
  - `Badge({ variant?: "neutral"|"danger"|"warning"|"success"|"info"|"brand", ... })` — tint bg + `-ink` text, pill.
  - `Card({ raised?: boolean, as?: "div"|"li", ... })`.

- [ ] **Step 1: Install**

Run: `pnpm --filter web add class-variance-authority clsx tailwind-merge lucide-react`

- [ ] **Step 2: Write the failing primitives test**

`apps/web/src/components/ui/primitives.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Button } from "./button";
import { DataText } from "./data-text";
import { Heading } from "./heading";
import { Input } from "./input";
import { NativeSelect } from "./native-select";

describe("ui primitives", () => {
  it("Heading renders the semantic tag in the display face", () => {
    render(<Heading level={2}>Trips</Heading>);
    const h = screen.getByRole("heading", { level: 2, name: "Trips" });
    expect(h.tagName).toBe("H2");
    expect(h.className).toContain("font-display");
  });

  it("Button defaults to secondary; primary carries brand; destructive carries danger", () => {
    const { rerender } = render(<Button>Edit trip</Button>);
    expect(screen.getByRole("button", { name: "Edit trip" }).className).toContain("border-border-strong");
    rerender(<Button variant="primary">Add activity</Button>);
    expect(screen.getByRole("button", { name: "Add activity" }).className).toContain("bg-brand");
    rerender(<Button variant="destructive">Remove</Button>);
    expect(screen.getByRole("button", { name: "Remove" }).className).toContain("bg-danger");
  });

  it("Badge maps semantic variants to tint + ink pairs (conflicts are warning)", () => {
    render(<Badge variant="warning">2 conflicts</Badge>);
    const b = screen.getByText("2 conflicts");
    expect(b.className).toContain("bg-warning-tint");
    expect(b.className).toContain("text-warning-ink");
  });

  it("DataText is mono; Input and NativeSelect are native elements with the input border", () => {
    render(
      <>
        <DataText>18:00–20:00</DataText>
        <Input aria-label="Trip name" />
        <NativeSelect aria-label="Currency"><option>USD</option></NativeSelect>
      </>,
    );
    expect(screen.getByText("18:00–20:00").className).toContain("font-mono");
    expect(screen.getByLabelText("Trip name").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Currency").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Trip name").className).toContain("border-border-input");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter web test apps/web/src/components/ui/primitives.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 4: Implement**

`apps/web/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

`apps/web/src/components/ui/heading.tsx`:

```tsx
import { cn } from "../../lib/cn";

const styles = {
  1: "font-display text-2xl font-semibold text-ink",
  2: "font-display text-xl font-semibold text-ink",
  3: "font-display text-lg font-semibold text-ink",
  4: "font-display text-md font-medium text-ink",
} as const;

export function Heading({ level, className, ...props }: { level: 1 | 2 | 3 | 4 } & React.HTMLAttributes<HTMLHeadingElement>) {
  const Tag = `h${level}` as const;
  return <Tag className={cn(styles[level], className)} {...props} />;
}
```

`apps/web/src/components/ui/text.tsx`:

```tsx
import { cn } from "../../lib/cn";

const variants = {
  body: "text-base text-ink",
  secondary: "text-sm text-slate",
  muted: "text-xs text-slate",
} as const;

export function Text({ variant = "body", as: Tag = "p", className, ...props }: { variant?: keyof typeof variants; as?: "p" | "span" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn(variants[variant], className)} {...props} />;
}
```

`apps/web/src/components/ui/data-text.tsx`:

```tsx
import { cn } from "../../lib/cn";

const sizes = { xs: "text-xs", sm: "text-sm", base: "text-base" } as const;

// The Field Kit signature: every time, date, duration, and currency amount
// renders through this — mono digits align ledger-style (design-system.md).
export function DataText({ size = "sm", as: Tag = "span", className, ...props }: { size?: keyof typeof sizes; as?: "span" | "time" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("font-mono tabular-nums text-slate", sizes[size], className)} {...props} />;
}
```

`apps/web/src/components/ui/label.tsx`:

```tsx
import { cn } from "../../lib/cn";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-slate", className)} {...props} />;
}
```

`apps/web/src/components/ui/button.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-surface hover:bg-brand-hover active:bg-brand-pressed",
        secondary: "border border-border-strong bg-surface text-ink hover:bg-moss",
        ghost: "text-slate hover:bg-moss hover:text-ink",
        destructive: "bg-danger text-surface hover:bg-danger-ink",
      },
      size: {
        sm: "h-7 px-2.5 text-sm",
        md: "h-9 px-3.5 text-base",
        icon: "h-8 w-8 text-base",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({ variant, size, className, type = "button", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
```

`apps/web/src/components/ui/input.tsx`:

```tsx
import { cn } from "../../lib/cn";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-sm border border-border-input bg-surface px-3 text-base text-ink placeholder:text-slate focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        className,
      )}
      {...props}
    />
  );
}
```

`apps/web/src/components/ui/textarea.tsx` — identical classes minus `h-9`, plus `py-2 min-h-20`, on a `<textarea>`; export `Textarea`.

`apps/web/src/components/ui/native-select.tsx`:

```tsx
import { cn } from "../../lib/cn";

// Deliberately a native <select> (ADR-010): Radix Select would swap native
// semantics and turn e2e selectOption updates behavioral.
export function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-sm border border-border-input bg-surface px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
```

`apps/web/src/components/ui/badge.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    variant: {
      neutral: "bg-moss text-slate",
      danger: "bg-danger-tint text-danger-ink",
      warning: "bg-warning-tint text-warning-ink",
      success: "bg-success-tint text-success-ink",
      info: "bg-info-tint text-info-ink",
      brand: "bg-brand-tint text-brand-pressed",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export function Badge({ variant, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

`apps/web/src/components/ui/card.tsx`:

```tsx
import { cn } from "../../lib/cn";

export function Card({ raised = false, as: Tag = "div", className, ...props }: { raised?: boolean; as?: "div" | "li" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("rounded-md border border-hairline bg-surface p-3", raised && "shadow-raised", className)} {...props} />;
}
```

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter web test apps/web/src/components/ui/primitives.test.tsx && pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web/src/lib apps/web/src/components/ui apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): Field Kit primitives — heading/text/data-text/label/button/input/textarea/native-select/badge/card"
```

### Task F3: The seven composites

**Files:**
- Create under `apps/web/src/components/ui/`: `form-field.tsx`, `dialog.tsx`, `tabs.tsx`, `banner.tsx`, `panel.tsx`, `table.tsx`, `empty-state.tsx`
- Test: `apps/web/src/components/ui/composites.test.tsx`
- Modify: `apps/web/package.json` (radix deps)

**Interfaces:**
- Produces:
  - `FormField({ id, label, hint?, error?, children })` — Label + control slot + `Text` hint/error (error in `text-danger-ink`). No react-hook-form (ADR-010).
  - `Dialog({ open, onOpenChange, title, children })` + `DialogFooter` — Radix dialog, `bg-ink/40` overlay, `shadow-overlay` content.
  - `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` — styled Radix tabs (lens switcher). Active trigger: `bg-surface text-ink` on a `bg-moss` list.
  - `Banner({ variant: "warning"|"info"|"danger"|"success", children, actions? })` — tint bg, `-ink` text, lucide icon per variant.
  - `Panel({ title, children, actions?, ...aside-props })` — `bg-surface border-hairline rounded-lg` chrome with a header row.
  - `Table`, `THead`, `TBody`, `TR`, `TH`, `TD` — hairline row borders, `text-xs` uppercase slate header; numeric cells compose `DataText`.
  - `EmptyState({ icon?, title, body?, action? })` — centered invitation (copy per design-system.md: headline names the space, CTA is a verb).

- [ ] **Step 1: Install**

Run: `pnpm --filter web add @radix-ui/react-dialog @radix-ui/react-tabs`

- [ ] **Step 2: Write the failing composites test**

`apps/web/src/components/ui/composites.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Banner } from "./banner";
import { Dialog, DialogFooter } from "./dialog";
import { FormField } from "./form-field";
import { Input } from "./input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

describe("ui composites", () => {
  it("FormField wires label→control and renders an error in danger ink", () => {
    render(
      <FormField id="trip-name" label="Trip name" error="Enter a name">
        <Input id="trip-name" />
      </FormField>,
    );
    expect(screen.getByLabelText("Trip name").tagName).toBe("INPUT");
    expect(screen.getByText("Enter a name").className).toContain("text-danger-ink");
  });

  it("Banner defaults conflict messaging to the warning palette, never danger", () => {
    render(<Banner variant="warning">2 conflicts need attention</Banner>);
    const banner = screen.getByText("2 conflicts need attention").closest("[role=status]");
    expect(banner?.className).toContain("bg-warning-tint");
  });

  it("Dialog opens with a titled, accessible modal", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Edit activity">
        <p>body</p>
        <DialogFooter>ok</DialogFooter>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Edit activity" })).toBeTruthy();
  });

  it("Tabs switch content", async () => {
    render(
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
        </TabsList>
        <TabsContent value="board">board content</TabsContent>
        <TabsContent value="map">map content</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText("board content")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(screen.getByText("map content")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify failure, then implement**

Run: `pnpm --filter web test apps/web/src/components/ui/composites.test.tsx` → FAIL (modules missing).

`apps/web/src/components/ui/form-field.tsx`:

```tsx
import { Label } from "./label";
import { Text } from "./text";

export function FormField({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <Text variant="muted" className="text-danger-ink">{error}</Text>
      ) : hint ? (
        <Text variant="muted">{hint}</Text>
      ) : null}
    </div>
  );
}
```

`apps/web/src/components/ui/dialog.tsx`:

```tsx
"use client";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./button";
import { Heading } from "./heading";

export function Dialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-ink/40" />
        <RadixDialog.Content className="fixed top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-5 shadow-overlay">
          <div className="mb-3 flex items-start justify-between gap-3">
            <RadixDialog.Title asChild>
              <Heading level={3}>{title}</Heading>
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" aria-hidden />
              </Button>
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 flex justify-end gap-2">{children}</div>;
}
```

`apps/web/src/components/ui/tabs.tsx`:

```tsx
"use client";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "../../lib/cn";

export const Tabs = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn("inline-flex gap-0.5 rounded-md bg-moss p-0.5", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "cursor-pointer rounded-sm px-2.5 py-1 text-sm font-medium text-slate transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand data-[state=active]:bg-surface data-[state=active]:font-semibold data-[state=active]:text-ink data-[state=active]:shadow-raised",
        className,
      )}
      {...props}
    />
  );
}
```

`apps/web/src/components/ui/banner.tsx`:

```tsx
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "../../lib/cn";

const variants = {
  warning: { classes: "bg-warning-tint text-warning-ink", Icon: AlertTriangle },
  info: { classes: "bg-info-tint text-info-ink", Icon: Info },
  danger: { classes: "bg-danger-tint text-danger-ink", Icon: OctagonAlert },
  success: { classes: "bg-success-tint text-success-ink", Icon: CheckCircle2 },
} as const;

export function Banner({ variant, actions, className, children, ...props }: { variant: keyof typeof variants; actions?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const { classes, Icon } = variants[variant];
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-sm", classes, className)} {...props}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 gap-1.5">{actions}</div> : null}
    </div>
  );
}
```

`apps/web/src/components/ui/panel.tsx`:

```tsx
import { cn } from "../../lib/cn";
import { Heading } from "./heading";

export function Panel({ title, actions, className, children, ...props }: { title: string; actions?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <aside className={cn("rounded-lg border border-hairline bg-surface", className)} {...props}>
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <Heading level={4}>{title}</Heading>
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </aside>
  );
}
```

`apps/web/src/components/ui/table.tsx`:

```tsx
import { cn } from "../../lib/cn";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-base", className)} {...props} />;
}
export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}
export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}
export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-hairline", className)} {...props} />;
}
export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-2 py-1.5 text-left text-xs font-semibold tracking-wide text-slate uppercase", className)} {...props} />;
}
export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-2 py-1.5 align-top", className)} {...props} />;
}
```

`apps/web/src/components/ui/empty-state.tsx`:

```tsx
import { Heading } from "./heading";
import { Text } from "./text";

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
      {icon ? <div className="text-slate">{icon}</div> : null}
      <Heading level={4}>{title}</Heading>
      {body ? <Text variant="secondary">{body}</Text> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter web test apps/web/src/components/ui && pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web/src/components/ui apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): Field Kit composites — form-field/dialog/tabs/banner/panel/table/empty-state"
```

### Task F4: Enforcement wall (ratchet)

**Files:**
- Create: `scripts/check-color-wall.mjs`, `scripts/design-wall-pending.json`
- Modify: `apps/web/eslint.config.mjs`, root `package.json` (`lint` script)

**Interfaces:**
- Produces: `pnpm lint` now also fails on (a) color literals in `apps/web/src` outside `globals.css`, (b) raw `<button|input|textarea|select|label|h1..h6|table>` or inline `style=` in components outside `ui/` — **except** files still listed in `scripts/design-wall-pending.json`. Re-skin tasks (A/B/C) each delete their files from the pending list; Task I1 asserts it is `[]`.

- [ ] **Step 1: Pending list — every not-yet-re-skinned file**

`scripts/design-wall-pending.json` (verify against `git ls-files apps/web/src` — this is the exhaustive list of current UI files, and it must match reality when you run this task):

```json
[
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/trips/[tripId]/page.tsx",
  "apps/web/src/components/board/ActivityCard.tsx",
  "apps/web/src/components/board/ActivityEditor.tsx",
  "apps/web/src/components/board/AnchorEditor.tsx",
  "apps/web/src/components/board/Board.tsx",
  "apps/web/src/components/board/Column.tsx",
  "apps/web/src/components/board/ConflictBanner.tsx",
  "apps/web/src/components/board/HistoryPanel.tsx",
  "apps/web/src/components/board/LocationInput.tsx",
  "apps/web/src/components/board/MoneyInput.tsx",
  "apps/web/src/components/board/TripBoardScreen.tsx",
  "apps/web/src/components/board/TripMoneySettings.tsx",
  "apps/web/src/components/board/UndoRedoControls.tsx",
  "apps/web/src/components/lenses/CalendarLens.tsx",
  "apps/web/src/components/lenses/DailyOverviewLens.tsx",
  "apps/web/src/components/lenses/FullTripOverviewLens.tsx",
  "apps/web/src/components/lenses/ItineraryLens.tsx",
  "apps/web/src/components/lenses/MapLens.tsx",
  "apps/web/src/components/lenses/TimelineLens.tsx",
  "apps/web/src/components/lenses/TripDateControl.tsx"
]
```

- [ ] **Step 2: The scan script**

`scripts/check-color-wall.mjs`:

```js
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// THE COLOR WALL (design-system.md "Enforcement"): raw color literals live in
// exactly one file. Files on the pending list are pre-M5 surfaces awaiting
// re-skin; the list only ever shrinks (deleted by the task that re-skins them).
const pending = new Set(JSON.parse(readFileSync("scripts/design-wall-pending.json", "utf8")));
const files = execSync("git ls-files 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 'apps/web/src/**/*.css'", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => f !== "apps/web/src/app/globals.css" && !pending.has(f));

const colorLiteral = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/;
const arbitraryValue = /className={?["'`][^"'`]*\[/;
let failed = false;
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (colorLiteral.test(line)) {
      console.error(`${file}:${i + 1}: raw color literal (tokens only — design-system.md)`);
      failed = true;
    }
    if (arbitraryValue.test(line)) {
      console.error(`${file}:${i + 1}: arbitrary Tailwind value (tokens only — design-system.md)`);
      failed = true;
    }
  });
}
if (failed) process.exit(1);
console.log(`color wall OK (${files.length} files scanned, ${pending.size} pending re-skin)`);
```

- [ ] **Step 3: The element/style wall in ESLint**

In `apps/web/eslint.config.mjs`, append a config object after the existing lint-wall block (keep that block untouched). The `ignores` list embeds the same pending files (paths relative to `apps/web`) — **each re-skin task removes its entries here AND in the JSON**:

```js
  {
    // THE ELEMENT WALL (design-system.md): text, controls, and tables render
    // through components/ui primitives; no inline styles. Enumerated inline-
    // style exceptions (drag opacity, map container, computed timeline/calendar
    // geometry) carry a line-level eslint-disable with a reason.
    files: ["src/**/*.tsx"],
    ignores: [
      "src/components/ui/**",
      "src/server/**",
      "src/app/api/**",
      // pending re-skin — mirror of scripts/design-wall-pending.json:
      "src/app/page.tsx",
      "src/app/trips/[tripId]/page.tsx",
      "src/components/board/*.tsx",
      "src/components/lenses/*.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name=/^(button|input|textarea|select|label|h1|h2|h3|h4|h5|h6|table)$/]",
          message: "Render through the components/ui primitives (design-system.md).",
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message: "No inline styles — use tokens. Enumerated exceptions need a line disable with a reason (design-system.md).",
        },
      ],
    },
  },
```

- [ ] **Step 4: Wire into root lint + self-test the wall**

Root `package.json`: `"lint": "pnpm --filter web lint && node scripts/check-lint-wall.mjs && node scripts/check-color-wall.mjs"`.

Self-test (mirrors `check-lint-wall.mjs`'s fixture trick): create `apps/web/src/components/__wall_fixture__.tsx` containing `export function F() { return <button style={{ color: "#ff0000" }}>x</button>; }`, run `pnpm lint`, expect **both** the ESLint rule and the color script to fail; delete the fixture.

- [ ] **Step 5: Run + commit**

Run: `pnpm lint && pnpm --filter web typecheck`
Expected: PASS (pending list shields the unconverted files; `components/ui` and everything else is clean).

```bash
git add scripts/check-color-wall.mjs scripts/design-wall-pending.json apps/web/eslint.config.mjs package.json
git commit -m "chore(lint): design-system enforcement wall — color/element/style ratchet with pending list"
```

---

## Re-skin tracks (parallel worktrees after F4; each task also deletes its files from `scripts/design-wall-pending.json` AND the eslint `ignores` mirror)

> **Re-skin task contract (applies to every A/B/C task):**
> 1. Read `docs/guidelines/design-system.md` first. Use ONLY `components/ui` primitives/composites + token utilities. No new colors, sizes, or shadows.
> 2. Preserve every `data-testid`, `aria-label`, visible text string, and DOM event handler exactly. Replace emoji glyphs (✎ ✕ ⚠️ etc.) with lucide icons **inside an element that keeps the same `aria-label`**.
> 3. Conflict affordances = `warning` variants. Destructive buttons = `destructive`. At most one `primary` Button per screen (the board's is "Add activity"; the trip list's is "Create trip"; lens screens have none).
> 4. All times/dates/amounts through `DataText`. Money formatting logic (`amountMinor / 100` display) is behavior — do not touch it, only re-skin around it.
> 5. Existing component unit tests must pass **unchanged** (they select by role/label/testid). If one fails, your re-skin changed semantics — fix the re-skin, not the test.
> 6. Finish: remove your files from both pending lists → `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` → visual self-check against design-system.md → commit.

### Task A1: Shell — trip list + auth chrome + trip page container

**Files:**
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/app/trips/[tripId]/page.tsx`

**Interfaces:** Consumes F2/F3 components. Produces the page-level container idiom the board screen sits in: `<main className="mx-auto max-w-6xl px-6 py-8">` (this replaces the old body margin from F1).

- [ ] **Step 1:** Re-skin `page.tsx`: page container as above; `Heading level={1}` for the app title; the trip list as `Card as="li"` rows inside a `ul` (`flex flex-col gap-2`); trip names as links (`text-brand font-medium hover:underline`); created dates via `DataText`; "Create trip" as the view's one `primary` Button; sign-in/sign-out as `secondary`/`ghost` Buttons; empty trip list via `EmptyState` (title "Start your first trip", CTA "Create trip"). Trip creation input (if inline) via `FormField` + `Input`.
- [ ] **Step 2:** Re-skin `trips/[tripId]/page.tsx`: same `main` container (wider: `max-w-none px-6 py-6`); anything else in the file is passthrough to `TripBoardScreen` — leave logic alone.
- [ ] **Step 3:** Remove both files from `scripts/design-wall-pending.json` and the eslint `ignores` mirror.
- [ ] **Step 4:** Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Commit:

```bash
git add apps/web/src/app scripts/design-wall-pending.json apps/web/eslint.config.mjs
git commit -m "feat(ui): re-skin trip list, auth chrome, and page containers on Field Kit"
```

### Task B1: Board core — Board, Column, ActivityCard, TripBoardScreen chrome

**Files:**
- Modify: `apps/web/src/components/board/Board.tsx`, `Column.tsx`, `ActivityCard.tsx`, `TripBoardScreen.tsx`

**Interfaces:** Consumes F2/F3. Produces the board idiom B2/B3 slot into: columns are `bg-moss rounded-md p-2` wells with a `flex items-baseline justify-between` header (day name `text-sm font-semibold text-ink`, date via `DataText size="xs"`); the lens switcher renders as `Tabs`/`TabsList`/`TabsTrigger` (keep the exact same visible tab labels and the same state variable/handler — Radix drives the same `setLens`-style callback via `onValueChange`).

- [ ] **Step 1:** `ActivityCard.tsx` — the fully-worked example of the re-skin pattern; produce exactly this shape (adapt prop names to what the file actually has):

```tsx
    <Card
      as="li"
      ref={ref}
      data-testid={`activity-card-${activity.activityId}`}
      // eslint-disable-next-line no-restricted-syntax -- drag opacity is computed per-frame by pragmatic-drag-and-drop state, not expressible as a token class
      style={{ opacity: dragging ? 0.5 : 1 }}
      className="mb-1.5 cursor-grab p-2.5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Text as="span" className="font-medium">{activity.title}</Text>
          {hasConflict && (
            <Badge variant="warning" role="img" aria-label="conflict" title="This activity has conflicts">
              <AlertTriangle className="size-3" aria-hidden />
            </Badge>
          )}
        </span>
        <span className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${activity.title}`}>
            <Pencil className="size-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${activity.title}`}>
            <X className="size-3.5" aria-hidden />
          </Button>
        </span>
      </div>
      {activity.timeWindow && (
        <DataText size="xs">{activity.timeWindow.start}–{activity.timeWindow.end}</DataText>
      )}
      {activity.location && <Text as="span" variant="muted"> · {activity.location.name}</Text>}
    </Card>
```

> `Card` must forward refs for this (`as` + ref: extend F2's `Card` with `React.forwardRef` if the dnd `ref` doesn't attach — that is an allowed `ui/` amendment, committed with this task). Keep the dnd `useEffect` byte-identical.

- [ ] **Step 2:** `Column.tsx` + `Board.tsx`: moss wells per the produced idiom; board layout `flex gap-3 overflow-x-auto pb-2`; columns `w-64 shrink-0`; backlog column identical well with its existing heading; drop-indicator styling may keep its computed inline style **only if** it is geometry (position) — colors come from tokens (`bg-brand` for the drop line).
- [ ] **Step 3:** `TripBoardScreen.tsx`: screen header = `Heading level={2}` trip name + `DataText` date range + the "Add activity"/"Add day" controls (`primary` for Add activity, `secondary` for Add day); lens switcher → `Tabs` (same labels/handler); conflict count chip → `Badge variant="warning"`; keep every handler, hook, and data flow untouched.
- [ ] **Step 4:** Remove the four files from both pending lists. Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Commit:

```bash
git add apps/web/src/components/board scripts/design-wall-pending.json apps/web/eslint.config.mjs
git commit -m "feat(ui): re-skin board core (board/column/activity card/screen chrome) on Field Kit"
```

### Task B2: Board editors — ActivityEditor, AnchorEditor, LocationInput, MoneyInput, TripMoneySettings

**Files:**
- Modify: the five files above under `apps/web/src/components/board/`

**Interfaces:** Consumes F2/F3 and B1's idiom. Every field goes `FormField` + `Input`/`Textarea`/`NativeSelect`/`MoneyInput`; every `<select>` stays a native select via `NativeSelect` (ADR-010 — the currency select's `selectOptions` e2e/unit calls must keep working).

- [ ] **Step 1:** `ActivityEditor.tsx` + `AnchorEditor.tsx`: if the editor currently renders inline (not a modal), keep it inline inside a `Card` — do NOT introduce a `Dialog` where none existed (that would be a behavior change). Fields → `FormField`; save/cancel → `primary`(only if the screen's primary isn't visible simultaneously — if it is, use `secondary` with `font-semibold`)/`ghost`; remove-anchor buttons → `ghost` icon Buttons with unchanged aria-labels.
- [ ] **Step 2:** `LocationInput.tsx`, `MoneyInput.tsx`: swap raw `<input>` for `Input` keeping ALL props (`type="number"`, `step`, `min`, `aria-label`, `defaultValue`, `onChange`) byte-identical — the M4 unit tests (`MoneyInput.test.tsx`, `TripMoneySettings.test.tsx`) must pass unchanged.
- [ ] **Step 3:** `TripMoneySettings.tsx`: currency `<select>` → `NativeSelect`; budget input stays `MoneyInput`; "Clear budget" → `ghost` Button; wrap in `FormField`s with its existing labels.
- [ ] **Step 4:** Remove the five files from both pending lists. Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Commit:

```bash
git add apps/web/src/components/board scripts/design-wall-pending.json apps/web/eslint.config.mjs
git commit -m "feat(ui): re-skin board editors and money controls on Field Kit"
```

### Task B3: History & conflict chrome — ConflictBanner, HistoryPanel, UndoRedoControls

**Files:**
- Modify: the three files above under `apps/web/src/components/board/`

**Interfaces:** Consumes F2/F3. Conflict severity mapping is fixed: everything conflict-related is `warning` (banner, badges); `info` marks time-travel state ("Viewing a past state" style notices); `danger` appears nowhere in these files unless an actual failure message already exists.

- [ ] **Step 1:** `ConflictBanner.tsx` → `Banner variant="warning"` with the existing message text, conflict list, and dismiss/resolve controls as `actions` (ghost/secondary Buttons, unchanged labels/testids). Per-conflict severity chips → `Badge variant="warning"` (a `severity: "block"` chip, if rendered, may use `danger` ONLY if the existing UI already distinguishes it — otherwise warning).
- [ ] **Step 2:** `HistoryPanel.tsx` → `Panel title="History"` (keep the exact existing heading text as the title); entries as a `divide-y divide-hairline` list; timestamps/sequence numbers via `DataText size="xs"`; the selected/previewed entry row gets `bg-brand-tint`; revert/undo affordances keep their labels; any "viewing past state" notice → `Banner variant="info"`.
- [ ] **Step 3:** `UndoRedoControls.tsx` → icon `Button`s (`Undo2`/`Redo2` lucide icons) with unchanged aria-labels and the M4 in-flight guard logic untouched.
- [ ] **Step 4:** Remove the three files from both pending lists. Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Commit:

```bash
git add apps/web/src/components/board scripts/design-wall-pending.json apps/web/eslint.config.mjs
git commit -m "feat(ui): re-skin conflict banner, history panel, undo/redo on Field Kit"
```

### Task C1: Table lenses — Itinerary, DailyOverview, FullTripOverview

**Files:**
- Modify: `apps/web/src/components/lenses/ItineraryLens.tsx`, `DailyOverviewLens.tsx`, `FullTripOverviewLens.tsx`

**Interfaces:** Consumes F2/F3. Produces the ledger idiom: lens data in `Table` composites; every time/date/amount cell wraps `DataText`; amount columns right-aligned (`text-right` TH/TD + `DataText` inside); day subtotal rows `font-medium bg-moss`; the trip total row `border-t border-border-strong font-semibold`; over-budget remaining amounts in `text-warning-ink` (not danger — it corresponds to a warn conflict).

- [ ] **Step 1:** Re-skin the three lenses onto `Table`/`THead`/`TR`/`TH`/`TD` per the idiom. The pure data helpers (`itineraryData.ts` etc.) are NOT touched — presentation only. Section headings → `Heading level={3}`; day dates via `DataText`; empty lens states → `EmptyState`.
- [ ] **Step 2:** Existing lens unit tests pass unchanged (they test the pure helpers + rendered text, not markup).
- [ ] **Step 3:** Remove the three files from both pending lists. Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Commit:

```bash
git add apps/web/src/components/lenses scripts/design-wall-pending.json apps/web/eslint.config.mjs
git commit -m "feat(ui): re-skin itinerary/daily/full-trip lenses as Field Kit ledger tables"
```

### Task C2: Spatial lenses — Map, Timeline, Calendar, TripDateControl

**Files:**
- Modify: `apps/web/src/components/lenses/MapLens.tsx`, `TimelineLens.tsx`, `CalendarLens.tsx`, `TripDateControl.tsx`

**Interfaces:** Consumes F2/F3. These are the enumerated inline-style exceptions: the maplibre container's explicit dimensions and the timeline/calendar *computed geometry* (percent offsets, grid positions) keep inline styles, each line carrying `// eslint-disable-next-line no-restricted-syntax -- computed geometry (position math), not tokenable` — but every **color, font, radius, and shadow** in those computed blocks moves to token classes on the same element.

- [ ] **Step 1:** `MapLens.tsx`: container keeps its sized `div` (disable-with-reason); popups/legends/labels re-skinned on primitives; marker colors: if markers are styled via JS-injected CSS/hex, point them at the token values by reading the CSS variable (`getComputedStyle(document.documentElement).getPropertyValue("--color-brand")`) rather than a literal — if maplibre's API genuinely requires a literal string that can't come from the CSS var, STOP and ask Mitchell rather than hardcoding.
- [ ] **Step 2:** `TimelineLens.tsx` + `CalendarLens.tsx`: geometry inline (disabled with reason), all block colors → `bg-brand-tint border-brand` for activities, conflict marks → warning tokens, hour/day gridlines → `border-hairline`, hour labels/dates → `DataText size="xs"`, headings → `Heading`.
- [ ] **Step 3:** `TripDateControl.tsx`: date input → `FormField` + `Input type="date"` (keep type/handlers; native date input stays native).
- [ ] **Step 4:** Remove the four files from both pending lists (the eslint mirror's `lenses/*.tsx` glob goes away entirely once C1+C2 are both merged — coordinate: whichever merges second deletes the glob). Run: `pnpm lint && pnpm --filter web test && pnpm --filter web typecheck` — PASS. Commit:

```bash
git add apps/web/src/components/lenses scripts/design-wall-pending.json apps/web/eslint.config.mjs
git commit -m "feat(ui): re-skin map/timeline/calendar lenses + date control on Field Kit"
```

---

## Integration (single coordinating session)

### Task I1: Converge — ratchet empty, full check, all e2e green

- [ ] **Step 1:** Merge the A/B/C worktree branches back sequentially (never concurrently — AGENTS.md).
- [ ] **Step 2:** Assert the ratchet closed: `scripts/design-wall-pending.json` is `[]` and the eslint `ignores` mirror lists only `ui/**`, `server/**`, `api/**`. Grep for leftovers: `grep -rn "style={{" apps/web/src --include="*.tsx" | grep -v "components/ui"` — every hit must be an enumerated, disable-commented exception (drag opacity, map container, timeline/calendar geometry).
- [ ] **Step 3:** Run: `pnpm check` — PASS (typecheck, both lint walls + color wall, all unit tests).
- [ ] **Step 4:** Assert the presentational guarantee: `git diff origin/main --stat -- packages/ apps/web/src/server apps/web/src/app/api docs/contracts` shows **nothing**.
- [ ] **Step 5:** e2e, all milestones: `docker compose up -d && pnpm --filter web test:e2e`. Expected: `smoke`, `m1-board`, `m2-history`, `m3-place-and-time`, `m4-money-and-lenses` all PASS. A selector-only fix (e.g. lens switcher `getByRole("button")` → `getByRole("tab")`) is committed as `test(e2e): selector-only update for <reason> (M5 gate allows)`. **Any assertion or flow change: STOP, report to Mitchell.**
- [ ] **Step 6:** Commit any convergence fixes: `git commit -m "chore(ui): close the design-wall ratchet; all M0-M4 e2e green on the re-skin"`.

### Task I2: web-design-guidelines review gate

- [ ] **Step 1:** Start the dev server and walk every surface (trip list, board + editors, history, conflicts, all six lenses, money settings) with the **web-design-guidelines skill** as the checklist — this is the milestone's named review gate. Record findings.
- [ ] **Step 2:** Fix every finding (or bring a finding to Mitchell if the fix would change behavior — never quietly change behavior to satisfy a guideline). Re-run `pnpm check` + e2e after fixes.
- [ ] **Step 3:** Verify AA claims empirically on the rendered app (text/background pairs match the computed table in design-system.md — spot-check with devtools that no unexpected combination exists, e.g. slate-on-moss in a small badge).
- [ ] **Step 4:** Commit: `git commit -m "fix(ui): web-design-guidelines review findings"`.

### Task I3: Verification, docs, PR (no merge)

- [ ] **Step 1:** Invoke superpowers:verification-before-completion: fresh `pnpm check`, fresh e2e run, `pnpm --filter web build` — paste actual outputs, no claims without evidence.
- [ ] **Step 2:** Docs sync: if any token/component drifted from `docs/guidelines/design-system.md` during execution, update the doc in the same commit (they change together). Add the plan link to the milestone file's kickoff record if missing.
- [ ] **Step 3:** Push and open ONE PR: base `main`, head `m5-design-foundations`, title `M5: design foundations — Field Kit tokens, primitives/composites, full re-skin`. Body: summary, ADR-010 pointer, the enforcement-wall description, e2e evidence (all M0–M4 green + any selector-only diffs called out), screenshots of board/history/one table lens/one spatial lens. End with the standard generated-with footer. **Do not merge. Do not tick any gate boxes** — the exit gate closes only after Mitchell's deployed-URL demo, via the gate-close checklist.
- [ ] **Step 4:** Report to Mitchell: PR link, what to demo (walk every Phase-1 surface per the exit gate), and any findings/waivers from I2.

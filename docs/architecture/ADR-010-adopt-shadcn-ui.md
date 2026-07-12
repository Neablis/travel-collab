# ADR-010: Adopt shadcn/ui (re-themed) for the M5 design system

**Status:** Accepted — 2026-07-11
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

M5 introduces the design system: Tailwind tokens, a documented palette, and
shared primitives/composites that become the only way UI code renders text,
inputs, buttons, tables, and dialogs. The milestone file named hand-rolled
primitives as the presumptive default and reserved the library question as a
kickoff decision for Mitchell, with an ADR required if a library is adopted —
adoption is irreversible in practice because the component idiom spreads
through every surface.

Options weighed at kickoff:

- **A. Hand-rolled on Tailwind.** Own components; native `<dialog>` for
  modals. Zero new runtime dependencies, no templated aesthetics, full control;
  cost is owning accessibility details (focus management, aria wiring) and
  building every composite from scratch.
- **B. Hand-rolled + headless Radix for behavior-heavy pieces only.** Buys
  battle-tested a11y for Dialog now, popovers/menus later; adds a dependency
  today for one component native `<dialog>` already covers.
- **C. Adopt shadcn/ui.** Vendored components (Radix + cva + tailwind-merge)
  copied into the repo. Fastest to broad, accessible coverage (Dialog, Tabs,
  Table, form controls) with every file ours to edit; costs a larger dependency
  surface and a strong default aesthetic that must be deliberately overridden.

## Decision

**Option C — adopt shadcn/ui, with two binding conditions.**

1. **The theme layer is wholly ours.** shadcn's stock look (zinc palette,
   default radii/shadows) never ships. All vendored components are re-themed to
   the Field Kit tokens in `docs/guidelines/design-system.md` at adoption time,
   not "later". The templated-look risk that made hand-rolled the presumptive
   default converts into this theming obligation.
2. **Per-component native-semantics rule.** shadcn components based on native
   elements (Button, Input, Badge, Card, Table, Tabs) are adopted freely.
   Radix-based components that *replace* native semantics are adopted only
   where they don't change how users and tests drive the UI: **Dialog yes**
   (only where a modal already exists behaviorally); **Radix Select no** — it
   swaps `<select>` for a listbox, which would turn e2e `selectOption` updates
   behavioral, a red flag under the M5 gate. A styled `NativeSelect` wraps
   `<select>` instead. shadcn's `Form` (react-hook-form) is skipped entirely:
   M5 is purely presentational and existing form logic must not change.

Decided by Mitchell at M5 kickoff, overriding the hand-rolled default with the
trade-offs on the table.

## Consequences

- New dependencies in `apps/web`: `tailwindcss` (v4, already required by M5
  scope), `radix-ui` primitives as pulled in by the vendored components,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.
  Vendored files live in `apps/web/src/components/ui/` and are treated as our
  code — edited freely, never "updated" wholesale from upstream.
- Future composites (popover, dropdown menu, combobox in M6+) have a paved
  path instead of a per-milestone build-vs-buy debate — but each new Radix
  behavior component still passes the native-semantics rule above.
- The component idiom (cva variants, `cn()` merging) becomes the house style
  for UI components; the design-system doc's inventory is the registry.
- The milestone README reserved "ADR-010" for M6 atomic changes; that pointer
  moves to ADR-011 (updated in the same commit as this file).

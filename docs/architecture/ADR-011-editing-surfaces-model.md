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

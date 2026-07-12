# M5 — Design foundations: design record

**Date:** 2026-07-11 · **Deciders:** Mitchell (product/eng), Claude (architect)
**Milestone:** `docs/milestones/M5-design-foundations.md` (gate confirmed
unchanged at kickoff) · **Normative tokens/palette/inventory:**
`docs/guidelines/design-system.md` · **Library decision:** ADR-010

## Goal

Replace the unstyled native-HTML UI with a small, documented design system and
re-skin every Phase-1 surface on it. Purely presentational: zero behavior,
contract, domain, or event changes; all M0–M4 e2e scripts pass unchanged
(selector-only updates acceptable).

## Starting state

`apps/web` has no styling infrastructure at all — no Tailwind, no CSS files
(only maplibre's vendored stylesheet), ~22 components inline-styled with
hardcoded values (`#ddd`, `borderRadius: 6`), `system-ui`, emoji glyphs as
icons. Greenfield for the token layer; nothing to migrate, everything to
re-skin.

## Decisions and rationale

1. **shadcn/ui adopted, re-themed** (Mitchell at kickoff, overriding the
   milestone's hand-rolled default) — full trade-offs and the two binding
   conditions (theme layer wholly ours; per-component native-semantics rule)
   in ADR-010. The consequential rules: Radix Select is not used (styled
   `NativeSelect` keeps `<select>` semantics so e2e updates stay
   selector-only); shadcn `Form`/react-hook-form is skipped (existing form
   logic untouched); Dialog only where a modal already exists behaviorally.
2. **Aesthetic direction: Field Kit** (chosen from three rendered candidates —
   Field Kit / Wayfinding / Editorial Atlas). Cartographic calm: paper white
   `#F7F8F6`, ink navy `#151D2E`, contour-teal brand `#0E7C66`, moss column
   tint, warm semantic hues against a muted base. Signature: **IBM Plex Mono
   for all data values** (times, dates, currency) so ledger surfaces align.
   Type trio: Bricolage Grotesque (display) / IBM Plex Sans (body) / IBM Plex
   Mono (data), self-hosted via `next/font`. Rejected: Wayfinding's per-day
   line-color chips (color must encode meaning, not identity) and Editorial
   Atlas's serif-on-ivory (weak fit for a working tool; current AI-design
   cliché).
3. **Tailwind v4, CSS-first.** The `@theme` block in `globals.css` is the
   single source of truth the milestone requires — tokens are CSS variables,
   readable by both Tailwind utilities and the vendored components.
4. **Token scale:** Tailwind's 4px spacing grid unmodified (constraint is
   lint-banned arbitrary values, not a custom scale); 7-step type scale
   12–30px; radii 6/8/12; exactly two shadows (`raised`, `overlay`);
   breakpoints untouched. Full tables in the design-system doc.
5. **Palette semantics:** brand teal never carries state meaning; semantic
   colors never decorative; **conflicts render warning-amber, never danger-red**
   (Invariant 3 — conflicts are data — made visual); info blue marks
   time-travel/system notices; gradients prohibited in Phase 1 (that
   prohibition *is* the gradient usage rule); day columns stay neutral. All
   documented text/background combos computed ≥ 4.5:1 (weakest: warning text
   on tint, 4.77); form-control borders get a dedicated `border-input`
   `#8A938E` at 3.16:1 because the decorative hairline (1.32:1) fails the
   non-text minimum.
6. **Inventory:** 10 primitives (Heading, Text, DataText, Label, Button, Input,
   Textarea, NativeSelect, Badge, Card — with Button capped at one `primary`
   per view) and 7 composites (FormField, Dialog, Table, Tabs, Banner, Panel,
   EmptyState). Registry lives in the design-system doc and updates in the
   same PR as any addition.
7. **Enforcement wall** (same spirit as the purity wall): CI grep bans raw
   hex/rgb/hsl outside `globals.css`; ESLint bans inline `style={{…}}` outside
   a drag/maplibre allowlist, raw text/control elements outside
   `components/ui/`, and arbitrary Tailwind values.

## Scope of the re-skin

Every Phase-1 surface, all in `apps/web/src` (never `src/server`): app shell
(`layout.tsx` — the `margin: 2rem` body dies), trip list + auth chrome, board
(columns, activity cards, activity/anchor editors, location/money inputs, trip
money settings), conflict banner, history panel, undo/redo controls, lens
switcher, map/timeline/calendar lenses, itinerary/daily/full-trip lenses, trip
date control. Emoji glyphs (✎ ✕ ⚠️) replaced by lucide icons (ships with
shadcn).

## Testing & review model

- **e2e:** all M0–M4 scripts green unchanged; selector-only updates allowed,
  behavioral updates are a gate red flag. No new e2e script — M5 adds no flows.
- **Enforcement:** the lint/grep wall runs in CI from the first system commit,
  so re-skin tasks fail fast if they leak literals.
- **Review gate:** `web-design-guidelines` skill review on each re-skinned
  surface before its task closes; findings addressed or explicitly waived by
  Mitchell.
- **Contrast:** documented combos verified by computation (recorded in the
  design-system doc); any new combo computed before use.

## Out of scope

Per the milestone file: no behavior changes, dark mode, motion design,
responsive redesign, print/export CSS, published component package, or
collaboration UX. No `docs/contracts/CHANGELOG.md` entry — a contract change
means scope crept.

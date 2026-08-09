# M10 — Visual craft pass

**Status:** In progress. Brought forward ahead of M9 (2026-08-08) — see
`docs/architecture/ADR-018-visual-pass-ahead-of-ai-behind-preview-seam.md` and
the design record, `docs/specs/2026-08-08-M10-redesign-incorporation-design.md`.
New order: `M8 ✓ → [Phase 1 gate review ✓] → M10 (this) → M9 → M11 → …`.

## Why this moved ahead of M9

M5 was a full design milestone — tokens, a documented palette, shadcn adoption,
three waves, a re-skin of every surface — and Mitchell still does not like how
the product looks or feels. That is not because it was done badly. **M5 answered
"is it consistent." The open question is "is it obvious," and then "is it
beautiful."** Three different questions; running the first one twice does not
answer the other two.

So the work is split deliberately:

- **"Is it obvious"** is interaction design and lives inside **M8** and **M9**,
  inseparable from the features it shapes.
- **"Is it beautiful"** is this milestone.

The roadmap originally placed this milestone *after* M9, reasoning that M9 adds
an entire new interaction surface — conversation, streaming progress, a
proposal diff — and that M5's own history (Wave 1's re-skin partly redone in
Waves 2–3 as the layout moved underneath it) showed polishing before the
surface inventory is stable means polishing twice. **ADR-018 reversed that
call on 2026-08-08:** an external design team delivered a high-fidelity redesign
of the whole product, including M9's (and M11's) not-yet-built surfaces, drawn
from M9's own exit-gate language. That removes the design-uncertainty objection
the original ordering was protecting against — the surface inventory is now
*specified*, even though it isn't yet *built*. The Phase 1 gate review (the
other precondition the original ordering was waiting on) also closed the same
day. See the ADR for the full argument, including the alternatives rejected.

## Scope

One coherent visual pass over the redesign handoff
(`~/Downloads/design_handoff_trip_planner/`), executed via
`docs/plans/2026-08-08-M10-redesign-incorporation.md`:

- **Real restyle, real data, no behavior change:** Home (next-trip hero,
  sparkline, all-trips grid), Trip plan (sticky header, day-chips row, Timeline/
  Day-columns/Calendar lenses, retained lenses), New-trip and Add-stop dialogs.
- **Inert `<Preview>` shells** (real components, sample data, no-op handlers) for
  surfaces M9 and M11 will make functional: the Assistant rail and in-timeline
  ghost proposals (M9); the Playbooks route, keep-a-day flag + dialog, share,
  add-a-saved-day, and insert-a-Playbook (M11). A registry + sync test keeps
  every shell grep-able and accounted for.
- Per-city day-accent tokens and the bespoke hand-styled elements the handoff
  calls out (day chips, keep-day pennant flag, sparkline bars).
- Clear the accumulated cosmetic debt: **KI-2** (money formatted two ways in the
  same screen), **KI-3**, **KI-4**.
- Explicitly deferred out of this milestone: whether to collapse the lens set to
  match the redesign's 3-view TabStrip (a behavior/IA change, recorded in the
  retro, not acted on here); AI behavior of any kind (M9); Playbook persistence,
  save, share, or the "Keep this day" celebration (M11).

## Exit gate

- [ ] Every surface in the redesign → milestone map (design spec) matches the
      handoff, with before/after screenshots captured.
- [ ] KI-2, KI-3, KI-4 closed or explicitly re-deferred with a reason.
- [ ] **Presentational only:** zero diff to `packages/`, `apps/web/src/server`,
      and `apps/web/src/app/api` (`git diff --stat main -- …` empty), with the
      single Mitchell-approved exception recorded in the retro if the KI-2 fix
      required a `packages/domain` change.
- [ ] No lens added, removed, or merged (the 3 redesign views map onto existing
      Board/Timeline/Calendar lenses; other lenses retained, lightly restyled).
- [ ] Every not-yet-functional surface is behind `<Preview id milestone>`, with
      a registry entry and the registry↔usage sync test green — no shell fires
      a real or fake side effect.
- [ ] All prior milestones' e2e stay green; typecheck/lint/unit/int all green.
- [ ] Retro appended at gate close; roadmap docs (`README.md`, `TODO.md`,
      `docs/STATUS.md`) flipped to this order in the same gate-close commit.

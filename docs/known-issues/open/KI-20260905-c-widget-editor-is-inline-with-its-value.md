### KI-2026-09-05-c — a widget's filter controls render inline beside its value, so the chrome row crowds the sentence it sits in

- **Severity:** cosmetic (user-visible, and it gets worse with every dimension a
  primitive declares — this is the first entry whose symptom is *caused* by an
  accepted design rather than by an oversight).
- **Area:** `apps/web/src/components/pages/editor/widgetBind.tsx`
  (`WidgetBindControls`), `DaysFilter.tsx`, and the node view in
  `MacroNodeExtension.tsx` that renders both the value and its editor inside one
  inline span.
- **What is wrong:** ADR-039 replaced seventeen named widgets with twelve
  primitives that each declare their legal filter dimensions, so `cost` — which
  the legality matrix gives five — reaches the editor as **five controls plus a
  days calendar, laid out inline, inside a paragraph.** The retired widgets
  declared one or two, so the row was never this long before and the inline
  placement never had to carry it. `flex-wrap` stops the row pushing the line
  sideways, which keeps the layout intact without making it good.
- **Reported:** Mitchell, on the PR 141 preview (2026-09-04), twice and from two
  directions:
  - *"The highlight of the select element looks weird, maybe we need to rethink
    the popover selector more, maybe the root of the issue is we need to seperate
    the input editor to be a popover editor, and the inline/block/rendered
    whatever element."* (thread `gjQBcepKXXkF`)
  - and on the days calendar built later the same night, *"I think we can do a
    little better designing this popover, i like the UX, but the ui is a little
    lacking"* (thread `MoDEHsHSo4Z0`).

  His diagnosis in the first is the fix in this entry; the second is downstream
  of it, which is why they are one entry and not two.
- **Why it is filed rather than fixed here:** PR 141 is the widget *vocabulary*,
  and separating the editor from the rendered value is an editor-architecture
  change that lands on two questions nobody has answered:
  1. **Does the popover open on click of the widget itself, or on a small
     affordance beside it?** Click-the-widget is fewer targets, but it collides
     with selecting the node — which is exactly what `KI-2026-09-05-a` is about.
  2. **Does the widget stay a ProseMirror inline atom?** It has to for now
     (ADR-035 decision 1, "one node type, not two"), because a block-level
     editor node is a `PageDoc` migration and that box sits **unowned on M14's
     gate**. But the whole reason a block-shaped widget looks wrong inline is the
     same reason its caret misbehaves, so answering this once settles both.
- **What was fixed in PR 141, so it is not re-found as new:** the row wraps
  instead of overflowing (`flex-wrap`), and the days calendar's cells print a
  real date (`formatTripDate`, three columns) rather than a raw `2027-06-01`
  squeezed into a 64px cell. Neither is the fix; both are the parts that could be
  improved without pre-empting the decisions above.
- **Fix path:** decide (2) first — it is the same decision `KI-2026-09-05-a`
  waits on, and taking it once resolves both entries. Then the node view renders
  **only the value** in the text, and the filters open in a popover anchored to
  it. Note this also **removes a divergence rather than adding a surface**: the
  phone already does exactly this, with a "Showing …" button opening a bind sheet
  (SPEC §19), so desktop would stop being the odd one out. The shared shell is
  where the padding, header and footer live, which is why polishing `DaysFilter`
  as a standalone popover first is work that gets redone.
- **Cross-reference:** `KI-2026-09-05-a` (same node-shape decision),
  `docs/milestones/M14-rich-layer.md` (the unowned block-node box),
  ADR-035 decision 1, ADR-039 decisions 1 and 3,
  `docs/specs/2026-09-04-widget-primitives.md` §8, Vercel toolbar threads
  `gjQBcepKXXkF` and `MoDEHsHSo4Z0`.
- **First noted:** 2026-09-04, on the PR 141 preview.

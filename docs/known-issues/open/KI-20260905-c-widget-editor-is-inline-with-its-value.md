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
- **2026-09-05 overnight review — shares one cause with KI-2026-09-05-a:**
  stream B concluded this entry and KI-2026-09-05-a (the caret parking behind a
  block widget) are two symptoms of the macro node being an **inline atom** in
  ProseMirror while the AST treats it as a block (resolved KI-2026-09-03-d);
  KI-2026-09-05-b is unrelated to both. The same read verified that the chrome
  row itself is *generated* from the widget's declarations with no per-widget
  case, so this is a placement problem, not a per-widget one. Context:
  `../../reviews/2026-09-05-overnight-review/README.md` §"B — Notebook and widget AST".

- **DECIDED, Mitchell, 2026-09-12 — recorded as ADR-044 (`docs/architecture/ADR-044-a-widget-edits-without-reflowing.md`), and the decision reframes the entry rather than just answering it.** *"As long as a widget in edit mode can give a different layout than when in read mode, it's impossible for a user to really get the page they want. We need a way to have the widget have its controls near the element, but not impacting the inline flow of the html, that's why I suggested a popover or something. We need to be considerate of mobile interactions, or click handlers but that is solvable."*
- **The invariant this establishes is bigger than the symptom.** This entry was filed as *cosmetic* — a crowded row. The decision says the real defect is that **edit mode and read mode can disagree about layout at all**, which makes the editor unable to show the user the page they are actually composing. That is a WYSIWYG correctness property, not a cosmetic one, and it is the thing to build against: **the value occupies identical space in both modes; the chrome never participates in inline flow.** Severity above should be re-read in that light.
- **What it settles of the two open questions.** Question 2 — *does the widget stay a ProseMirror inline atom?* — is settled in the affirmative **for the value**, because anything that reflows between modes violates the invariant; ADR-035 Decision 1 ("one node type, not two") stands, and no `PageDoc` migration is implied. Question 1 — *click the widget itself, or a small affordance beside it?* — is settled in direction but not in detail: the controls move **out of flow** into a popover, and Mitchell has explicitly ruled that mobile interaction and the click-handler collision with node selection (`KI-2026-09-05-a`) are **solvable, not blocking**. An affordance *beside* the value would itself occupy inline space, so the trigger has to be the widget or an overlay anchored to it — which is what makes `KI-2026-09-05-a` load-bearing rather than adjacent.
- **Consequently this is no longer blocked on a decision, and it is no longer a one-file fix.** Two dependents pin the current behaviour and must change with it: `apps/web/src/components/pages/editor/WidgetChrome.test.tsx:279-285`, whose guard asserts `cost`'s selects are present with **no interaction**, and `apps/web/e2e/m14-notebook-widgets.spec.ts`, which clicks `cost`'s dates control with no prior "open the popover" step. Both encode the pre-decision behaviour, so both are expected edits rather than scope creep.
- **Recommended shape of the work, for whoever takes it:** a popover trigger anchored to the widget for `shape === "single"` primitives only (so `block`/`repeat` keep the rendering `KI-2026-09-06-c`'s guard depends on), reusing the phone's existing "Showing …" summary button and `bindSummary` rather than inventing a second vocabulary — the affordance the entry's own Fix path already named. Resolve `KI-2026-09-05-a` with it, not after it.

- **The decision is now an ADR, not only a note here.** `ADR-044 — A widget edits without reflowing` carries the invariant, the five rules that follow from it, the two tests that must change with the implementation, and what would falsify it. This entry stays open as the defect; the ADR is the standing decision it is built against.

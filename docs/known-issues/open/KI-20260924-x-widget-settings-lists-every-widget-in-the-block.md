### KI-2026-09-24-x — the settings panel lists every widget in the selected widget's block, numbered, instead of only the one selected

- **Severity:** cosmetic / UX (confusing, not wrong). A fast follow to PR #221, filed at Mitchell's request.
- **Milestone:** M14, carried rather than gating.
- **Area:** `apps/web/src/components/pages/editor/WidgetSettings.tsx` (`numbered`, one entry per `block.entries`), `apps/web/src/components/pages/editor/blockWidgets.ts` (`selectedBlock`), `apps/web/src/components/pages/editor/widgetMarkPlugin.ts` (the 1, 2, 3 marks on inline widgets).
- **Symptom / What happens:**
  - Select one inline widget in a sentence that holds several ("We land on Day 1 in Tokyo and by Day 9 we are in Kyoto").
  - The side panel shows settings for EVERY widget in that paragraph, numbered 1, 2, 3…, and the widgets in the text carry matching number marks.
  - To change the one you clicked, you have to match its number to the right entry in the panel.
- **Wanted (Mitchell, 2026-09-24 on PR #221):** *"Just have 1 selected at a time."* The panel shows only the selected widget's settings, and the number marks go.
- **Why not fixed here:** #221 is the last part of a large stack; this is a panel redesign across the desktop column and the phone bind sheet (both mount `WidgetSettings`), so it follows as its own change.
- **Kept on purpose:** each widget in a sentence is still bound independently (ADR-037 open question 1 as Mitchell settled it: day 1, day 3 and day 9 in one notebook). Showing one at a time changes the panel, not that rule.
- **First noted:** 2026-09-24, Mitchell's review of PR #221.

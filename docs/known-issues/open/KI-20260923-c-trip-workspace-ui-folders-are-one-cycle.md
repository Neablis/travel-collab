### KI-2026-09-23-c — `components/board`, `components/trip` and `components/lenses` import each other: three folders that are one feature

- **Severity:** cleanup. No user impact; the cost is navigational — "which
  folder owns the trip screen's header, editor sheet, focus state and money
  settings" has no answer, so a new piece lands wherever the last one did, and
  the architecture wall can only warn about the cluster rather than hold it.
- **Area:** `apps/web/src/components/board/`, `apps/web/src/components/trip/`
  (with `trip/editor/` and `trip/context/`), `apps/web/src/components/lenses/`;
  `KNOWN_CYCLE_CLUSTERS` and rule `no-folder-cycle-known` in
  `.dependency-cruiser.cjs`.

- **Symptom.** Seven folder-cycle reports after the first run's cleanup, all
  inside these folders. The edges that close them (dependency-cruiser,
  2026-09-23):
  - `board → trip` (23): `TripBoardScreen.tsx` composes the trip shell —
    `TripHeader`, `TripProvider`, `FocusProvider`, `EditorHost`, `LensRouter`,
    `ActivityEditorSheet`, `UnscheduledRack` — and `Board.tsx` reads
    `centralDay`, `FocusProvider`, `KeepDayFlag`.
  - `trip → board` (5): `trip/TripHeader.tsx` renders `board/HistoryPanel` and
    `board/UndoRedoControls`; `trip/SettingsSheet.tsx` renders
    `board/TripMoneySettings`; `trip/editor/ActivityEditorSheet.tsx` renders
    `board/ActivityEditor` and uses `board/activityCommands`.
  - `lenses → trip` (6) and `trip → lenses` (1:
    `trip/SettingsSheet.tsx` → `lenses/TripDateControl.tsx`);
    `board → lenses` (7).

  So `board` is both the screen that hosts the trip shell and a library of
  widgets the shell renders, and `trip` is both.

- **What the first run already removed from this cluster** (so this entry
  describes only the residue): `formatMoney`, `activityTags`, `useIsPhone` and
  the pure half of `DayChips` (`chipModel`, `cityFor`) moved to `lib/`, which
  took `components/ui`, `components/pages`, `components/assistant` and `lib`
  itself out of the cycle — 55 folder-cycle reports to 9.

- **Why not fixed here.** What is left is not a helper in the wrong place; it
  is a folder layout decision. Two honest shapes: (1) one `components/trip/`
  feature folder with `board/`, `lenses/`, `shell/` beneath it, so the cycle
  becomes internal and the wall stops seeing it — cheap, and it concedes the
  three are one feature; or (2) keep three folders and move the shared widgets
  (`HistoryPanel`, `UndoRedoControls`, `TripMoneySettings`, `ActivityEditor`,
  `TripDateControl`) to whichever folder is the leaf, making the direction
  `board → trip → widgets`. (2) is the one that keeps the wall meaningful, and
  it touches ~40 import sites, which is a PR of its own, not a litmus pass.

- **Cross-reference:** `KI-2026-09-23-a`, `KI-2026-09-23-b`,
  `docs/reviews/2026-09-23-architecture-wall-first-run.md`.
- **First noted:** 2026-09-23, the first run of `pnpm arch`.

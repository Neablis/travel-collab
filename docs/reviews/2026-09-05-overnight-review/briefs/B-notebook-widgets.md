# Stream B — Notebook and the widget AST

Question: **Is the widget system a framework for the next fifty widgets, or a
hand-built set of twelve?** Mitchell: *"the existing widgets are supposed to be
a framework for many more to come, not the final set. I want clean extensible
common sense rules for how to generalize making a widget, and expand upon
them."*

Read first, in this order:
- ADR-035, ADR-037, ADR-038, ADR-039 (`docs/architecture/`)
- `docs/specs/2026-09-03-notebook-widget-catalogue.md`, `docs/specs/2026-09-04-widget-primitives.md` (esp. §8 what is owed)
- `packages/contracts/src/pageDoc.ts` (640 lines — the AST), `pages.ts`
- `packages/pages/src/**` — `registry.ts`, `registry-types.ts`, `presets.ts`, `select.ts`, `filters.ts`, `insert.ts`, `templates.ts`, `macros/primitives/*.ts`
- `apps/web/src/components/pages/**` — `PageScreen`, `NotebookScreen`, `MacroView`, `WidgetPicker`, `WidgetInsert`, `editor/*` (`widgetBind.tsx`, `useSlashMenu.ts`, `DaysFilter.tsx`, `storedPageDoc.ts`, TipTap node extensions), `blocks/*`
- `apps/web/src/server/pages.ts`, `server/ai/pageTools.ts`, `server/ai/markdownToPageNodes.ts`
- Tests beside each; `packages/pages/src/test-support/*`

Do this concretely:
1. **Write the recipe.** As if you were adding widget #13 (pick a realistic
   one: "weather for a day", "packing checklist", "budget vs actual per
   person"). List every file you would have to touch, in order, and what
   would fail to tell you if you missed one. Count the files. Anything not
   caught by a type error or a test is a finding.
2. **Then do it for a new FILTER dimension** (e.g. `person`, which the spec
   says is declared but has no control) and a new SHAPE / arity. Same count.
3. **Find the seams that are not seams:** places where the registry is
   re-enumerated by hand (switch on widget id, hand-written union of names,
   preset table diverging from registry, picker keyword list, e2e helpers,
   AI tool schemas in `pageTools.ts`, the simulated model, `markdownToPageNodes`).
   ADR-039 says presets are data — is anything still keyed on a preset NAME?
4. **The AST:** are node types closed (discriminated union) or open? How does
   a client that does not know a node behave (STATUS says TipTap discards the
   whole doc — is the vocabulary guard the only defence, and does it cover
   `repeat`)? Is `attribute` "generic behind an allow-list" actually enforced
   at parse time? Where is the `v` version stamped, and can a node be added
   WITHOUT bumping `v`?
5. **Chrome / UX consistency rules:** does each primitive get its filter
   controls generated from its declared dimensions (as STATUS claims), or are
   there per-widget special cases in `DaysFilter` / `widgetBind`? KI-2026-09-05-a/b/c
   describe three UX defects — are they symptoms of one structural cause?
6. **Server-side rendering vs client:** where are widgets resolved (server?
   client? both?), what is the resolver's input contract, and what happens
   when the trip changes under an open page (stale bind, deleted day)?
7. **Rules that should exist.** Draft the "how to add a widget" and "what a
   widget may/may not know" rules you would want in `AGENTS.md` or a
   `docs/guidelines/widgets.md`, based on what the code actually does well.
   Put them under a `### Proposed rules` heading — that is a deliverable, not
   a finding.

Also report **Patterns**: what in this package is clean and should be copied
elsewhere in the repo.

### KI-2026-11-01-aa — `EdgeDef` in `lib/adminPersonas.ts` duplicates `DebugEdge` in `lib/askDebug.ts` — RESOLVED

- **Severity:** cleanup (two copies of one wire type drift).
- **Area:** `apps/web/src/lib/adminPersonas.ts` (`EdgeDef`, line 22), `apps/web/src/lib/askDebug.ts` (`DebugEdge`, line 31).
- **Symptom / What happens:** part 5 and part 6 each declared the persona edge's wire shape. Changing one without the other compiles until the console and the Ask panel disagree.
- **Why not fixed here:** PR 674's review marked it known-not-fixed (finding 6); the fix touches code, and the close is prose only. Fix: one type, imported by both.
- **Cross-reference:** PR 674, PR 673.
- **First noted:** 2026-11-01, M57 part 6 review.
- **Resolution (2026-11-14):** one declaration. `DebugEdge` in `lib/askDebug.ts` takes its persona
  id type as a parameter (`DebugEdge<Id extends string = DebugPersonaId>`). The Ask panel keeps the
  default, and `lib/adminPersonas.ts` exports `EdgeDef = DebugEdge<string>`, because the console's
  map is passed in and may name a persona the union does not. A field added to the one interface
  now reaches both ends. Proven by `tsc --noEmit` in `apps/web` and the unchanged unit and int tests
  of both consumers. No regression test: what this fixes is a duplicate declaration, and no test
  can catch a third copy someone writes later.

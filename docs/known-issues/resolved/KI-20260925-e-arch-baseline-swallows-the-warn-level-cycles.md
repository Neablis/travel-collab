### KI-2026-09-25-e — `pnpm arch:baseline` writes the warn-level folder cycles into the baseline, silencing the warnings the config promises on every run — RESOLVED

- **Severity:** reliability of a check — a regenerated baseline hides what the
  wall is meant to keep printing.
- **Area:** root `package.json` (`arch:baseline`: `depcruise-baseline apps/web/src packages/*/src`),
  `.dependency-cruiser.cjs` (`KNOWN_CYCLE_CLUSTERS` and its header, which says
  the known folder cycles are warnings "printed on every run"),
  `.dependency-cruiser-known-violations.json`.
- **Symptom:** `depcruise-baseline` records every current violation, warn level
  included. Regenerating the baseline as the config header describes therefore
  adds the nine `no-folder-cycle-known` warnings to the known-violations file,
  and `pnpm arch` stops printing them. KI-2026-09-23-d's fixer (2026-09-25)
  hand-edited the file to `[]` rather than regenerate it for exactly this
  reason.
- **Why not fixed here:** found in passing by the overnight sweep. Intended
  fix: make `arch:baseline` keep only error-severity violations (filter the
  generated JSON, or a wrapper script), and say so in the config header.
- **Cross-reference:** KI-2026-09-23-b, KI-2026-09-23-c (the cycles themselves).
- **First noted:** 2026-09-25, overnight KI sweep.
- **Resolved 2026-09-25 (overnight sweep).** `pnpm arch:baseline` is now `node scripts/arch-baseline.mjs`. It runs `depcruise --output-type baseline` over the same targets and keeps only violations whose `rule.severity` is `"error"`, then writes `.dependency-cruiser-known-violations.json` in the same format (sorted, two-space indent, trailing newline). The header of `.dependency-cruiser.cjs` now says so, and says not to regenerate with bare `depcruise-baseline`. **Reproduction:** with the real file backed up and restored afterwards, the old `depcruise-baseline apps/web/src packages/*/src` wrote 9 entries, and all 9 were `no-folder-cycle-known | warn` (7 in the board/trip/trip-editor/lenses cluster, 2 for billing ↔ entitlements). **Correction to the Symptom:** with that 9-entry file in place, `pnpm arch` *still* printed `x 9 dependency violations (0 errors, 9 warnings)`. dependency-cruiser 18.4.0's `analyze/soften-known-violations.mjs` softens module- and dependency-level entries only. It has an explicit `// TODO: folder level violations`, so today folder-cycle entries in the baseline do nothing. The silencing is latent: it happens the day dependency-cruiser closes that TODO, or the day a module-level rule is set to `warn`. What was real today was a baseline file polluted with 9 inert entries that read as "accepted". **After the fix:** `pnpm arch:baseline` prints `0 error-severity violation(s) written …; 9 warn/info-level left out`, the file stays `[]`, and `pnpm arch` prints 9 `warn no-folder-cycle-known` lines. **Regression test:** `scripts/__tests__/arch-baseline.test.mjs` feeds a fixture (one warn folder cycle, one error dependency) through `--from`. With the filter changed to `return violations;` both tests fail: `deepStrictEqual` shows the `no-folder-cycle-known` / `severity: 'warn'` entry as `+ actual`, and the warn-only case writes a non-empty array instead of `"[]\n"`. Restored, 2/2 pass. **Checks:** `node --test scripts/__tests__/arch-baseline.test.mjs` (2/2), `pnpm arch` (0 errors, 9 warnings), and the KI filename/citation and docstring walls.
- **Decision (2026-09-25 overnight sweep):** filter at the source by using a wrapper script, and keep error severity only (warn *and* info are excluded). Rejected alternatives: (a) mark the entry DOWNGRADED because the warnings still print today. The file was still polluted, and the silencing is one dependency upgrade away. (b) `--baseline` in `shrink-only` mode, which stops new entries being added but would keep any warn entries already present, and does not state the rule. (c) post-filtering `depcruise-baseline`'s output file in place with `jq` in `package.json`, which adds a tool dependency and is harder to test.

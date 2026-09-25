### KI-2026-09-25-e — `pnpm arch:baseline` writes the warn-level folder cycles into the baseline, silencing the warnings the config promises on every run

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

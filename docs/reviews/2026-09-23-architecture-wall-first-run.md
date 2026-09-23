# Architecture wall — first run, and what it was worth as a cleanup tool

**Date:** 2026-09-23
**Asked by Mitchell:** evaluate the architecture-map plan
(`docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md`), then —
on the recommendation to adopt dependency-cruiser and baseline its findings —
*"Don't just accept all the violations, let's take a pass and try to clean up
using the first run as a litmus test for how much this helps clean up code."*
**Nature:** tool adoption, a cleanup pass made of file moves, three KIs for
what a move could not fix, and this record.

---

## The verdict first

**It paid for itself on the first run, and not where the spec expected.** The
spec's drift conditions are about the map disagreeing with code. The first
run's value was the code disagreeing with its own **ADRs** — twice — and a
dependency tangle nobody had drawn:

| | before | after this pass |
|---|---:|---:|
| folder-level cycle reports | **55** | **9** (all inside two named clusters, warn-only) |
| largest server tangle (folders + root files in one strongly-connected component) | **14** | 6 (identity/entitlements/billing) and 4 (planning/access), both KI'd |
| largest UI tangle | **10** incl. `lib` and `components/ui` | 4 (`board`, `trip` with its subfolders, `lenses`, and `components/SaveLight.tsx` via a type-only import) |
| runtime (non-type-only) file cycles | 0 | 0 |
| module-map "knows no trips" violations | **0** | 0 |
| ADR claims found false | — | **2** (ADR-043's "a `git mv`", ADR-047's "nothing closes a cycle") |
| wall runtime | — | ~2 s, inside `pnpm lint` |

Every fix in the pass was a **file move or a function extraction**; no logic
changed. Nine findings were real, six were fixed here, three need a design
call and are filed. The three false positives are named below and are handled
by a rule rather than by a baseline.

**What it did not find, as the spec predicted (Decision 4): duplication.** The
KI-o class — 21 files hand-enumerating the same fields — is invisible to an
import graph. A dependency wall answers *"who may know about whom"*; it says
nothing about *"is this written twice"*.

## How the run was set up, and the trap in it

`dependency-cruiser` 18.4, root devDependency, config `.dependency-cruiser.cjs`,
wired as `pnpm arch` at the end of `pnpm lint`.

**The first run was silently empty.** From the repo root, `apps/web/tsconfig.json`
declares `paths` with no `baseUrl`, and dependency-cruiser's tsconfig-paths
plugin then resolves them against the working directory — so **all 1,164 `@/`
imports resolved to nothing**, the graph had no app edges, and every rule
passed. A second pass resolved `.ts` targets but not `.tsx`. Both were fixed
(`tsconfig.depcruise.json`, an explicit `extensions` list), and the config now
carries `every-local-import-resolves`: breaking the resolver on purpose turns
the run from green to **1,164 errors**. A wall over an empty graph is the
"boundary that fails silently" ADR-043 already paid for once.

## Findings, triaged

| # | Finding | Verdict | Action |
|---|---|---|---|
| 1 | `server/ai` ↔ `server/assistant`: the kernel imported six pure modules from `ai/` (`context`, `limits`, `idFields`, `markdownToPageNodes`, `batchResolver`, `askAnalytics`), and `askAnalytics` imported the kernel back | **real** — ADR-043 says the extraction to a package "becomes a `git mv`"; with the kernel importing `ai/*` it could not | **fixed**: the six moved into `assistant/`; `geocodeRegion` → `geocoding/region` (public API routes use it, and a route importing the kernel is backwards). The eslint allowlist lost six entries; `check-lint-wall.mjs` now proves the module-list branch with `geocoding/region` and the barrel as the near-miss |
| 2 | `lib/cost.ts` → `components/lenses/formatMoney`; `components/ui/budget-meter` → the same | real — `lib` and `ui` are leaves | **fixed**: `formatMoney` → `lib/` |
| 3 | `lib/askThreadStore.ts` → `components/assistant/Transcript` | real — a store of a UI type living in `lib` | **fixed**: store → `components/assistant/` (and its jsdom entry in `vitest.unit.config.ts`, which would otherwise have moved the test to the wrong environment silently) |
| 4 | `pages`, `assistant`, `home`, `lenses` → `components/trip/DayChips.tsx` for `chipModel`/`cityFor` | real — pure functions imported out of a React component file | **fixed**: extracted to `lib/dayChips.ts`; the component keeps the rendering |
| 5 | `useIsPhone` in `components/lenses`, used by `board`, `pages`, the home page | real | **fixed**: → `lib/` (which already holds hooks, e.g. `today.ts`) |
| 6 | `activityTags` in `components/board`, used by `lenses`, `trip` | real — constants over a contract | **fixed**: → `lib/` |
| 7 | `server/billing` → `server/entitlements/planVersions` ×5, `→ usage` ×1 | **real, and contradicts ADR-047 decision 1** | **KI-2026-09-23-d** — three candidate fixes, a design call |
| 8 | `entitlements/admin.ts` composes Billing's revenue into the tier panel | real, deliberate per its header | in **KI-2026-09-23-d** as option 3 |
| 9 | Access ↔ Planning (`access/*` → `getTripDetail`; `projections.ts`/`commands.ts` → `access/members`) and Identity ↔ Entitlements via `auth.ts` | real; Planning → Access half is deliberate and commented | **KI-2026-09-23-b** — and **the wall cannot see either** (below) |
| 10 | `board` ↔ `trip` ↔ `lenses` | real — three folders, one feature | **KI-2026-09-23-c** — a folder-layout decision, ~40 import sites |
| 11 | three file-level cycles (`apiClient`↔`queryCache`, `defineTool`↔`grants`↔`registry`, `pages/filters`↔`registry-types`) | **false positive** for runtime — every one passes through a type-only import | rule is `no-runtime-cycle` (type-only edges excluded), not a baseline entry |
| 12 | `entitlements` → `assistant/entitlements.ts` (ceiling and capability types) | **intended** — ADR-043 §5 puts the entitlement port in the kernel for M20 to fill | none |

## The blind spot, stated so a green line is not over-read

dependency-cruiser's folder-scope cycle rule **does not report a cycle between a
folder and its own subfolder**. Four modules — Trip Planning, Identity, flags,
and loose chrome like `components/SaveLight.tsx` — live as files in a parent
folder's root, so their cycles with `server/access/`, `server/entitlements/` or
`components/trip/` are parent↔child and invisible. Finding 9 was found by a
strongly-connected-components pass written for this review, not by the wall.
The structural fix is `KI-2026-09-23-b`'s: give each root module its own folder.
Until then the wall's claim is *"no cycle between sibling folders"*, not *"no
cycle"*.

## What the known violations are, and are not

Not a blanket acceptance. After the cleanup, what remains is named in two
places, each entry owned by a KI:

- `KNOWN_CYCLE_CLUSTERS` in `.dependency-cruiser.cjs` — one regex per KI. A
  folder cycle wholly inside a cluster **warns** on every run; a cycle that
  reaches any folder outside it **fails**.
- `.dependency-cruiser-known-violations.json` — the six Billing → Entitlements
  imports, and only those. dependency-cruiser's baseline cannot hold folder
  cycles, which is why the clusters live in the config instead.

Proven by sabotage before commit, each restored afterwards: `lib` importing a
component → `no-folder-cycle` (17 errors); Billing importing the resolver →
`billing-imports-no-entitlements`; Entitlements importing `projections` →
`entitlements-knows-no-trips`; the kernel importing `ai/askIntent` →
`no-folder-cycle` on `ai` ↔ `assistant`; the resolver broken → 1,164
`every-local-import-resolves` errors.

## What this says about the rest of the plan

- **The generated diagram is the weakest part.** `pnpm arch:graph` exists and
  emits 395 lines of Mermaid at module granularity — correct, and nobody will
  read it. The spec's Risk 2 is real at this repo's size. The next step is the
  query form (`pnpm map --for <path>`), not a committed picture.
- **The rules are the strongest part.** The module map's "does NOT know about"
  column held perfectly for trips (0 violations across Entitlements, Billing
  and Identity), and the two ADR contradictions were in the column the map
  never had: *direction between two non-planning modules*. That is worth
  encoding as each ADR is written, in the same PR.
- **`entitlements/moduleBoundary.test.ts`'s import half is now a second wall
  over the same boundary** (a regex over `^import … from "…"`, which misses
  `export … from` and dynamic `import()`). It was left in place here — deleting
  a guard is its own decision — but `entitlements-knows-no-trips` resolves
  imports rather than matching them, and the two can now disagree.

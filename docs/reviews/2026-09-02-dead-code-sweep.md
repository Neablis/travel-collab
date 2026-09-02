# Dead-code sweep — 2026-09-02

Branch `worktree-agent-a89052f3f6c722a87`. Five commits, `d31c7be`…`f2436d9`.

**Headline: this codebase is unusually clean, and that is the finding.** A
whole-tree sweep of all **1,130 exported symbols** turned up **five** whose only
textual reference anywhere in the repo is their own definition line. Two of
those five are Next.js framework contracts. The `/ai` retirement (`db5a5cb`)
left **zero** orphans. Most of what a dead-code tool flags here is a false
positive, and the interesting half of this document is *why*.

---

## 1. Tooling

### knip, via `pnpm dlx` — usable, with two caveats

```
pnpm dlx knip --no-exit-code --reporter json
```

No config exists in the repo and none was added (adding a devDependency is a
design decision, not tonight's call — see the recommendation in §6). A throwaway
`knip.json` was written at the repo root for the run and deleted before the
first commit; it is preserved outside the repo at the scratchpath and reproduced
here so the run can be repeated:

```json
{
  "workspaces": {
    "apps/web": {
      "entry": [
        "src/app/**/{page,layout,template,loading,error,not-found,global-error,route,default,sitemap,robots,opengraph-image,icon,apple-icon,manifest}.{ts,tsx}",
        "src/proxy.ts", "src/instrumentation.ts", "src/instrumentation-client.ts",
        "sentry.*.config.ts", "sentry.shared.ts", "next.config.ts",
        "drizzle.config.ts", "playwright.config.ts",
        "vitest.config.ts", "vitest.unit.config.ts", "vitest.setup.ts",
        "eslint.config.mjs", "postcss.config.mjs",
        "e2e/**/*.ts", "scripts/**/*.{ts,mjs}",
        "src/mocks/**/*.ts", "src/test-support/**/*.ts", "**/*.test.{ts,tsx}"
      ],
      "project": ["src/**/*.{ts,tsx}", "e2e/**/*.ts", "scripts/**/*.{ts,mjs}", "*.{ts,mjs}"],
      "ignoreBinaries": ["playwright"],
      "ignoreDependencies": ["@tailwindcss/postcss", "tailwindcss"]
    },
    "packages/*": {
      "entry": ["src/index.ts", "src/*.ts", "test/**/*.ts", "**/*.test.ts"],
      "project": ["src/**/*.ts", "test/**/*.ts"]
    }
  }
}
```

**Caveat 1 — dependency findings from this run are not trustworthy.** Under
`pnpm dlx`, knip runs outside the workspace's `node_modules` and could not load
nine config files:

```
ERROR: Error loading apps/web/vitest.config.ts (Cannot find module 'vitest/config')
ERROR: Error loading apps/web/playwright.config.ts (Cannot find module '@playwright/test')
ERROR: Error loading apps/web/drizzle.config.ts (Cannot find module 'drizzle-kit')
  (+ the five packages' vitest.config.ts)
```

Anything those configs consume therefore looked unused. That is the direct cause
of six of the eight flagged devDependencies. Every dependency verdict below was
re-derived by hand instead.

**Caveat 2 — the config above misses `.mts`.** Both `scripts/**/*.{ts,mjs}` and
a naive `grep --include='*.ts'` are blind to `.mts`, and this repo has
`apps/web/scripts/geocode-japan-seed.mts`. It is the sole importer of
`server/ai/geocodeNameMatch.ts` (`placeNameVerdict`, `nameTokens`), which would
otherwise read as an orphaned module. `server/savedDayCities.ts` is in the same
position via `scripts/backfill-saved-day-cities.mjs`. **Any future sweep must
glob `.mts`/`.cts` or it will propose deleting live code.**

### Manual cross-check — a whole-tree textual sweep

Independent of knip, a script enumerated every `export function|const|class|`
`interface|type|enum` across all non-`.design-sync` source (1,130 symbols) and
counted references for each across **every** tracked `.ts/.tsx/.mjs/.js/.json/.md`
— docs and ADRs included, so a symbol mentioned only in prose still shows up.
Symbols with ≤1 total references:

| Symbol | Verdict |
|---|---|
| `route.ts:23 maxDuration` | Next.js route segment config — **framework contract, kept** |
| `instrumentation-client.ts:42 onRouterTransitionStart` | Next.js/Sentry instrumentation hook — **framework contract, kept** |
| `preview-registry.ts:90 PreviewMilestone` | dead — **deleted** |
| `kindOverrides.ts:53 STILL_TO_BOOK` | dead — **deleted** |
| `pages/src/index.ts:3 PACKAGE` | dead — **deleted** |

This sweep and knip agreed on every genuine finding, which is the main reason to
trust the result.

---

## 2. What was removed

**5 commits · 18 files · 38 lines deleted, 21 inserted (net −17) · 0 files
deleted · 1 dependency removed.**

The line count is deliberately small. Nothing here was deleted on suspicion.

### `d31c7be` — four exports nothing references

| What | Where | Evidence |
|---|---|---|
| `export { DEMO_TRIP_ID, isDemoTripId }` | `apps/web/src/server/demoTrip.ts:42` | A pure re-export of `@/lib/demoTrip`. All six importers of `server/demoTrip` take only the `demoTrip*` functions; **both of its own test files** import the two ids from `@/lib/demoTrip` directly. The now-unused `isDemoTripId` import was dropped with it. |
| `PreviewMilestone` | `apps/web/src/lib/preview-registry.ts:90` | Type alias, no reader. Sibling `PreviewId` is used by `ui/preview.tsx:2` and kept. |
| `PACKAGE` | `packages/pages/src/index.ts:3` | Scaffold marker (`"@tc/pages" as const`). Not a convention — no other package has one. |
| `STILL_TO_BOOK` | `packages/fixtures/src/japan/kindOverrides.ts:53` | Added by M18's own gate commit `85f9515` and never wired to anything. `git log -S` confirms it has been unreferenced since the line was written. |

### `892242f` — ten symbols unexported

Each has a live caller; every caller is in the same file. No test imports any of
them. These were widening a module's surface for no reader.

`cloneDemoTrip` · `MAX_LOGGED_CAUSE_CHARS` · `describeFailure` · `ReadTripInput`
· `ASK_INTENT_MARKER` · `askIntentPrompt` · `useSaveLight` · `parseLocalDate` ·
`seasonLine` · `PHONE_MAX_WIDTH_PX`

`ASK_INTENT_MARKER` deserves a note: its own comment argues that its writer and
reader belong in one module. Unexporting it is that comment enforced. Its
reader, `isAskIntentCall`, stays exported — that is the seam `simulatedModel.ts`
actually imports.

### `d553202` — `zod` dropped from `@tc/domain`

`zod` appears nowhere in `packages/domain` — not in `src`, not in `test`, not in
its vitest config. The dependency line was its only occurrence in the package.
Domain's schemas arrive as inferred types through `@tc/contracts`, which
declares zod itself.

This turns Invariant 4's "depends only on contracts" from a convention into the
manifest. The risk being tested was pnpm's strict linking breaking
transitively-resolved zod types in consumers; `pnpm -r typecheck` green across
all seven packages says it does not. Lockfile delta is three lines.

### `e9d7fc6` — `DEMO_SHARE_TOKEN` dropped from `.env.example`

ADR-031 retired it when the demo trip became the in-memory fixture;
`readFeaturedShare` and `GET /api/shares/featured` went with it. All eleven
surviving mentions — ADR-027, ADR-031, KI-061, KI-079 and four source comments —
describe it in the past tense. `.env.example` was the last place still
presenting it as a live setting, with fill-in instructions for a flow that no
longer reads it.

### `f2436d9` — three references to things that no longer exist

- `AddSavedDayButton.tsx` sited itself "outside the still-shelled
  `<Preview id="insert-playbook">`". M11b (`13f1302`) deleted that shell;
  `preview-registry.test.ts:209` now asserts all four PLAYBOOKS ids are absent.
- `writeTools.ts` referred to "the older `/ai` command endpoint" and pointed at
  a note "for where that leaves `/ai`". `/ai` was deleted in `db5a5cb`.
- `ui/dialog.tsx` carried an `eslint-disable-next-line no-restricted-syntax`
  suppressing nothing — eslint reported it as an unused directive. The rationale
  it carried is real and kept as a plain comment; only the directive went.
  **`pnpm --filter web lint` now exits with zero warnings; it previously
  reported one.**

---

## 3. False positives rejected

This is the substantive half of the sweep. Nothing in this table was deleted.

| Flagged | Why it is not dead |
|---|---|
| **`apps/web/src/components/ui/panel.tsx`** (knip's only "unused file") | Genuinely has no *app* importer, and has had none since M5 (`df3a37f`) — but `components/ui` is the design-system surface: `.design-sync/config.json` sets `"srcDir": "src/components/ui"`, `.design-sync/previews/Panel.tsx` does `import { Panel, Button } from "web"` with two stories, and `.design-sync/docs-stubs/Panel.md` documents it. Deleting it breaks the design-sync harness. **See §5 — this is a decision for Mitchell, not a sweep.** |
| **All 14 "unused types"** (`AskOutcome`, `AskFailureCause`, `AskToolCallRecord`, `AskStepLike`, `TripDayReadout`, `StopReadout`, `FreeTimeGapReadout`, `BatchResolutionError`, `MapStop`, `TimelineTimedItem`, `TimelineUntimedItem`, `PendingUnit`, `Confirmed`, `FocusOrigin`, `ToolNote`, `ProposalStatus`, `AdmissionGrant`, `GeocodeOptions`) | Every one is a **named constituent of an exported interface or type** (e.g. `AskToolCallRecord` is the element type of `AskRecord.toolCalls`), or a barrel re-export (`geocoding/index.ts:5`). Unexporting them would make the exported parent's fields un-nameable by consumers. knip cannot see this; it is a whole class of false positive here. |
| **`ProposalApplyRecord`** (`handleAskRequest.ts:777`) | Used by `ask/apply/route.int.test.ts:23` via `type X = import("…").ProposalApplyRecord`. knip's static pass misses the **dynamic `import()` type form**. Also cited by ADR-032. |
| **`signIn`, `signOut`** (`server/auth.ts:16`) | Members of `export const { handlers, auth, signIn, signOut } = NextAuth({…})`. Standard Auth.js server-action surface, and the file's own comment says "Exported names are unchanged from before the split — many modules depend on them." |
| **`readAll`, `parseStdin`, `ask`** (`scripts/hooks/lib/run-context.mjs`) | Imported by four live hook scripts (`subagent-file-scope`, `resource-lease`, `run-teardown-reminder`, `subagent-report-conformance`). knip's root workspace used defaults that did not cover `scripts/hooks/**`. |
| **`scripts/classify-test-envs.mjs`, `coverage-overlap.mjs`, `sync-launch-config.mjs`** | `node`-invoked CLI tools, not imports. `sync-launch-config.mjs` is wired into `.claude/settings.json:13` as a hook; the other two are documented in `docs/testing-baseline.md` and `docs/testing-inventory.md`. |
| **All 33 `.design-sync/previews/*.tsx` + `handoff/design/support.js`** | AGENTS.md names `.design-sync/**` a build input explicitly. |
| **`scripts/hooks/*.mjs` (6 files)** | Registered in `.claude/settings.json`. |
| **`react-dom`, `@tiptap/pm`** | Zero source greps, but `react-dom` is Next.js's required runtime peer and `@tiptap/pm` is `@tiptap/react`'s required ProseMirror peer. Classic Next.js knip false positives. |
| **`jsdom`, `@vitest/coverage-v8`, `eslint`, `eslint-config-next`, `@testing-library/dom`, `@types/react-dom`** | Consumed by the nine config files knip failed to load (Caveat 1). `jsdom` is a vitest `environment` string at `vitest.unit.config.ts:98`. |
| **`maxDuration`, `onRouterTransitionStart`** | Next.js framework contracts — exported *for* the framework, never imported. |

---

## 4. Deliberate seams left alone

Checked against `docs/architecture/` and `docs/milestones/` before touching
anything that looked like a placeholder.

| Seam | Where | Why kept |
|---|---|---|
| `EVERYONE_IS_ENTITLED` | `server/ai/modelSelection.ts:89` | `() => true`, making the `denied` branch at `:105` unreachable today. Its comment says so, and M20 fills it in. |
| `AI_LIVE` short-circuit | `server/ai/modelSelection.ts:20` | `AI_LIVE=false` is set in `.env.example`, `ci.yml:76` and `playwright.config.ts`, so the `aiLiveFlag()` path at `:30` never runs locally or in CI. Deliberate, documented in ADR-019, with a `console.warn` tripwire at `:40`. The `ai-live` flag is the repo's only flag and is **live**, not dead. |
| `isPublicHoliday: () => true` | `packages/domain/src/trip/conflicts.ts:36` | The **D-1 dormant-by-decision** anchor. Its own comment says "DECIDE: revive anchors with a real UI, or delete the feature." That is Mitchell's decision, not a sweep's. |
| `AccessPolicy` | per AGENTS.md | Phase-2 swap point. Untouched. |

---

## 5. Handed back

**Nothing in `packages/contracts/src` was touched, and nothing there needs to
be** — no contract export came up dead in either the knip run or the 1,130-symbol
manual sweep. Invariant 5 was never in play.

1. **`apps/web/src/components/ui/panel.tsx` — a decision, not a defect.** A
   design-system component with a docs stub and two design-sync stories that no
   app code has ever used. Either wire it up or retire it *together with*
   `.design-sync/previews/Panel.tsx` and `.design-sync/docs-stubs/Panel.md` —
   deleting the component alone breaks the sync build. Not a call a cleanup
   sweep should make.
2. **No orphaned tests were created.** No source file was deleted, so no
   `*.test.ts` lost its subject. Nothing to clean up.
3. **`apps/web/e2e/m7-solo-delight.spec.ts:49`** points its coverage note at
   `app/api/trips/[tripId]/ai/route.int.test.ts`, deleted by `db5a5cb`. The
   behaviour now lives in `ask/route.int.test.ts`. **Left untouched — `e2e/**`
   was off-limits this session (a concurrent agent owns it).** One-line comment
   fix for whoever is in there next.
4. **Four undeclared spend ceilings.** `AI_STEP_LIMIT_PER_USER_HOURLY`,
   `AI_STEP_LIMIT_GLOBAL_HOURLY`, `AI_STEP_LIMIT_PER_USER_DAILY`,
   `AI_STEP_LIMIT_GLOBAL_DAILY` are read at `server/quota.ts:198-205` and appear
   in **no** `.env.example` line, although `.env.example:68-69` points at them
   ("the step ceilings below are what meter that (KI-67)") and `quota.ts:189`
   claims "Every one is operator-overridable". This is the tighter of the two
   quota layers. Not dead code — a documentation gap in the direction that
   costs money. `AUTH_TRUST_HOST` is similarly undocumented.
5. **A latent `BASE_URL` trap.** `apps/web/scripts/db-seed.ts:76` reads
   `process.env.WEB_BASE_URL ?? process.env.BASE_URL ?? …`. Nothing in the repo
   ever sets `BASE_URL`, so the middle branch is unreachable — and it
   re-introduces exactly the name `src/config.ts:11-19` warns against (KI-72,
   where Vitest injects `BASE_URL="/"`). Harmless under `tsx`, a live trap if
   that file is ever imported under Vitest. Behaviour change, so not done here.

---

## 6. Recommendation: is knip worth adding as a wall?

**Not as a blocking wall. Worth it as an occasional manual sweep.**

The evidence from this run:

- knip surfaced **41 unused files, 12 unused exports, 14 unused types, 8 unused
  dependencies**. After verification, the true-positive rate was
  **4 exports, 1 type-adjacent constant, 1 dependency, 0 files** — under 10%.
- The dominant false-positive classes are structural, not tunable away cheaply:
  constituent types of exported interfaces (14 of 14 wrong), `.design-sync` (34
  files), `node`-invoked scripts and hooks (9), framework contracts, and peer
  dependencies. A `knip.json` that suppressed all of these would be a
  substantial file needing maintenance every time a config moves.
- The `import()`-type miss (`ProposalApplyRecord`) means knip would have talked
  a less careful agent into deleting a type an integration test depends on.
- The repo's actual dead-code density is ~5 symbols in 1,130. A wall that fires
  95% false positives to catch that will be muted, and a muted wall is worse
  than none — the same failure mode AGENTS.md records for guessed property-test
  floors ("retraining everyone to ignore red").

**Better value for the same effort:** the 40-line whole-tree reference-count
script in §1 found every true positive knip did, plus `PACKAGE`, with a
five-row output that a human can read in ten seconds. If a periodic check is
wanted, that is the cheaper thing to commit — as a `scripts/` tool run on
demand, not in `pnpm check`.

If knip is ever added anyway: pin it as a devDependency (so configs load — see
Caveat 1), commit the config from §1 **with `.mts` added to every glob**, and
run it with `--no-exit-code` in report-only mode first for a milestone before
letting it fail anything.

---

## 7. Verification actually performed

Tier 2 (`AGENTS.md` — code, mid-branch). Subset computed with the
`minimal-check-subset` skill. No file under `packages/contracts/src` changed, so
narrowing applies.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | **green, 7/7 packages** (contracts, domain, pages, predict, fixtures, factories, web) |
| `pnpm --filter web exec vitest run -c vitest.unit.config.ts` × 8 touched files | **`Test Files 8 passed (8)` · `Tests 154 passed (154)`** |
| `pnpm --filter @tc/domain test` | **`Test Files 27 passed (27)` · `Tests 229 passed (229)`** |
| `pnpm --filter @tc/fixtures test` | **`Test Files 3 passed (3)` · `Tests 18 passed (18)`** |
| `pnpm --filter @tc/pages test` | **`Test Files 7 passed (7)` · `Tests 32 passed (32)`** |
| `pnpm --filter web lint` | **exit 0, zero warnings** (was 1 warning before `f2436d9`) |
| `node scripts/check-color-wall.mjs` | **OK — 463 files scanned, 0 pending re-skin** |
| `node scripts/check-lint-wall.mjs` | **OK — all three wall assertions hold** |

The eight unit files: `SaveLight.test.tsx`, `trip/DayChips.test.tsx`,
`playbooks/SharedDayScreen.test.tsx`, `lib/preview-registry.test.ts`,
`ai/askAnalytics.test.ts`, `ai/askIntent.test.ts`, `ai/readTools.test.ts`,
`server/demoTrip.test.ts`.

**Not run, and why.**

- **The integration suite** (`pnpm --filter web test:int`), despite
  `cloneTrip.ts` and `demoTrip.ts` both having `.int.test.ts` coverage. Postgres
  *is* available (`travel-collab-postgres-1`, healthy on :5433); this worktree
  simply has no `.env.local`. It was skipped deliberately on two grounds: this
  session was told several agents are running concurrently and a heavy suite
  reproduces KI-13's parallel-load timeout; and every change on this branch is
  provably behaviour-neutral — export visibility, a dead re-export, comments,
  and one manifest dependency. Nothing alters a runtime code path. The check
  that actually covers "did I remove something someone referenced" is
  `tsc --noEmit`, which passed across all seven packages. I additionally
  confirmed no `import * as` namespace import and no `require()` of any touched
  module could evade the typechecker.
- **`pnpm check`** — explicitly out of scope for this session, per the same
  KI-13 concurrency reasoning.
- **e2e** — no user flow changed.
- **`pnpm seed:verify`** — no contract field changed. `STILL_TO_BOOK` was not
  read by the verifier (that was the point of deleting it), and
  `pnpm --filter @tc/fixtures test` covers the fixture package regardless.

## A blind spot this sweep had, found by someone else the same day

**`packages/factories/src/scenarios.ts` has no consumers outside its own
package, and this sweep did not report it.** PR #117's author found it
independently and filed it as `KI-2026-09-02-d`.

The miss is not an oversight, it is the method. Both the reference-count script
and knip ask *"is this symbol referenced anywhere?"* — and `scenarios` is
referenced, by `packages/factories/src/contract.test.ts`. It passes that test
while being, in the sense anyone cares about, unused: **no component test under
`apps/web/src/components/**` imports it.** `grep -rn "scenarios\." apps/web/src
--include=*.test.tsx` returns nothing.

So the sweep's question has a hole in it, and the hole has a name:

> **A symbol referenced only by its own package's tests is invisible to
> reference counting, because its tests are references.**

That is a whole category — test-only-consumed code — and it is exactly where
scaffolding built ahead of its callers goes to die. Anything the test overhaul's
Phase 2 built is a candidate, and so is anything built for a milestone that then
took a different shape.

**The right follow-up question, for whoever runs the next sweep:** for each
exported symbol, are all its references inside its own package? If yes, is that
package the intended consumer, or is it scaffolding whose real consumers never
arrived? The second answer is not a deletion — `KI-2026-09-02-d` argues
correctly that `scenarios` should be **adopted**, not removed, because the named
states are where the meaning lives and hand-rebuilding them is the drift
`@tc/factories` exists to stop. A sweep that had found it and deleted it would
have been worse than a sweep that missed it.

Which is the caveat to put on this report's headline. "Five dead exports out of
1,130" is true of the question that was asked. It is not the same claim as
"there is no unused code here."

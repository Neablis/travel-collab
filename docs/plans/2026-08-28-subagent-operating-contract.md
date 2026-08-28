# Subagent Operating Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a portable subagent operating contract — dispatch table, lifecycle, three exit states, strike/handback, run-scoped board, report contract, cleanup — enforced by four fail-open hooks, with every travel-collab-specific fact isolated in one adapter pair.

**Architecture:** Four markdown files under `.claude/protocol/` (three portable, one repo-specific) plus a machine-readable `adapter.json`. Four Node hook scripts in `scripts/hooks/` share one library, `lib/run-context.mjs`, which locates the active run by scanning `<main-checkout>/.claude/run/*/manifest.json` and matching the tool call's `cwd` against unit worktrees. Every hook fails open: any parse error, missing manifest, or unmatched cwd means the hook no-ops and ordinary work is untouched.

**Tech Stack:** Node 22 ESM (`.mjs`), no new dependencies. Tests use Node's built-in runner (`node --test`), invoked black-box: spawn the hook, write a JSON payload to stdin, assert on stdout/exit code.

**Spec:** `docs/specs/2026-08-28-subagent-operating-contract-design.md` — read it alongside this plan.

## Global Constraints

- **Every hook fails open.** Any parse failure, missing file, or unresolvable run context exits 0 silently. A hook that blocks work it does not understand is worse than no hook.
- **`permissionDecision: "ask"`, never `"deny"`,** for the two `PreToolUse` hooks. A wrong declared scope should get noticed, not trap the agent.
- **`stop_hook_active` is checked first** in both `SubagentStop` and `Stop` hooks. Skipping this guard creates an infinite block loop.
- **The three portable files must never name this repo.** `CONTRACT.md`, `DISPATCH-TEMPLATE.md`, and `REPORT-TEMPLATE.md` may not contain: `travel-collab`, `pnpm`, `apps/web`, `packages/domain`, `packages/contracts`, `Postgres`, `postgres`, `Drizzle`, `Vercel`, `Playwright`, `AGENTS.md`, `known-issues.md`. Task 1 adds a test that enforces this.
- **`CONTRACT.md` must stay near one page.** It is read by every subagent at Orient; growth is a signal to cut, not to raise the budget.
- **Style:** match `scripts/hooks/check-destructive-git.mjs` — stdin JSON, `hookSpecificOutput` on stdout, comments explain *why* (constraints and incidents), never *what*.

## Spec refinements locked in here

Three details the spec left to implementation. They do not change the design.

1. **Hooks discover the run by scanning, not by `RUN_ID`.** A hook payload carries `cwd` but no run id, and a separate-session agent inherits no environment from the orchestrator. Hooks therefore scan `<main>/.claude/run/*/manifest.json` for a non-torn-down manifest containing a unit whose `worktree` is an ancestor of `cwd`. The agent still receives `RUN_ID` in its brief, as the spec says; the hooks simply do not depend on it.
2. **`adapter.json` accompanies `ADAPTER.md`.** Parsing prose for exclusive-command patterns would be fragile. `ADAPTER.md` stays the human document; `adapter.json` carries the machine-readable half. Both are repo-specific and both get rewritten when porting.
3. **Report conformance is gated on a `## Exit:` heading.** `SubagentStop` fires for *every* subagent, including ones outside any protocol run. Enforcing unconditionally would block unrelated agents into writing fake reports. The hook therefore enforces only when the final message contains a `## Exit:` heading — an agent that opted into the protocol must finish it correctly. A *missing* report is caught by the orchestrator's close step in `/dispatch`, not by this hook. This is a deliberate layering, and it is the one place enforcement is advisory rather than mechanical.

---

### Task 1: Protocol documents and the portability guard

Establishes the contract itself, the test lane the later tasks use, and an automated guard on the portability boundary that the whole design rests on.

**Files:**
- Create: `.claude/protocol/CONTRACT.md`
- Create: `.claude/protocol/DISPATCH-TEMPLATE.md`
- Create: `.claude/protocol/REPORT-TEMPLATE.md`
- Create: `.claude/protocol/ADAPTER.md`
- Create: `.claude/protocol/adapter.json`
- Create: `scripts/hooks/__tests__/protocol-portability.test.mjs`
- Modify: `.gitignore` (add `!.claude/protocol` to the existing allowlist)
- Modify: `package.json` (root `test` script gains the hook test lane)
- Modify: `.claude/agents/ki-fixer.md`, `.claude/agents/phase-implementer.md`, `.claude/agents/phase-verifier.md` (one new first instruction each)

**Interfaces:**
- Consumes: nothing.
- Produces: `.claude/protocol/adapter.json` with shape
  `{ exclusiveCommands: [{ resource: string, pattern: string, symptom: string }], portabilityForbiddenTokens: string[] }`.
  Tasks 2 and 4 read this file. `manifest.json`'s shape is defined in Task 2.

- [ ] **Step 1: Add the hook test lane to the root package.json**

`pnpm test` is `pnpm -r --if-present test`, which recurses into workspace packages only. `scripts/` is not a package, so hook tests would never run. Change the root `test` script:

```json
"test": "pnpm -r --if-present test && node --test scripts/hooks/__tests__/"
```

This keeps `pnpm check` (`typecheck && lint && test`) as the single gate. No new dependency: `node --test` ships with Node 22, and `engines.node` is already `>=22.18.0`.

- [ ] **Step 2: Write the failing portability test**

Create `scripts/hooks/__tests__/protocol-portability.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The protocol's whole portability claim is that three of its four documents
// name nothing about this repository. That claim is worth exactly as much as
// the test enforcing it, so here it is enforced.

const PORTABLE = [
  ".claude/protocol/CONTRACT.md",
  ".claude/protocol/DISPATCH-TEMPLATE.md",
  ".claude/protocol/REPORT-TEMPLATE.md",
];

const FORBIDDEN = [
  "travel-collab", "pnpm", "apps/web", "packages/domain", "packages/contracts",
  "Postgres", "postgres", "Drizzle", "Vercel", "Playwright",
  "AGENTS.md", "known-issues.md",
];

test("portable protocol files name nothing repo-specific", () => {
  for (const rel of PORTABLE) {
    const text = readFileSync(rel, "utf8");
    for (const token of FORBIDDEN) {
      assert.ok(
        !text.includes(token),
        `${rel} mentions "${token}" — repo-specific facts belong in ADAPTER.md`,
      );
    }
  }
});

test("the adapter carries the machine-readable half", () => {
  const adapter = JSON.parse(readFileSync(".claude/protocol/adapter.json", "utf8"));
  assert.ok(Array.isArray(adapter.exclusiveCommands), "exclusiveCommands must be an array");
  assert.ok(adapter.exclusiveCommands.length > 0, "at least one exclusive resource must be declared");
  for (const entry of adapter.exclusiveCommands) {
    assert.equal(typeof entry.resource, "string");
    assert.equal(typeof entry.symptom, "string");
    assert.doesNotThrow(() => new RegExp(entry.pattern), `bad pattern for ${entry.resource}`);
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test scripts/hooks/__tests__/`
Expected: FAIL — `ENOENT` on `.claude/protocol/CONTRACT.md`.

- [ ] **Step 4: Allowlist the protocol directory in .gitignore**

`.gitignore` ignores `.claude/*` with an allowlist. Without this line the entire protocol is untracked and invisible to cloud sessions and fresh clones. Add `!.claude/protocol` immediately after the existing `!.claude/commands` line:

```
.claude/*
!.claude/settings.json
!.claude/skills
!.claude/hooks
!.claude/agents
!.claude/commands
!.claude/protocol
```

Note that `.claude/run/` stays ignored by the `.claude/*` rule with no change — that is intentional; run directories are never committed.

- [ ] **Step 5: Write `.claude/protocol/CONTRACT.md`**

```markdown
# Subagent contract

You are one unit of a planned run. This contract is binding. Read your
adapter (`.claude/protocol/ADAPTER.md`) next — it carries every fact
specific to this repository.

## Lifecycle

**Orient → Work → Prove → Report → Teardown.**

Orient, in order, before you touch any file:

1. Read this file and the adapter.
2. Read the board: `<run-dir>/notes/`. Locate the run directory with
   `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`,
   then `.claude/run/<RUN_ID>/` using the `RUN_ID` in your brief.
3. Confirm your brief is valid. **A brief with no acceptance checks is
   invalid** — refuse to start, name the missing field, and hand back.
   Deciding what would prove the work *after* doing the work is how a
   verification step gets quietly dropped.

## Exit criteria

You may terminate in exactly three states. There is no fourth.

**DONE** requires all of:
- Every acceptance check in your brief was run, with the exact command and
  its real output or exit status quoted.
- Every check passed. A check that passed only on retry is a flaky-labelled
  bug — report it as that, not as a pass.
- No file outside your declared scope was modified.
- The board was updated if, and only if, you learned something portable.
- Your own temporary artifacts are gone.

You may **add** an acceptance check you discover is needed. You may never
remove or substitute one.

**BLOCKED** — you hit the strike limit, or an invariant or authority wall.
Report a reproduction, the strikes used, what you tried, your best
hypothesis, and the state you left the working tree in.

**DESCOPED** — the unit was wrong: not reproducible, already fixed, or
mis-scoped. Legitimate, and it must carry evidence.

"Mostly done", "should work", and "I could not run the tests but the change
is correct" are not exit states. They are BLOCKED.

## Strikes

A **strike** is one failed attempt to get past one blocker.

- **Two strikes on the same blocker → BLOCKED.** The second failed attempt
  is the last one. There is no third.
- **Three distinct blockers in one unit → BLOCKED**, reason *mis-scoped*.
  Three unrelated walls means the split was wrong, not that you are failing.
- **Before strike 2:** re-read the board — a sibling may already have
  answered it — and, if the failure looks environmental, run the adapter's
  environment probe instead of concluding.

None of these may ever be used to get past a strike. Each is an immediate
BLOCKED, with that fact stated in your report:

- Weakening, skipping, or deleting a test.
- Widening your declared file scope.
- Calling a failure flaky, environmental, or infrastructural without
  evidence.

**Handing back is a success mode.** Stopping at strike 2 with a clean
hypothesis is doing your job correctly, not failing at it.

## The board

The board lets a unit that has not started yet avoid a wall you already hit.

It is a bulletin board, not a message bus: you are one-shot and have no
inbox, so a note written now cannot reach a sibling that started earlier and
is still running. Read it at three points — during Orient, before strike 2
of any failure, and before claiming an exclusive resource.

One file per entry at `<run-dir>/notes/<ISO-timestamp>-<slug>.md`. Never
append to an existing file; one file per entry means no lock and no lost
write when two units publish at once.

```
---
kind: environment | tooling | repo-fact
observed-by: <your unit id>
observed-at: <ISO timestamp>
recheck: <the exact command a reader must run before acting on this>
---

**Observation.** What you ran and what it printed, verbatim.

**What I did about it.** (optional)
```

Three rules, and they matter more than the format:

1. **Entries are observations, never conclusions.** A command and its output
   is an entry. "X is broken, skip it" is not.
2. **Every entry carries a `recheck` command, and a reader must run it
   before acting on the entry.** The board can save a reader the diagnosis.
   It can never save them the check. One wrong "environmental" call that
   everyone downstream believes is more expensive than the wall itself.
3. **The board dies at teardown.** Nothing durable lives here. Anything that
   would still be true next week gets promoted before the run directory is
   deleted; the adapter says where.

**Write** when another unit in this run would hit the same wall *and* the
wall is not about your unit's code: environment, tooling, or a repo fact you
had to discover.

**Do not write** about your implementation, your design choices, or your
progress. That is your report.

**The test:** *would a unit working on something completely different change
what it does because of this?* If no, it is a report line. Progress chatter
is what buries the two or three entries that mattered.

## Report

Write `<run-dir>/reports/<your-unit-id>.md`. Your final message is that
file's content — authored once, present in both places, because the
orchestrator reads the message while later units grep the file.

The required sections are in `REPORT-TEMPLATE.md`. They are checked
mechanically. "Evidence gaps" may say "none", but it may not be absent: a
stated gap is a fine outcome, a silent one is not.

## Teardown

Delete **only what you created**: scratch files, temporary branches you made
and abandoned, servers or containers you started, and your resource lease.

Never:

- touch another unit's artifacts,
- delete the run directory,
- remove a worktree — **including your own.** Removing the tree you are
  standing in is a reliable way to lose uncommitted work. The orchestrator
  owns worktree lifecycle.
```

- [ ] **Step 6: Write `.claude/protocol/DISPATCH-TEMPLATE.md`**

```markdown
# Dispatch brief

One per unit. The orchestrator fills this. A unit with no acceptance checks
must not be dispatched, and an agent that receives one must refuse to start.

    RUN_ID:       <run id — the run directory is .claude/run/<RUN_ID>/>
    unit-id:      <stable id; names your report file and your board entries>
    worktree:     <absolute path; one worktree per concurrent unit>

    objective:    <one sentence: what is true when this unit is done>

    file-scope:
      - <glob>
      - <glob>

    acceptance-checks:
      - <exact command>            # what its passing output looks like
      - <exact command>

    resources:    <exclusive resources this unit claims, or none>
    depends-on:   <other unit-ids that must reach DONE first, or none>

    context:      <what the agent cannot derive: prior findings, the
                   constraint that shaped this split, what was already tried>

## The parallelisation test

Units may run concurrently only if **all four** hold. Failing any one means
they are sequential, or the split is wrong.

1. **Disjoint file scopes.** No glob overlap between concurrent units.
2. **No interface change among them.** A change to a shared type or schema
   breaks consumers whose own files did not change, so it is always its own
   serialized unit, reviewed before dependent work continues.
3. **No exclusive-resource collision.** Two units may not both claim the
   same resource; the adapter lists which resources are exclusive.
4. **Separate worktrees.** Never a shared working tree.

Splitting by file set alone is not enough. The real serialization points are
resources, not files.

## When a dependency does not reach DONE

A unit whose `depends-on` target ends BLOCKED or DESCOPED is **not
dispatched**. Its brief was written against an assumption that no longer
holds; dispatching it anyway buys an agent that discovers this expensively,
mid-unit, and hands back. Re-plan instead: re-split the blocked unit, merge
the two, or drop both.
```

- [ ] **Step 7: Write `.claude/protocol/REPORT-TEMPLATE.md`**

```markdown
# Report template

Write this to `<run-dir>/reports/<unit-id>.md`, and make your final message
the same content. Section headings are checked mechanically — keep them
exactly as written.

    ## Exit: DONE

    ## Unit
    <unit-id> — <the objective from your brief>

    ## Files touched
    - <path> — <what changed, one line>

    ## Acceptance checks
    - `<exact command>`
      <verbatim output, or the exit status>
      PASS | FAIL

    ## Evidence gaps
    <What you did NOT verify, and why. "none" is allowed. Absence is not.>

    ## Findings left alone
    <Noticed, deliberately not acted on, so it can be filed rather than lost.
    "none" is allowed.>

    ## Board entries written
    <paths, or "none">

    ## Teardown
    <what you created, and what you removed>

A **BLOCKED** report keeps every section above and adds these two:

    ## Blocker
    <reproduction; strikes used; what you tried; your best hypothesis>

    ## Tree state
    <what condition you left the working tree in>

A **DESCOPED** report keeps every section above, and its Evidence gaps
section carries the evidence that the unit was wrong.
```

- [ ] **Step 8: Write `.claude/protocol/ADAPTER.md`**

This is the only markdown file permitted to name this repo.

```markdown
# Adapter — travel-collab

The repo-specific half of the protocol. Porting the protocol elsewhere means
rewriting this file and `adapter.json`, and nothing else.

## Binding law

`AGENTS.md` is binding and outranks this file. Read, in particular: the
Invariants, the module map, the architecture dependency rules, and the
Definition of Done. If an invariant blocks your unit, that is a finding to
report — never a rule to bend.

## Exclusive resources

Declared machine-readably in `adapter.json`; the lease hook reads it.

| Resource | Why exclusive |
|---|---|
| `postgres` | One docker-compose instance. `pnpm --filter web test:int` runs the whole suite and cannot be scoped file-by-file, so two units running it concurrently corrupt each other's results — the symptom is a *different random subset* failing each run, which reads as flakiness and burns hours. |
| `dev-server` | Fixed ports. A second `pnpm dev` either fails to bind or silently serves the wrong worktree. |
| `ci-minutes` | This repo is private on a GitHub Free plan; a measured 30-day sample burned 1,956 of 2,000 minutes, 71% on pull-request runs. Open PRs as drafts and mark ready only when you believe they are green. See `docs/guidelines/ci-cost-and-capacity.md`. |

## Acceptance-check catalogue

- **Narrowest sufficient subset:** use the `minimal-check-subset` skill.
- **Contracts exception:** if any changed file is under
  `packages/contracts/src`, do not narrow — run the full `pnpm check`.
  A contracts change silently breaks domain and web even though their own
  files did not change (AGENTS.md invariant 5).
- **E2E:** a result counts only from `pnpm --filter web test:e2e:ci-like`.
  Plain `test:e2e` serves `pnpm dev`, which compiles routes on first hit and
  produces timeouts CI does not have. The dev lane is for iterating on a
  spec you are writing — never for a verdict or a PR checkbox.
- **Integration:** `pnpm --filter web test:int` claims the `postgres`
  resource. It is whole-suite by design.

## Environment probe

Run these before concluding that anything is environmental, flaky, or
infrastructural — and **grep `docs/known-issues.md` for the symptom first.**
Both times the dev-lane trap was hit here, the entry describing it (KI-27)
already existed and went unread; the second time cost a day and still
reached the wrong answer.

```bash
grep -in "<your symptom>" docs/known-issues.md
docker ps
ps aux | grep -E 'node|vitest|playwright' | grep -v grep
pg_isready -h localhost -p 5433
```

Useful discriminator: **a failure whose location moves between runs is a
timeout; a real defect fails in the same place every time.**

## Promotion destinations

At teardown, every board entry is promoted or explicitly discarded:

| Kind of fact | Goes to |
|---|---|
| Known-broken behaviour, with a reproduction | `docs/known-issues.md` |
| An irreversible decision and its rationale | `docs/architecture/` (a new ADR) |
| A durable tooling or repo fact | this file, or `adapter.json` |
| True only for this run | discarded, with a one-line reason |

## Cleanup targets

Worktrees under `.claude/worktrees/`; `.claude/launch.json` entries
(`scripts/sync-launch-config.mjs` regenerates it); local and remote
`claude/*` branches; stray containers and held ports. `/cleanup-orphans`
already covers the first three and reports before deleting anything —
prefer it to hand-rolling teardown.
```

- [ ] **Step 9: Write `.claude/protocol/adapter.json`**

```json
{
  "exclusiveCommands": [
    {
      "resource": "postgres",
      "pattern": "\\btest:int\\b|\\bdocker\\s+compose\\b|\\bdb:(reseed|reset|migrate)\\b",
      "symptom": "Two units running the integration suite share one Postgres. The symptom is a different random subset of tests failing each run, which reads as flakiness and burns hours."
    },
    {
      "resource": "dev-server",
      "pattern": "\\bpnpm\\s+(--filter\\s+\\S+\\s+)?dev\\b|\\bnext\\s+(dev|start)\\b|\\btest:e2e\\b",
      "symptom": "Fixed ports. A second dev server either fails to bind or silently serves a different worktree than the one you are testing."
    }
  ],
  "portabilityForbiddenTokens": [
    "travel-collab", "pnpm", "apps/web", "packages/domain", "packages/contracts",
    "Postgres", "postgres", "Drizzle", "Vercel", "Playwright",
    "AGENTS.md", "known-issues.md"
  ]
}
```

- [ ] **Step 10: Point the three agent definitions at the contract**

Each of `.claude/agents/ki-fixer.md`, `.claude/agents/phase-implementer.md`, and `.claude/agents/phase-verifier.md` gains this as the **first line of its body**, immediately after the closing `---` of the frontmatter. An agent definition is the only text a subagent is guaranteed to have in context, which is why the pointer lives here rather than in a document that references another document.

```markdown
**Before anything else:** read `.claude/protocol/CONTRACT.md` and
`.claude/protocol/ADAPTER.md`. They are binding, and they define how you
exit, when you hand back, and what your report must contain.
```

Leave the rest of each agent file unchanged — the contract generalises what they already say; it does not replace their procedures.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `node --test scripts/hooks/__tests__/`
Expected: PASS, 2 tests.

If the portability test fails, the fix is to move the offending sentence into `ADAPTER.md` — never to shorten the forbidden-token list.

- [ ] **Step 12: Verify the protocol directory is actually tracked**

Run: `git check-ignore -v .claude/protocol/CONTRACT.md; echo "exit=$?"`
Expected: `exit=1` and no output — meaning the file is **not** ignored. An exit of 0 means Step 4 did not take, and the whole protocol would be invisible to cloud sessions.

- [ ] **Step 13: Commit**

```bash
git add .gitignore package.json .claude/protocol .claude/agents scripts/hooks/__tests__
git commit -m "feat(protocol): subagent contract, adapter, and portability guard"
```

---

### Task 2: Shared run-context library

The plumbing all four hooks depend on. Built first and tested alone so the hook tasks are about policy, not path arithmetic.

**Files:**
- Create: `scripts/hooks/lib/run-context.mjs`
- Create: `scripts/hooks/__tests__/fixture.mjs`
- Create: `scripts/hooks/__tests__/run-context.test.mjs`

**Interfaces:**
- Consumes: `.claude/protocol/adapter.json` from Task 1.
- Produces, all exported from `lib/run-context.mjs`:
  - `readAll(stream) -> Promise<string>`
  - `parseStdin(raw) -> object | null`
  - `mainCheckout(cwd) -> string | null`
  - `activeRuns(cwd) -> Array<{ runDir: string, manifest: object }>`
  - `unitForCwd(cwd) -> { runDir, manifest, unit } | null`
  - `globToRegExp(glob) -> RegExp`
  - `inScope(relPath, globs) -> boolean`
  - `loadAdapter(cwd) -> object | null`
  - `ask(hookEventName, reason) -> void` (writes the `hookSpecificOutput` JSON)
- Produces the `manifest.json` shape that Tasks 3, 4, 6 and 7 all rely on:

```json
{
  "runId": "2026-08-28-m11-polish",
  "createdAt": "2026-08-28T10:00:00Z",
  "teardown": null,
  "units": [
    {
      "id": "u1-timeline-lens",
      "worktree": "/abs/path/.claude/worktrees/u1",
      "fileScope": ["apps/web/src/components/TimelineLens.tsx"],
      "state": "open"
    }
  ],
  "resources": { "postgres": "u1-timeline-lens" }
}
```

`state` is `"open"` or `"closed"`. `teardown` is `null` until the orchestrator records teardown; a manifest with a non-null `teardown` is invisible to every hook.

- [ ] **Step 1: Write the test fixture helper**

Create `scripts/hooks/__tests__/fixture.mjs`. It builds a real temporary git repo so the tests exercise the actual `git rev-parse --git-common-dir` path rather than a mock, and runs hooks black-box via a subprocess.

```js
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// A real git repo, because the hooks locate the run directory via
// `git rev-parse --path-format=absolute --git-common-dir`. Mocking that away
// would leave the piece most likely to be wrong untested. realpathSync because
// macOS resolves /var to /private/var, and the hooks compare resolved paths.
export function makeRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tc-protocol-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

export function makeLooseDir() {
  return realpathSync(mkdtempSync(join(tmpdir(), "tc-nogit-")));
}

export function makeUnitDir(root, name) {
  const dir = join(root, "units", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeManifest(root, manifest) {
  const dir = join(root, ".claude", "run", manifest.runId);
  mkdirSync(join(dir, "notes"), { recursive: true });
  mkdirSync(join(dir, "reports"), { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

export function writeAdapter(root, adapter) {
  const dir = join(root, ".claude", "protocol");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "adapter.json"), JSON.stringify(adapter, null, 2));
  return dir;
}

export function runHook(name, payload) {
  const res = spawnSync(process.execPath, [join(HOOKS_DIR, name)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  let json = null;
  try {
    json = res.stdout.trim() ? JSON.parse(res.stdout) : null;
  } catch {
    json = null;
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

export function decision(res) {
  return res.json?.hookSpecificOutput?.permissionDecision ?? null;
}
```

- [ ] **Step 2: Write the failing run-context tests**

Create `scripts/hooks/__tests__/run-context.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeLooseDir, makeRepo, makeUnitDir, writeManifest } from "./fixture.mjs";
import {
  activeRuns, globToRegExp, inScope, mainCheckout, unitForCwd,
} from "../lib/run-context.mjs";

function manifestFor(unitDir, extra = {}) {
  return {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["src/**"], state: "open" }],
    resources: { postgres: "u1" },
    ...extra,
  };
}

test("mainCheckout resolves the repo root from a nested directory", () => {
  const root = makeRepo();
  assert.equal(mainCheckout(makeUnitDir(root, "u1")), root);
});

test("mainCheckout returns null outside a git repo", () => {
  assert.equal(mainCheckout(makeLooseDir()), null);
});

test("unitForCwd matches a unit whose worktree contains cwd", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, manifestFor(unitDir));

  const found = unitForCwd(unitDir);
  assert.ok(found, "expected a match");
  assert.equal(found.unit.id, "u1");
  assert.equal(found.manifest.runId, "r1");
});

test("unitForCwd ignores a cwd outside every unit worktree", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, manifestFor(unitDir));
  assert.equal(unitForCwd(makeUnitDir(root, "elsewhere")), null);
});

test("a torn-down run is invisible", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, manifestFor(unitDir, { teardown: "2026-08-28T12:00:00Z" }));
  assert.equal(activeRuns(unitDir).length, 0);
  assert.equal(unitForCwd(unitDir), null);
});

test("a malformed manifest is skipped, not thrown", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  const runDir = writeManifest(root, manifestFor(unitDir));
  writeFileSync(join(runDir, "manifest.json"), "{ not json");
  assert.deepEqual(activeRuns(unitDir), []);
});

test("globToRegExp handles ** and *", () => {
  assert.ok(globToRegExp("src/**").test("src/a/b.ts"));
  assert.ok(globToRegExp("src/*.ts").test("src/a.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/a/b.ts"));
  assert.ok(globToRegExp("**/*.test.mjs").test("scripts/hooks/x.test.mjs"));
  assert.ok(!globToRegExp("src/**").test("docs/a.md"));
});

test("inScope is false for an empty or missing glob list", () => {
  assert.equal(inScope("src/a.ts", []), false);
  assert.equal(inScope("src/a.ts", undefined), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test scripts/hooks/__tests__/run-context.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../lib/run-context.mjs`.

- [ ] **Step 4: Implement the library**

Create `scripts/hooks/lib/run-context.mjs`:

```js
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

// Shared plumbing for the subagent-protocol hooks
// (docs/specs/2026-08-28-subagent-operating-contract-design.md).
//
// Every export fails open. A hook that cannot work out the run context must
// no-op: blocking work it does not understand is worse than not running.
//
// Hooks locate the run by scanning rather than by a RUN_ID, because a hook
// payload carries only `cwd`, and an agent driven from a separate session
// inherits no environment from the orchestrator.

export async function readAll(stream) {
  let out = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) out += chunk;
  return out;
}

export function parseStdin(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

export function mainCheckout(cwd) {
  try {
    const common = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return common ? dirname(common) : null;
  } catch {
    return null;
  }
}

export function activeRuns(cwd) {
  const main = mainCheckout(cwd);
  if (!main) return [];
  const root = join(main, ".claude", "run");
  if (!existsSync(root)) return [];

  const runs = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      if (manifest.teardown) continue;
      runs.push({ runDir: join(root, entry.name), manifest });
    } catch {
      // A malformed manifest must not block work.
    }
  }
  return runs;
}

export function unitForCwd(cwd) {
  const here = resolve(cwd);
  for (const run of activeRuns(cwd)) {
    for (const unit of run.manifest.units ?? []) {
      if (!unit.worktree) continue;
      const root = resolve(unit.worktree);
      if (here === root || here.startsWith(root + sep)) {
        return { ...run, unit };
      }
    }
  }
  return null;
}

export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function inScope(relPath, globs) {
  return (globs ?? []).some((glob) => globToRegExp(glob).test(relPath));
}

export function loadAdapter(cwd) {
  const main = mainCheckout(cwd);
  if (!main) return null;
  try {
    return JSON.parse(
      readFileSync(join(main, ".claude", "protocol", "adapter.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

export function ask(hookEventName, reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/hooks/__tests__/run-context.test.mjs`
Expected: PASS, 8 tests. The fixture already normalises temp paths with `realpathSync` — on macOS a `/var/...` temp dir resolves to `/private/var/...`, and the hooks compare resolved paths. If a path assertion still trips, fix the normalisation in the fixture rather than loosening the assertion.

- [ ] **Step 6: Commit**

```bash
git add scripts/hooks/lib scripts/hooks/__tests__
git commit -m "feat(protocol): shared run-context library for the protocol hooks"
```

---

### Task 3: File-scope hook

The highest-value hook: the direct guard against a phase branch becoming a 79-file PR (AGENTS.md, PR #23).

**Files:**
- Create: `scripts/hooks/subagent-file-scope.mjs`
- Create: `scripts/hooks/__tests__/subagent-file-scope.test.mjs`
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `unitForCwd`, `inScope`, `ask`, `parseStdin`, `readAll` from `lib/run-context.mjs`.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the failing tests**

Create `scripts/hooks/__tests__/subagent-file-scope.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { decision, makeRepo, makeUnitDir, runHook, writeManifest } from "./fixture.mjs";

function setup() {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["src/**", "docs/notes.md"], state: "open" }],
    resources: {},
  });
  return { root, unitDir };
}

test("an in-scope edit passes silently", () => {
  const { unitDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Edit",
    tool_input: { file_path: join(unitDir, "src/a.ts") },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("an out-of-scope edit asks, and names the declared scope", () => {
  const { unitDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Edit",
    tool_input: { file_path: join(unitDir, "other/b.ts") },
  });
  assert.equal(decision(res), "ask");
  assert.match(res.json.hookSpecificOutput.permissionDecisionReason, /src\/\*\*/);
});

test("an edit outside the worktree entirely asks", () => {
  const { unitDir } = setup();
  const res = runHook("subagent-file-scope.mjs", {
    cwd: unitDir,
    tool_name: "Write",
    tool_input: { file_path: "/etc/hosts" },
  });
  assert.equal(decision(res), "ask");
});

test("no manifest means no opinion", () => {
  const root = makeRepo();
  const loose = makeUnitDir(root, "loose");
  const res = runHook("subagent-file-scope.mjs", {
    cwd: loose,
    tool_name: "Edit",
    tool_input: { file_path: join(loose, "anything.ts") },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});

test("malformed stdin fails open", () => {
  const res = runHook("subagent-file-scope.mjs", "not-an-object");
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/hooks/__tests__/subagent-file-scope.test.mjs`
Expected: FAIL — `Cannot find module .../subagent-file-scope.mjs`.

- [ ] **Step 3: Implement the hook**

Create `scripts/hooks/subagent-file-scope.mjs`:

```js
import { relative, resolve, sep } from "node:path";
import { ask, inScope, parseStdin, readAll, unitForCwd } from "./lib/run-context.mjs";

// PreToolUse hook (matcher: Edit|Write). Keeps a dispatched unit inside the
// file scope its brief declared. No-ops entirely when this cwd is not part of
// an active protocol run, so ordinary work is untouched.
//
// `ask`, not `deny`, on purpose: sometimes the declared scope is genuinely
// wrong, and the right outcome is that someone notices — not that the agent
// is trapped. AGENTS.md records the sprawl this guards against (PR #23).

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);

const cwd = payload.cwd ?? process.cwd();
const target = payload?.tool_input?.file_path;
if (!target) process.exit(0);

const found = unitForCwd(cwd);
if (!found) process.exit(0);

const { unit } = found;
const root = resolve(unit.worktree);
const rel = relative(root, resolve(cwd, target));

if (rel === "" || rel.startsWith("..") || rel.startsWith(sep)) {
  ask(
    "PreToolUse",
    `Unit "${unit.id}" is writing to "${target}", which is outside its own worktree ` +
      `(${root}). Units never edit across worktree boundaries — report the need ` +
      "instead of reaching for it.",
  );
  process.exit(0);
}

if (!inScope(rel, unit.fileScope)) {
  ask(
    "PreToolUse",
    `"${rel}" is outside unit "${unit.id}"'s declared file scope:\n  ` +
      `${(unit.fileScope ?? []).join("\n  ")}\n\n` +
      "The contract (.claude/protocol/CONTRACT.md) requires reporting an " +
      "out-of-scope need rather than expanding silently, and widening your own " +
      "scope to get past a blocker is an automatic BLOCKED. If the scope is " +
      "genuinely wrong, say so in your report.",
  );
}

process.exit(0);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/hooks/__tests__/subagent-file-scope.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register the hook**

In `.claude/settings.json`, add to the existing `PreToolUse` array a second entry (do not modify the existing `Bash` entry):

```json
{
  "matcher": "Edit|Write",
  "hooks": [
    {
      "type": "command",
      "command": "node scripts/hooks/subagent-file-scope.mjs"
    }
  ]
}
```

Note the existing `PostToolUse` `Edit|Write` typecheck hook stays exactly as it is. This is `PreToolUse`; the two do not interact.

- [ ] **Step 6: Verify the hook does not fire on ordinary work**

Run: `echo '{"cwd":"'"$PWD"'","tool_name":"Edit","tool_input":{"file_path":"README.md"}}' | node scripts/hooks/subagent-file-scope.mjs; echo "exit=$?"`
Expected: `exit=0` with no output. There is no active run, so the hook has no opinion. If this prints JSON, the fail-open path is broken and no further work should proceed.

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/subagent-file-scope.mjs scripts/hooks/__tests__ .claude/settings.json
git commit -m "feat(protocol): file-scope hook keeps a unit inside its declared globs"
```

---

### Task 4: Resource-lease hook

Prevents a failure this repo already pays for: concurrent integration runs sharing one Postgres, producing a different random subset of failures each time.

**Files:**
- Create: `scripts/hooks/resource-lease.mjs`
- Create: `scripts/hooks/__tests__/resource-lease.test.mjs`
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `unitForCwd`, `loadAdapter`, `ask`, `parseStdin`, `readAll` from `lib/run-context.mjs`; the `exclusiveCommands` array from `adapter.json` (Task 1).
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the failing tests**

Create `scripts/hooks/__tests__/resource-lease.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decision, makeRepo, makeUnitDir, runHook, writeManifest, writeAdapter } from "./fixture.mjs";

const ADAPTER = {
  exclusiveCommands: [
    { resource: "postgres", pattern: "\\btest:int\\b", symptom: "Shared Postgres; results corrupt each other." },
  ],
};

function setup(holder) {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeAdapter(root, ADAPTER);
  writeManifest(root, {
    runId: "r1",
    teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["**"], state: "open" }],
    resources: { postgres: holder },
  });
  return unitDir;
}

test("a unit holding the lease runs freely", () => {
  const unitDir = setup("u1");
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(decision(res), null);
});

test("a unit without the lease is asked, and told who holds it", () => {
  const unitDir = setup("u2");
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(decision(res), "ask");
  const reason = res.json.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /u2/);
  assert.match(reason, /corrupt each other/);
});

test("an unrelated command is ignored", () => {
  const unitDir = setup("u2");
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "git status" },
  });
  assert.equal(decision(res), null);
});

test("an unleased resource is free", () => {
  const unitDir = setup(undefined);
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(decision(res), null);
});

test("a missing adapter fails open", () => {
  const root = makeRepo();
  const unitDir = makeUnitDir(root, "u1");
  writeManifest(root, {
    runId: "r1", teardown: null,
    units: [{ id: "u1", worktree: unitDir, fileScope: ["**"], state: "open" }],
    resources: { postgres: "u2" },
  });
  const res = runHook("resource-lease.mjs", {
    cwd: unitDir, tool_name: "Bash", tool_input: { command: "pnpm --filter web test:int" },
  });
  assert.equal(res.status, 0);
  assert.equal(decision(res), null);
});
```

`writeAdapter` and `writeManifest` come from the fixture built in Task 2.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/hooks/__tests__/resource-lease.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `scripts/hooks/resource-lease.mjs`:

```js
import { ask, loadAdapter, parseStdin, readAll, unitForCwd } from "./lib/run-context.mjs";

// PreToolUse hook (matcher: Bash). The real serialization points in a parallel
// run are resources, not files: two units running the integration suite share
// one database and produce a different random subset of failures each run — a
// symptom that reads as flakiness and costs hours. The manifest names one
// holder per exclusive resource; this asks before a second unit takes it.

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);

const cwd = payload.cwd ?? process.cwd();
const command = payload?.tool_input?.command ?? "";
if (!command) process.exit(0);

const found = unitForCwd(cwd);
if (!found) process.exit(0);

const adapter = loadAdapter(cwd);
if (!Array.isArray(adapter?.exclusiveCommands)) process.exit(0);

const leases = found.manifest.resources ?? {};

for (const entry of adapter.exclusiveCommands) {
  let pattern;
  try {
    pattern = new RegExp(entry.pattern);
  } catch {
    continue; // a bad pattern in the adapter must not block work
  }
  if (!pattern.test(command)) continue;

  const holder = leases[entry.resource];
  if (!holder || holder === found.unit.id) continue;

  ask(
    "PreToolUse",
    `This command claims the exclusive resource "${entry.resource}", which run ` +
      `${found.manifest.runId} leases to unit "${holder}" — not "${found.unit.id}".\n\n` +
      `${entry.symptom}\n\n` +
      "Coordinate through the orchestrator rather than taking it now. Waiting is " +
      "cheaper than the failure this produces.",
  );
  break;
}

process.exit(0);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/hooks/__tests__/resource-lease.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register the hook**

In `.claude/settings.json`, append to the **existing** `PreToolUse` `Bash` entry's `hooks` array, after `check-destructive-git.mjs`:

```json
{
  "type": "command",
  "command": "node scripts/hooks/resource-lease.mjs"
}
```

- [ ] **Step 6: Verify no false positive on ordinary work**

Run: `echo '{"cwd":"'"$PWD"'","tool_name":"Bash","tool_input":{"command":"pnpm --filter web test:int"}}' | node scripts/hooks/resource-lease.mjs; echo "exit=$?"`
Expected: `exit=0`, no output — no active run, so no lease applies. If this asks, the hook would obstruct every ordinary integration run and must not be committed.

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/resource-lease.mjs scripts/hooks/__tests__ .claude/settings.json
git commit -m "feat(protocol): resource-lease hook guards exclusive resources"
```

---

### Task 5: Report-conformance hook

Makes reports structurally complete. It cannot make them true — see the limit stated in the spec.

**Files:**
- Create: `scripts/hooks/subagent-report-conformance.mjs`
- Create: `scripts/hooks/__tests__/subagent-report-conformance.test.mjs`
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `parseStdin`, `readAll` from `lib/run-context.mjs`.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the failing tests**

Create `scripts/hooks/__tests__/subagent-report-conformance.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "./fixture.mjs";

// The hook reads the subagent's final assistant message out of the transcript
// JSONL, so the fixture writes a transcript rather than a report string.
function transcriptWith(text) {
  const dir = mkdtempSync(join(tmpdir(), "tc-transcript-"));
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, [
    JSON.stringify({ type: "user", message: { content: "go" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }),
  ].join("\n"));
  return path;
}

const COMPLETE_DONE = `## Exit: DONE

## Unit
u1 — do the thing

## Files touched
- src/a.ts — did it

## Acceptance checks
- \`node --test\`
  ok 3
  PASS

## Evidence gaps
none

## Findings left alone
none

## Board entries written
none

## Teardown
nothing created
`;

test("a complete DONE report passes", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(COMPLETE_DONE),
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});

test("a report missing Evidence gaps is blocked and told which section", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(COMPLETE_DONE.replace("## Evidence gaps\nnone\n", "")),
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Evidence gaps/);
});

test("a BLOCKED report also requires Blocker and Tree state", () => {
  const blocked = COMPLETE_DONE.replace("## Exit: DONE", "## Exit: BLOCKED");
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(blocked),
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /## Blocker/);
  assert.match(res.stderr, /## Tree state/);
});

test("an invented exit state is rejected", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith(COMPLETE_DONE.replace("## Exit: DONE", "## Exit: MOSTLY DONE")),
    stop_hook_active: false,
  });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /DONE \| BLOCKED \| DESCOPED/);
});

test("a non-protocol subagent is left alone", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith("I searched the codebase and found three call sites."),
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});

test("stop_hook_active short-circuits so the hook cannot loop", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: transcriptWith("## Exit: DONE\n"),
    stop_hook_active: true,
  });
  assert.equal(res.status, 0);
});

test("an unreadable transcript fails open", () => {
  const res = runHook("subagent-report-conformance.mjs", {
    transcript_path: "/nonexistent/transcript.jsonl",
    stop_hook_active: false,
  });
  assert.equal(res.status, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/hooks/__tests__/subagent-report-conformance.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `scripts/hooks/subagent-report-conformance.mjs`:

```js
import { readFileSync } from "node:fs";
import { parseStdin, readAll } from "./lib/run-context.mjs";

// SubagentStop hook. Checks that a unit's final report has the sections
// REPORT-TEMPLATE.md requires, and blocks (exit 2) with the gaps named if not.
//
// Two deliberate limits:
//
// 1. This validates SHAPE, NOT TRUTH. It can force an "Acceptance checks"
//    section to exist; it cannot make the output pasted into it real. That is
//    still worth having — the verification failures this guards against were
//    silent omissions, not fabricated evidence.
// 2. It only engages when the final message has an "## Exit:" heading.
//    SubagentStop fires for every subagent, including ones outside any
//    protocol run; enforcing unconditionally would push unrelated agents into
//    writing fake reports. A MISSING report is caught by the orchestrator's
//    close step in /dispatch, not here.

const REQUIRED = [
  "## Unit",
  "## Files touched",
  "## Acceptance checks",
  "## Evidence gaps",
  "## Findings left alone",
  "## Board entries written",
  "## Teardown",
];

const BLOCKED_EXTRA = ["## Blocker", "## Tree state"];

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);

// Without this guard the block below re-fires forever.
if (payload.stop_hook_active) process.exit(0);
if (!payload.transcript_path) process.exit(0);

let text = "";
try {
  const lines = readFileSync(payload.transcript_path, "utf8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const content = entry?.message?.content;
    text = Array.isArray(content)
      ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n")
      : typeof content === "string"
        ? content
        : "";
    if (text.trim()) break;
  }
} catch {
  process.exit(0);
}

if (!/^##\s*Exit:/m.test(text)) process.exit(0);

const stateMatch = text.match(/^##\s*Exit:\s*(DONE|BLOCKED|DESCOPED)\s*$/m);
const missing = [];

if (!stateMatch) {
  missing.push('"## Exit: <state>" naming exactly one of DONE | BLOCKED | DESCOPED');
}

const required = [
  ...REQUIRED,
  ...(stateMatch?.[1] === "BLOCKED" ? BLOCKED_EXTRA : []),
];

for (const heading of required) {
  if (!text.includes(heading)) missing.push(heading);
}

if (missing.length > 0) {
  console.error(
    "Your final report does not conform to .claude/protocol/REPORT-TEMPLATE.md.\n\n" +
      `Missing:\n  ${missing.join("\n  ")}\n\n` +
      "Re-emit the full report with these sections. \"Evidence gaps\" may say " +
      "\"none\", but it may not be absent — a stated gap is a fine outcome, a " +
      "silent one is not.",
  );
  process.exit(2);
}

process.exit(0);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/hooks/__tests__/subagent-report-conformance.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Register the hook**

Add a new top-level `SubagentStop` array to `.claude/settings.json`:

```json
"SubagentStop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node scripts/hooks/subagent-report-conformance.mjs"
      }
    ]
  }
]
```

- [ ] **Step 6: Commit**

```bash
git add scripts/hooks/subagent-report-conformance.mjs scripts/hooks/__tests__ .claude/settings.json
git commit -m "feat(protocol): report-conformance hook enforces the report shape"
```

---

### Task 6: Run-teardown reminder

Catches the step most likely to be skipped: promoting durable board entries before the run directory is deleted.

**Files:**
- Create: `scripts/hooks/run-teardown-reminder.mjs`
- Create: `scripts/hooks/__tests__/run-teardown-reminder.test.mjs`
- Modify: `.claude/settings.json`

**Interfaces:**
- Consumes: `activeRuns`, `parseStdin`, `readAll` from `lib/run-context.mjs`.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the failing tests**

Create `scripts/hooks/__tests__/run-teardown-reminder.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, makeUnitDir, runHook, writeManifest } from "./fixture.mjs";

function repoWith(units, teardown = null) {
  const root = makeRepo();
  const dir = makeUnitDir(root, "u1");
  writeManifest(root, { runId: "r1", teardown, units: units(dir), resources: {} });
  return root;
}

test("an open unit means no reminder", () => {
  const root = repoWith((dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "open" }]);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 0);
});

test("all units closed and no teardown blocks once with the checklist", () => {
  const root = repoWith((dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "closed" }]);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /r1/);
  assert.match(res.stderr, /promot/i);
});

test("a recorded teardown silences it", () => {
  const root = repoWith(
    (dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "closed" }],
    "2026-08-28T12:00:00Z",
  );
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 0);
});

test("stop_hook_active short-circuits", () => {
  const root = repoWith((dir) => [{ id: "u1", worktree: dir, fileScope: ["**"], state: "closed" }]);
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: true });
  assert.equal(res.status, 0);
});

test("no run directory means no opinion", () => {
  const root = makeRepo();
  const res = runHook("run-teardown-reminder.mjs", { cwd: root, stop_hook_active: false });
  assert.equal(res.status, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/hooks/__tests__/run-teardown-reminder.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `scripts/hooks/run-teardown-reminder.mjs`:

```js
import { activeRuns, parseStdin, readAll } from "./lib/run-context.mjs";

// Stop hook (main session). Fires ONLY when a run has every unit closed and no
// teardown recorded. The narrow trigger is the point: a Stop hook that fires on
// every turn is trained away within a day, after which it enforces nothing.
//
// What it protects is the promotion gate. Deleting a run directory that still
// holds an unpromoted durable fact is how the same lesson gets paid for twice.

const payload = parseStdin(await readAll(process.stdin));
if (!payload || typeof payload !== "object") process.exit(0);
if (payload.stop_hook_active) process.exit(0);

const cwd = payload.cwd ?? process.cwd();

const pending = activeRuns(cwd).filter(({ manifest }) => {
  const units = manifest.units ?? [];
  return units.length > 0 && units.every((unit) => unit.state === "closed");
});

if (pending.length === 0) process.exit(0);

const names = pending.map(({ manifest }) => manifest.runId).join(", ");

console.error(
  `Run ${names}: every unit is closed, but teardown is not recorded.\n\n` +
    "Before this run's directory is deleted:\n" +
    "  1. Triage every board entry in <run-dir>/notes/ — promote each one to a\n" +
    "     known-issue, an ADR, or the adapter, or discard it with a one-line reason.\n" +
    "     (See the promotion table in .claude/protocol/ADAPTER.md.)\n" +
    "  2. Report the teardown categories and get a per-category yes before\n" +
    "     deleting: run directory, worktrees, branches, launch config entries,\n" +
    "     stray containers and held ports.\n" +
    "  3. Record the teardown timestamp in the manifest to silence this.\n\n" +
    "If you are stopping for another reason, say so and stop again.",
);

process.exit(2);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/hooks/__tests__/run-teardown-reminder.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register the hook**

Add a new top-level `Stop` array to `.claude/settings.json`:

```json
"Stop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node scripts/hooks/run-teardown-reminder.mjs"
      }
    ]
  }
]
```

- [ ] **Step 6: Verify it is silent with no run in progress**

Run: `echo '{"cwd":"'"$PWD"'","stop_hook_active":false}' | node scripts/hooks/run-teardown-reminder.mjs; echo "exit=$?"`
Expected: `exit=0`, no output. A non-zero exit here would block the end of *every* turn in this repo, so do not commit until this passes.

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/run-teardown-reminder.mjs scripts/hooks/__tests__ .claude/settings.json
git commit -m "feat(protocol): teardown reminder guards the promotion gate"
```

---

### Task 7: The /dispatch command and repo wiring

The orchestrator half. Two of the four hooks are inert without the manifest this command writes, which is why it is not optional.

**Files:**
- Create: `.claude/commands/dispatch.md`
- Modify: `AGENTS.md` (Repo automation section)
- Modify: `docs/STATUS.md` (record the protocol as landed)

**Interfaces:**
- Consumes: every artifact from Tasks 1–6. Writes `manifest.json` in the shape defined in Task 2.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the dispatch command**

Create `.claude/commands/dispatch.md`:

```markdown
---
description: Plan a protocol run — create the run directory, write the manifest, and emit one brief per unit
---

Set up and drive a subagent protocol run for: $ARGUMENTS

Read `.claude/protocol/CONTRACT.md`, `DISPATCH-TEMPLATE.md`, and `ADAPTER.md`
first. Then:

## 1. Split the work

Produce the dispatch table. Apply the four parallelisation tests from
`DISPATCH-TEMPLATE.md` — disjoint file scopes, no interface change among
concurrent units, no exclusive-resource collision, separate worktrees. State
the verdict for each test out loud. If any fails, the units are sequential;
do not mark them concurrent because it would be faster.

Refuse to create any unit whose acceptance checks you cannot name. A brief
with no acceptance checks is invalid, and an agent receiving one is required
to refuse it — writing one wastes a full dispatch.

## 2. Create the run

    RUN_ID=$(date +%Y-%m-%d)-<short-slug>
    MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
    mkdir -p "$MAIN/.claude/run/$RUN_ID"/{notes,reports}

Write `$MAIN/.claude/run/$RUN_ID/manifest.json`:

    {
      "runId": "<RUN_ID>",
      "createdAt": "<ISO timestamp>",
      "teardown": null,
      "units": [
        {
          "id": "<unit-id>",
          "worktree": "<absolute path>",
          "fileScope": ["<glob>"],
          "state": "open"
        }
      ],
      "resources": { "<resource>": "<unit-id>" }
    }

**The manifest is not bookkeeping.** The file-scope and resource-lease hooks
read it and no-op without it, so a run dispatched without a manifest has no
enforcement at all.

## 3. Dispatch

One worktree per concurrent unit (use `superpowers:using-git-worktrees`).
Fill `DISPATCH-TEMPLATE.md` per unit and dispatch. Do not dispatch a unit
whose `depends-on` target has not reached DONE.

## 4. Close each unit

When a unit reports:

- Confirm `reports/<unit-id>.md` exists. The conformance hook checks a
  report's shape; it cannot catch a report that was never written. **This
  step is the only thing that does.**
- On DONE: set that unit's `state` to `"closed"` in the manifest.
- On BLOCKED: do **not** debug inline — that reimports the context delegation
  was spending to avoid. Re-split the unit, dispatch a fresh debug agent with
  the handback report as its brief, or escalate. A unit whose dependency ends
  BLOCKED or DESCOPED is not dispatched; re-plan instead.
- On DESCOPED: close it and re-check whether dependent units still make sense.

## 5. Teardown

The `Stop` hook will remind you once when every unit is closed. Then:

1. **Promotion gate first.** Triage every entry in `notes/` — promote to a
   known-issue, an ADR, or the adapter, or discard with a one-line reason.
   Nothing is deleted before this.
2. Report the teardown categories and get a **per-category yes** before
   deleting anything: run directory, worktrees, branches, `launch.json`
   entries, stray containers and ports. `/cleanup-orphans` covers most of
   this and already reports before deleting.
3. Record the teardown timestamp in the manifest.
```

- [ ] **Step 2: Add the protocol to the AGENTS.md automation table**

In `AGENTS.md`, "Repo automation" section, add a row to the **Slash commands** table:

```markdown
| `/dispatch` | Sets up a subagent protocol run — splits the work, writes the manifest the enforcement hooks read, emits one brief per unit, and drives the promotion gate at teardown |
```

And append this paragraph immediately after the **Hooks** paragraph in the same section:

```markdown
**The subagent protocol** (`.claude/protocol/`): `CONTRACT.md` is binding on
every dispatched subagent — lifecycle, the three exit states, the two-strike
handback rule, the run-scoped board, and the report shape. `ADAPTER.md` and
`adapter.json` carry every travel-collab-specific fact; the other three files
are portable and a test enforces that they name nothing about this repo. Four
hooks enforce it: file scope and resource leases before a tool call, report
conformance at subagent stop, and a teardown reminder at session stop. All
four fail open and no-op when no run is active. Design:
`docs/specs/2026-08-28-subagent-operating-contract-design.md`.
```

- [ ] **Step 3: Run the full check**

Run: `pnpm check`
Expected: PASS. This is the first run that exercises the new `node --test` lane inside `pnpm test`; if the hook tests are slow enough to be noticeable, say so in the PR rather than removing them from the lane.

- [ ] **Step 4: Smoke-test a real run end to end**

Create a throwaway run in this repo and confirm each hook engages, then engages *not at all* once the run is torn down.

```bash
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
mkdir -p "$MAIN/.claude/run/smoke"/{notes,reports}
cat > "$MAIN/.claude/run/smoke/manifest.json" <<JSON
{
  "runId": "smoke",
  "teardown": null,
  "units": [{ "id": "u1", "worktree": "$PWD", "fileScope": ["docs/**"], "state": "open" }],
  "resources": { "postgres": "u2" }
}
JSON

# in scope -> silent
echo "{\"cwd\":\"$PWD\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$PWD/docs/x.md\"}}" \
  | node scripts/hooks/subagent-file-scope.mjs

# out of scope -> ask
echo "{\"cwd\":\"$PWD\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$PWD/src/x.ts\"}}" \
  | node scripts/hooks/subagent-file-scope.mjs

# leased elsewhere -> ask
echo "{\"cwd\":\"$PWD\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm --filter web test:int\"}}" \
  | node scripts/hooks/resource-lease.mjs
```

Expected: nothing from the first; an `"ask"` JSON payload from the second and third, each naming the reason.

Then close the unit and confirm the teardown reminder fires exactly once:

```bash
sed -i '' 's/"state": "open"/"state": "closed"/' "$MAIN/.claude/run/smoke/manifest.json"
echo "{\"cwd\":\"$PWD\",\"stop_hook_active\":false}" | node scripts/hooks/run-teardown-reminder.mjs; echo "exit=$?"
```

Expected: `exit=2` with the promotion checklist on stderr.

Finally, remove the smoke run and confirm every hook goes quiet:

```bash
rm -rf "$MAIN/.claude/run/smoke"
echo "{\"cwd\":\"$PWD\",\"stop_hook_active\":false}" | node scripts/hooks/run-teardown-reminder.mjs; echo "exit=$?"
```

Expected: `exit=0`, no output. **Do not open the PR until this last check passes** — a teardown reminder that fires with no active run would block the end of every turn in this repo.

- [ ] **Step 5: Update docs/STATUS.md**

`docs/STATUS.md` is newest-first: an intro paragraph, then dated `## <headline>, <date>` sections. Insert a new section immediately after the intro block (currently above `## M18 PR 1 (the contract change) is done, 2026-08-27`), matching that headline style:

```markdown
## The subagent protocol landed, 2026-08-28

`.claude/protocol/` now carries a binding contract for every dispatched
subagent — lifecycle, three exit states, a two-strike handback rule, a
run-scoped board, and a mechanically checked report shape. Four fail-open
hooks enforce it; all four no-op when no run is active. `ADAPTER.md` and
`adapter.json` hold every travel-collab-specific fact, and a test enforces
that the other three files name nothing about this repo.

Start a run with `/dispatch`. Design:
`docs/specs/2026-08-28-subagent-operating-contract-design.md`.
```

- [ ] **Step 6: Commit and open a draft PR**

```bash
git add .claude/commands/dispatch.md AGENTS.md docs/STATUS.md
git commit -m "feat(protocol): /dispatch command and repo wiring"
git push -u origin HEAD
gh pr create --draft --title "Subagent operating contract" --body-file .github/PULL_REQUEST_TEMPLATE.md
```

Fill the template's **Verification actually performed** section honestly: the smoke test in Step 4 is real evidence, the `pnpm check` in Step 3 is real evidence, and anything not run goes on the "Not run, and why" line. Mark ready with `gh pr ready <n>` only when you believe it is green, then `gh pr checks <n> --watch --fail-fast`.

---

## Notes for the executor

**This plan has no browser-verifiable surface.** Nothing here renders. `phase-verifier`'s browser walk does not apply; say "not applicable — no user-facing surface" on the PR rather than leaving the box silently unchecked.

**The hooks affect every session in this repo the moment they land.** Steps 6 in Tasks 3, 4 and 6 and Step 4 in Task 7 exist specifically to prove the fail-open path before that happens. Treat a failure in any of them as blocking, not cosmetic.

**If a hook misfires twice in real use, delete it rather than tuning it.** That is the mitigation recorded in the spec's accepted risks, and it is cheaper than the alternative.

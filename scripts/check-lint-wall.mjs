import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// **ESLint is invoked directly, not through `pnpm --filter web exec`**, and
// both reasons are measured rather than stylistic.
//
// SPEED. This wall lints one fixture per check and its own test
// (`scripts/__tests__/check-lint-wall.test.mjs`) runs the whole wall several
// times over sabotaged configs — about 87 eslint invocations in all. Measured
// 2026-09-23: linting one fixture costs 2889ms through `pnpm --filter web
// exec` and 1600ms through the shim — ~1.3s of every call was pnpm starting up
// and resolving a workspace it had already resolved. That test file alone ran
// for **243 seconds**, which was 60% of `pnpm test` — more than the entire web
// vitest suite (123s) — and every other file in `scripts/__tests__` finishes
// in under 7s.
//
// IT ALSO FIXES KI-2026-09-08-b. That entry records this script being
// unrunnable in a cloud session: it "hardcodes `pnpm --filter web exec`
// internally and so has no way to receive the flag" that works around the
// pnpm-major skew, so it printed thirteen `LINT WALL CANNOT RUN` lines and
// exited 1 — which "reads exactly like thirteen wall failures and is not".
// With no pnpm in the path there is no flag to pass.
// `apps/web`'s own `.bin` shim, NOT the binary inside eslint's package.
//
// Resolving the package and running `node <eslint>/bin/eslint.js` directly is
// the obvious move and it does not work: under pnpm's strict layout the plugins
// are not reachable from `apps/web`, and eslint dies with *"couldn't find the
// plugin eslint-plugin-react-hooks"* (measured, exit 2, no report). The shim is
// what sets up that resolution — it is the same thing `pnpm exec` arranges,
// minus pnpm's own startup.
const ESLINT_BIN = join(process.cwd(), "apps", "web", "node_modules", ".bin", "eslint");

/**
 * Runs eslint from `apps/web` and returns its stdout.
 *
 * Throws exactly as `execSync` did on a non-zero exit, which both callers
 * already depend on: eslint exits 1 for "found problems" AND for "could not
 * start", and telling those apart is what the `-o <file>` report and the
 * print-config parse below are for.
 */
function eslint(args, input) {
  return execFileSync(ESLINT_BIN, args, {
    cwd: "apps/web",
    stdio: "pipe",
    input,
  }).toString();
}

// KI-2026-09-05-s: this wall is itself covered by scripts/__tests__/check-lint-wall.test.mjs,
// which runs it against deliberately sabotaged copies of apps/web/eslint.config.mjs. That test
// needs to point eslint at a config other than the checked-in one; `LINT_WALL_ESLINT_CONFIG`
// (a path relative to apps/web) is the only seam it uses. Unset — i.e. in `pnpm lint` — the
// command line is exactly what it always was.
// An ARGUMENT LIST now rather than a string fragment, because the commands
// below are no longer built by string concatenation — a path with a space in
// it used to be a latent bug here and cannot be one now.
const configArgs = process.env.LINT_WALL_ESLINT_CONFIG
  ? ["--config", process.env.LINT_WALL_ESLINT_CONFIG]
  : [];

// Which RULE rejected a fixture, not merely "eslint exited non-zero".
//
// KI-2026-09-05-s, red-first: the original helper returned `passed: false` for any non-zero
// exit, so a fixture rejected for the wrong reason read as proof the wall fired. Measured:
// the e2e fixture below trips BOTH `playwright/expect-expect` and the cosmetic
// `playwright/consistent-spacing-between-blocks`. With `playwright/expect-expect` turned
// off in eslint.config.mjs, the wall still printed "e2e spec without an assertion correctly
// rejected" and exited 0. Same shape for the gateway (two rules) and container (two rules)
// fixtures — and for a config so broken eslint cannot start, which also exits non-zero.
//
// `dir`/`ext` default to the UI-wall fixtures' original shape
// (apps/web/src/app/__name__.tsx). The gateway wall below fixtures a
// server-side file instead (apps/web/src/server/ai/__name__.ts), so both
// need to be overridable rather than duplicating this helper.
//
// THE FIXTURE NEVER TOUCHES THE DISK (KI-2026-09-23-g). It is piped to eslint
// on stdin, and `--stdin-filename` gives it the path it would have had, which
// is all flat config needs: `files`/`ignores` blocks, the
// `import/no-restricted-paths` zones and relative-import resolution all key off
// that name, not off a file existing there (measured 2026-09-24 — a stdin
// fixture named `src/server/ai/__probe__.ts` importing the gateway draws both
// `no-restricted-imports` and `import/no-restricted-paths`, and one named under
// `node_modules/` draws the same "File ignored" warning a real file does). It
// used to be written to `apps/web/<relative>` for the length of one eslint run,
// with a FIXED name, so a `tsc --noEmit` or ESLint pass over `src` in the same
// checkout reported errors in files that were gone when anyone looked, and two
// wall runs at once deleted each other's fixtures.
function lintFixture(name, source, { dir = "src/app", ext = "tsx" } = {}) {
  const relative = `${dir}/__${name}__.${ext}`;
  const fixture = `apps/web/${relative}`;
  // `-o` rather than reading stdout: when the linted file has problems `pnpm exec` appends
  // its own `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] ...` line to STDOUT, so the report is not
  // the last thing there and no bracket-matching heuristic survives it.
  const reportDir = mkdtempSync(join(tmpdir(), "tc-lint-wall-"));
  const reportPath = join(reportDir, "eslint.json");
  let report;
  try {
    try {
      eslint([...configArgs, "-f", "json", "-o", reportPath, "--stdin", "--stdin-filename", relative], source);
    } catch {
      // eslint exits 1 both when it reports an error and when it fails to start. Only the
      // former leaves a report behind; the latter is caught by the read/parse below.
    }
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    // Not a wall verdict at all — eslint never ran. Reporting this as "the wall
    // fired" is exactly the blindness this helper exists to remove.
    console.error(`LINT WALL CANNOT RUN: eslint produced no JSON report for ${relative}`);
    process.exitCode = 1;
    return { fixture, ranEslint: false, errorRuleIds: [] };
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }

  const errorRuleIds = report.flatMap((file) =>
    file.messages.filter((m) => m.severity === 2).map((m) => m.ruleId ?? "<fatal parse error>"),
  );
  return { fixture, ranEslint: true, errorRuleIds };
}

/** The fixture must be rejected, and rejected BY `ruleId` — not by some bystander rule. */
function expectRejectedBy(result, ruleId, label) {
  if (!result.ranEslint) return;
  if (result.errorRuleIds.includes(ruleId)) {
    console.log(`lint wall OK: ${label} (rejected by ${ruleId})`);
    return;
  }
  const fired = result.errorRuleIds.length > 0 ? result.errorRuleIds.join(", ") : "nothing";
  console.error(`LINT WALL BREACHED: ${label} was NOT flagged by ${ruleId} (fired instead: ${fired})`);
  process.exitCode = 1;
}

/** The other half of every wall: the thing it must NOT reach stays clean. */
function expectClean(result, label) {
  if (!result.ranEslint) return;
  if (result.errorRuleIds.length === 0) {
    console.log(`lint wall OK: ${label}`);
    return;
  }
  console.error(`LINT WALL TOO STRICT: ${label} — flagged by ${result.errorRuleIds.join(", ")}`);
  process.exitCode = 1;
}

expectRejectedBy(
  lintFixture("lint_wall_fixture", 'import "@tc/domain";\nexport default function Fixture() { return null; }\n'),
  "no-restricted-imports",
  "forbidden @tc/domain import from UI correctly rejected",
);

expectClean(
  lintFixture(
    "lint_wall_predict_fixture",
    'import { predictCommand } from "@tc/predict";\nexport default function Fixture() { void predictCommand; return null; }\n',
  ),
  "@tc/predict import (predict subpath allowed) correctly passes",
);

expectRejectedBy(
  lintFixture("lint_wall_server_fixture", 'import "@/server/flags";\nexport default function Fixture() { return null; }\n'),
  "no-restricted-imports",
  "@/server/* import from UI correctly rejected",
);

// THE ADMIN EXEMPTION, proven to be exactly one hole (2026-09-14).
//
// `src/app/admin/**` may reach `@/server/*` — M20's gate box requires the ROUTE
// to 404 for a non-admin, which needs `users.is_admin`, which is a database
// column the edge proxy cannot read. What made this worth fixturing is the flat
// config mechanic the config itself warns about twice: ESLint REPLACES a rule's
// options for the last matching block rather than merging them, so dropping the
// console from two blocks' `ignores` and handing the restrictions back in a
// third is easy to get half-right. A version of this that silently also opened
// `@tc/domain` and `@/lib/authConfig` would lint clean and look identical.
//
// Three fixtures, because the claim is three-part: one hole open, two shut.
expectClean(
  lintFixture(
    "admin_server_fixture",
    'import "@/server/entitlements/admin";\nexport default function Fixture() { return null; }\n',
    { dir: "src/app/admin" },
  ),
  "the operator console may import @/server/* (the exemption is open)",
);

expectRejectedBy(
  lintFixture(
    "admin_domain_fixture",
    'import "@tc/domain";\nexport default function Fixture() { return null; }\n',
    { dir: "src/app/admin" },
  ),
  "no-restricted-imports",
  "the operator console still may not import @tc/domain",
);

expectRejectedBy(
  lintFixture(
    "admin_authconfig_fixture",
    'import "@/lib/authConfig";\nexport default function Fixture() { return null; }\n',
    { dir: "src/app/admin" },
  ),
  "no-restricted-imports",
  "the operator console still may not build an Auth.js instance",
);

// THE GATEWAY CHOKEPOINT WALL (ADR-019's 2026-08-25 amendment): only
// src/server/ai/modelSelection.ts may import @/server/ai/gateway. Fixtured
// under src/server/ai/ itself — a NEW file there, not modelSelection.ts —
// because that's exactly the shape of the real threat (M16's second AI
// endpoint reaching for the gateway directly instead of going through
// selectAiModel()).
//
// The alias spelling trips BOTH `no-restricted-imports` and `import/no-restricted-paths`,
// so it is named per rule: an exit-code-only check here could not tell one of the two
// halves going missing from both being present.
expectRejectedBy(
  lintFixture(
    "lint_wall_gateway_fixture",
    'import { aiModel } from "@/server/ai/gateway";\nexport function forbidden() { return aiModel(); }\n',
    { dir: "src/server/ai", ext: "ts" },
  ),
  "no-restricted-imports",
  "@/server/ai/gateway import outside modelSelection.ts correctly rejected",
);

// The same wall, for the SECOND export gateway.ts gained when the /ask intent
// classifier got its own configurable model (AI_CLASSIFIER_MODEL). The rule
// restricts the module, not the symbol, so this cannot fail while the fixture
// above passes — which is exactly why it is cheap to assert, and exactly what
// would have gone unchecked if a later export were added the same way.
expectRejectedBy(
  lintFixture(
    "lint_wall_gateway_classifier_fixture",
    'import { aiClassifierModel } from "@/server/ai/gateway";\nexport function forbidden() { return aiClassifierModel(); }\n',
    { dir: "src/server/ai", ext: "ts" },
  ),
  "no-restricted-imports",
  "aiClassifierModel import outside modelSelection.ts correctly rejected",
);

// Regression coverage for a Major caught in review: `no-restricted-imports`
// `patterns` does string matching, not path resolution, so the alias-only
// check above did not catch a sibling reaching gateway.ts via a relative
// path — `import { aiModel } from "./gateway"` passed lint clean. The fix
// adds `import/no-restricted-paths` (which resolves the import before
// comparing) alongside the alias pattern; this fixture proves the relative
// spelling is rejected too, not just the alias one.
expectRejectedBy(
  lintFixture(
    "lint_wall_gateway_relative_fixture",
    'import { aiModel } from "./gateway";\nexport function forbidden() { return aiModel(); }\n',
    { dir: "src/server/ai", ext: "ts" },
  ),
  "import/no-restricted-paths",
  'relative "./gateway" import outside modelSelection.ts correctly rejected',
);

// THE ASSISTANT KERNEL WALL (ADR-043, corrected 2026-09-10): from inside
// `src/server/assistant/**`, no `@/server/*` import at all except a named
// allowlist, and no `next/*`. Everything else arrives as an injected port.
//
// **The transitive fixtures below are the point of this block.** P1 shipped
// this wall as a five-name denylist — `next/*`, `@/server/db/*`,
// `@/server/pages`, `@/server/auth`, `@/server/pages-guard` — and lint passed
// while `search_playbooks` reached Postgres through `@/server/playbooks` and
// `insert_playbook_day` through `@/server/savedDays`, each of which imports
// `./db/client` one hop down. ESLint sees only direct imports, so a probe that
// fixtures only the named modules proves nothing about the hop that actually
// existed. The deny-by-default wall catches it by refusing the INTERMEDIATE
// module, and these two fixtures are that claim, named.
//
// P1 also verified the flat-config shadowing by hand with `--print-config` and
// reported that the check was not repeatable. The three real-file assertions
// further down are that check, made repeatable.
expectRejectedBy(
  lintFixture(
    "lint_wall_kernel_next_fixture",
    'import type { NextRequest } from "next/server";\nexport type Forbidden = NextRequest;\n',
    { dir: "src/server/assistant", ext: "ts" },
  ),
  "no-restricted-imports",
  "assistant kernel: a next/* import correctly rejected",
);

expectRejectedBy(
  lintFixture(
    "lint_wall_kernel_db_fixture",
    'import { db } from "@/server/db/client";\nexport function forbidden() { return db; }\n',
    { dir: "src/server/assistant", ext: "ts" },
  ),
  "no-restricted-imports",
  "assistant kernel: a direct @/server/db import correctly rejected",
);

// The hop the denylist missed, half one: `@/server/playbooks` is not a database
// module by name, and imports `./db/client` at line 17.
expectRejectedBy(
  lintFixture(
    "lint_wall_kernel_playbooks_fixture",
    'import { discoverDays } from "@/server/playbooks";\nexport function forbidden() { return discoverDays; }\n',
    { dir: "src/server/assistant", ext: "ts" },
  ),
  "no-restricted-imports",
  "assistant kernel: @/server/playbooks (Postgres one hop down) correctly rejected",
);

// Half two: `@/server/savedDays`, which imports `./db/client` at line 12.
expectRejectedBy(
  lintFixture(
    "lint_wall_kernel_saveddays_fixture",
    'import { readableSavedDay } from "@/server/savedDays";\nexport function forbidden() { return readableSavedDay; }\n',
    { dir: "src/server/assistant", ext: "ts" },
  ),
  "no-restricted-imports",
  "assistant kernel: @/server/savedDays (Postgres one hop down) correctly rejected",
);

// The same module by its RELATIVE spelling, which `no-restricted-imports` does
// not see at all — the bypass a review found against the gateway rule, closed
// here by `import/no-restricted-paths` resolving the import first. Named per
// rule so one of the two halves going missing cannot hide behind the other.
expectRejectedBy(
  lintFixture(
    "lint_wall_kernel_relative_fixture",
    'import { discoverDays } from "../playbooks";\nexport function forbidden() { return discoverDays; }\n',
    { dir: "src/server/assistant", ext: "ts" },
  ),
  "import/no-restricted-paths",
  'assistant kernel: relative "../playbooks" correctly rejected',
);

// The other half of every wall, and the one a deny-by-default rule gets wrong
// most easily: the allowlist has to actually reach the kernel. Both spellings
// in one fixture — the alias form an allowlisted module is imported by, and a
// relative import of the kernel's own sibling, which `import/no-restricted-paths`
// would close along with everything else if its `except` were wrong.
expectClean(
  lintFixture(
    "lint_wall_kernel_allowed_fixture",
    'import { tripRegionOf } from "@/server/geocoding/region";\n' +
      'import { newPageBuffer } from "./deps";\n' +
      "export function allowed() { return [tripRegionOf, newPageBuffer]; }\n",
    { dir: "src/server/assistant", ext: "ts" },
  ),
  "assistant kernel: an allowlisted module and its own sibling correctly pass",
);

// Some assertions below check "this exact real file's effective config",
// which a fixture cannot express — a fixture is, by construction, a file at
// some OTHER path. `--print-config` reports the no-restricted-imports rule
// ESLint would actually apply to a given real file; this reads its
// `patterns` array (or `[]` if the rule doesn't apply to that file at all —
// several blocks ignore all of src/server/**, so absence is a valid "not
// restricted" answer, not a script bug).
// Returns `null` — distinct from `[]`, which means "resolved, and nothing restricted" —
// when ESLint could not answer at all. Callers must not read that as "not restricted",
// which is the same trap `lintFixture` closes above.
function noRestrictedImportPatterns(relativePath) {
  let printed;
  try {
    printed = eslint([...configArgs, "--print-config", relativePath]);
    const resolvedConfig = JSON.parse(printed);
    const restrictedImports = resolvedConfig.rules?.["no-restricted-imports"];
    return Array.isArray(restrictedImports?.[1]?.patterns) ? restrictedImports[1].patterns : [];
  } catch {
    console.error(`LINT WALL CANNOT RUN: eslint could not print a config for ${relativePath}`);
    process.exitCode = 1;
    return null;
  }
}

function restricts(patterns, importPath) {
  return patterns.some((p) => (p.group ?? []).some((g) => g === importPath || g.includes(importPath)));
}

/**
 * The same question for a `regex` pattern, which the assistant wall uses instead
 * of a `group` — `no-restricted-imports` matches `group` with the `ignore`
 * package, and gitignore's "a file cannot be re-included once a parent directory
 * is excluded" rule makes a deny-all-plus-exceptions group deny its own
 * exceptions. Measured; see eslint.config.mjs.
 */
function restrictedByPattern(patterns, importPath) {
  return patterns.some(
    (p) =>
      (p.regex !== undefined && new RegExp(p.regex, "u").test(importPath)) ||
      (p.group ?? []).some((g) => g === importPath),
  );
}

// The positive half of the gateway wall: modelSelection.ts itself must stay
// importable. Without this half, "wall rejects the forbidden fixture" alone
// can't distinguish a scoped chokepoint from a blanket ban on the import
// everywhere — the same gap the @tc/predict case above exists to close for
// the domain wall.
const modelSelectionPatterns = noRestrictedImportPatterns("src/server/ai/modelSelection.ts");
if (modelSelectionPatterns === null) {
  // already reported by noRestrictedImportPatterns
} else if (restricts(modelSelectionPatterns, "@/server/ai/gateway")) {
  console.error("LINT WALL TOO STRICT: modelSelection.ts is restricted from importing its own gateway");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: modelSelection.ts (the sole exempt file) is not restricted from importing the gateway");
}

// Regression coverage for a Critical caught in review: the gateway wall block
// sits between the domain/UI wall and the auth-config wall in
// eslint.config.mjs. Both `src/proxy.ts` and `src/lib/authConfig.ts` are
// ignored by the auth-config wall (so it never re-asserts the domain wall for
// them) and were, briefly, NOT ignored by the gateway wall block sitting
// between them and it — meaning the gateway wall's gateway-only pattern
// became the last (and only) no-restricted-imports config ESLint resolved
// for those two files, silently REPLACING rather than adding to the
// domain/server wall block 1 sets (flat config does not merge two blocks'
// options for the same rule key — see eslint.config.mjs's own comments on
// this). Fixtures can't be `proxy.ts` or `authConfig.ts` by definition, so
// this checks the same real-file resolved config the fix depends on staying
// correct.
for (const path of ["src/proxy.ts", "src/lib/authConfig.ts"]) {
  const patterns = noRestrictedImportPatterns(path);
  if (patterns === null) continue; // already reported by noRestrictedImportPatterns
  const hasDomainWall = restricts(patterns, "@tc/domain") && restricts(patterns, "@/server/*");
  if (!hasDomainWall) {
    console.error(`LINT WALL BREACHED: ${path} lost the @tc/domain / @/server/* wall`);
    process.exitCode = 1;
  } else {
    console.log(`lint wall OK: ${path} still carries the @tc/domain / @/server/* wall`);
  }
}

// The assistant kernel's own real-file check, for the same flat-config reason
// and against a file a fixture cannot be. `src/server/assistant/**` is matched
// by TWO blocks that both set `no-restricted-imports` — the gateway chokepoint
// block and the kernel block after it — and flat config REPLACES a rule's
// options with the last matching block's rather than merging them. The kernel
// block therefore has to re-assert `gatewayWallPatterns`, and if it stops, the
// most security-sensitive directory in the app becomes the one place
// `selectAiModel()`'s chokepoint is not enforced. Silently: no fixture in this
// file would notice, because a fixture is by construction a file at some other
// path with its own resolved config.
//
// Three questions, on one real kernel file: the gateway wall survived the
// shadowing, the deny-all reaches the file, and the allowlist reaches it too.
{
  const path = "src/server/assistant/tools/read.ts";
  const patterns = noRestrictedImportPatterns(path);
  if (patterns === null) {
    // already reported by noRestrictedImportPatterns
  } else {
    if (!restricts(patterns, "@/server/ai/gateway")) {
      console.error(`LINT WALL BREACHED: ${path} lost the gateway chokepoint wall to block shadowing`);
      process.exitCode = 1;
    } else {
      console.log(`lint wall OK: ${path} still carries the gateway chokepoint wall`);
    }
    if (!restrictedByPattern(patterns, "@/server/playbooks")) {
      console.error(`LINT WALL BREACHED: ${path} does not restrict @/server/playbooks`);
      process.exitCode = 1;
    } else {
      console.log(`lint wall OK: ${path} restricts @/server outside the allowlist`);
    }
    if (restrictedByPattern(patterns, "@/server/geocoding/region")) {
      console.error(`LINT WALL TOO STRICT: ${path} cannot import the allowlisted @/server/geocoding/region`);
      process.exitCode = 1;
    } else {
      console.log(`lint wall OK: ${path} may still import the allowlisted @/server/geocoding/region`);
    }
  }
}

// **The admission pipeline is inside the wall, and its five bindings are still
// outside it** (P4, spec §3b). `evaluateAiGrant` moved from `src/server/ai` to
// `src/server/assistant/admission.ts`, which is the test of whether its ports
// are real: the wall denies `guard`, `getPage`, `selectAiModel`, `consumeQuota`
// and `classifyAskIntent`, and the pipeline reaches every one of them through
// `AdmissionPorts` instead. Checked on the REAL file rather than a fixture,
// because the property being asserted is that this particular module is behind
// the wall — a fixture at another path cannot say that.
{
  const path = "src/server/assistant/admission.ts";
  const patterns = noRestrictedImportPatterns(path);
  if (patterns === null) {
    // already reported by noRestrictedImportPatterns
  } else {
    // `pages-guard` and `quota` are two of the five, by name, and `ai/askIntent`
    // is the third. The `geocoding` barrel and its LocationIQ adapter are the
    // deliberate near-miss: `geocoding/region` next door IS allowlisted, so
    // this is what proves the allowlist is a list of modules and not a prefix.
    // (Until 2026-09-23 the near-miss was `ai/askAnalytics` beside
    // `ai/askIntent`; `askAnalytics` moved inside the kernel, see the
    // allowlist's own comment in eslint.config.mjs.)
    for (const forbidden of [
      "@/server/pages-guard",
      "@/server/quota",
      "@/server/ai/askIntent",
      "@/server/geocoding",
      "@/server/geocoding/locationiq",
    ]) {
      if (!restrictedByPattern(patterns, forbidden)) {
        console.error(`LINT WALL BREACHED: the admission pipeline may import ${forbidden} directly`);
        process.exitCode = 1;
      } else {
        console.log(`lint wall OK: the admission pipeline must take ${forbidden} as a port`);
      }
    }
    if (restrictedByPattern(patterns, "@/server/geocoding/region")) {
      console.error(`LINT WALL TOO STRICT: ${path} cannot import the allowlisted @/server/geocoding/region`);
      process.exitCode = 1;
    } else {
      console.log("lint wall OK: the admission pipeline may import the allowlisted @/server/geocoding/region");
    }
  }
}

// THE TEST-QUALITY WALL (test-overhaul Task 7.1, landed 2026-09-02).
//
// A lint rule that asserts an invariant is the same species as a comment that
// asserts one: if nothing proves it fires, it is a claim with a timer on it.
// That is the whole reason this file exists, so the newest wall gets the same
// treatment as the import walls above — including the "too strict" half, which
// is the one a fixture-only check would miss.
expectRejectedBy(
  lintFixture(
    "test_quality_fixture",
    'import { screen } from "@testing-library/react";\n' +
      'it("fixture", () => {\n  expect(screen.getByRole("button")).toHaveClass("bg-danger");\n});\n',
    { dir: "src/components", ext: "test.tsx" },
  ),
  "no-restricted-syntax",
  "test-quality wall: a toHaveClass assertion correctly rejected",
);

// The deliberate exemption, and the reason this half exists: a design-system
// primitive mapping `variant` onto a token class has no role, label or value
// standing in for that class. Without this check, "the rule fires" cannot
// distinguish a scoped wall from a blanket ban — the same gap the @tc/predict
// case closes for the domain wall.
expectClean(
  lintFixture(
    "test_quality_ui_fixture",
    'import { screen } from "@testing-library/react";\n' +
      'it("fixture", () => {\n  expect(screen.getByRole("button")).toHaveClass("bg-danger");\n});\n',
    { dir: "src/components/ui", ext: "test.tsx" },
  ),
  "test-quality wall: src/components/ui primitives may still assert their token classes",
);

// `no-container` and `no-node-access` both fire on this one, so the rule is named:
// either could go missing behind the other's non-zero exit.
expectRejectedBy(
  lintFixture(
    "test_quality_container_fixture",
    'import { render } from "@testing-library/react";\n' +
      'it("fixture", () => {\n  const { container } = render(<div />);\n' +
      '  expect(container.querySelector("div")).toBeTruthy();\n});\n',
    { dir: "src/components", ext: "test.tsx" },
  ),
  "testing-library/no-container",
  "test-quality wall: container.querySelector correctly rejected",
);

// Doubles as proof that `e2e/` is inside the lint lane at all. It was not until
// `apps/web`'s lint script was widened from `eslint src` (KI-2026-08-30-b), and
// a script narrowing back to `src` would make every Playwright rule silently
// stop applying — with no other signal than this line disappearing.
//
// KI-2026-09-05-s: naming `playwright/expect-expect` here is the whole point. This
// fixture also trips `playwright/consistent-spacing-between-blocks`, a cosmetic rule,
// so before the rule id was asserted this line stayed green with `expect-expect` off.
expectRejectedBy(
  lintFixture(
    "test_quality_e2e_fixture",
    'import { test } from "@playwright/test";\n' +
      'test("fixture", async ({ page }) => {\n  await page.goto("/");\n});\n',
    { dir: "e2e", ext: "ts" },
  ),
  "playwright/expect-expect",
  "test-quality wall: e2e spec without an assertion correctly rejected (is e2e/ still in the lint lane?)",
);

// THE FETCH WALL (KI-2026-09-05-q): UI code reaches the app's API through the
// client modules, whose helpers never reject. The second assertion on the same
// fixture is the one that matters most: the wall is `no-restricted-globals`
// precisely so it does not become the last block to set `no-restricted-syntax`
// on a `.tsx` file, which would silently switch the element wall off.
const fetchWallFixture = lintFixture(
  "fetch_wall_fixture",
  'export async function load() {\n  return fetch("/api/trips");\n}\n' +
    "export default function Fixture() {\n  return <button>go</button>;\n}\n",
  { dir: "src/components" },
);
expectRejectedBy(fetchWallFixture, "no-restricted-globals", "fetch wall: a bare fetch in UI code correctly rejected");
expectRejectedBy(
  fetchWallFixture,
  "no-restricted-syntax",
  "fetch wall: the element wall still applies to the same .tsx file",
);
expectClean(
  lintFixture("fetch_wall_server_fixture", 'export async function probe() {\n  return fetch("https://example.test");\n}\n', {
    dir: "src/server",
    ext: "ts",
  }),
  "fetch wall: server code may still call fetch",
);

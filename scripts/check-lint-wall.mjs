import { writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// KI-2026-09-05-s: this wall is itself covered by scripts/__tests__/check-lint-wall.test.mjs,
// which runs it against deliberately sabotaged copies of apps/web/eslint.config.mjs. That test
// needs to point eslint at a config other than the checked-in one; `LINT_WALL_ESLINT_CONFIG`
// (a path relative to apps/web) is the only seam it uses. Unset — i.e. in `pnpm lint` — the
// command line is exactly what it always was.
const configFlag = process.env.LINT_WALL_ESLINT_CONFIG
  ? `--config ${process.env.LINT_WALL_ESLINT_CONFIG} `
  : "";

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
function lintFixture(name, source, { dir = "src/app", ext = "tsx" } = {}) {
  const relative = `${dir}/__${name}__.${ext}`;
  const fixture = `apps/web/${relative}`;
  writeFileSync(fixture, source);
  // `-o` rather than reading stdout: when the linted file has problems `pnpm exec` appends
  // its own `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] ...` line to STDOUT, so the report is not
  // the last thing there and no bracket-matching heuristic survives it.
  const reportDir = mkdtempSync(join(tmpdir(), "tc-lint-wall-"));
  const reportPath = join(reportDir, "eslint.json");
  let report;
  try {
    try {
      execSync(`pnpm --filter web exec eslint ${configFlag}-f json -o ${reportPath} ${relative}`, {
        stdio: "pipe",
      });
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
    rmSync(fixture, { force: true });
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
    printed = execSync(`pnpm --filter web exec eslint ${configFlag}--print-config ${relativePath}`, {
      cwd: "apps/web",
      stdio: "pipe",
    }).toString();
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

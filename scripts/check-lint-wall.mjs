import { writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

// `dir`/`ext` default to the UI-wall fixtures' original shape
// (apps/web/src/app/__name__.tsx). The gateway wall below fixtures a
// server-side file instead (apps/web/src/server/ai/__name__.ts), so both
// need to be overridable rather than duplicating this helper.
function lintFixture(name, source, { dir = "src/app", ext = "tsx" } = {}) {
  const relative = `${dir}/__${name}__.${ext}`;
  const fixture = `apps/web/${relative}`;
  writeFileSync(fixture, source);
  try {
    execSync(`pnpm --filter web exec eslint ${relative}`, {
      stdio: "pipe",
    });
    return { fixture, passed: true };
  } catch {
    return { fixture, passed: false };
  } finally {
    rmSync(fixture, { force: true });
  }
}

const forbidden = lintFixture(
  "lint_wall_fixture",
  'import "@tc/domain";\nexport default function Fixture() { return null; }\n',
);
if (forbidden.passed) {
  console.error("LINT WALL BREACHED: forbidden import was NOT flagged");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: forbidden import correctly rejected");
}

const predict = lintFixture(
  "lint_wall_predict_fixture",
  'import { predictCommand } from "@tc/predict";\nexport default function Fixture() { void predictCommand; return null; }\n',
);
if (!predict.passed) {
  console.error("LINT WALL TOO STRICT: @tc/predict import was incorrectly flagged");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: @tc/predict import (predict subpath allowed) correctly passes");
}

const serverInternals = lintFixture(
  "lint_wall_server_fixture",
  'import "@/server/flags";\nexport default function Fixture() { return null; }\n',
);
if (serverInternals.passed) {
  console.error("LINT WALL BREACHED: @/server/* import from UI was NOT flagged");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: @/server/* import from UI correctly rejected");
}

// THE GATEWAY CHOKEPOINT WALL (ADR-019's 2026-08-25 amendment): only
// src/server/ai/modelSelection.ts may import @/server/ai/gateway. Fixtured
// under src/server/ai/ itself — a NEW file there, not modelSelection.ts —
// because that's exactly the shape of the real threat (M16's second AI
// endpoint reaching for the gateway directly instead of going through
// selectAiModel()).
const gateway = lintFixture(
  "lint_wall_gateway_fixture",
  'import { aiModel } from "@/server/ai/gateway";\nexport function forbidden() { return aiModel(); }\n',
  { dir: "src/server/ai", ext: "ts" },
);
if (gateway.passed) {
  console.error("LINT WALL BREACHED: @/server/ai/gateway import outside modelSelection.ts was NOT flagged");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: @/server/ai/gateway import outside modelSelection.ts correctly rejected");
}

// The same wall, for the SECOND export gateway.ts gained when the /ask intent
// classifier got its own configurable model (AI_CLASSIFIER_MODEL). The rule
// restricts the module, not the symbol, so this cannot fail while the fixture
// above passes — which is exactly why it is cheap to assert, and exactly what
// would have gone unchecked if a later export were added the same way.
const gatewayClassifier = lintFixture(
  "lint_wall_gateway_classifier_fixture",
  'import { aiClassifierModel } from "@/server/ai/gateway";\nexport function forbidden() { return aiClassifierModel(); }\n',
  { dir: "src/server/ai", ext: "ts" },
);
if (gatewayClassifier.passed) {
  console.error("LINT WALL BREACHED: @/server/ai/gateway aiClassifierModel import outside modelSelection.ts was NOT flagged");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: aiClassifierModel import outside modelSelection.ts correctly rejected");
}

// Regression coverage for a Major caught in review: `no-restricted-imports`
// `patterns` does string matching, not path resolution, so the alias-only
// check above did not catch a sibling reaching gateway.ts via a relative
// path — `import { aiModel } from "./gateway"` passed lint clean. The fix
// adds `import/no-restricted-paths` (which resolves the import before
// comparing) alongside the alias pattern; this fixture proves the relative
// spelling is rejected too, not just the alias one.
const gatewayRelative = lintFixture(
  "lint_wall_gateway_relative_fixture",
  'import { aiModel } from "./gateway";\nexport function forbidden() { return aiModel(); }\n',
  { dir: "src/server/ai", ext: "ts" },
);
if (gatewayRelative.passed) {
  console.error("LINT WALL BREACHED: relative \"./gateway\" import outside modelSelection.ts was NOT flagged");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: relative \"./gateway\" import outside modelSelection.ts correctly rejected");
}

// Some assertions below check "this exact real file's effective config",
// which a fixture cannot express — a fixture is, by construction, a file at
// some OTHER path. `--print-config` reports the no-restricted-imports rule
// ESLint would actually apply to a given real file; this reads its
// `patterns` array (or `[]` if the rule doesn't apply to that file at all —
// several blocks ignore all of src/server/**, so absence is a valid "not
// restricted" answer, not a script bug).
function noRestrictedImportPatterns(relativePath) {
  const printed = execSync(`pnpm --filter web exec eslint --print-config ${relativePath}`, {
    cwd: "apps/web",
    stdio: "pipe",
  }).toString();
  const resolvedConfig = JSON.parse(printed);
  const restrictedImports = resolvedConfig.rules?.["no-restricted-imports"];
  return Array.isArray(restrictedImports?.[1]?.patterns) ? restrictedImports[1].patterns : [];
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
if (restricts(modelSelectionPatterns, "@/server/ai/gateway")) {
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
  const hasDomainWall = restricts(patterns, "@tc/domain") && restricts(patterns, "@/server/*");
  if (!hasDomainWall) {
    console.error(`LINT WALL BREACHED: ${path} lost the @tc/domain / @/server/* wall`);
    process.exitCode = 1;
  } else {
    console.log(`lint wall OK: ${path} still carries the @tc/domain / @/server/* wall`);
  }
}

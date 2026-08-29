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

// The positive half of the gateway wall: modelSelection.ts itself must stay
// importable. A fixture can't cover this — a fixture is, by construction, a
// file at some OTHER path, and the exemption is keyed on this exact path
// (apps/web/eslint.config.mjs's `ignores`). So this asserts against ESLint's
// own resolved config for that real file instead: `--print-config` reports
// the no-restricted-imports rule ESLint would actually apply to it, and the
// exemption holds iff that rule (if present at all — the domain/UI walls
// also ignore all of src/server/**, so it may be entirely absent) carries no
// pattern matching @/server/ai/gateway. Without this half, "wall rejects the
// forbidden fixture" alone can't distinguish a scoped chokepoint from a
// blanket ban on the import everywhere — the same gap the @tc/predict case
// above exists to close for the domain wall.
const printed = execSync("pnpm --filter web exec eslint --print-config src/server/ai/modelSelection.ts", {
  cwd: "apps/web",
  stdio: "pipe",
}).toString();
const resolvedConfig = JSON.parse(printed);
const restrictedImports = resolvedConfig.rules?.["no-restricted-imports"];
const patterns = Array.isArray(restrictedImports?.[1]?.patterns) ? restrictedImports[1].patterns : [];
const stillRestricted = patterns.some((p) => (p.group ?? []).some((g) => g.includes("@/server/ai/gateway")));
if (stillRestricted) {
  console.error("LINT WALL TOO STRICT: modelSelection.ts is restricted from importing its own gateway");
  process.exitCode = 1;
} else {
  console.log("lint wall OK: modelSelection.ts (the sole exempt file) is not restricted from importing the gateway");
}

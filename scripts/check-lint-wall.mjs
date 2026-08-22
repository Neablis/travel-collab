import { writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

function lintFixture(name, source) {
  const fixture = `apps/web/src/app/__${name}__.tsx`;
  writeFileSync(fixture, source);
  try {
    execSync(`pnpm --filter web exec eslint src/app/__${name}__.tsx`, {
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

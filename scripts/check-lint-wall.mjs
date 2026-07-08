import { writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const fixture = "apps/web/src/app/__lint_wall_fixture__.tsx";
writeFileSync(
  fixture,
  'import "@tc/domain";\nexport default function Fixture() { return null; }\n',
);
try {
  execSync("pnpm --filter web exec eslint src/app/__lint_wall_fixture__.tsx", {
    stdio: "pipe",
  });
  console.error("LINT WALL BREACHED: forbidden import was NOT flagged");
  process.exitCode = 1;
} catch {
  console.log("lint wall OK: forbidden import correctly rejected");
} finally {
  rmSync(fixture, { force: true });
}

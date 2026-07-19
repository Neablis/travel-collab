import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// THE COLOR WALL (design-system.md "Enforcement"): raw color literals live in
// exactly one file. Files on the pending list are pre-M5 surfaces awaiting
// re-skin; the list only ever shrinks (deleted by the task that re-skins them).
const pending = new Set(JSON.parse(readFileSync("scripts/design-wall-pending.json", "utf8")));
const files = execSync("git ls-files 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 'apps/web/src/**/*.css'", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => f !== "apps/web/src/app/globals.css" && !pending.has(f));

const colorLiteral = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/;
const arbitraryValue = /className={?["'`][^"'`]*\[/;
let failed = false;
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (colorLiteral.test(line)) {
      console.error(`${file}:${i + 1}: raw color literal (tokens only — design-system.md)`);
      failed = true;
    }
    if (arbitraryValue.test(line)) {
      console.error(`${file}:${i + 1}: arbitrary Tailwind value (tokens only — design-system.md)`);
      failed = true;
    }
  });
}
if (failed) process.exit(1);
console.log(`color wall OK (${files.length} files scanned, ${pending.size} pending re-skin)`);

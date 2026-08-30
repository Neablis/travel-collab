import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// THE COLOR WALL (design-system.md "Enforcement"): raw color literals live in
// exactly one file. Files on the pending list are pre-M5 surfaces awaiting
// re-skin; the list only ever shrinks (deleted by the task that re-skins them).
//
// lib/sparklineColor.ts used to be a second, deliberate exception alongside
// globals.css (an 8-hue hashed palette for the home hero's sparkline). It's
// gone: the sparkline now colors by dayAccents' 5 semantic families, same as
// every other city-accented surface, so it needs no raw-hex exception of its
// own anymore (Mitchell, 2026-08-25 — one city, one color, everywhere).
const pending = new Set(JSON.parse(readFileSync("scripts/design-wall-pending.json", "utf8")));
// Third-party generated files that are permanently out of scope because they
// are not product UI at all — NOT the same concept as `pending` above. That
// list is legacy debt we are paying down and only ever shrinks; this one is
// scaffolding nobody hand-authors and nobody will ever re-skin, so it never
// shrinks either (KI-51 records the distinction). Keep this list to files
// that are wizard/codegen output, never a convenient place to park a raw
// color someone didn't want to fix.
const generatedNonProduct = new Set([
  // Sentry's `npx @sentry/wizard` scaffold — a throwaway route for verifying
  // error capture, not a page a user ever sees. Its `<style jsx>` block ships
  // Sentry's own brand colors, not ours (landed via 6a5501e, pushed directly
  // to main without a PR review — docs/guidelines/ci-cost-and-capacity.md).
  "apps/web/src/app/sentry-example-page/page.tsx",
]);
// --others --exclude-standard adds untracked-but-not-ignored files to the
// tracked (--cached) list: a brand-new file was invisible to the wall until it
// was staged (KI-51), which is exactly the file most likely to carry a raw hex.
// --exclude-standard keeps .gitignore honoured, so node_modules/.next/generated
// output stay out — walking the tree naively would not. Set dedupes the stage
// 1/2/3 duplicates --cached emits for unmerged paths mid-conflict.
const files = [
  ...new Set(
    execSync(
      "git ls-files --cached --others --exclude-standard 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 'apps/web/src/**/*.css'",
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean),
  ),
]
  .sort()
  .filter((f) => f !== "apps/web/src/app/globals.css" && !pending.has(f) && !generatedNonProduct.has(f));

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
console.log(
  `color wall OK (${files.length} files scanned, ${pending.size} pending re-skin, ${generatedNonProduct.size} generated non-product excluded)`,
);

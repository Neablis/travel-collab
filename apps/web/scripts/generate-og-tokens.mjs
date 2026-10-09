// Writes src/server/og/ogTokens.generated.ts and src/lib/appColors.generated.ts
// from src/app/globals.css, or with `--check` fails when either committed file
// differs from a fresh parse.
//
//   node scripts/generate-og-tokens.mjs           (pnpm --filter web og:tokens)
//   node scripts/generate-og-tokens.mjs --check   (pnpm --filter web og:verify)
//
// Spec 2026-09-27 §2.2, decision (a). The per-link preview cards are drawn by
// satori, which cannot resolve `var(--…)`, and the colour wall allows a raw
// literal only in globals.css. So the literals are GENERATED from globals.css
// and the wall exempts the generated files. What keeps the exemption honest is
// that a file can only go stale by failing a check: `ogTokens.test.ts` and
// `appColors.test.ts` run the same comparison inside `pnpm test`, which CI
// runs — the `content:verify` shape, a standalone command plus the same check
// in the unit lane.
//
// Two files rather than one because the app manifest and the root layout's
// `theme-color` (M39) are UI, and UI may not import `src/server` (AGENTS.md
// lint wall).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderAppColorsModule, renderOgTokensModule } from "./lib/ogTokens.mjs";

const root = new URL("../", import.meta.url);
const css = readFileSync(fileURLToPath(new URL("src/app/globals.css", root)), "utf8");
const targets = [
  ["src/server/og/ogTokens.generated.ts", renderOgTokensModule(css)],
  ["src/lib/appColors.generated.ts", renderAppColorsModule(css)],
];

if (process.argv.includes("--check")) {
  let stale = false;
  for (const [path, fresh] of targets) {
    let committed = "";
    try {
      committed = readFileSync(fileURLToPath(new URL(path, root)), "utf8");
    } catch {
      // Missing counts as stale, and says so below.
    }
    if (committed !== fresh) {
      console.error(`og tokens are stale: ${path} does not match globals.css.`);
      stale = true;
    }
  }
  if (stale) {
    console.error("Run `pnpm --filter web og:tokens` and commit the result.");
    process.exit(1);
  }
  console.log("og tokens OK");
} else {
  for (const [path, fresh] of targets) {
    writeFileSync(fileURLToPath(new URL(path, root)), fresh);
    console.log(`wrote ${path}`);
  }
}

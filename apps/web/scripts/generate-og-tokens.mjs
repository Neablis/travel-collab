// Writes src/server/og/ogTokens.generated.ts from src/app/globals.css, or with
// `--check` fails when the committed file differs from a fresh parse.
//
//   node scripts/generate-og-tokens.mjs           (pnpm --filter web og:tokens)
//   node scripts/generate-og-tokens.mjs --check   (pnpm --filter web og:verify)
//
// Spec 2026-09-27 §2.2, decision (a). The per-link preview cards are drawn by
// satori, which cannot resolve `var(--…)`, and the colour wall allows a raw
// literal only in globals.css. So the literals are GENERATED from globals.css
// and the wall exempts that one file. What keeps the exemption honest is that
// the file can only go stale by failing a check: `ogTokens.test.ts` runs the
// same comparison inside `pnpm test`, which CI runs — the `content:verify`
// shape, a standalone command plus the same check in the unit lane.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderOgTokensModule } from "./lib/ogTokens.mjs";

const root = new URL("../", import.meta.url);
const css = readFileSync(fileURLToPath(new URL("src/app/globals.css", root)), "utf8");
const target = fileURLToPath(new URL("src/server/og/ogTokens.generated.ts", root));
const fresh = renderOgTokensModule(css);

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(target, "utf8");
  } catch {
    // Missing counts as stale, and says so below.
  }
  if (committed !== fresh) {
    console.error("og tokens are stale: src/server/og/ogTokens.generated.ts does not match globals.css.");
    console.error("Run `pnpm --filter web og:tokens` and commit the result.");
    process.exit(1);
  }
  console.log("og tokens OK");
} else {
  writeFileSync(target, fresh);
  console.log("wrote src/server/og/ogTokens.generated.ts");
}

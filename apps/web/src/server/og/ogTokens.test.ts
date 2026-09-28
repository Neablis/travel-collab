import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderOgTokensModule } from "../../../scripts/lib/ogTokens.mjs";

// The drift check behind the colour wall's one generated exemption (spec
// 2026-09-27 §2.2, decision a). `pnpm --filter web og:verify` is the same
// comparison as a command; this is the copy CI runs, inside `pnpm test`.
describe("ogTokens.generated.ts", () => {
  it("is exactly what a fresh parse of globals.css produces", () => {
    const here = join(process.cwd(), "src");
    const css = readFileSync(join(here, "app/globals.css"), "utf8");
    const committed = readFileSync(join(here, "server/og/ogTokens.generated.ts"), "utf8");

    expect(committed).toBe(renderOgTokensModule(css));
  });
});

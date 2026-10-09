import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderAppColorsModule } from "../../scripts/lib/ogTokens.mjs";

// The drift check behind the colour wall's exemption for the manifest's and
// `theme-color`'s literals (M39 Part 4) — `ogTokens.test.ts`'s twin.
// `pnpm --filter web og:verify` is the same comparison as a command.
describe("appColors.generated.ts", () => {
  it("is exactly what a fresh parse of globals.css produces", () => {
    const here = join(process.cwd(), "src");
    const css = readFileSync(join(here, "app/globals.css"), "utf8");
    const committed = readFileSync(join(here, "lib/appColors.generated.ts"), "utf8");

    expect(committed).toBe(renderAppColorsModule(css));
  });
});

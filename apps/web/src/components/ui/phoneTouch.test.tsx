import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Button, PHONE_TOUCH, buttonVariants } from "./button";
import { TOUCH } from "../home/NewTripWizard";

// SPEC §13.1 — "44px targets, always" — and KI-046, which measured 191 of 211
// controls under it on one trip screen. M26 link 14 folded the two hand-rolled
// substitutes into the design system; these hold what that fold has to keep
// true.
describe("PHONE_TOUCH", () => {
  // **The bug the fold fixed.** It was `min-h-11 sm:min-h-0`, so the floor
  // released at 640px — while every other phone rule in this app draws the line
  // at 767: `useIsPhone`'s `PHONE_MAX_WIDTH_PX`, `.assistant-rail`,
  // `.unscheduled-rack`, and `md:hidden` on the tab bar. A 28px control on a
  // 700px-wide phone in landscape sat inside KI-046's band and outside the only
  // rule meant to protect it.
  //
  // **And only for a mouse, since M39 D3** (KI-2026-09-24-j). Released by
  // width alone (`md:min-h-0`), a tablet at 820px got 28px controls under a
  // finger. `fine:` is "a fine pointer, at md and up" (globals.css).
  it("releases for a mouse from the breakpoint the rest of the app calls a phone, never by width alone", () => {
    expect(PHONE_TOUCH).toContain("fine:min-h-0");
    expect(PHONE_TOUCH).toContain("fine:min-w-0");
    expect(PHONE_TOUCH).not.toMatch(/(^|\s)(sm|md):min-/);
  });

  it("is a floor, not a height, so a wrapped label pushes the control taller", () => {
    expect(PHONE_TOUCH).toContain("min-h-11");
    expect(PHONE_TOUCH).not.toMatch(/(^|\s)h-11(\s|$)/);
  });

  // One definition, two names. `NewTripWizard` kept exporting `TOUCH` so its
  // importers did not all have to change in the same commit; if the two ever
  // stop being the same string, a surface silently gets a different floor.
  it("is the single definition NewTripWizard's TOUCH now re-exports", () => {
    expect(TOUCH).toBe(PHONE_TOUCH);
  });

  // The other size still exists and still means something different: `touch` is
  // 44px everywhere, for controls the design draws at 44px on both surfaces —
  // the sheet header, the Ask pill, the front door.
  //
  // **This test caught the sweep breaking it.** M26 link 14 put §13.1's phone
  // floor on the BASE, with `md:min-h-0` releasing it above 768px — which
  // applied to `touch` too, quietly turning "44px at every width" into
  // "44px on a phone". The size now re-asserts the floor under the SAME
  // variant the base releases it with (`fine:`, since M39 D3): a re-assertion
  // under a different one (`md:`) loses the cascade to the release whenever
  // both match, which is what that variant swap would have done here.
  it("is not the same thing as the base's phone floor: touch is 44px at every width", () => {
    const always = buttonVariants({ size: "touch" });
    expect(always).toContain("min-h-11");
    expect(always).toContain("fine:min-h-11");
    expect(always).toContain("fine:min-w-11");
  });

  // The base's own floor, which is what makes §13.1 true by construction rather
  // than by 48 people remembering it.
  it("is inherited by every button under a finger, and released for a mouse above 768px", () => {
    const plain = buttonVariants({ size: "sm" });
    expect(plain).toContain("min-h-11");
    expect(plain).toContain("fine:min-h-0");
    // Never by width alone: not at 640, and since M39 D3 not at 768 either.
    expect(plain).not.toMatch(/(^|\s)(sm|md):min-h-0/);
  });

  it("applies to a real button without fighting its variant", () => {
    render(
      <Button size="sm" className={PHONE_TOUCH}>
        Choose premium
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Choose premium" });
    // `min-h-11` beats `sm`'s fixed `h-7` without the caller restating it.
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("h-7");
  });
});

// What `fine:` compiles to, from the REAL globals.css with the REAL Tailwind
// compiler (the PageEditor typography test's method; jsdom matches no media
// query). A touchscreen laptop's PRIMARY pointer is its trackpad, so
// `(pointer: fine)` alone released the floor under a finger that can still
// reach the screen (CodeRabbit, PR #365) — the critique's own reason for
// choosing the pointer over width was that such a laptop keeps 44px. Chromium
// cannot emulate "fine primary, coarse also present" (touch emulation flips the
// primary pointer too), so this is the layer that can hold it.
describe("the fine: variant", () => {
  async function compiled(candidate: string): Promise<string> {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cssPath = path.resolve(here, "../../app/globals.css");
    const require = createRequire(cssPath);
    const { compile } = require("tailwindcss") as typeof import("tailwindcss");
    const compiler = await compile(readFileSync(cssPath, "utf8"), {
      base: path.dirname(cssPath),
      loadStylesheet: async (id: string, base: string) => {
        const resolved = require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id, { paths: [base] });
        return { path: resolved, base: path.dirname(resolved), content: readFileSync(resolved, "utf8") };
      },
      loadModule: async () => {
        throw new Error("globals.css loads no JS plugins");
      },
    });
    return compiler.build([candidate]);
  }

  it("releases the floor only when no pointer on the device is coarse", async () => {
    const css = await compiled("fine:min-h-0");
    const rule = css.slice(css.indexOf(".fine\\:min-h-0"));
    // The at-rules wrapping the rule, outermost first.
    const conditions = css.slice(0, css.indexOf(".fine\\:min-h-0")).match(/@media[^{]*/g) ?? [];
    expect(rule).toContain("min-height: 0");
    expect(conditions.join(" ")).toMatch(/pointer: fine/);
    expect(conditions.join(" ")).toMatch(/not all and \(any-pointer: coarse\)/);
  });
});

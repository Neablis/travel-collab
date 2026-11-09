import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPublicOrigin } from "./lib/public-origin-check.mjs";

const ENTRY = fileURLToPath(
  new URL("./check-public-origin.mjs", import.meta.url),
);

// Production served `<link rel="canonical" href="http://localhost:3001">` on
// every prerendered page after the move off Vercel (2026-11-09), because the
// container build had no PUBLIC_ORIGIN. These pin the gate that refuses that.
describe("the container build's public origin", () => {
  it("refuses a production build with no PUBLIC_ORIGIN, naming the fix", () => {
    const result = checkPublicOrigin({ APP_ENV: "production" });
    expect(result).toHaveProperty("fail");
    expect("fail" in result && result.fail).toContain(
      "PUBLIC_ORIGIN=https://caesura.today",
    );
  });

  // Coolify can hold a variable as an empty string.
  it("treats an empty PUBLIC_ORIGIN as unset", () => {
    expect(
      checkPublicOrigin({ APP_ENV: "production", PUBLIC_ORIGIN: "" }),
    ).toHaveProperty("fail");
  });

  it("refuses a production build whose origin is localhost or plain http", () => {
    expect(
      checkPublicOrigin({
        APP_ENV: "production",
        PUBLIC_ORIGIN: "http://localhost:3001",
      }),
    ).toHaveProperty("fail");
    expect(
      checkPublicOrigin({
        APP_ENV: "production",
        PUBLIC_ORIGIN: "http://caesura.today",
      }),
    ).toHaveProperty("fail");
    expect(
      checkPublicOrigin({
        APP_ENV: "production",
        PUBLIC_ORIGIN: "caesura.today",
      }),
    ).toHaveProperty("fail");
  });

  it("passes a production build with a public https origin", () => {
    expect(
      checkPublicOrigin({
        APP_ENV: "production",
        PUBLIC_ORIGIN: "https://caesura.today",
      }),
    ).toEqual({
      ok: "[public-origin] https://caesura.today",
    });
  });

  it("only warns on a preview, which is noindex", () => {
    expect(checkPublicOrigin({ APP_ENV: "preview" })).toHaveProperty("warn");
  });

  it("leaves a local or CI build alone", () => {
    expect(checkPublicOrigin({})).toHaveProperty("ok");
  });

  it("leaves a Vercel build to Vercel's own variables", () => {
    expect(checkPublicOrigin({ VERCEL_ENV: "production" })).toHaveProperty(
      "ok",
    );
  });

  // The script is what `build:container` runs, so its exit code is the gate.
  it("exits non-zero for a production build with no origin, and zero with one", () => {
    const run = (env: Record<string, string>) =>
      spawnSync(process.execPath, [ENTRY], {
        env: {
          PATH: process.env.PATH ?? "",
          ...env,
        } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
      });
    const missing = run({ APP_ENV: "production" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("PUBLIC_ORIGIN is not set");
    expect(
      run({ APP_ENV: "production", PUBLIC_ORIGIN: "https://caesura.today" })
        .status,
    ).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { BASE_URL, WEB_PORT } from "@/config";

// KI-72. These run inside a Vitest worker, which is exactly where the defect
// lived: Vitest assigns Vite's resolved `env` onto `process.env`, and Vite's
// own `BASE_URL` is the public base path, `"/"`. `src/config.ts` read
// `env.BASE_URL`, so it evaluated to `"/"` here — and a test comparing a URL
// against it would have agreed with almost anything.
//
// The first assertion is the regression pin. It is written against the
// *shape* rather than the exact string so it keeps working if someone sets a
// real WEB_BASE_URL override, while still failing the moment config.ts goes
// back to reading a name Vite owns.
describe("BASE_URL", () => {
  it("is an absolute URL, not Vite's base path", () => {
    expect(BASE_URL).not.toBe("/");
    expect(() => new URL(BASE_URL)).not.toThrow();
    expect(new URL(BASE_URL).protocol).toMatch(/^https?:$/);
  });

  it("still carries Vite's own BASE_URL in the worker env, which is the trap", () => {
    // Not asserting the app is correct — asserting the hazard is still present,
    // so this file keeps explaining itself if someone wonders why config.ts
    // reads an oddly-named variable. If Vitest ever stops doing this, this
    // test fails and the comment in config.ts can be revisited.
    expect(process.env.BASE_URL).toBe("/");
  });

  // Both branches assert. The first draft wrapped the assertion in
  // `if (!process.env.WEB_BASE_URL)`, so setting that variable turned the test
  // into a no-op that still reported green — a test that can pass without
  // asserting the thing it is named for. (CodeRabbit, PR #86.)
  it("is the override when one is set, and the WEB_PORT default otherwise", () => {
    const override = process.env.WEB_BASE_URL;
    expect(BASE_URL).toBe(override ? override : `http://localhost:${WEB_PORT}`);
  });
});

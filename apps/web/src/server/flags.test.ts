import { afterEach, describe, expect, it, vi } from "vitest";

// **Every flag in this app fails closed, and until now that was a comment.**
//
// `defaultValue: false` is the guarantee behind three separate notes — the
// `ai-live` declaration's own ("unset degrades to simulated, never to
// spending"), `quota.ts`'s fail-closed note, and M20's
// plan, which lists *"'tidying' `defaultValue: false` in the flag declaration
// to match the dashboard"* among the things that must not happen.
//
// Nothing asserted it. A one-line "cleanup" would have turned an outage from
// "simulated, and nobody spends" into "live, and everybody does" — and for
// `admin-console`, from "not an operator" into "everyone is an operator".
//
// Enumerated from the module rather than listed by hand, so a flag added
// tomorrow is covered the day it is written rather than the day somebody
// remembers this file.
it("declares every flag false by default, which is what failing closed means", async () => {
  const flags = await import("@/server/flags");
  const declarations = Object.entries(flags) as [string, { key: string; defaultValue?: unknown }][];
  expect(declarations.length).toBeGreaterThan(0);
  for (const [name, declaration] of declarations) {
    expect(declaration.defaultValue, `${name} (${declaration.key})`).toBe(false);
  }
  // The witness for the loop above: an empty module would satisfy it vacuously,
  // and the two keys are the ones the logs and docs name.
  expect(declarations.map(([, d]) => d.key).sort()).toEqual(["admin-console", "ai-live"]);
});

// The flags are env vars now (M59): no adapter, no Flags service. `true` is the
// only value that turns one on, so a typo cannot spend money or grant admin.
describe("flags read their own environment variable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["aiLiveFlag", "FLAG_AI_LIVE"],
    ["adminConsoleFlag", "FLAG_ADMIN_CONSOLE"],
  ] as const)("%s is on for %s=true and off for anything else", async (name, variable) => {
    const flags = await import("@/server/flags");
    vi.stubEnv(variable, "true");
    expect(await flags[name]()).toBe(true);
    for (const other of ["", "TRUE", "1", "yes"]) {
      vi.stubEnv(variable, other);
      expect(await flags[name](), `${variable}=${JSON.stringify(other)}`).toBe(false);
    }
    vi.stubEnv(variable, undefined);
    expect(await flags[name]()).toBe(false);
  });
});

import { expect, it } from "vitest";

// One property, and it is the reason `flagEntities.ts` imports `@/server/auth`
// lazily rather than at the top of the file.
//
// The Flags Explorer's discovery endpoint lives at the fixed path
// `src/app/.well-known/vercel/flags/route.ts` and does `import * as flags from
// "@/server/flags"`. It is a protocol route: it needs no database, and it
// builds without one today. But `identify` has to read the session, and
// `@/server/auth` reaches `server/users.ts` -> `server/db/client.ts` ->
// `server/config.ts`, which THROWS at module load when DATABASE_URL is unset.
// A static import would therefore have moved that throw into this module's
// graph and into the discovery endpoint's, turning a missing `.env.local` into
// "Failed to collect page data for /.well-known/vercel/flags" — the failure
// `docs/guidelines/cloud-agent-sessions.md` documents as costing a full build
// cycle to recognise.
//
// Asserting it here rather than trusting the comment: a later "tidy the dynamic
// import away" is a one-line change that nothing else would catch until a build
// in a fresh worktree.
//
// What this actually pins is that the auth/database chain is not in this
// module's graph; "loads with no DATABASE_URL" is how that is observable from a
// test. Making the import static was tried, and it does fail this — though the
// symptom is environment-specific (in the unit runner next-auth fails to
// resolve `next/server` before config.ts is even reached; in a real build it is
// the DATABASE_URL throw). Either way the graph is what changed, so don't
// rewrite this to assert one particular error message.
it("loads with no DATABASE_URL, so the discovery endpoint keeps building without a database", async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await expect(import("@/server/flags")).resolves.toHaveProperty("aiLiveFlag");
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

// **Every flag in this app fails closed, and until now that was a comment.**
//
// `defaultValue: false` is the guarantee behind three separate notes — the
// `ai-live` declaration's own ("an unreachable Flags service degrades to
// simulated, never to spending"), `quota.ts`'s fail-closed note, and M20's
// plan, which lists *"'tidying' `defaultValue: false` in the flag declaration
// to match the dashboard"* among the things that must not happen. It is the
// code's fallback for an unreachable Flags service, and the dashboard value
// deliberately points the other way once AI goes live; making them agree is the
// exact mistake.
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
  // and the two keys are the ones the Vercel dashboard is configured against —
  // renaming one is a deploy that silently stops reading its own rules.
  expect(declarations.map(([, d]) => d.key).sort()).toEqual(["admin-console", "ai-live"]);
});

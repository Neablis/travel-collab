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

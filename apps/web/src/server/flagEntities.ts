// Who is asking, expressed as Vercel Flags ENTITIES — the attributes a
// targeting rule in the Vercel dashboard is written against ("serve `Live` to
// user.email eq mitchell@…"). Server-only, same rule as server/config.ts and
// server/flags.ts: nothing here is importable from UI code.
//
// **Why this is not in `server/flags.ts`.** That module is declarations only —
// `getProviderData(flags)` in the discovery endpoint enumerates every one of
// its exports and expects each to be a flag definition, so an exported helper
// there would be skipped at best and throw at worst. Same reason `aiLive()`
// lives in `ai/modelSelection.ts`.
//
// ADR-019 said per-user targeting was "one `identify` option away" and left it
// unbuilt. This is that option; the 2026-09-08 amendment records what changed.
import { dedupe } from "flags/next";

/**
 * The attributes this app publishes about the caller for targeting.
 *
 * Every field here is one a rule can be written against, and each is carried
 * for a stated reason rather than because it was available:
 *
 * - **`id`** — the Auth.js user id, which is `actor_id` verbatim (`server/users.ts`):
 *   the only identifier that is stable across sign-ins and the one a percentage
 *   rollout must bucket by (`vercel flags rollout ai-live --by user.id`), because
 *   bucketing by anything a person can change moves them between buckets.
 * - **`email`** — the handle a rule is actually WRITTEN with. `id` is
 *   `google-<sub>` for a real sign-in, an opaque number nobody can recognise;
 *   targeting by it alone would mean copy-pasting uuids out of Postgres to turn
 *   AI on for one person, which is the exact task this exists to make easy.
 * - **`emailDomain`** — so "everyone at my company" is one `eq` rule rather than
 *   a rule per person, without depending on which string operators the
 *   dashboard offers on `email`.
 *
 * `user` is ABSENT for a signed-out caller (see `flagEntitiesFor`), which is
 * not the same as a user with empty attributes: no user-keyed rule matches, and
 * the flag falls through to its dashboard default. That is why the `ai-live`
 * fallthrough must stay `Simulated` — targeting rules may only ever WIDEN who
 * gets live AI, never be the thing that keeps everyone else off it.
 *
 * Note on what leaves the app: these attributes are sent to Vercel Flags on
 * evaluation. Vercel already runs the compute this app is deployed on and
 * already holds every one of these values, so no new processor sees them — but
 * it is a real export of identity, so the list stays this short deliberately
 * and each addition should have to justify itself the way the three above do.
 */
export type FlagEntities = {
  user?: {
    id: string;
    email?: string;
    emailDomain?: string;
  };
};

/** The subset of an Auth.js session this reads. Structural on purpose: it makes
 * this function testable with a literal, and it is the whole reason the mapping
 * is separable from the session read at all. */
export type FlagSession = {
  user?: { id?: string | null; email?: string | null } | null;
} | null;

/**
 * Pure: what a session means as targeting attributes.
 *
 * An id of `""` counts as signed out. That is not defensive padding — the
 * `session` callback in `lib/authConfig.ts` writes exactly that when a token
 * carries no `userId` claim, and an entity keyed on the empty string would let
 * one targeting rule match every unidentifiable caller at once.
 */
export function flagEntitiesFor(session: FlagSession): FlagEntities {
  const id = session?.user?.id?.trim();
  if (!id) return {};

  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return { user: { id } };

  // Everything after the LAST "@" — an address may legally contain one in a
  // quoted local part, and the domain is the part after the final separator.
  const at = email.lastIndexOf("@");
  const domain = at === -1 ? "" : email.slice(at + 1);

  return { user: { id, email, ...(domain === "" ? {} : { emailDomain: domain }) } };
}

/**
 * The `identify` every flag in this app should use.
 *
 * **`auth` is imported lazily, and that is load-bearing.** `@/server/auth`
 * reaches `server/users.ts` → `server/db/client.ts` → `server/config.ts`, which
 * THROWS at module load when `DATABASE_URL` is unset. A static import here would
 * put that in `server/flags.ts`'s module graph and therefore in the discovery
 * endpoint's, so `.well-known/vercel/flags` — a route that needs no database and
 * builds without one today — would start failing Next's page-data collection in
 * any checkout that hasn't got an `.env.local` yet. See
 * `docs/guidelines/cloud-agent-sessions.md` for what that failure looks like and
 * how long it takes to recognise.
 *
 * **There is deliberately no try/catch.** A session read that throws must NOT
 * degrade to "anonymous": anonymous falls through to the flag's dashboard
 * default, which is a configuration, not a guarantee. It must degrade to
 * simulated, and it does — `aiLive()` (`ai/modelSelection.ts`) already catches
 * everything the flag call can throw and answers `false`. That catch is the one
 * that matters here, because the Flags SDK evaluates `identify` BEFORE the code
 * path that applies `defaultValue`: an `identify` that throws propagates out of
 * the flag call and is NOT covered by `defaultValue` (verified in
 * `flags@4.3.0`, `dist/next.js` — `getEntities` runs ahead of `applyResult`).
 *
 * `dedupe` keeps this to one session read per request even when several flags
 * identify the same way; sharing this one function reference between flags is
 * also what lets the SDK group them into a single `bulkDecide` call, since it
 * buckets by the identify reference.
 */
export const identifyFlagEntities = dedupe(async (): Promise<FlagEntities> => {
  const { auth } = await import("@/server/auth");
  return flagEntitiesFor(await auth());
});

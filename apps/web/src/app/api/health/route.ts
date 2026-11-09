// What the container healthcheck and Coolify's rollout ask. Deliberately
// shallow: it answers "is the server up", not "is the database up", so a
// database blip cannot get a healthy container killed and restarted in a loop.
// Unauthenticated: `/api` is outside the proxy's matcher, and it reveals
// nothing. `force-dynamic` so `next build` does not prerender one answer.
import { sourceCommit } from "@/lib/deployment/env";

export const dynamic = "force-dynamic";

/**
 * The liveness answer: `{ ok: true }` while the server is up, and nothing about
 * its dependencies, plus the commit sha of the build so a deploy can be
 * confirmed to be the one pushed. A sha is public in a public repo.
 */
export function GET() {
  return Response.json({ ok: true, version: sourceCommit() ?? "unknown" });
}

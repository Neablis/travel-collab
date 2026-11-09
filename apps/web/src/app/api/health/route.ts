// What the container healthcheck and Coolify's rollout ask. Deliberately
// shallow: it answers "is the server up", not "is the database up", so a
// database blip cannot get a healthy container killed and restarted in a loop.
// Unauthenticated: `/api` is outside the proxy's matcher, and it reveals
// nothing. `force-dynamic` so `next build` does not prerender one answer.
export const dynamic = "force-dynamic";

/** The liveness answer: `{ ok: true }` while the server is up, and nothing about its dependencies. */
export function GET() {
  return Response.json({ ok: true });
}

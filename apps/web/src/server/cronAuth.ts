// Server-only: never import from UI code. The shared secret check for Vercel
// Cron routes (Part 2 of 5 introduces the first one, `api/cron/embed-days`).
//
// Vercel sends `Authorization: Bearer <CRON_SECRET>` on every cron
// invocation, using the project's `CRON_SECRET` env var — the same value this
// module reads. No other caller should ever hold it. When the secret is
// unset, EVERYTHING is unauthorised (fail closed): an operator who forgot the
// env var gets 401s in the cron logs, not an open endpoint.
import { timingSafeEqual } from "node:crypto";
import { serverConfig } from "@/server/config";

/**
 * Whether this request carries the cron secret.
 *
 * Compared with `timingSafeEqual` so a wrong secret costs the same time as a
 * right one; a missing secret or a missing header is unauthorised without
 * reaching the comparison.
 */
export function isCronRequestAuthorized(request: Request): boolean {
  const secret = serverConfig.cronSecret;
  if (secret === "") return false;
  const header = request.headers.get("authorization");
  if (header === null) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// Server-only: never import from UI code. The shared secret check for the
// cron routes (Part 2 of 5 introduced the first one, `api/cron/embed-days`).
//
// Each Coolify scheduled task sends `Authorization: Bearer <CRON_SECRET>`,
// using the application's `CRON_SECRET` env var — the same value this module
// reads (docs/ops/coolify-vps.md, *Crons*). No other caller should ever hold it. When the secret is
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

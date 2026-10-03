#!/usr/bin/env node
/**
 * Runs the live set (`src/server/ai/eval/live-set.json`) against a deployment,
 * with a real model, and prints the window the `ai-usage` skill's
 * `ledger.sql` needs to read the turns back (M31 Phase 1, ADR-062 §7).
 *
 *   LIVE_SET_COOKIE='<session cookie>' pnpm --filter web live-set <deployment-url> --trip <tripId> --confirm
 *
 * - `<deployment-url>` must be a deployment that reports itself as `preview`
 *   or `development` from `/api/health/ai-mode`. Anything else, an
 *   unreachable health route included, is refused before a turn is sent.
 *   It must be `https://`, except on this machine: the first request already
 *   carries the cookie, so a plain-HTTP remote is refused before it is sent.
 * - `--trip` is a trip the signed-in account can EDIT: change prompts propose,
 *   and the demo trip is refused by the route (KI-079). Use a copy of the
 *   seeded Japan trip; the prompts name its Kyoto days.
 * - The cookie is the account's whole `Cookie` header value, copied from a
 *   signed-in browser on that deployment (`authjs.session-token=…`). It is read
 *   from `LIVE_SET_COOKIE`, or from standard input when that is piped — never
 *   from an argument, where it would land in shell history and `ps` (CodeRabbit
 *   on #301). The script never prints it.
 * - `--confirm` is required: every turn is a real model call that costs money
 *   once `ai-live` is on for that deployment. Without it the script prints
 *   what it would run and stops.
 * - `VERCEL_AUTOMATION_BYPASS_SECRET` in the environment is sent as
 *   `x-vercel-protection-bypass` when the preview is protected.
 *
 * Each turn is one fresh conversation, so the runs are independent. Nothing
 * is approved: the set measures turns, not commits. Read the results with
 * `.claude/skills/ai-usage/ledger.sql` over the printed window. The account and
 * the window identify the run; the script adds no tag of its own.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SET = new URL("../src/server/ai/eval/live-set.json", import.meta.url);

/**
 * The operand after `flag` in `argv`, or null when the flag is absent, last, or
 * followed by another flag — so `--trip --confirm` is a missing trip, not a
 * trip called `--confirm` (CodeRabbit on #301).
 */
export function argValue(flag, argv = process.argv) {
  const index = argv.indexOf(flag);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith("-") ? null : value;
}

/**
 * Whether credentials may be sent to `url` at all: HTTPS, or plain HTTP only
 * to this machine. Checked before the health request, which is the first one
 * that carries the cookie; `targetVerdict` comes after it and cannot protect it.
 */
export function transportVerdict(url) {
  if (url.protocol === "https:") return { ok: true };
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return { ok: true };
  return { ok: false, reason: `${url.protocol}//${url.hostname} is not HTTPS` };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Turn statuses that will not change by sending more turns: the cookie is not
 * signed in (401) or the account cannot edit the trip (403). The run stops at
 * the first one rather than repeat it for every prompt (CodeRabbit on #301).
 */
export function isFatalStatus(status) {
  return status === 401 || status === 403;
}

/** The session cookie: `LIVE_SET_COOKIE`, else piped standard input, else null. */
async function readCookie() {
  const fromEnv = process.env.LIVE_SET_COOKIE?.trim();
  if (fromEnv) return fromEnv;
  if (process.stdin.isTTY) return null;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() || null;
}

/**
 * Whether a target may be sent paid turns: only when the deployment ITSELF
 * reports `preview` or `development` from `/api/health/ai-mode`.
 *
 * Not decided from the hostname. A production deployment has its own hashed
 * `*.vercel.app` URL exactly like a preview's, so no URL pattern separates
 * them (Copilot on #301); the first version of this guard did and would have
 * let a production deployment URL through. Fails closed: an unreachable or
 * unreadable health route, or any other environment, is a refusal.
 */
export function targetVerdict(environment, hostname) {
  if (environment === "preview" || environment === "development") return { ok: true };
  // No environment at all: off Vercel. Only this machine is allowed then — a
  // deployment that hides `VERCEL_ENV` could be production (review of #301).
  const local = LOOPBACK.has(hostname);
  if (environment === null && local) return { ok: true };
  return { ok: false, reason: `the deployment reports environment ${JSON.stringify(environment ?? null)}` };
}

/**
 * Request headers for one call to the target: the account's cookie, plus the
 * protection bypass when `VERCEL_AUTOMATION_BYPASS_SECRET` is set.
 */
function headersFor(cookie) {
  const headers = { "Content-Type": "application/json", Cookie: cookie };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return headers;
}

/**
 * What the deployment reports as its environment: a string, `null` when it is
 * off Vercel, or `undefined` when the health route could not be read at all —
 * which `targetVerdict` treats as a refusal.
 */
async function environmentOf(base, cookie) {
  try {
    const res = await fetch(new URL("/api/health/ai-mode", base), { headers: headersFor(cookie) });
    if (!res.ok) return undefined;
    const body = await res.json();
    if (body.environment === null) return null;
    return typeof body.environment === "string" ? body.environment : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sends one prompt as a fresh conversation and drains the reply, so the turn's
 * ledger rows are written before the next turn starts. Returns the status,
 * whether the turn was simulated, and the wall-clock time.
 */
async function runTurn(base, tripId, cookie, text) {
  const headers = headersFor(cookie);
  const startedAt = Date.now();
  const res = await fetch(new URL(`/api/trips/${tripId}/ask`, base), {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text }] }],
      scope: { kind: "trip" },
    }),
  });
  // Drain the stream: the turn's ledger row is written when it ends.
  await res.text();
  return { status: res.status, simulated: res.headers.get("x-tc-ai-simulated"), ms: Date.now() - startedAt };
}

/** Parses the arguments, refuses a non-preview target, then runs the set or prints what it would run. */
async function main() {
  const raw = process.argv[2];
  const tripId = argValue("--trip");
  if (!raw || raw.startsWith("-") || !tripId) {
    console.error("usage: LIVE_SET_COOKIE=<cookie header> live-set <deployment-url> --trip <tripId> [--confirm]");
    process.exit(2);
  }
  const base = new URL(raw);
  const transport = transportVerdict(base);
  if (!transport.ok) {
    console.error(`live-set: refusing ${base.hostname}: ${transport.reason}. The cookie is only sent over HTTPS, or to this machine.`);
    process.exit(2);
  }
  const cookie = await readCookie();
  if (!cookie) {
    console.error("live-set: no session cookie. Set LIVE_SET_COOKIE, or pipe the Cookie header value on standard input.");
    process.exit(2);
  }
  const verdict = targetVerdict(await environmentOf(base, cookie), base.hostname);
  if (!verdict.ok) {
    console.error(`live-set: refusing ${base.hostname}: ${verdict.reason}. Preview or local development only.`);
    process.exit(2);
  }
  const set = JSON.parse(readFileSync(SET, "utf8"));
  const turns = set.prompts.flatMap((prompt) => Array.from({ length: set.repeat }, () => prompt));
  if (!process.argv.includes("--confirm")) {
    console.log(`live-set: would run ${turns.length} turns (${set.prompts.length} prompts × ${set.repeat}) against ${base.origin}.`);
    console.log("live-set: each is a real model call once ai-live is on. Pass --confirm to run them.");
    return;
  }

  const since = new Date();
  let simulated = 0;
  let failed = 0;
  for (const [index, prompt] of turns.entries()) {
    const result = await runTurn(base, tripId, cookie, prompt.text);
    console.log(`${String(index + 1).padStart(2)}/${turns.length} ${prompt.id.padEnd(26)} ${result.status} ${result.ms}ms`);
    if (isFatalStatus(result.status)) {
      console.error(`live-set: stopping — ${result.status} means the cookie is not signed in or the account cannot edit trip ${tripId}. Every later turn would fail the same way.`);
      process.exit(1);
    }
    if (result.simulated === "true") simulated += 1;
    if (result.status !== 200) failed += 1;
  }
  const until = new Date();

  console.log("");
  console.log(`window: since ${since.toISOString()} until ${until.toISOString()}`);
  console.log(`turns: ${turns.length}, non-200: ${failed}, simulated: ${simulated}`);
  if (simulated > 0) {
    console.log("WARNING: simulated turns ran — ai-live was off for this account, and ledger.sql excludes them.");
  }
  console.log("Read it back: in each ledger.sql query, set `since` to the window above and add");
  console.log("`AND u.user_id = '<this account's user id>'` to its WHERE clause.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("live-set:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Runs the live set (`src/server/ai/eval/live-set.json`) against a deployment,
 * with a real model, and prints the window the `ai-usage` skill's
 * `ledger.sql` needs to read the turns back (M31 Phase 1, ADR-062 §7).
 *
 *   pnpm --filter web live-set <deployment-url> --trip <tripId> --cookie <session cookie> --confirm
 *
 * - `<deployment-url>` must be localhost or a Vercel preview deployment. It
 *   refuses anything else, so a mistyped production URL spends nothing there.
 * - `--trip` is a trip the signed-in account can EDIT: change prompts propose,
 *   and the demo trip is refused by the route (KI-079). Use a copy of the
 *   seeded Japan trip; the prompts name its Kyoto days.
 * - `--cookie` is the account's whole `Cookie` header value, copied from a
 *   signed-in browser on that deployment (`authjs.session-token=…`). The script
 *   never prints it.
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

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/** Localhost, or a preview deployment's own hostname (`<project>-<hash>-<team>.vercel.app` or a `-git-` branch alias). */
export function isAllowedTarget(url) {
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (!host.endsWith(".vercel.app")) return false;
  return /-git-/.test(host) || /-[a-z0-9]{9}-/.test(host);
}

async function runTurn(base, tripId, cookie, text) {
  const headers = { "Content-Type": "application/json", Cookie: cookie };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
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

async function main() {
  const raw = process.argv[2];
  const tripId = argValue("--trip");
  const cookie = argValue("--cookie");
  if (!raw || raw.startsWith("--") || !tripId || !cookie) {
    console.error("usage: live-set <deployment-url> --trip <tripId> --cookie <cookie header> [--confirm]");
    process.exit(2);
  }
  const base = new URL(raw);
  if (!isAllowedTarget(base)) {
    console.error(`live-set: refusing ${base.hostname} — localhost or a Vercel preview deployment only.`);
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
    if (result.simulated === "true") simulated += 1;
    if (result.status !== 200) failed += 1;
    console.log(`${String(index + 1).padStart(2)}/${turns.length} ${prompt.id.padEnd(26)} ${result.status} ${result.ms}ms`);
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

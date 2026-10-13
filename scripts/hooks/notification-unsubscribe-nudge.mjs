import { parseStdin, readAll } from "./lib/run-context.mjs";
import { orchestratorMarker } from "./lib/orchestrator.mjs";
import { recordGuard } from "./lib/guard-log.mjs";

// PostToolUse hook (matcher: ReadNotifications). 141 of the 190 GitHub wakes
// in M42 did nothing but read a notification, at about $0.29 each, and most
// came from part PRs the orchestrator never chose to watch: the harness
// subscribes a session to every PR opened inside it, and implementers open
// theirs there (docs/retros/2026-10-12-m42-token-spend-retro.md, F1 and
// Fix 1). Nothing can stop the wake that already happened; this says, at the
// moment it is cheapest to act on, to drop the subscription.
//
// Since 2026-10-13 (after the M45 retro) that covers every PR, part 0's
// included: the orchestrator watches none. It arms long `send_later`
// check-ins and reads all its PRs' state in one `pnpm pr-digest` at each.
// The past-250k hand-off note moved to orchestrator-context-limit.mjs for the
// same reason: once unsubscribed, the orchestrator stops reading notifications.
//
// Engages only for the milestone orchestrator (lib/orchestrator.mjs).
// Advisory: it never blocks and exits 0 on anything it cannot work out. The
// note stays under 60 words because, once added, it is re-read on every later
// call like the rest of the context.

const MAX_NAMED = 4;

try {
  const payload = parseStdin(await readAll(process.stdin));
  if (!orchestratorMarker(payload)) process.exit(0);

  // The response's shape is the harness's and not documented; a PR number is
  // read out of its text wherever it sits. `\\?"` because a JSON string
  // nested in the response arrives with its quotes escaped.
  const text = JSON.stringify(payload.tool_response ?? "") ?? "";
  const numbers = new Set();
  for (const m of text.matchAll(/\/pull\/(\d+)|pullNumber\\?"?\s*[:=]\s*\\?"?(\d+)|\\?"number\\?"\s*:\s*(\d+)/g)) {
    numbers.add(m[1] ?? m[2] ?? m[3]);
  }
  const named = [...numbers].slice(0, MAX_NAMED).map((n) => `PR ${n}`);
  const seen = named.length ? ` Seen here: ${named.join(", ")}.` : "";

  recordGuard(payload.cwd, "notification-unsubscribe-nudge", "note");
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          "Call `unsubscribe_pr_activity` for every PR these events came from, part 0's included: PR state " +
          `comes from \`pnpm -s pr-digest\` at a \`send_later\` check-in.${seen}`,
      },
    }),
  );
} catch {
  // Never block, never fail: the nudge is worth less than the read.
}
process.exit(0);

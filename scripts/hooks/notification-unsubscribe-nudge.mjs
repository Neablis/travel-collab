import { parseStdin, readAll } from "./lib/run-context.mjs";
import { orchestratorMarker } from "./lib/orchestrator.mjs";
import { recordGuard } from "./lib/guard-log.mjs";
import { lastCall } from "./lib/transcript.mjs";

// PostToolUse hook (matcher: ReadNotifications). 141 of the 190 GitHub wakes
// in M42 did nothing but read a notification, at about $0.29 each, and most
// came from part PRs the orchestrator never chose to watch: the harness
// subscribes a session to every PR opened inside it, and implementers open
// theirs there (docs/retros/2026-10-12-m42-token-spend-retro.md, F1 and
// Fix 1). Nothing can stop the wake that already happened; this says, at the
// moment it is cheapest to act on, to drop the subscription.
//
// Engages only for the milestone orchestrator (lib/orchestrator.mjs).
// Advisory: it never blocks and exits 0 on anything it cannot work out. The
// note stays under 60 words because, once added, it is re-read on every later
// call like the rest of the context.

const MAX_NAMED = 6;

// M42's orchestrator averaged 416k and every wake re-read it. Past this, a
// fresh session seeded by /next-prompt is cheaper than each further wake; the
// agent cannot rotate itself, so it is told to ask. A wake is where this is
// said because wakes are what the size multiplies.
const CONTEXT_LIMIT_TOKENS = 250_000;

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

  let handoff = "";
  try {
    const { context } = lastCall(payload.transcript_path);
    if (context !== null && context > CONTEXT_LIMIT_TOKENS) {
      handoff =
        ` Your context is ${Math.round(context / 1000)}k (limit ${CONTEXT_LIMIT_TOKENS / 1000}k): write the ` +
        "`/next-prompt` handoff and ask Mitchell to start a fresh session.";
      recordGuard(payload.cwd, "orchestrator-context-limit", "note");
    }
  } catch {
    // No transcript path, or unreadable: the unsubscribe note still goes out.
  }

  recordGuard(payload.cwd, "notification-unsubscribe-nudge", "note");
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          "The orchestrator watches only part 0's PR. If these events came from a part's PR, call " +
          "`unsubscribe_pr_activity` for it now; CI state comes from implementer reports and review " +
          `re-checks.${seen}${handoff}`,
      },
    }),
  );
} catch {
  // Never block, never fail: the nudge is worth less than the read.
}
process.exit(0);

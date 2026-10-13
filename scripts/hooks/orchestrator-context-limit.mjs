import { parseStdin, readAll } from "./lib/run-context.mjs";
import { orchestratorMarker } from "./lib/orchestrator.mjs";
import { recordGuard } from "./lib/guard-log.mjs";
import { lastCall } from "./lib/transcript.mjs";

// UserPromptSubmit hook, and PostToolUse on Bash for a `pr-digest` run. Past
// 250k of its own context, tells the milestone orchestrator to hand off to a
// fresh session (docs/guidelines/building-a-milestone.md, *Hand-off*).
//
// M42's orchestrator averaged 416k and every wake re-read it. Past this, a
// fresh session seeded by /next-prompt is cheaper than each further wake.
// The note used to ride on the ReadNotifications hook, but since 2026-10-13
// the orchestrator subscribes to no PR, so that hook stopped firing (PR 431's
// review, finding 3). What wakes it now is a `send_later` check-in or a
// subagent's report, both of which arrive as a prompt, and each check-in runs
// `pnpm -s pr-digest`. Those are the two places this is said.
//
// Engages only for the milestone orchestrator (lib/orchestrator.mjs).
// Advisory: it never blocks and exits 0 on anything it cannot work out. The
// note stays under 60 words because it is re-read on every later call.

const CONTEXT_LIMIT_TOKENS = 250_000;

/** The note for `context` tokens, or "" at or under the limit. */
function note(context) {
  if (context === null || context <= CONTEXT_LIMIT_TOKENS) return "";
  return (
    `Context ${Math.round(context / 1000)}k, over ${CONTEXT_LIMIT_TOKENS / 1000}k. If about 100 calls ` +
    "remain, hand off (building-a-milestone.md, Hand-off) once no subagent is running: `session-metrics`, " +
    "`/next-prompt` with its block, `create_session` with that text, delete your `send_later` check-ins, " +
    "tell Mitchell the new session's id, stop."
  );
}

try {
  const payload = parseStdin(await readAll(process.stdin));
  const event = payload?.hook_event_name;
  const digestRun =
    event === "PostToolUse" && payload?.tool_name === "Bash" && /\bpr-digest\b/.test(payload?.tool_input?.command ?? "");
  if ((event === "UserPromptSubmit" || digestRun) && orchestratorMarker(payload)) {
    const text = note(lastCall(payload.transcript_path).context);
    if (text) {
      recordGuard(payload.cwd, "orchestrator-context-limit", "note");
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
    }
  }
} catch {
  // No transcript, unreadable stdin: the hand-off is advice, never a failure.
}
process.exit(0);

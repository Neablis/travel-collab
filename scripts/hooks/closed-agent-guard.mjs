import { join } from "node:path";
import { parseStdin, readAll } from "./lib/run-context.mjs";
import { orchestratorMarker } from "./lib/orchestrator.mjs";
import { recordGuard } from "./lib/guard-log.mjs";
import { lastCall } from "./lib/transcript.mjs";

// PreToolUse hook (matcher: SendMessage). Once a subagent has reported, it is
// closed: a follow-up goes to a NEW agent with a brief, not to the old one.
// build-a-milestone says so in prose; M42's orchestrator sent 43 follow-ups
// anyway, and about $106 of the $206 subagent spend came after one
// (docs/retros/2026-10-12-m42-token-spend-retro.md, F2 and F3).
//
// Engages only for the milestone orchestrator (lib/orchestrator.mjs). It reads
// the target's own transcript, `<session transcript minus .jsonl>/subagents/
// agent-<id>.jsonl`, and denies the message when either holds:
//
//   - the transcript's last record is older than IDLE_LIMIT_SECONDS;
//   - the target's last assistant call carried more than CONTEXT_LIMIT_TOKENS.
//
// What still passes is the one use SendMessage keeps: an answer to an agent
// that is running, small, and asked within the last few minutes.
//
// Exit 2 with the reason on stderr blocks. A `to` that is a name, a transcript
// that is missing or unreadable, a record it cannot parse: exit 0.

// F3: subagents write the prompt cache with the 5-minute TTL, so the first
// call after 300 idle seconds re-writes the whole context at 1.25x the input
// price (41 such re-writes in M42, 24 of them straight after a follow-up).
// 270 leaves 30 seconds for the message to arrive and the agent to call.
const IDLE_LIMIT_SECONDS = 270;

// F2: M42's follow-ups went to builders already at 250k-480k, and every later
// call re-read all of it. A fresh agent with a brief starts near 40k; 150k is
// where carrying the old context costs more than a new brief does.
const CONTEXT_LIMIT_TOKENS = 150_000;

try {
  const payload = parseStdin(await readAll(process.stdin));
  if (!orchestratorMarker(payload)) process.exit(0);

  const to = payload?.tool_input?.to;
  const session = payload.transcript_path;
  // An agent id is one path segment; anything else is a name, or not ours to open.
  if (typeof to !== "string" || !/^[A-Za-z0-9_-]+$/.test(to)) process.exit(0);
  if (typeof session !== "string" || !session.endsWith(".jsonl")) process.exit(0);

  let last;
  try {
    last = lastCall(join(session.slice(0, -".jsonl".length), "subagents", `agent-${to.replace(/^agent-/, "")}.jsonl`));
  } catch {
    process.exit(0); // a name, or an agent with no transcript yet
  }
  const { lastAt, context } = last;

  const idleSeconds = lastAt === null ? null : (Date.now() - lastAt) / 1000;
  const idle = idleSeconds !== null && idleSeconds > IDLE_LIMIT_SECONDS;
  const deep = context !== null && context > CONTEXT_LIMIT_TOKENS;
  if (!idle && !deep) process.exit(0);

  const minutes = idleSeconds === null ? "unknown" : `${(idleSeconds / 60).toFixed(1)} min`;
  const size = context === null ? "unknown" : `${Math.round(context / 1000)}k tokens`;
  const why = [
    idle && `its prompt cache has expired (limit ${IDLE_LIMIT_SECONDS}s), so the next call re-writes its whole context`,
    deep && `every call after this message would re-read that context (limit ${CONTEXT_LIMIT_TOKENS / 1000}k)`,
  ].filter(Boolean);
  recordGuard(payload.cwd, "closed-agent-guard", "deny");
  console.error(
    `Agent ${to} is closed to follow-ups: idle ${minutes}, context at its last call ${size}. ` +
      `${why.join("; ")}. Dispatch a NEW agent of the same type with a brief instead: ` +
      "the branch, its head sha, the findings or asks verbatim, the files, and what done means.",
  );
  process.exit(2);
} catch {
  process.exit(0);
}

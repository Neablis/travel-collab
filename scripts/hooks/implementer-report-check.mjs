import { parseStdin, readAll } from "./lib/run-context.mjs";

// SubagentStop hook (matcher: phase-implementer). The orchestrator never reads
// code, so the implementer's report is all it sees. Two things in it are not
// optional: the sha it pushed, and the red-first table (the source edit that
// broke each test -> the failure text it printed). Missing either, the stop is
// blocked once with the instruction; `stop_hook_active` lets the retry through
// so this can never loop.
//
// Engages only when the payload names the agent as phase-implementer. A payload
// with no `agent_type` is skipped, not guessed at. A report that declares
// `Exit: BLOCKED` or `DESCOPED` is skipped too: it may have nothing to push.

const payload = parseStdin(await readAll(process.stdin));
if (!payload || payload.stop_hook_active) process.exit(0);
if (payload.agent_type !== "phase-implementer") process.exit(0);

const text = String(payload.last_assistant_message ?? "");
if (!text.trim()) process.exit(0);
if (/Exit:\s*\**\s*(?:BLOCKED|DESCOPED)\b/.test(text)) process.exit(0);

const sha = /\b[0-9a-f]{40}\b/.test(text) || /pushed\b[^\n]{0,120}?\b[0-9a-f]{7,40}\b/i.test(text);
const redFirst = /^[\s#>*-]*\**red[ -]first\b/im.test(text);

if (!sha || !redFirst) {
  const missing = [!sha && "the pushed sha", !redFirst && "a Red first table"].filter(Boolean);
  console.error(
    "finish: report the pushed sha and the red-first table (edit → failure text). " +
      `Missing: ${missing.join(", ")}.`,
  );
  process.exit(2);
}
process.exit(0);

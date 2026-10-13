import { parseStdin, readAll } from "./lib/run-context.mjs";

// SubagentStop hook (matcher: phase-implementer). The orchestrator never reads
// code, so the implementer's report is all it sees. Three things in it are not
// optional: the sha it pushed, the red-first table (the source edit that
// broke each test -> the failure text it printed), and a `Closed:` line.
// Missing any, the stop is blocked once with the instruction;
// `stop_hook_active` lets the retry through so this can never loop.
//
// `Closed:` is the builder saying it is finished for good: a fix after review
// goes to a new agent with a brief (closed-agent-guard.mjs), and the line is
// the orchestrator's cue to unsubscribe from the part's PR
// (docs/retros/2026-10-12-m42-token-spend-retro.md, Fix 1 and Fix 2).
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
// `[ \t]`, not `\s`, and no separate `\**`: either one let the prefix be
// matched many ways, and a report of blank lines took seconds.
const redFirst = /^[ \t#>*-]*red[ -]first\b/im.test(text);
const closed = /^[ \t#>*-]*closed\**:/im.test(text);

if (!sha || !redFirst || !closed) {
  const missing = [!sha && "the pushed sha", !redFirst && "a Red first table", !closed && "a `Closed:` line"].filter(
    Boolean,
  );
  console.error(
    "finish: report the pushed sha and the red-first table (edit → failure text), and " +
      "a `Closed:` line: this agent takes no follow-ups; a new agent takes any fix. " +
      `Missing: ${missing.join(", ")}.`,
  );
  process.exit(2);
}
process.exit(0);

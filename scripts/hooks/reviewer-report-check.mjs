import { parseStdin, readAll } from "./lib/run-context.mjs";
import { recordGuard } from "./lib/guard-log.mjs";

// SubagentStop hook (matcher: part-reviewer). A review is long, and whatever a
// reviewer hands back lands in the orchestrator's context, which is re-read on
// every wake (docs/retros/2026-10-12-m42-token-spend-retro.md, F1 and Fix 3).
// So the review goes to a file and only its outline comes back: the
// orchestrator posts the file with `gh pr comment --body-file` and passes the
// path to the fix agent, and the review's text never enters its context.
//
// Blocks the stop when the final message is longer than MAX_CHARS, or has no
// `Full review:` line followed by a path. Blocked once with the instruction;
// `stop_hook_active` lets the retry through so this can never loop.
//
// Engages only when the payload names the agent as part-reviewer. A payload
// with no `agent_type`, or an empty message, is skipped, not guessed at.

// About 1k tokens, the size Fix 3 asks a reviewer's hand-back to stay under.
const MAX_CHARS = 4000;

const payload = parseStdin(await readAll(process.stdin));
if (!payload || payload.stop_hook_active) process.exit(0);
if (payload.agent_type !== "part-reviewer") process.exit(0);

const text = String(payload.last_assistant_message ?? "");
if (!text.trim()) process.exit(0);
// A reviewer that could not review has no review to file.
if (/Exit:\s*\**\s*(?:BLOCKED|DESCOPED)\b/.test(text)) process.exit(0);

// `[ \t]`, not `\s`: see implementer-report-check.mjs.
const filed = /^[ \t#>*-]*full review\**:\**[ \t]*`?[^\s`]*[/.][^\s`]*/im.test(text);
const long = text.length > MAX_CHARS;

if (long || !filed) {
  const missing = [
    long && `the hand-back is ${text.length} characters (limit ${MAX_CHARS})`,
    !filed && "no `Full review:` line with the file's path",
  ].filter(Boolean);
  recordGuard(payload.cwd, "reviewer-report-check", "deny");
  console.error(
    "finish: write the full review to a file and hand back only its outline. " +
      `Now: ${missing.join("; ")}. ` +
      'Write it to "$(git rev-parse --git-common-dir)/tc-reviews/pr-<n>-<short sha>.md" with a shell ' +
      "heredoc (`mkdir -p` the directory first), then hand back only: the verdict; one line per finding " +
      "(severity, file:line, six words); and a `Full review:` line with that path.",
  );
  process.exit(2);
}
process.exit(0);

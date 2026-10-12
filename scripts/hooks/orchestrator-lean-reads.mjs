import { parseStdin, readAll } from "./lib/run-context.mjs";
import { parseShell } from "./lib/shell.mjs";
import { orchestratorMarker } from "./lib/orchestrator.mjs";
import { recordGuard } from "./lib/guard-log.mjs";

// PreToolUse hook (matchers: mcp__github__get_job_logs, and Bash for `gh`).
// The orchestrator's context is re-read on every wake, and M42's averaged
// 416k: `get_job_logs` alone put 61k tokens in it
// (docs/retros/2026-10-12-m42-token-spend-retro.md, F1 and Fix 3). A CI log is
// read once, by an agent that ends; only its conclusion comes back.
//
// Engages only for the milestone orchestrator (lib/orchestrator.mjs), so the
// ci-triage subagent it points at can still run `gh run view --log-failed`.
// Denied here:
//
//   - the `get_job_logs` MCP tool;
//   - a Bash command that runs `gh run view ... --log` or `--log-failed`.
//
// `gh run view <id>` without a log flag (the job list) passes. lib/shell.mjs
// reads the command, so a commit message that quotes the words does not fire.
// Exit 2 with the reason on stderr blocks; anything it cannot work out exits 0.

const LOG_FLAG = /^--log(?:-failed)?(?:=.*)?$/;

try {
  const payload = parseStdin(await readAll(process.stdin));
  if (!orchestratorMarker(payload)) process.exit(0);

  const tool = String(payload.tool_name ?? "");
  let what = "";
  if (/(?:^|__)get_job_logs$/.test(tool)) {
    what = "get_job_logs";
  } else if (tool === "Bash") {
    const reads = parseShell(String(payload.tool_input?.command ?? "")).some((seg) => {
      if (seg.words[0]?.split("/").pop() !== "gh") return false;
      const run = seg.words.indexOf("run");
      return run !== -1 && seg.words[run + 1] === "view" && seg.words.slice(run + 2).some((w) => LOG_FLAG.test(w));
    });
    if (reads) what = "`gh run view --log`";
  }
  if (!what) process.exit(0);

  recordGuard(payload.cwd, "orchestrator-lean-reads", "deny");
  console.error(
    `The orchestrator does not read CI logs (${what}): its context is re-read on every wake. ` +
      "Send the failing run to a subagent with the `ci-triage` skill and ask for the root cause " +
      "in under 200 words. Read check state with one `pull_request_read get_check_runs` call.",
  );
  process.exit(2);
} catch {
  process.exit(0);
}

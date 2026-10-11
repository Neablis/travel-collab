import { execFileSync } from "node:child_process";
import { parseStdin, readAll } from "./lib/run-context.mjs";

// PostToolUse hook (matcher: Bash). After a successful `git push` of a branch
// other than main, adds one line of context: the next step in review-a-part is
// a part-reviewer run on the PR. Advisory only — it never blocks, and it exits
// 0 on anything it cannot work out.

try {
  const payload = parseStdin(await readAll(process.stdin));
  const command = String(payload?.tool_input?.command ?? "");
  const push = /(?:^|[\n;|&]\s*)(?:[A-Za-z_]\w*=\S*\s+)*git\b(?:\s+-[cC]\s*\S+|\s+--?[\w-]+(?:=\S+)?)*\s+push\b([^\n;|&]*)/.exec(command);
  if (!push) process.exit(0);

  // PostToolUse normally fires only on success; a rejected push can still land
  // here as text, so read it before nudging anyone to review it.
  const res = payload?.tool_response ?? {};
  const out = typeof res === "string" ? res : `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  if (res.interrupted || /\[rejected\]|\bfatal:|\berror:/.test(out)) process.exit(0);

  const args = push[1].trim().split(/\s+/).filter(Boolean);
  if (args.some((a) => /^(?:--delete|-d|--tags|--all|--mirror)$/.test(a))) process.exit(0);
  const positional = args.filter((a) => !a.startsWith("-"));
  let branch = positional.length >= 2 ? positional[positional.length - 1] : "";
  branch = branch.replace(/^\+/, "").split(":").pop().replace(/^refs\/heads\//, "");
  if (!branch || branch === "HEAD") {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: payload?.cwd || process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  }
  if (!branch || branch === "HEAD" || branch === "main" || branch === "master") process.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `Pushed ${branch}. Next per review-a-part: dispatch the part-reviewer agent on this PR.`,
      },
    }),
  );
} catch {
  // Never block, never fail: the nudge is worth less than the push.
}
process.exit(0);

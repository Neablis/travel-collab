import { parseStdin, readAll } from "./lib/run-context.mjs";
import { gitSubcommandArgs, parseShell, withoutRedirections } from "./lib/shell.mjs";
import { currentBranch, isPartBranch } from "./lib/part-branch.mjs";

// PostToolUse hook (matcher: Bash). After a successful `git push` of a
// milestone part branch (lib/part-branch.mjs), adds one line of context: the
// push is to be reported, because the next step in review-a-part is a
// part-reviewer run that the orchestrator dispatches. The line reaches
// whoever pushed, usually the phase-implementer, not the orchestrator.
// Advisory only — it never blocks, and it exits 0 on anything it cannot work
// out.
//
// The branch is the refspec's destination when one is given, else the branch
// checked out at the payload's cwd. Redirections are not arguments:
// `git push ... 2>&1` once reported "Pushed 2>.".

try {
  const payload = parseStdin(await readAll(process.stdin));
  const command = String(payload?.tool_input?.command ?? "");
  const push = parseShell(command)
    .map((seg) => gitSubcommandArgs(seg, "push"))
    .find(Boolean);
  if (!push) process.exit(0);

  // PostToolUse normally fires only on success; a rejected push can still land
  // here as text, so read it before nudging anyone to review it.
  const res = payload?.tool_response ?? {};
  const out = typeof res === "string" ? res : `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  if (res.interrupted || /\[rejected\]|\bfatal:|\berror:/.test(out)) process.exit(0);

  const args = withoutRedirections(push);
  if (args.some((a) => /^(?:--delete|-d|--tags|--all|--mirror)$/.test(a))) process.exit(0);
  const positional = args.filter((a) => !a.startsWith("-"));
  let branch = positional.length >= 2 ? positional[positional.length - 1] : "";
  branch = branch.replace(/^\+/, "").split(":").pop().replace(/^refs\/heads\//, "");
  if (!branch || branch === "HEAD") branch = currentBranch(payload?.cwd) ?? "";
  if (!isPartBranch(branch)) process.exit(0);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          `Pushed ${branch}. Report this push; the orchestrator dispatches part-reviewer (review-a-part).`,
      },
    }),
  );
} catch {
  // Never block, never fail: the nudge is worth less than the push.
}
process.exit(0);

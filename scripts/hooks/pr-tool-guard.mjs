import { parseStdin, readAll } from "./lib/run-context.mjs";
import { findModelId } from "./lib/model-id.mjs";
import { isPartBranch } from "./lib/part-branch.mjs";

// PreToolUse hook (matcher: mcp__github__create_pull_request|
// mcp__github__update_pull_request). Two rules from build-a-part:
//
//   create without `draft: true`     -> block. A milestone is one stack of
//   from a milestone part branch        draft PRs; only its top part is marked
//   (`head`, lib/part-branch.mjs)       ready, for the one full CI run
//                                       (building-a-milestone.md, 2026-11-01).
//                                       Any other branch, part 0's included,
//                                       keeps AGENTS.md's draft-first rule.
//   a model id in the title or body  -> block, on create and update alike.
//
// Exit 2 with the reason on stderr blocks. FAILS OPEN on a bad payload.

const payload = parseStdin(await readAll(process.stdin));
const tool = String(payload?.tool_name ?? "");
const input = payload?.tool_input ?? {};

if (tool.endsWith("create_pull_request") && input.draft !== true && isPartBranch(input.head)) {
  console.error(
    "Open the part's PR as a draft, never ready (build-a-part step 5): set " +
      "`draft: true`, base the part below it or main for part 1. Only the stack's top " +
      "part is marked ready, for the milestone's one full CI run.",
  );
  process.exit(2);
}

const found = findModelId(input.title) ?? findModelId(input.body);
if (found) {
  console.error(
    `The PR title or body contains a model id ("${found}"). Remove it; the body ends ` +
      "with the Claude Code attribution line and the session link, nothing more.",
  );
  process.exit(2);
}
process.exit(0);

import { parseStdin, readAll } from "./lib/run-context.mjs";
import { findModelId } from "./lib/model-id.mjs";
import { isPartBranch } from "./lib/part-branch.mjs";

// PreToolUse hook (matcher: mcp__github__create_pull_request|
// mcp__github__update_pull_request). Two rules from build-a-part:
//
//   create with `draft: true` from   -> block. A part's PR opens ready for
//   a milestone part branch             review; a later push while it is draft
//   (`head`, lib/part-branch.mjs)       cancels the ready-for-review CI run.
//                                       Any other branch, part 0's included,
//                                       keeps AGENTS.md's draft-first rule.
//   a model id in the title or body  -> block, on create and update alike.
//
// Exit 2 with the reason on stderr blocks. FAILS OPEN on a bad payload.

const payload = parseStdin(await readAll(process.stdin));
const tool = String(payload?.tool_name ?? "");
const input = payload?.tool_input ?? {};

if (tool.endsWith("create_pull_request") && input.draft === true && isPartBranch(input.head)) {
  console.error(
    "Open the part's PR ready for review, never draft (build-a-part step 5): drop " +
      "`draft: true`. A push while a PR is draft cancels its ready-for-review run.",
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

import { parseStdin, readAll } from "./lib/run-context.mjs";
import { findModelId } from "./lib/model-id.mjs";

// PreToolUse hook (matcher: mcp__github__create_pull_request|
// mcp__github__update_pull_request). Two rules from build-a-part:
//
//   create with `draft: true`        -> block. A part's PR opens ready for
//                                       review; a later push while it is draft
//                                       cancels the ready-for-review CI run.
//                                       Part 0 is exempt (a title naming
//                                       "part 0"): close-a-milestone marks it
//                                       ready only at the gate.
//   a model id in the title or body  -> block, on create and update alike.
//
// Exit 2 with the reason on stderr blocks. FAILS OPEN on a bad payload.

const payload = parseStdin(await readAll(process.stdin));
const tool = String(payload?.tool_name ?? "");
const input = payload?.tool_input ?? {};

const partZero = /\bpart\s*0\b/i.test(String(input.title ?? ""));
if (tool.endsWith("create_pull_request") && input.draft === true && !partZero) {
  console.error(
    "Open the part's PR ready for review, never draft (build-a-part step 5): drop " +
      "`draft: true`. A push while a PR is draft cancels its ready-for-review run. " +
      "Only part 0, with \"part 0\" in its title, may open as a draft.",
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

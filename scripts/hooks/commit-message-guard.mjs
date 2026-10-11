import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStdin, readAll } from "./lib/run-context.mjs";
import { findModelId } from "./lib/model-id.mjs";

// PreToolUse hook (matcher: Bash). Blocks a `git commit` whose message names a
// hyphenated model id. The attribution this repo wants is the trailer
// `Co-Authored-By: Claude <Family> <version> <noreply@anthropic.com>`; a model
// id anywhere else in the message is noise that outlives the model.
//
// Scans from `git commit` to the end of the command rather than parsing `-m`,
// because the usual shape is `-m "$(cat <<'EOF' ... EOF)"`, which no simple
// argv split survives. `-F <file>` / `--file=<file>` is read from disk.
//
// `git` must be the command word of a segment, so `grep -rn "git commit"`
// does not count. Exit 2 with the reason on stderr blocks. FAILS OPEN on anything it cannot
// parse or read.

const payload = parseStdin(await readAll(process.stdin));
const command = String(payload?.tool_input?.command ?? "");
const commit = /(?:^|[\n;|&(]\s*)(?:[A-Za-z_]\w*=\S*\s+)*git\b(?:\s+-[cC]\s*\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit\b/.exec(command);
if (!commit) process.exit(0);

const tail = command.slice(commit.index);
const texts = [tail];
for (const m of tail.matchAll(/(?:\s-F\s*|\s--file[=\s])(['"]?)([^\s'"]+)\1/g)) {
  if (m[2] === "-") continue;
  try {
    texts.push(readFileSync(resolve(String(payload?.cwd ?? process.cwd()), m[2]), "utf8"));
  } catch {
    // An unreadable message file is git's error to report, not this hook's.
  }
}

const found = texts.map(findModelId).find(Boolean);
if (found) {
  console.error(
    `This commit message contains a model id ("${found}"). Remove it: the only ` +
      "attribution is the `Co-Authored-By:` trailer, which names the model in words " +
      "(e.g. `Claude Opus 5.5`), plus the `Claude-Session:` line.",
  );
  process.exit(2);
}
process.exit(0);

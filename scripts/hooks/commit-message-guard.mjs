import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseStdin, readAll } from "./lib/run-context.mjs";
import { findModelId } from "./lib/model-id.mjs";
import { gitSubcommandArgs, parseShell } from "./lib/shell.mjs";

// PreToolUse hook (matcher: Bash). Blocks a `git commit` whose message names a
// hyphenated model id. The attribution this repo wants is the trailer
// `Co-Authored-By: Claude <Family> <version> <noreply@anthropic.com>`; a model
// id anywhere else in the message is noise that outlives the model.
//
// Only the message is scanned: each `-m`/`--message` value, with
// `-m "$(cat <<'EOF' ... EOF)"` resolved to the heredoc's body by
// lib/shell.mjs, and the `-F`/`--file` message (a file read from disk, or the
// heredoc fed to `-F -`). Scanning the command text from `git commit` onward
// blocked `git commit -m x && grep -rn <id> apps/`, and a heredoc that wrote a
// file containing "git commit" read as a commit.
//
// `ALLOW_MODEL_ID=1` in front of the commit lets one through, for a change
// that legitimately describes the product's own AI model routing.
//
// Exit 2 with the reason on stderr blocks. FAILS OPEN on anything it cannot
// parse or read.

const payload = parseStdin(await readAll(process.stdin));
const command = String(payload?.tool_input?.command ?? "");
const cwd = String(payload?.cwd ?? process.cwd());

/** The message texts one `git commit` segment carries. */
function messages(seg, args) {
  const out = [];
  const file = (f) => {
    if (f === "-") return seg.heredocs.join("\n");
    try {
      return readFileSync(resolve(cwd, f), "utf8");
    } catch {
      return ""; // an unreadable message file is git's error to report
    }
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--message" || a === "--file") {
      const v = args[(i += 1)] ?? "";
      out.push(a === "--file" ? file(v) : v);
    } else if (a.startsWith("--message=")) out.push(a.slice(10));
    else if (a.startsWith("--file=")) out.push(file(a.slice(7)));
    else if (/^-[a-zA-Z]*[mF]$/.test(a)) {
      // `-m x`, `-am x`, `-F f`: the cluster's last flag takes the next word.
      const v = args[(i += 1)] ?? "";
      out.push(a.endsWith("F") ? file(v) : v);
    } else if (/^-[a-zA-Z]*[mF]./.test(a) && !a.startsWith("--")) {
      // `-mtext`, `-Ffile`: the value is glued to the flag.
      const at = a.search(/[mF]/);
      const v = a.slice(at + 1);
      out.push(a[at] === "F" ? file(v) : v);
    }
  }
  return out;
}

let found = null;
for (const seg of parseShell(command)) {
  const args = gitSubcommandArgs(seg, "commit");
  if (!args || seg.env.includes("ALLOW_MODEL_ID=1")) continue;
  found = messages(seg, args).map(findModelId).find(Boolean);
  if (found) break;
}

if (found) {
  console.error(
    `This commit message contains a model id ("${found}"). Remove it: the only ` +
      "attribution is the `Co-Authored-By:` trailer, which names the model in words " +
      "(e.g. `Claude Opus 5.5`), plus the `Claude-Session:` line. If the commit is " +
      "about the product's own AI model routing, put `ALLOW_MODEL_ID=1` in front of it.",
  );
  process.exit(2);
}
process.exit(0);

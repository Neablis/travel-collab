import { execFileSync } from "node:child_process";
import { parseStdin, readAll } from "./lib/run-context.mjs";
import { isPartBranch } from "./lib/part-branch.mjs";
import { recordGuard } from "./lib/guard-log.mjs";

// PreToolUse hook (matcher: Agent|Task). A fresh agent for every follow-up
// (closed-agent-guard.mjs) is only as good as its brief: the new agent has
// none of the old one's context, so whatever the brief leaves out it greps
// for. Reading code was 65% of what M42's builders carried
// (docs/retros/2026-10-12-m42-token-spend-retro.md, F2), so the brief names
// the files.
//
// Engages when `tool_input.subagent_type` is phase-implementer, in any
// session. The prompt must carry these labelled lines (label at line start,
// any case, after an optional bullet or markdown bold):
//
//   Branch:      a part branch (lib/part-branch.mjs)
//   Files:       at least one repo path, on that line or the lines under it
//   Done means:  anything
//
// and, when the branch already exists here or on origin (so this is a
// follow-up to work already pushed):
//
//   Head:        a 7-40 hex sha
//   Findings:    or `Asks:`, as text or as a path to a file that holds them
//
// Exit 2 with what is missing and a skeleton on stderr blocks. Anything it
// cannot work out exits 0.

// A section runs until the next of these, so `Done means: see docs/x.md` is
// not read as one of the Files.
const LABELS = ["Branch", "Head", "Files", "Findings", "Asks", "Done means", "Red first"];
// `[ \t]`, not `\s`: see implementer-report-check.mjs.
const PREFIX = String.raw`^[ \t#>*-]*`;
const ANY_LABEL = new RegExp(`${PREFIX}(?:${LABELS.join("|")})\\**:`, "i");

/** The text under `label`: the rest of its line plus the lines up to the next label. Null when absent. */
function section(lines, label) {
  const re = new RegExp(`${PREFIX}${label}\\**:\\**[ \\t]*(.*)$`, "i");
  for (let i = 0; i < lines.length; i += 1) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const out = [m[1]];
    for (let j = i + 1; j < lines.length && !ANY_LABEL.test(lines[j]); j += 1) out.push(lines[j]);
    return out.join("\n").replace(/[`*]/g, "").trim();
  }
  return null;
}

// `dir/file` (with the `(group)` and `[param]` segments Next.js routes use),
// or a root file with an extension.
const REPO_PATH = /(?:^|[\s'"(,])(?:\.?[\w@-]+(?:\/[\w.@()[\]-]+)+|[\w-]+\.[A-Za-z]{1,5})(?=$|[\s'"),:;])/m;

function branchExists(cwd, branch) {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd, stdio: "ignore", timeout: 3000 });
      return true;
    } catch {
      // not this ref; not a repo and no git read as "new branch" too
    }
  }
  return false;
}

try {
  const payload = parseStdin(await readAll(process.stdin));
  const input = payload?.tool_input;
  if (input?.subagent_type !== "phase-implementer") process.exit(0);
  if (typeof input.prompt !== "string" || !input.prompt.trim()) process.exit(0);
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd();

  const lines = input.prompt.split("\n");
  const missing = [];

  const branch = (section(lines, "Branch") ?? "")
    .split(/\s+/)[0]
    .replace(/^["']|["',.;]+$/g, "")
    .replace(/^(?:refs\/heads\/|origin\/)/, "");
  const part = /^[\w./-]+$/.test(branch) && isPartBranch(branch);
  if (!part) missing.push("`Branch:` with the part's branch (claude/m<N>-part<K>-<slug>)");
  if (!REPO_PATH.test(section(lines, "Files") ?? "")) missing.push("`Files:` with at least one repo path");
  if (!section(lines, "Done means")) missing.push("`Done means:` with what is true when this is finished");

  if (part && branchExists(cwd, branch)) {
    const head = (section(lines, "Head") ?? "").split("\n")[0];
    if (!/\b[0-9a-f]{7,40}\b/i.test(head)) {
      missing.push(`\`Head:\` with the sha ${branch} is at (the branch exists, so this is a follow-up)`);
    }
    if (!section(lines, "Findings") && !section(lines, "Asks")) {
      missing.push("`Findings:` (or `Asks:`) with the text, or the path of the file that holds it");
    }
  }
  if (missing.length === 0) process.exit(0);

  recordGuard(payload.cwd, "implementer-brief-check", "deny");
  console.error(
    `This phase-implementer brief is missing: ${missing.join("; ")}. ` +
      "The agent starts with nothing but the brief, and greps for whatever it leaves out. Skeleton:\n" +
      "Branch: claude/m<N>-part<K>-<slug>\n" +
      "Head: <sha the branch is at>            (follow-up to an existing branch)\n" +
      "Findings: <each one verbatim with file:line, or a file path>   (follow-up; or `Asks:`)\n" +
      "Files: <repo paths to open and to touch>\n" +
      "Red first: <the test that must fail before the change>\n" +
      "Done means: <what is true when this is finished>",
  );
  process.exit(2);
} catch {
  process.exit(0);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeLooseDir, makeRepo, runHook, runHookRaw } from "./fixture.mjs";

const HOOK = "implementer-brief-check.mjs";
const BRANCH = "claude/m43-part2-drawer-cards";

const FRESH = `Build part 2 of M43.

Branch: ${BRANCH}
Files:
- apps/web/src/app/(trip)/[id]/drawer.tsx
- apps/web/src/app/(trip)/[id]/drawer.test.tsx
Red first: the drawer test fails without the card key
Done means: the drawer renders one card per stop and the PR is open ready`;

const FOLLOW_UP = `${FRESH}
Head: 6c92e9a
Findings: .git/tc-reviews/pr-420-6c92e9a.md`;

const dispatch = (cwd, prompt, extra = {}) =>
  runHook(HOOK, {
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    cwd,
    tool_input: { subagent_type: "phase-implementer", description: "part 2", prompt },
    ...extra,
  });

// A repo where the part's branch already exists, as a local ref or as
// origin's, so a brief for it is a follow-up.
function repoWithBranch(ref) {
  const root = makeRepo();
  writeFileSync(join(root, "README.md"), "x\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", "init"], { cwd: root });
  execFileSync("git", ["update-ref", ref, "HEAD"], { cwd: root });
  return root;
}

test("a complete brief for a new branch passes, in plain and in bold-bullet form", () => {
  const root = makeRepo();
  const bold = `- **Branch:** \`${BRANCH}\`\n- **files:** scripts/hooks/x.mjs, AGENTS.md\n- **Done Means**: the hook denies`;
  for (const prompt of [FRESH, bold]) {
    const res = dispatch(root, prompt);
    assert.equal(res.status, 0, prompt);
    assert.equal(res.stderr, "");
  }
});

test("each missing label is denied by name, with the skeleton", () => {
  const root = makeRepo();
  const cases = [
    [FRESH.replace(`Branch: ${BRANCH}`, "Branch: claude/fix-the-drawer"), /`Branch:` with the part's branch/],
    [FRESH.replace(`Branch: ${BRANCH}\n`, ""), /`Branch:` with the part's branch/],
    [FRESH.replace(/- apps[^\n]+\n/g, ""), /`Files:` with at least one repo path/],
    [FRESH.replace(/Done means: .*/, "Done means:"), /`Done means:` with what is true/],
  ];
  for (const [prompt, expected] of cases) {
    const res = dispatch(root, prompt);
    assert.equal(res.status, 2, prompt);
    assert.match(res.stderr, expected);
    assert.equal(res.stderr.match(/`[A-Z][a-z ]+:` with/g).length, 1, res.stderr);
    const skeleton = res.stderr.trim().split("\n").slice(1);
    assert.deepEqual(
      skeleton.map((l) => l.split(":")[0]),
      ["Branch", "Head", "Findings", "Files", "Red first", "Done means"],
    );
  }
});

test("a path under Done means is not one of the Files", () => {
  const prompt = `Branch: ${BRANCH}\nFiles: the drawer\nDone means: docs/plans/m43.md part 2 holds`;
  assert.match(dispatch(makeRepo(), prompt).stderr, /`Files:` with at least one repo path/);
});

test("a branch that already exists, locally or on origin, makes the brief a follow-up: Head and Findings are required", () => {
  for (const ref of [`refs/heads/${BRANCH}`, `refs/remotes/origin/${BRANCH}`]) {
    const root = repoWithBranch(ref);
    const res = dispatch(root, FRESH);
    assert.equal(res.status, 2, ref);
    assert.match(res.stderr, /`Head:` with the sha claude\/m43-part2-drawer-cards is at/);
    assert.match(res.stderr, /`Findings:` \(or `Asks:`\)/);

    assert.equal(dispatch(root, FOLLOW_UP).status, 0, ref);
    assert.equal(dispatch(root, FOLLOW_UP.replace("Findings: .git", "Asks: .git")).status, 0, ref);
    assert.match(dispatch(root, FOLLOW_UP.replace("6c92e9a\n", "the tip\n")).stderr, /`Head:`/);
    assert.match(dispatch(root, FOLLOW_UP.replace(/Findings: .*/, "Findings:")).stderr, /`Findings:`/);
  }
});

test("another agent type, the Task alias and a prompt that is not text", () => {
  const root = makeRepo();
  const bad = "fix the drawer please";
  assert.equal(dispatch(root, bad, { tool_input: { subagent_type: "part-reviewer", prompt: bad } }).status, 0);
  assert.equal(dispatch(root, bad, { tool_input: { prompt: bad } }).status, 0);
  assert.equal(dispatch(root, bad, { tool_input: { subagent_type: "phase-implementer", prompt: 7 } }).status, 0);
  assert.equal(dispatch(root, bad, { tool_name: "Task" }).status, 2);
});

test("it engages inside a subagent and outside a repo too", () => {
  assert.equal(dispatch(makeRepo(), "fix it", { agent_id: "a1", agent_type: "general-purpose" }).status, 2);
  assert.equal(dispatch(makeLooseDir(), "fix it").status, 2);
  assert.equal(dispatch(makeLooseDir(), FRESH).status, 0);
});

test("garbage stdin fails open", () => {
  const res = runHookRaw(HOOK, "{not json");
  assert.equal(res.status, 0);
  assert.equal(res.stderr, "");
});

test("a denial appends one guard-log line in the contract's shape", () => {
  const root = makeRepo();
  assert.equal(dispatch(root, "fix it").status, 2);
  const lines = readFileSync(join(root, ".git", "tc-guard-log.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(line), ["t", "hook", "decision"]);
  assert.equal(line.hook, "implementer-brief-check");
  assert.equal(line.decision, "deny");
});

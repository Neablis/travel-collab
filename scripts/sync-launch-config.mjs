import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

function parsePorcelain(output) {
  const worktrees = [];
  let current = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim() };
      worktrees.push(current);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim();
    } else if (line === "detached" && current) {
      current.detached = true;
    }
  }
  return worktrees;
}

const porcelain = execSync("git worktree list --porcelain", {
  encoding: "utf8",
});
const worktrees = parsePorcelain(porcelain);

const mainWorktreePath = execSync("git rev-parse --show-toplevel", {
  encoding: "utf8",
}).trim();

const configurations = worktrees.map((worktree, index) => {
  const name =
    worktree.path === mainWorktreePath
      ? "web"
      : path.basename(worktree.path);
  return {
    name,
    runtimeExecutable: "bash",
    runtimeArgs: [
      "-c",
      `cd "${worktree.path}" && pnpm --filter web dev`,
    ],
    port: 3001 + index,
    autoPort: true,
  };
});

const launchConfig = {
  version: "0.0.1",
  configurations,
};

writeFileSync(
  path.join(process.cwd(), ".claude", "launch.json"),
  JSON.stringify(launchConfig, null, 2) + "\n",
);

console.log(
  `synced ${configurations.length} worktree(s) into .claude/launch.json`,
);

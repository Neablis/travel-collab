// One-shot local dev bootstrap: `pnpm setup`. Copies .env.example to
// apps/web/.env.local, the file `pnpm dev`, `db:*`, and `test:e2e` all read
// from (Next.js loads it natively; the others via `--env-file-if-exists` /
// the preload-dotenv.mjs import — see docs/guidelines/environments-and-
// deploys.md). Never overwrites an existing .env.local — each worktree
// keeps its own (e.g. a different LOCATIONIQ_API_KEY, or a non-default
// WEB_PORT when running several worktrees' dev servers side by side).
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const example = fileURLToPath(new URL("../.env.example", import.meta.url));
const target = fileURLToPath(new URL("../apps/web/.env.local", import.meta.url));

if (existsSync(target)) {
  console.log(`apps/web/.env.local already exists — leaving it alone.`);
} else {
  copyFileSync(example, target);
  console.log(`Created apps/web/.env.local from .env.example.`);
  console.log(`Defaults match docker-compose (postgres on :5433). Start it, then:`);
  console.log(`  pnpm --filter web db:reseed   # seed local data`);
  console.log(`  pnpm dev                      # or pnpm --filter web dev`);
}

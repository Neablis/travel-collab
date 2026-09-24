// One-shot local dev bootstrap: `pnpm setup`. Copies .env.example to
// apps/web/.env.local, the file `pnpm dev`, `db:*`, and `test:e2e` all read
// from (Next.js loads it natively; the others via `--env-file-if-exists` /
// the preload-dotenv.mjs import — see docs/guidelines/environments-and-
// deploys.md). Never overwrites an existing .env.local — each worktree
// keeps its own (e.g. a different LOCATIONIQ_API_KEY, or a non-default
// WEB_PORT when running several worktrees' dev servers side by side).
//
// One value is not copied verbatim. `.env.example` ships `API_TOKEN_PEPPER=`
// blank, because the pepper is a secret and a checked-in value would be a
// published key. Copied as-is, that blank made every fresh worktree fail the
// api-token integration tests and the M22 e2e spec (KI-2026-09-19-a), since
// `pepper()` fails closed on an empty value by design. So a new .env.local
// gets a freshly generated pepper — random per checkout, never written
// anywhere tracked. A pepper the example already gives a value is kept.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const example = fileURLToPath(new URL("../.env.example", import.meta.url));
const target = fileURLToPath(new URL("../apps/web/.env.local", import.meta.url));

// Anchored to a whole line, so a comment that merely names the variable is not
// touched, and `$` with nothing before it means only a blank value matches.
const BLANK_PEPPER = /^API_TOKEN_PEPPER=[ \t]*$/m;

if (existsSync(target)) {
  console.log(`apps/web/.env.local already exists — leaving it alone.`);
  // Existing files are still never edited: a worktree's .env.local is its
  // owner's. Saying so is enough — the test lanes default a blank pepper
  // themselves, and only `pnpm dev` would go on throwing.
  if (BLANK_PEPPER.test(readFileSync(target, "utf8"))) {
    console.log(
      `Note: its API_TOKEN_PEPPER is blank, so \`pnpm dev\` cannot mint or verify API tokens.`,
    );
    console.log(`  Set one with:  openssl rand -base64 32`);
  }
} else {
  const source = readFileSync(example, "utf8");
  const pepper = randomBytes(32).toString("base64");
  writeFileSync(target, source.replace(BLANK_PEPPER, `API_TOKEN_PEPPER=${pepper}`));
  console.log(`Created apps/web/.env.local from .env.example.`);
  if (BLANK_PEPPER.test(source)) {
    console.log(`Generated a local API_TOKEN_PEPPER (random, this checkout only).`);
  }
  console.log(`Defaults match docker-compose (postgres on :5433). Start it, then:`);
  console.log(`  pnpm --filter web db:migrate   # create the schema (db:reseed does not migrate)`);
  console.log(`  pnpm --filter web dev         # leave it running; the seed goes through it`);
  console.log(`  pnpm --filter web db:reseed   # in a second terminal, once the server answers`);
}

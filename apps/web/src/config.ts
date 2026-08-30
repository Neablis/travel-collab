// Single source of truth for local dev-environment values (browser-safe half —
// the database URL lives in src/server/config.ts). The M0 retro moved these
// off the defaults (3000/5432) because another local project squats on them.
// docker-compose.yml and package.json scripts cannot import this file; they
// repeat the same defaults as ${VAR:-default} interpolations — keep in sync.
const env: Record<string, string | undefined> =
  typeof process !== "undefined" ? process.env : {};

export const WEB_PORT = Number(env.WEB_PORT ?? 3001);

// The override is read from WEB_BASE_URL, NOT BASE_URL, because `BASE_URL` is
// a name Vite owns. Vitest assigns Vite's resolved `env` onto `process.env` in
// every worker, and Vite's `env.BASE_URL` is the public base *path* — `"/"`.
// So this line used to evaluate to `"/"` in every unit test regardless of what
// the app would use at runtime, and any test asserting against it was asserting
// against `"/"` and agreeing with almost anything (KI-72). Nothing in the repo
// ever set `BASE_URL` deliberately, so the override's only real producer was
// the collision. `WEB_BASE_URL` also matches the `WEB_PORT` knob below it.
// Pinned by config.test.ts, which fails if this reads a Vite-owned name again.
export const BASE_URL = env.WEB_BASE_URL ?? `http://localhost:${WEB_PORT}`;

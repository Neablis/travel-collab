// Single source of truth for local dev-environment values (browser-safe half —
// the database URL lives in src/server/config.ts). The M0 retro moved these
// off the defaults (3000/5432) because another local project squats on them.
// docker-compose.yml and package.json scripts cannot import this file; they
// repeat the same defaults as ${VAR:-default} interpolations — keep in sync.
const env: Record<string, string | undefined> =
  typeof process !== "undefined" ? process.env : {};

export const WEB_PORT = Number(env.WEB_PORT ?? 3001);
export const BASE_URL = env.BASE_URL ?? `http://localhost:${WEB_PORT}`;

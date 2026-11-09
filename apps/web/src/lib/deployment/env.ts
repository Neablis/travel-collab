// The one reader of "which environment am I, where do I answer, which build
// is this". The new `APP_ENV`, `PUBLIC_ORIGIN` and `APP_VERSION` come first and
// the `VERCEL_*` variables are the fallback, so a Vercel deployment answers
// exactly as it did before and a self-hosted box answers from three vars we
// set ourselves (M59). It lives in `lib`, not `server`, because `lib/devLogin.ts`
// and the pages read it and the lint wall keeps UI out of `@/server/*`; it is
// plain env reads. Nothing else in `apps/web/src` reads `VERCEL_*`.

const read = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

/**
 * `production`, `preview` or `development` as the platform names it, or
 * `undefined` when neither `APP_ENV` nor `VERCEL_ENV` is set (local dev, the
 * test lanes). Returned raw rather than narrowed: callers compare against
 * `"production"` or `"preview"`, and an unrecognised value must not read as
 * either. Neither variable is one a user or a request can set.
 */
export function deployEnv(): string | undefined {
  return read("APP_ENV") ?? read("VERCEL_ENV");
}

/**
 * Where this deployment answers, from configuration rather than from a
 * request header. `PUBLIC_ORIGIN` when set; otherwise Vercel's hierarchy,
 * written out rather than left to a framework default: the production domain
 * in production, the branch alias on a preview, the deployment's own URL for a
 * deployment with no alias, localhost otherwise. See `lib/deploymentOrigin.ts`
 * for why the branch alias comes before the deployment URL.
 */
export function publicOrigin(): string {
  const configured = read("PUBLIC_ORIGIN");
  if (configured) return configured.replace(/\/+$/, "");
  const production = read("VERCEL_PROJECT_PRODUCTION_URL");
  if (read("VERCEL_ENV") === "production" && production) return `https://${production}`;
  const branch = read("VERCEL_BRANCH_URL");
  if (branch) return `https://${branch}`;
  const deployment = read("VERCEL_URL");
  if (deployment) return `https://${deployment}`;
  return `http://localhost:${process.env.WEB_PORT ?? "3001"}`;
}

/**
 * An id that changes with every build: `APP_VERSION`, else Vercel's deployment
 * id or commit sha, else `local`.
 */
export function deploymentVersion(): string {
  return read("APP_VERSION") ?? read("VERCEL_DEPLOYMENT_ID") ?? read("VERCEL_GIT_COMMIT_SHA") ?? "local";
}

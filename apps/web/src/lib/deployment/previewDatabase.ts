// The preview app's own database guard. `scripts/lib/build-steps.mjs` refuses to
// migrate any database but `caesura_preview`, but it sees the Actions secret;
// the running container's DATABASE_URL is set by hand in Coolify, and a
// production URL pasted there would let the preview write production. So the
// server refuses to start a preview that names any other database.

const PREVIEW_DATABASE = "caesura_preview";

/**
 * Throws when this is a preview (`APP_ENV`, then `VERCEL_ENV`, as `deployEnv()`
 * reads them; an empty string is unset) and `DATABASE_URL` does not name
 * `caesura_preview`. Any other environment is left alone.
 */
export function assertPreviewDatabase(env: Record<string, string | undefined>): void {
  if ((env.APP_ENV || env.VERCEL_ENV) !== "preview") return;
  let database: string | null = null;
  try {
    database = decodeURIComponent(new URL(env.DATABASE_URL ?? "").pathname.slice(1));
  } catch {}
  if (database !== PREVIEW_DATABASE) {
    throw new Error(
      `a preview may only run against ${PREVIEW_DATABASE}; DATABASE_URL names ${JSON.stringify(database)}. Fix the preview app's DATABASE_URL in Coolify.`,
    );
  }
}

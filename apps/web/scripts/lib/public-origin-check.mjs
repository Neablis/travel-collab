// Whether a container build knows the address it will be served at.
//
// `app/layout.tsx` sets `metadataBase` from `publicOrigin()` (lib/deployment/
// env.ts) when the module loads. A page `next build` prerenders loads it AT
// BUILD TIME, so its canonical, og:url and og:image are written into the HTML
// from whatever `PUBLIC_ORIGIN` the build saw. With none, `publicOrigin()`
// falls back to `http://localhost:3001`, and the static pages ship telling
// Google their real address is localhost. That is what production served
// after the move off Vercel (2026-11-09): `/`, `/demo` and `/developers` all
// carried `<link rel="canonical" href="http://localhost:3001...">`, while every
// page rendered per request was right, because the running container has the
// variable. Nothing failed; it was found by reading the HTML.
//
// So a production build without a public https origin is refused, here, before
// `next build`, with the fix in the message. A preview is only warned: it is
// noindex, and the right origin for one is per preview.

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ fail: string } | { warn: string } | { ok: string }}
 */
export function checkPublicOrigin(env) {
  // `||`, not `??`: Coolify can hold a variable as an empty string.
  const appEnv = env.APP_ENV || env.VERCEL_ENV || undefined;
  const origin = env.PUBLIC_ORIGIN || undefined;

  if (origin !== undefined) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      url = undefined;
    }
    const usable =
      url !== undefined &&
      url.protocol === "https:" &&
      url.hostname !== "localhost";
    if (usable) return { ok: `[public-origin] ${url.origin}` };
    const problem = `[public-origin] PUBLIC_ORIGIN is set but is not a public https origin: ${origin}`;
    return appEnv === "production" ? { fail: problem } : { warn: problem };
  }

  // Vercel still answers from its own variables (lib/deployment/env.ts).
  if (env.VERCEL_ENV) return { ok: "[public-origin] from Vercel's variables" };

  if (appEnv === "production") {
    return {
      fail:
        "[public-origin] PUBLIC_ORIGIN is not set for this production build, so every prerendered page " +
        "would name http://localhost:3001 as its canonical address. Add PUBLIC_ORIGIN=https://caesura.today " +
        "as a BUILD variable in Coolify (it is already a runtime one), and redeploy.",
    };
  }
  if (appEnv === "preview") {
    return {
      warn: "[public-origin] PUBLIC_ORIGIN unset on a preview build: prerendered pages will name localhost.",
    };
  }
  return { ok: "[public-origin] not a deployed build; localhost is right" };
}

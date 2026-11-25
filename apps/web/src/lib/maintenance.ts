// The cutover's maintenance mode (M64 decision 9, PR 794). One variable,
// `MAINTENANCE_MODE=true`, turns every page into a static notice and the
// discovery and OAuth routes into a 503 JSON answer. `/api` is outside it (the
// proxy would buffer every request body): writes stop by making Neon's role
// read-only (plan O8 step 2), not here. Unset, nothing here runs.
//
// It imports nothing: the notice must come up with the database down and with
// the rest of the app unloadable, which is the situation it is for. No
// colours of its own (the colour wall): `color-scheme` gives the browser's
// light and dark defaults.

const RETRY_AFTER_SECONDS = "600";

// Routes a machine calls through the proxy: the discovery documents and OAuth's
// own pages, which get JSON because a browser page is no use to a JSON client.
// `api` is listed only for the bare `/api`: the proxy's matcher never sends
// `/api/...` here.
const MACHINE_PATH = /^\/(?:api|\.well-known|oauth)(?:\/|$)/;

// Read per request, never at load: Next builds this file once and the variable
// belongs to the running container.
/** Is the cutover's maintenance mode on? True only for `MAINTENANCE_MODE=true`. */
export function isMaintenance(): boolean {
  return process.env.MAINTENANCE_MODE === "true";
}

const NOTICE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Caesura</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Georgia,serif}
main{max-width:30rem;padding:2rem}
h1{font-size:1.75rem;font-weight:500;margin:0 0 1rem}
p{font-size:1.125rem;line-height:1.6;margin:0 0 .5rem}
</style>
</head>
<body>
<main>
<h1>Caesura</h1>
<p>We're moving to a new home.</p>
<p>Back in a few minutes. Nothing you've saved is lost.</p>
</main>
</body>
</html>
`;

/** The 503 a request gets while maintenance is on: JSON for a machine route, the notice for anything else. */
export function maintenanceResponse(pathname: string): Response {
  const headers = { "Retry-After": RETRY_AFTER_SECONDS, "X-Robots-Tag": "noindex", "Cache-Control": "no-store" };
  if (MACHINE_PATH.test(pathname)) return Response.json({ error: "maintenance" }, { status: 503, headers });
  return new Response(NOTICE, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

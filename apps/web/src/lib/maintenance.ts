// The cutover's maintenance mode (M64 decision 9, PR 794). One variable,
// `MAINTENANCE_MODE=true`, turns every page into a static notice and every
// machine route into a 503 JSON answer, so the old box can stop taking writes
// while the new one is filled. Unset, nothing here runs.
//
// It imports nothing: the notice must come up with the database down and with
// the rest of the app unloadable, which is the situation it is for.

const RETRY_AFTER_SECONDS = "600";

// Routes a machine calls: the API, MCP and cron routes (all under `/api`), the
// discovery documents, and OAuth's own pages. A browser would be shown a page
// for a JSON client that cannot read one.
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
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Georgia,serif;background:#faf8f4;color:#1c1b19}
main{max-width:30rem;padding:2rem}
h1{font-size:1.75rem;font-weight:500;margin:0 0 1rem}
p{font-size:1.125rem;line-height:1.6;margin:0 0 .5rem}
@media(prefers-color-scheme:dark){body{background:#17160f;color:#ece8de}}
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

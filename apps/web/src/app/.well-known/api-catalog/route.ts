// **RFC 9727 API catalog: `GET /.well-known/api-catalog`.** The standard place a
// crawler or agent looks to find what APIs a host publishes. One linkset, one
// item, whose `service-desc` is the OpenAPI document.
//
// **Reachability is not this file's to decide.** The Vercel firewall challenges
// bots on everything outside `/api/*`, so this path needs an exemption in the
// dashboard before a bot can read it — see `docs/guidelines/using-the-api.md`.
//
// A plain static handler: no auth, no server imports. It sits under the
// `.well-known/**/route.ts` lint-wall exemption only because every route here
// does, not because it needs one.
export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const linkset = {
    linkset: [
      {
        anchor: `${origin}/api/v1`,
        "service-desc": [{ href: `${origin}/api/v1/openapi`, type: "application/json" }],
      },
    ],
  };
  return new Response(JSON.stringify(linkset), {
    headers: {
      "content-type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      "cache-control": "public, max-age=3600",
    },
  });
}

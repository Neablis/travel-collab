import document from "../openapi.json";

// **The reference, served.** `/api/v1/openapi.json` is where the design put it;
// Next's file router spells that `/api/v1/openapi` with the JSON as the body, so
// the extension is dropped from the path and kept in the content type.
//
// **Not declared through `route()`, and that is deliberate.** This is not a
// resource of anybody's account: it needs no token, no scope and no rate limit,
// because it is the same document for everybody and is already public knowledge
// the moment one caller has it. Requiring a credential to read the docs is the
// kind of friction that gets an API ignored.
//
// It lives under `v1/` as a plain handler, which the conformance test would
// normally refuse — see the exemption there, which names this file and nothing
// else.
export function GET() {
  return Response.json(document, {
    headers: {
      // A build artifact of the deployed code, so it is immutable for as long as
      // that deployment is.
      "cache-control": "public, max-age=3600",
    },
  });
}

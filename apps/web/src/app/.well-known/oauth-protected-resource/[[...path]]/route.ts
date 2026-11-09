import { metadataJson, preflight } from "@/server/oauth/errors";
import { protectedResourceMetadata } from "@/server/oauth/metadata";

// **RFC 9728: `GET /.well-known/oauth-protected-resource[/api/mcp]`.** A client
// that gets a 401 from `/api/mcp` reads this to learn where to sign in. Both
// forms answer: RFC 9728 §3.1 inserts the resource's path after the well-known
// name, and a client following MCP's fallback asks the bare one. Anything else
// is not a resource here.
//
// The bare form names the domain and the `/api/mcp` form the MCP endpoint
// (ADR-089 decision 7).
//
// The body never reads the request (ADR-083 amendment B): a forged `Host`
// cannot change the resource or the issuer it names.

const SERVED = new Set<string>(["", "api/mcp"]);

/** The protected resource metadata, at the bare well-known path or with `/api/mcp` after it. */
export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const which = path.join("/");
  if (!SERVED.has(which)) return new Response(null, { status: 404 });
  return metadataJson(protectedResourceMetadata(which as "" | "api/mcp"));
}

export const OPTIONS = preflight;

import { metadataJson, preflight } from "@/server/oauth/errors";
import { protectedResourceMetadata } from "@/server/oauth/metadata";

// **RFC 9728: `GET /.well-known/oauth-protected-resource[/api/mcp]`.** A client
// that gets a 401 from `/api/mcp` reads this to learn where to sign in. Both
// forms answer: RFC 9728 §3.1 inserts the resource's path after the well-known
// name. Anything else is not a resource here.
//
// The `/api/mcp` form names the MCP endpoint, and is what MCP clients read (from
// the 401's `resource_metadata`). The bare form is the domain's own document
// (Poppy §3.2, ADR-089 decision 7): a client falling back to it from MCP gets
// the domain, not the endpoint it is calling, so it cannot use it.
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

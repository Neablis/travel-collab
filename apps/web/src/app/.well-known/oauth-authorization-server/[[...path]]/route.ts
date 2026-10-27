import { metadataJson, preflight } from "@/server/oauth/errors";
import { authorizationServerMetadata } from "@/server/oauth/metadata";

// **RFC 8414: `GET /.well-known/oauth-authorization-server[/api/mcp]`.** The
// issuer has no path, so the bare form is the RFC's; the `/api/mcp` form is
// answered too for clients that insert the MCP endpoint's path, as RFC 9728
// does for the resource.
//
// The body never reads the request (ADR-083 amendment B): a forged `Host`
// cannot change the issuer it names.

const SERVED = new Set(["", "api/mcp"]);

export async function GET(_request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (!SERVED.has(path.join("/"))) return new Response(null, { status: 404 });
  return metadataJson(authorizationServerMetadata());
}

export const OPTIONS = preflight;

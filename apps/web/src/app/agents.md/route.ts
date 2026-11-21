import { agentsMd } from "@/app/api/mcp/agentsMd";
import { deploymentOrigin } from "@/lib/deploymentOrigin";

// **`GET /agents.md`.** Outside `src/proxy.ts`'s matcher, so it is served signed
// out; the document is built beside the MCP tool list (`app/api/mcp/agentsMd.ts`).

/** Serve agents.md as markdown, every link absolute against the deployment's configured origin. */
export function GET(_request?: Request) {
  return new Response(agentsMd(deploymentOrigin()), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

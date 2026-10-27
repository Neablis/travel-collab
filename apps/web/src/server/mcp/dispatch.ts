import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runInMcpDispatch } from "@/server/oauth/dispatchContext";
import { requestHash } from "@/server/public-api/idempotency";
import { DECLARED } from "@/server/public-api/route";
import { pathParams, type McpTool } from "./tools";

// **One tool call is one v1 request, in process** (ADR-083 §8, M55 D2). The
// declared handler is called with a synthetic `Request` carrying the caller's
// own bearer, so it resolves the actor, checks the scope, gates the trip,
// parses, validates, rate-limits and answers exactly as it would over HTTP.
// `runInMcpDispatch` is what lets a `tco_` token resolve there at all (§7).

/** The tool's answer, or v1's refusal as a tool error a model can act on. */
export async function callTool(
  tool: McpTool,
  input: Record<string, unknown>,
  request: Request,
  grantId: string,
): Promise<CallToolResult> {
  const declared = tool.handler[DECLARED];
  const params: Record<string, string> = {};
  for (const name of pathParams(tool)) {
    const value = input[name];
    if (typeof value !== "string" || value === "") return toolError(`"${name}" is required.`);
    params[name] = value;
  }
  // Only what the tool offers: `update_playbook` sharing PATCH with publish
  // must not publish because a model sent `visibility` it was never offered.
  const rest = Object.fromEntries(
    Object.entries(input).filter(([name]) => !(name in params) && (tool.offers?.includes(name) ?? true)),
  );

  const url = new URL(
    tool.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(params[name]!)),
    request.url,
  );
  const headers = new Headers({ authorization: request.headers.get("authorization")! });
  let body: string | undefined;
  if (declared.def.body !== undefined) {
    body = JSON.stringify({ ...rest, ...tool.fixed });
    headers.set("content-type", "application/json");
  } else {
    for (const [name, value] of Object.entries(rest)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        url.searchParams.set(name, String(value));
      }
    }
  }
  // A model retries a call whose answer it lost, and a retried create would
  // keep the Playbook twice. Derived, not minted: the same grant sending the
  // same input is the same request, inside ADR-051's 24 hours.
  if (declared.def.idempotent !== undefined) {
    headers.set("idempotency-key", `mcp-${grantId}-${requestHash(input)}`);
  }

  const response = await runInMcpDispatch(() =>
    tool.handler(new Request(url, { method: declared.method, headers, body }), { params: Promise.resolve(params) }),
  );
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) return toolError(refusalText(tool, input, response.status, answer));
  const result = tool.answer === undefined ? answer : tool.answer(answer);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

function toolError(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** v1's envelope, in words: its message, with its code so a model can branch on it. */
function refusalText(tool: McpTool, input: Record<string, unknown>, status: number, answer: unknown): string {
  const error = (answer as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  // `savedDays.ts` refuses `days` on a day that is not private, and reviews
  // rate what was published, so the way through is the three calls below. A
  // stale version is the other 409 here, and it names `currentVersion`.
  const stale = (error?.details as { currentVersion?: unknown } | undefined)?.currentVersion !== undefined;
  if (tool.name === "update_playbook" && status === 409 && input.days !== undefined && !stale) {
    return (
      "This Playbook is published, so its days cannot change. Call unpublish_playbook, then update_playbook " +
      "with the new days, then publish_playbook again."
    );
  }
  const message = error?.message ?? `The request failed (HTTP ${status}).`;
  const coded = error?.code === undefined ? message : `${message} (${error.code})`;
  // A 400's details are the validation issues: what a model needs to fix its input.
  return error?.details === undefined ? coded : `${coded}\n${JSON.stringify(error.details)}`;
}

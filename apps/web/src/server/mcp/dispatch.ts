import type { CallToolResult } from "@modelcontextprotocol/server";
import { tripAccessFor } from "@/server/access/trip-access";
import { runInMcpDispatch } from "@/server/oauth/dispatchContext";
import { forgetKey, REPLAYED_HEADER, requestHash } from "@/server/public-api/idempotency";
import { DECLARED, NO_SUCH_TRIP, SERVER_FAILED, type DeclaredHandler } from "@/server/public-api/route";
import { readableSavedDay } from "@/server/savedDays";
import { pathParams, type McpTool } from "./tools";

// **One tool call is one v1 request, in process** (ADR-083 §8, M55 D2). The
// declared handler is called with a synthetic `Request` carrying the caller's
// own bearer, so it resolves the actor, checks the scope, gates the trip,
// parses, validates, rate-limits and answers exactly as it would over HTTP.
// `runInMcpDispatch` is what lets a `tco_` token resolve there at all (§7).

/** One MCP request's caller: its bearer, whose account and grant that bearer is. */
export interface McpCaller {
  readonly request: Request;
  readonly userId: string;
  readonly grantId: string;
  /**
   * The 401 or 402 a handler answered the bearer itself with, which the route
   * answers in place of the MCP response: a refused credential is HTTP, so the
   * client refreshes or reconnects (ADR-083 §8), never a tool error.
   */
  refusal?: Response;
}

/** The tool's answer, or v1's refusal as a tool error a model can act on. */
export async function callTool(tool: McpTool, input: Record<string, unknown>, caller: McpCaller): Promise<CallToolResult> {
  const { request, userId, grantId } = caller;
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
  const key = declared.def.idempotent === undefined ? null : `mcp-${grantId}-${requestHash(input)}`;
  if (key !== null) headers.set("idempotency-key", key);

  const send = () =>
    runInMcpDispatch(() =>
      tool.handler(new Request(url, { method: declared.method, headers, body }), { params: Promise.resolve(params) }),
    );
  const sentAt = new Date();
  let response = await send();
  // A REST caller whose kept answer stopped being true mints a new key; a
  // model cannot, since its key is its input. So a replayed refusal, or a
  // replayed Playbook since deleted, is forgotten and the call runs once more.
  if (key !== null && response.headers.has(REPLAYED_HEADER) && !(await stillTrue(response.clone(), userId))) {
    await forgetKey(userId, key, sentAt);
    response = await send();
  }
  if (refusesCredential(response)) caller.refusal = response.clone();
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const tripId = tripIdOf(declared, params, body);
    let hidden: boolean;
    try {
      hidden = await hidesTrip(declared, answer, tripId, userId);
    } catch (error) {
      // A database that did not answer is v1's own gate's 500, in its words,
      // never a throw out of the tool call.
      console.error("MCP trip re-check threw", { tool: tool.name, scope: declared.def.scope, tripId, error });
      return toolError(refusalText(tool, input, 500, { error: { code: "server-error", message: SERVER_FAILED } }));
    }
    if (hidden) return toolError(`${NO_SUCH_TRIP} (not-found)`);
    return toolError(refusalText(tool, input, response.status, answer));
  }
  const result = tool.answer === undefined ? answer : tool.answer(answer);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

/**
 * Whether a replayed answer still holds. A kept 4xx may not (the trip the
 * caller has since joined); a kept 5xx came after the handler's writes
 * (ADR-051), so running again could write them twice and it stands.
 */
async function stillTrue(replayed: Response, userId: string): Promise<boolean> {
  if (replayed.status >= 400 && replayed.status < 500) return false;
  const made = ((await replayed.json().catch(() => null)) as { playbook?: { playbookId?: unknown } } | null)?.playbook;
  return typeof made?.playbookId !== "string" || (await readableSavedDay(made.playbookId, userId)) !== null;
}

/** v1's refusal of the bearer itself, which carries the challenge that restarts OAuth. */
function refusesCredential(response: Response): boolean {
  return (
    (response.status === 401 || response.status === 402) &&
    (response.headers.get("WWW-Authenticate") ?? "").includes("resource_metadata=")
  );
}

/** The trip v1 gated the call on: from the path, or from the body where v1 reads it there. */
function tripIdOf(
  declared: DeclaredHandler[typeof DECLARED],
  params: Record<string, string>,
  body: string | undefined,
): string | undefined {
  if (declared.trip === undefined) return undefined;
  if (declared.trip === "path") return params.tripId;
  const parsed = declared.def.body?.safeParse(body === undefined ? undefined : JSON.parse(body));
  return parsed?.success ? (declared.trip.body(parsed.data) ?? undefined) : undefined;
}

/**
 * Whether v1 refused a trip the caller cannot read at all. v1 answers a
 * stranger `forbidden` (M22), which over MCP tells a model the trip exists, so
 * it answers as a missing id instead (M55 part 11, Mitchell, 2026-10-28). A
 * member short of the role can read the trip and keeps `forbidden`; matched on
 * the code, not 403, which `insufficient-scope` shares.
 */
async function hidesTrip(
  declared: DeclaredHandler[typeof DECLARED],
  answer: unknown,
  tripId: string | undefined,
  userId: string,
): Promise<boolean> {
  if (tripId === undefined) return false;
  if ((answer as { error?: { code?: unknown } } | null)?.error?.code !== "forbidden") return false;
  // v1's gate already asked "may this user read it", so its refusal is the
  // answer; a second read would only widen the timing gap a missing id lacks.
  if ((declared.role ?? "viewer") === "viewer") return true;
  // Only `forbidden`: a member whose trip will not parse is still a member.
  const access = await tripAccessFor(userId, tripId, "viewer");
  return !access.ok && access.denial === "forbidden";
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

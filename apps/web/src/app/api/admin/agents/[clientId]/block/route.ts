import { requireAdminApi } from "@/server/entitlements/requireAdmin";
import { blockClient, unblockClient } from "@/server/poppy/agentsSeen";

// **The kill switch over one Personal Agent** (ADR-089 decision 3), by protocol
// `client_id`: its sign-ins stop at the token endpoint and every request it
// sends is refused as `invalid_session`. Both handlers answer an
// `AdminAgentBlock`, and both are idempotent.
//
//   * 404 `not-found` — not an operator (`requireAdminApi`).
//   * 400 `invalid-client-id` — not the https URL a Personal Agent's `client_id` is.

type Params = { params: Promise<{ clientId: string }> };

/** The `client_id` the segment names, or `null`: Next may or may not have decoded it, and a URL decodes to itself only once. */
async function clientIdOf({ params }: Params): Promise<string | null> {
  const raw = (await params).clientId;
  const clientId = raw.startsWith("https://") ? raw : decodeURIComponent(raw);
  return clientId.startsWith("https://") && clientId.length <= 2048 ? clientId : null;
}

/** Block the `client_id` (operator only): the kill switch the Agents tab's Block button calls. */
export async function PUT(_request: Request, context: Params) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const clientId = await clientIdOf(context).catch(() => null);
  if (clientId === null) return Response.json({ error: "invalid-client-id" }, { status: 400 });
  await blockClient(clientId, guard.userId);
  return Response.json({ clientId, blocked: true });
}

/** Lift the block on the `client_id` (operator only). */
export async function DELETE(_request: Request, context: Params) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const clientId = await clientIdOf(context).catch(() => null);
  if (clientId === null) return Response.json({ error: "invalid-client-id" }, { status: 400 });
  await unblockClient(clientId);
  return Response.json({ clientId, blocked: false });
}

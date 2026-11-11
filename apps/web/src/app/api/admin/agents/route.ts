import { requireAdminApi } from "@/server/entitlements/requireAdmin";
import { agentsSeen } from "@/server/poppy/agentsSeen";

/**
 * **The Personal Agents seen** (ADR-089 decision 3), for the console's Agents
 * tab: an `AdminAgentList`, one row per `client_id`. To anyone but an operator
 * this is a missing route (`requireAdminApi`).
 */
export async function GET() {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  return Response.json({ agents: await agentsSeen() });
}

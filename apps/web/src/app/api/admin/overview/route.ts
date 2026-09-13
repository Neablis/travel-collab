import { adminOverview } from "@/server/entitlements/admin";
import { requireAdminApi } from "@/server/entitlements/requireAdmin";

// Everything the operator console's one page reads (M20 link 7). Behind
// `users.is_admin`, checked here and not only in the layout — the gate box
// requires the ENDPOINT to refuse, not just the route to be hidden.
export async function GET() {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  return Response.json({ overview: await adminOverview() });
}

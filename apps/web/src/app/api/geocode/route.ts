import { auth } from "@/server/auth";
import { getGeocoder } from "@/server/geocoding";
import { consumeQuota, geocodeQuota, quotaRefusal } from "@/server/quota";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ results: [] });
  // Security review 2026-08-28, L4: authenticated but uncapped, so any signed-in
  // account could burn the operator's LocationIQ daily quota. Charged after the
  // empty-query short-circuit, which contacts no vendor.
  const quota = await consumeQuota(geocodeQuota(), session.user.id);
  if (!quota.allowed) return quotaRefusal(quota);
  const results = await getGeocoder().forward(q, { limit: 5 });
  return Response.json({ results });
}

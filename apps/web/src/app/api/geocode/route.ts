import { auth } from "@/server/auth";
import { getGeocoder } from "@/server/geocoding";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ results: [] });
  const results = await getGeocoder().forward(q, { limit: 5 });
  return Response.json({ results });
}

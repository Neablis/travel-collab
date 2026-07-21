import { CreatePageInput } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { listPages, createPage } from "@/server/pages";

export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const g = await guard(tripId);
  if ("error" in g) return g.error;
  return Response.json({ pages: await listPages(tripId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const g = await guard(tripId);
  if ("error" in g) return g.error;
  const body = CreatePageInput.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "invalid-page" }, { status: 400 });
  if (body.data.context.tripId !== tripId) return Response.json({ error: "context tripId mismatch" }, { status: 400 });
  const page = await createPage(tripId, body.data, g.userId);
  return Response.json({ page }, { status: 201 });
}

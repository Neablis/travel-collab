import { UpdatePageInput } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { getPage, updatePage, deletePage } from "@/server/pages";

export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "viewer");
  if ("error" in g) return g.error;
  const page = await getPage(pageId);
  if (!page || page.tripId !== tripId) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ page });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  const existing = await getPage(pageId);
  if (!existing || existing.tripId !== tripId) return Response.json({ error: "not-found" }, { status: 404 });
  const body = UpdatePageInput.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "invalid-page" }, { status: 400 });
  if (body.data.context && body.data.context.tripId !== tripId) return Response.json({ error: "context tripId mismatch" }, { status: 400 });
  const page = await updatePage(pageId, body.data);
  if (!page) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ page });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  const existing = await getPage(pageId);
  if (!existing || existing.tripId !== tripId) return Response.json({ error: "not-found" }, { status: 404 });
  const ok = await deletePage(pageId);
  if (!ok) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ ok: true });
}

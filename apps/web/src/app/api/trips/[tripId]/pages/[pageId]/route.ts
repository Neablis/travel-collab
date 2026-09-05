import { UpdatePageInput } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { isUuid } from "@/server/ids";
import { getPage, updatePage, deletePage } from "@/server/pages";

// `pages.id` is a uuid column, so `getPage("not-a-uuid")` is not a miss — it is
// `22P02` out of the driver, and all three handlers here answered 500 instead
// of the 404 they meant (KI-2026-09-05-x). Guarded at the route rather than
// inside `getPage` because the only other caller — the assistant's page scope —
// already parses its id with `z.string().uuid()` (handleAskRequest.ts), so this
// is the one entry point where an unchecked path segment reaches the lookup.
//
// The check comes AFTER `guard`, never before: answering "that is not an id" to
// somebody with no access to the trip would tell them something the access seam
// has just decided not to tell them.
const notFound = () => Response.json({ error: "not-found" }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "viewer");
  if ("error" in g) return g.error;
  if (!isUuid(pageId)) return notFound();
  const page = await getPage(pageId);
  if (!page || page.tripId !== tripId) return notFound();
  return Response.json({ page });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  if (!isUuid(pageId)) return notFound();
  const existing = await getPage(pageId);
  if (!existing || existing.tripId !== tripId) return notFound();
  const body = UpdatePageInput.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "invalid-page" }, { status: 400 });
  if (body.data.context && body.data.context.tripId !== tripId) return Response.json({ error: "context tripId mismatch" }, { status: 400 });
  const page = await updatePage(pageId, body.data);
  if (!page) return notFound();
  return Response.json({ page });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  if (!isUuid(pageId)) return notFound();
  const existing = await getPage(pageId);
  if (!existing || existing.tripId !== tripId) return notFound();
  const ok = await deletePage(pageId);
  if (!ok) return notFound();
  return Response.json({ ok: true });
}

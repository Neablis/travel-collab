import { PAGE_CHANGED_CODE, UpdatePageInput, serializePageDoc } from "@tc/contracts";
import { guard } from "@/server/pages-guard";
import { inviteTokenOf } from "@/server/access/trip-access";
import { isUuid } from "@/server/ids";
import { MAX_PAGE_BODY_BYTES, getPage } from "@/server/pages";
import { executePageCommand } from "@/server/pageCommands";
import { readBody } from "@/server/readBody";

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

export async function GET(req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "viewer", { allowDemo: true, inviteToken: inviteTokenOf(req) });
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
  const body = await readBody(req, UpdatePageInput, "invalid-page", { maxBytes: MAX_PAGE_BODY_BYTES });
  if ("error" in body) return body.error;
  if (body.data.context && body.data.context.tripId !== tripId) return Response.json({ error: "context tripId mismatch" }, { status: 400 });

  // **A command now, not a table write.** The edit goes through the same
  // pipeline a trip command does, so it lands in the trip's log — which is
  // what moves `headSeq` and wakes a co-traveller's poll, and what puts the
  // change in the trip's history.
  //
  // `context` is validated above and then DROPPED rather than forwarded, and
  // that loses nothing: `PageContext` carries `tripId`, which is checked
  // against the URL right here, and `kind`, which is identity — `updatePage`
  // already refused to write it (CodeRabbit, PR 170) precisely so a PATCH
  // restating its own tripId could not strip the Overview marker. There is no
  // third field, so the whole object is either checked or forbidden.
  //
  // `serializePageDoc`, not the parse output: `executePageCommand` parses its
  // input again, and a node wrapped as `unknown` by the first parse would be
  // wrapped a second time by that one (KI-2026-09-05-g). The wire form is what
  // the command takes.
  const result = await executePageCommand(
    {
      type: "EditPage",
      tripId,
      pageId,
      ...(body.data.title === undefined ? {} : { title: body.data.title }),
      ...(body.data.content === undefined ? {} : { content: serializePageDoc(body.data.content) }),
      ...(body.data.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: body.data.expectedUpdatedAt }),
    },
    g.userId,
  );

  if (!result.ok) {
    if (result.error.code === "page-not-found") return notFound();
    // The stream moved under this request. The editor autosaves, so the next
    // pause retries on its own — 409 is the honest code and the client already
    // treats a failed save as "not saved yet" rather than as data loss.
    if (result.error.code === "concurrency-conflict") {
      return Response.json({ error: result.error.message }, { status: 409 });
    }
    // The page moved since the editor read it. Also a 409, and unlike the one
    // above it must NOT be retried as it stands: the same save would be
    // refused again, and it is the older document. The code is what lets the
    // client tell the two apart and offer the draft instead.
    if (result.error.code === PAGE_CHANGED_CODE) {
      return Response.json({ error: result.error.message, code: PAGE_CHANGED_CODE }, { status: 409 });
    }
    if (result.error.code === "forbidden") return Response.json({ error: result.error.message }, { status: 403 });
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  if (result.page === null) return notFound();
  return Response.json({ page: result.page });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  if (!isUuid(pageId)) return notFound();
  const existing = await getPage(pageId);
  if (!existing || existing.tripId !== tripId) return notFound();
  const outcome = await executePageCommand({ type: "DeletePage", tripId, pageId }, g.userId);
  if (outcome.ok) return Response.json({ ok: true });
  if (outcome.error.code === "page-not-found") return notFound();
  if (outcome.error.code === "forbidden") return Response.json({ error: outcome.error.message }, { status: 403 });
  if (outcome.error.code === "concurrency-conflict") {
    return Response.json({ error: outcome.error.message }, { status: 409 });
  }
  // 409, not 403. The caller has every right to delete pages on this trip —
  // `guard` above already said so — and this particular page is simply not a
  // page that can be deleted (SPEC §25). A 403 would say "you may not", which
  // is false and would send an editor looking for a permission they already
  // have. The body carries the reason, because §25 wants the control to explain
  // itself rather than go quiet.
  return Response.json({ error: outcome.error.message }, { status: 409 });
}

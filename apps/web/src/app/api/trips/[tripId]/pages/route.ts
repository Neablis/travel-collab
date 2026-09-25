import { CreatePageInput, serializePageDoc } from "@tc/contracts";
import { randomUUID } from "node:crypto";
import { guard } from "@/server/pages-guard";
import { inviteTokenOf } from "@/server/access/trip-access";
import { listPages } from "@/server/pages";
import { executePageCommand } from "@/server/pageCommands";
import { readBody } from "@/server/readBody";

export async function GET(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  // A viewer may read the Notebook; only an editor may add to it.
  const g = await guard(tripId, "viewer", { allowDemo: true, inviteToken: inviteTokenOf(req) });
  if ("error" in g) return g.error;
  // `viewerId` rides along so the index's provenance line can say "Yours"
  // truthfully. `actorId` alone only proves a PERSON wrote a notebook, not that
  // the reader did — so on a shared trip every collaborator's notebook was
  // labelled "Yours" (Copilot, PR #126; it was filed as KI-20260903 on the
  // assumption this needed a `users` join, and it does not — the guard already
  // resolved the reader).
  return Response.json({ pages: await listPages(tripId), viewerId: g.userId });
}

export async function POST(req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const g = await guard(tripId, "editor");
  if ("error" in g) return g.error;
  const body = await readBody(req, CreatePageInput, "invalid-page");
  if ("error" in body) return body.error;
  if (body.data.context.tripId !== tripId) return Response.json({ error: "context tripId mismatch" }, { status: 400 });
  // **The id is minted HERE, not by the database**, which is what a command
  // needs: `CreatePage` names the page it creates, so the event is the same
  // whoever replays it. Activity ids have always worked this way; `createPage`
  // let Postgres mint one because a direct insert could.
  // `serializePageDoc`, not the parse output: `executePageCommand` parses its
  // input again, and a node wrapped as `unknown` by the first parse would be
  // wrapped a second time by that one (KI-2026-09-05-g). The wire form is what
  // the command takes.
  const result = await executePageCommand(
    {
      type: "CreatePage",
      tripId,
      pageId: randomUUID(),
      title: body.data.title,
      context: body.data.context,
      content: serializePageDoc(body.data.content),
    },
    g.userId,
  );
  if (!result.ok) {
    if (result.error.code === "forbidden") return Response.json({ error: result.error.message }, { status: 403 });
    if (result.error.code === "concurrency-conflict") {
      return Response.json({ error: result.error.message }, { status: 409 });
    }
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  return Response.json({ page: result.page }, { status: 201 });
}

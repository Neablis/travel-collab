import { CreateReportInput } from "@tc/contracts";
import { CreateReportResponse } from "@/lib/reports";
import { auth } from "@/server/auth";
import { createReport } from "@/server/reports";

// Report a shared day or a review (M12 link 6). Signed-in, like every read of
// the library it reports on.
//
//   * 201 — filed; 200 — you had already filed this one, and here it is.
//   * 404 — nothing you can see is there: private, deleted, moderated and
//     nonexistent all look alike, `requireSavedDayRead`'s rule.
//   * 403 `own-content` — only once the target is readable, so it confirms
//     nothing the reporter could not already open.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = CreateReportInput.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "invalid-report", issues: body.error.issues }, { status: 400 });
  }
  const result = await createReport(session.user.id, body.data);
  if (!result.ok) {
    return result.error.code === "own-content"
      ? Response.json({ error: "own-content", message: result.error.message }, { status: 403 })
      : Response.json({ error: "not-found" }, { status: 404 });
  }
  return Response.json(CreateReportResponse.parse({ report: result.value.report }), {
    status: result.value.created ? 201 : 200,
  });
}

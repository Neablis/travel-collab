import { PAGE_CHANGED_CODE } from "@tc/contracts";
import { PAGE_TITLE_TAKEN_CODE } from "./pageCommands";

// The HTTP answer for a refused default-notebook action (add missing, reset,
// restore), shared by their three routes so the same refusal reads the same
// way at each. The codes are the page pipeline's; the statuses follow the
// notebook routes that were here first (`pages/[pageId]/route.ts`).
//
// 409 for a notebook that cannot take THIS action (`not-a-default`, a version
// that does not exist) rather than 403: the caller may act on this trip, and
// the answer is about the notebook, not about them — the DELETE route's
// argument for the undeletable Overview.
/** The response for a refused default-notebook write; the body carries the code a client branches on. */
export function defaultNotebookRefusal(error: { code: string; message: string }): Response {
  const status =
    error.code === "forbidden"
      ? 403
      : error.code === "page-not-found" || error.code === "trip-not-found"
        ? 404
        : error.code === "concurrency-conflict" ||
            error.code === PAGE_CHANGED_CODE ||
            error.code === PAGE_TITLE_TAKEN_CODE ||
            error.code === "not-a-default" ||
            error.code === "page-version-not-found"
          ? 409
          : 400;
  return Response.json({ error: error.message, code: error.code }, { status });
}

import { CreatePageInput, Page, PageSummary, type UpdatePageInput } from "@tc/contracts";
import { apiUrl, type ApiError, type ApiResult } from "@/lib/apiClient";
import { beginWrite, endWrite } from "@/lib/queryCache";
import { fitsKeepalive } from "@/lib/keepalive";
import { tripKeys } from "@/lib/queryKeys";
import { inviteLookHeaders } from "@/lib/inviteLook";

// INVARIANT: every helper below RESOLVES an ApiResult and never rejects —
// the same invariant `apiClient.ts` states for its own helpers, and for the
// same reason. This module did NOT hold it until 2026-09-03: each helper
// `await`ed `fetch` with no `try`, so an offline or DNS failure rejected the
// promise instead of producing a result, and the `.then(...)` callbacks that
// callers hang their state changes on never ran at all.
//
// That is not theoretical. `NotebooksMenu` sets `status = "loading"` before
// `fetchPages` and clears it in the callback, and `creating = true` before
// `createPage`; both stick forever on a rejected request — a menu spinning on
// "Loading…" and a "New notebook" button disabled for the rest of the session,
// with nothing said and no retry offered. `apiClient`'s own comment records the
// worse version of this bug in `TripProvider` (a permanently gated send queue,
// `docs/reviews/2026-08-28-project-review.md` §1.1). Found by CodeRabbit on
// PR #126.
//
// `status: 0` is the shape for "the request never produced a response" — a
// rejected fetch, or a schema `.parse` throw on a 200, which is why the parse
// happens inside the `try` rather than after it.
function networkError(err: unknown): { ok: false; error: ApiError } {
  return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
}

// SECOND INVARIANT, added with the read cache (ADR-046): every WRITE below
// opens a write SCOPE around itself — `beginWrite` before, `endWrite` in a
// `finally` — whatever the outcome.
//
// **In a `finally`, i.e. on the way OUT, and that is the whole of it.**
// Invalidating before the request looks equivalent and is not: a read that
// starts after that clear and lands before the write's response caches a
// pre-write answer that nothing then clears — the page you just saved, gone
// from the list for the rest of the window. Clearing on the way out covers
// both that read and any entry cached while the write was in flight.
//
// **Whatever the outcome**, rather than on success only, because the ambiguous
// case is the one that matters: a write whose response never arrived may still
// have been applied. Being wrong in this direction costs one extra read; in
// the other it costs a document the user edited and cannot see.
//
// It lives here rather than at the call sites for the reason the keys live in
// one file: `createPage`, `updatePage` and `deletePage` have five callers
// between them, and an invalidation you have to remember to write is one you
// will one day not write.

// Not-ok responses read the same way everywhere: the body's `error` field when
// there is one, the status text when there is not. `code` when the route sent
// one: two refusals can share a status and want different handling (a 409
// `page-changed` must not be retried, a stream conflict may be).
async function refusal(res: Response): Promise<{ ok: false; error: ApiError }> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: unknown };
  const code = typeof data.code === "string" ? { code: data.code } : {};
  return { ok: false, error: { status: res.status, message: data.error ?? res.statusText, ...code } };
}

/**
 * The notebook list, plus who is reading it.
 *
 * `viewerId` is not decoration: the provenance line on the index says "Yours",
 * and `PageSummary.actorId` alone cannot tell the reader's own notebook from a
 * collaborator's. The route resolves the reader from its own guard, so this
 * costs no extra request. `null` when the response predates the field, which
 * the caller renders as author-neutral rather than guessing.
 */
export interface NotebookList {
  pages: PageSummary[];
  viewerId: string | null;
}

export async function fetchPages(tripId: string): Promise<ApiResult<NotebookList>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/pages`), { headers: inviteLookHeaders(tripId) });
    if (!res.ok) return await refusal(res);
    const data = (await res.json()) as { pages: unknown[]; viewerId?: unknown };
    return {
      ok: true,
      value: {
        pages: data.pages.map((p) => PageSummary.parse(p)),
        viewerId: typeof data.viewerId === "string" ? data.viewerId : null,
      },
    };
  } catch (err) {
    return networkError(err);
  }
}

export async function fetchPage(tripId: string, pageId: string): Promise<ApiResult<Page>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/pages/${pageId}`), { headers: inviteLookHeaders(tripId) });
    if (!res.ok) return await refusal(res);
    const data = (await res.json()) as { page: unknown };
    return { ok: true, value: Page.parse(data.page) };
  } catch (err) {
    return networkError(err);
  }
}

export async function createPage(tripId: string, input: CreatePageInput): Promise<ApiResult<Page>> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/pages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CreatePageInput.parse(input)),
    });
    if (!res.ok) return await refusal(res);
    const data = (await res.json()) as { page: unknown };
    return { ok: true, value: Page.parse(data.page) };
  } catch (err) {
    return networkError(err);
  } finally {
    endWrite(scope);
  }
}

export async function updatePage(
  tripId: string,
  pageId: string,
  patch: UpdatePageInput,
  /**
   * `keepalive` for a write sent from `pagehide`, so it outlives the page that
   * sent it: the end of an edit session on a reload or a closed tab
   * (`useEditSession`).
   */
  options: { keepalive?: boolean } = {},
): Promise<ApiResult<Page>> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/pages/${pageId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      keepalive: options.keepalive === true && fitsKeepalive(patch),
    });
    if (!res.ok) return await refusal(res);
    const data = (await res.json()) as { page: unknown };
    return { ok: true, value: Page.parse(data.page) };
  } catch (err) {
    return networkError(err);
  } finally {
    endWrite(scope);
  }
}

export async function deletePage(tripId: string, pageId: string): Promise<ApiResult<{ ok: true }>> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/pages/${pageId}`), { method: "DELETE" });
    if (!res.ok) return await refusal(res);
    return { ok: true, value: { ok: true } };
  } catch (err) {
    return networkError(err);
  } finally {
    endWrite(scope);
  }
}

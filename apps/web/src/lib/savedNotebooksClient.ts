import { Page, SavedNotebook, SavedNotebookListResponse, type SavedNotebookSummary } from "@tc/contracts";
import { apiUrl, type ApiError, type ApiResult } from "@/lib/apiClient";
import { beginWrite, endWrite } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";

// The signed-in person's saved notebooks (M14 link 10). `pagesClient.ts`' two
// invariants hold here too: every helper RESOLVES an `ApiResult` and never
// rejects, and a write that changes a trip's notebooks opens that trip's write
// scope so the cached notebook list is cleared on the way out. Saving or
// deleting a template changes no trip, so only instantiate opens one.

function networkError(err: unknown): { ok: false; error: ApiError } {
  return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
}

async function refusal(res: Response): Promise<{ ok: false; error: ApiError }> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
}

/** The signed-in person's saved notebooks, without their documents. */
export async function fetchSavedNotebooks(): Promise<ApiResult<SavedNotebookSummary[]>> {
  try {
    const res = await fetch(apiUrl("/api/saved-notebooks"));
    if (!res.ok) return await refusal(res);
    return { ok: true, value: SavedNotebookListResponse.parse(await res.json()).savedNotebooks };
  } catch (err) {
    return networkError(err);
  }
}

/** Keep a trip's notebook as a template. The server snapshots what it has stored. */
export async function saveNotebookAsTemplate(input: {
  tripId: string;
  pageId: string;
  title?: string;
}): Promise<ApiResult<SavedNotebook>> {
  try {
    const res = await fetch(apiUrl("/api/saved-notebooks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return await refusal(res);
    const data = (await res.json()) as { savedNotebook: unknown };
    return { ok: true, value: SavedNotebook.parse(data.savedNotebook) };
  } catch (err) {
    return networkError(err);
  }
}

/** Remove one of your templates. Notebooks already made from it are untouched. */
export async function deleteSavedNotebook(savedNotebookId: string): Promise<ApiResult<{ ok: true }>> {
  try {
    const res = await fetch(apiUrl(`/api/saved-notebooks/${savedNotebookId}`), { method: "DELETE" });
    if (!res.ok) return await refusal(res);
    return { ok: true, value: { ok: true } };
  } catch (err) {
    return networkError(err);
  }
}

/** A new notebook in `tripId`, made from one of your templates. */
export async function instantiateSavedNotebook(tripId: string, savedNotebookId: string): Promise<ApiResult<Page>> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/saved-notebooks/${savedNotebookId}`), { method: "POST" });
    if (!res.ok) return await refusal(res);
    const data = (await res.json()) as { page: unknown };
    return { ok: true, value: Page.parse(data.page) };
  } catch (err) {
    return networkError(err);
  } finally {
    endWrite(scope);
  }
}

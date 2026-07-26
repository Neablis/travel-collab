import { CreatePageInput, Page, PageSummary, type UpdatePageInput } from "@tc/contracts";
import { apiUrl, type ApiResult } from "@/lib/apiClient";

export async function fetchPages(tripId: string): Promise<ApiResult<PageSummary[]>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/pages`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { pages: unknown[] };
  return { ok: true, value: data.pages.map((p) => PageSummary.parse(p)) };
}

export async function fetchPage(tripId: string, pageId: string): Promise<ApiResult<Page>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/pages/${pageId}`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { page: unknown };
  return { ok: true, value: Page.parse(data.page) };
}

export async function createPage(tripId: string, input: CreatePageInput): Promise<ApiResult<Page>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/pages`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CreatePageInput.parse(input)),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { page: unknown };
  return { ok: true, value: Page.parse(data.page) };
}

export async function updatePage(
  tripId: string,
  pageId: string,
  patch: UpdatePageInput,
): Promise<ApiResult<Page>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/pages/${pageId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { page: unknown };
  return { ok: true, value: Page.parse(data.page) };
}

export async function deletePage(tripId: string, pageId: string): Promise<ApiResult<{ ok: true }>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/pages/${pageId}`), { method: "DELETE" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  return { ok: true, value: { ok: true } };
}

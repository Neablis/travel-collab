import {
  InvitePreview,
  PageContent,
  SharedTripView,
  TripAccess,
  TripDetail,
  TripHistory,
  TripInvite,
  TripShare,
  type BatchableCommand,
  type CreateInviteInput,
  type PageContext,
  type TripCommand,
} from "@tc/contracts";
import { BASE_URL } from "@/config";

export type ApiError = { status: number; message: string; code?: string };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export type BoardCommand = Exclude<TripCommand, { type: "CreateTrip" }>;

// Browsers resolve relative URLs against the page; Node's fetch (jsdom tests)
// rejects them. Resolve explicitly against the window origin, falling back to
// the dev config (Task 0) when no DOM is present.
export function apiUrl(path: string): string {
  const origin =
    typeof window !== "undefined" && window.location.origin !== "null"
      ? window.location.origin
      : BASE_URL;
  return new URL(path, origin).toString();
}

// Task 7.2 (M10 Phase 7): the new-trip wizard's real step, factored out of
// what was app/page.tsx's own inline form-submit handler so NewTripWizard can
// take it as an injectable prop (real implementation here, a mock in tests).
// Same shape as duplicateTrip below — POST, no dates/budget on this call
// (CreateTrip only ever carries a name; the wizard applies dates/budget as
// separate commands against the tripId this returns).
export async function createTrip(input: { name: string }): Promise<ApiResult<{ tripId: string }>> {
  // Unlike this file's other helpers, createTrip's only caller (the wizard's
  // submit()) has no surrounding try/catch of its own — a rejected fetch
  // (offline, DNS, a network blip) would otherwise reject this promise
  // instead of resolving `{ ok: false }`, leaving the wizard stuck
  // "submitting" with no error shown (CodeRabbit, PR #32).
  try {
    const res = await fetch(apiUrl("/api/trips"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
    }
    const data = (await res.json()) as { tripId: string };
    return { ok: true, value: data };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function fetchTripDetail(tripId: string): Promise<ApiResult<TripDetail>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { trip: unknown };
  return { ok: true, value: TripDetail.parse(data.trip) };
}

export async function fetchTripHistory(tripId: string): Promise<ApiResult<TripHistory>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/history`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { history: unknown };
  return { ok: true, value: TripHistory.parse(data.history) };
}

export async function fetchTripDetailAt(tripId: string, seq: number): Promise<ApiResult<TripDetail>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/history/${seq}`));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { trip: unknown };
  return { ok: true, value: TripDetail.parse(data.trip) };
}

export type CommandOutcome = { detail: TripDetail; history: TripHistory };

function parseOutcome(data: { detail: unknown; history: unknown }): CommandOutcome {
  return { detail: TripDetail.parse(data.detail), history: TripHistory.parse(data.history) };
}

export async function sendTripCommand(command: BoardCommand): Promise<ApiResult<CommandOutcome>> {
  const res = await fetch(apiUrl(`/api/trips/${command.tripId}/commands`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return {
      ok: false,
      error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
    };
  }
  const data = (await res.json()) as { detail: unknown; history: unknown };
  return { ok: true, value: parseOutcome(data) };
}

export async function sendTripCommandBatch(
  tripId: string,
  commands: BatchableCommand[],
): Promise<ApiResult<CommandOutcome>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/commands/batch`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return {
      ok: false,
      error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
    };
  }
  const data = (await res.json()) as { detail: unknown; history: unknown };
  return { ok: true, value: parseOutcome(data) };
}

// Task 5.5: POST /api/trips/:id/ai. `composeAiPage` is the page-authoring
// surface (returns a validated PageContent doc for the caller to review
// before it autosaves — see ComposePanel/PageScreen). `composeAiPlan` is the
// board/combined surface (the server executes 0+ planning tool calls as one
// atomic batch and returns the resulting detail/history, same shape as
// sendTripCommandBatch).
export async function composeAiPage(
  tripId: string,
  prompt: string,
  pageContext: PageContext,
): Promise<ApiResult<{ content: PageContent; simulated: boolean }>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/ai`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, surface: "page", pageContext }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return {
      ok: false,
      error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
    };
  }
  const data = (await res.json()) as { content: unknown; simulated?: unknown };
  return { ok: true, value: { content: PageContent.parse(data.content), simulated: data.simulated === true } };
}

// The plan surface returns the same detail/history as a command batch, plus a
// human-readable `message` summarizing what the AI applied (or why nothing
// was) — surfaced to the user by ComposePanel.
// `simulated` is true when the ai-live flag is off: the change really applied,
// but the server composed it rather than a model. Surfaced so the UI can say so.
export type PlanOutcome = CommandOutcome & { message: string; simulated: boolean };

export async function composeAiPlan(
  tripId: string,
  prompt: string,
  surface: "board" | "combined" = "board",
): Promise<ApiResult<PlanOutcome>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/ai`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, surface }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return {
      ok: false,
      error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
    };
  }
  const data = (await res.json()) as {
    detail: unknown;
    history: unknown;
    message?: unknown;
    simulated?: unknown;
  };
  return {
    ok: true,
    value: {
      ...parseOutcome(data),
      message: typeof data.message === "string" ? data.message : "",
      simulated: data.simulated === true,
    },
  };
}

// Task A11's clone endpoint: POST, no body, 201 with the new trip's id. Used
// by both the trip-list row menu and SettingsSheet's in-trip mirror (A15) —
// both just need the new id to navigate to.
export async function duplicateTrip(tripId: string): Promise<ApiResult<{ tripId: string }>> {
  const res = await fetch(apiUrl(`/api/trips/${tripId}/duplicate`), { method: "POST" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { tripId: string };
  return { ok: true, value: data };
}

// AccountMenu's "Reset to demo data" item (preview only — see
// src/lib/demoDataReset.ts). Clears the signed-in user's own trips and
// reseeds the Japan demo trip; POST, no body, 200 with the new trip's id.
export async function resetDemoData(): Promise<ApiResult<{ tripId: string }>> {
  const res = await fetch(apiUrl("/api/dev/reset-demo-data"), { method: "POST" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
  }
  const data = (await res.json()) as { tripId: string };
  return { ok: true, value: data };
}

// ── Access & Membership (M11 link 3) ─────────────────────────────────────────

async function readJson<T>(res: Response, parse: (data: unknown) => T): Promise<ApiResult<T>> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    return {
      ok: false,
      error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
    };
  }
  return { ok: true, value: parse(await res.json()) };
}

export async function fetchTripAccess(tripId: string): Promise<ApiResult<TripAccess>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/access`));
    return await readJson(res, (data) => TripAccess.parse((data as { access: unknown }).access));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function createTripInvite(
  tripId: string,
  input: CreateInviteInput,
): Promise<ApiResult<TripInvite>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/invites`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await readJson(res, (data) => TripInvite.parse((data as { invite: unknown }).invite));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function revokeTripInvite(
  tripId: string,
  inviteId: string,
): Promise<ApiResult<TripInvite>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/invites/${inviteId}`), { method: "DELETE" });
    return await readJson(res, (data) => TripInvite.parse((data as { invite: unknown }).invite));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function fetchInvitePreview(token: string): Promise<ApiResult<InvitePreview>> {
  try {
    const res = await fetch(apiUrl(`/api/invites/${encodeURIComponent(token)}`));
    return await readJson(res, (data) => InvitePreview.parse((data as { invite: unknown }).invite));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function acceptInvite(token: string): Promise<ApiResult<{ tripId: string }>> {
  try {
    const res = await fetch(apiUrl(`/api/invites/${encodeURIComponent(token)}/accept`), {
      method: "POST",
    });
    return await readJson(res, (data) => ({ tripId: (data as { tripId: string }).tripId }));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** The link an owner hands out. Absolute, because it is meant to be pasted. */
export function inviteLink(token: string): string {
  return apiUrl(`/invite/${encodeURIComponent(token)}`);
}

// ── Pinned read-only shares (M11 link 4) ─────────────────────────────────────

export async function fetchTripShares(tripId: string): Promise<ApiResult<TripShare[]>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/shares`));
    return await readJson(res, (data) =>
      ((data as { shares: unknown[] }).shares ?? []).map((s) => TripShare.parse(s)),
    );
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function createTripShare(tripId: string): Promise<ApiResult<TripShare>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/shares`), { method: "POST" });
    return await readJson(res, (data) => TripShare.parse((data as { share: unknown }).share));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function revokeTripShare(tripId: string, shareId: string): Promise<ApiResult<TripShare>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/shares/${shareId}`), { method: "DELETE" });
    return await readJson(res, (data) => TripShare.parse((data as { share: unknown }).share));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * The public read. `token` may be the reserved `"featured"`, which the API
 * routes to the deployment's configured demo share — same response shape, so
 * `/s/featured` is served by exactly the same page as any other share link.
 */
export async function fetchSharedTrip(token: string): Promise<ApiResult<SharedTripView>> {
  try {
    const res = await fetch(apiUrl(`/api/shares/${encodeURIComponent(token)}`));
    return await readJson(res, (data) => SharedTripView.parse((data as { trip: unknown }).trip));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** The link a sharer hands out. Absolute, because it is meant to be pasted. */
export function shareLink(token: string): string {
  return apiUrl(`/s/${encodeURIComponent(token)}`);
}

import {
  InvitePreview,
  PageContent,
  SavedDay,
  SharedTripView,
  TripAccess,
  TripDetail,
  TripHistory,
  TripInvite,
  TripShare,
  type BatchableCommand,
  type CreateInviteInput,
  type CreateSavedDayInput,
  type PageContext,
  type TripCommand,
} from "@tc/contracts";
import { BASE_URL } from "@/config";

export type ApiError = { status: number; message: string; code?: string };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

// INVARIANT: every helper below RESOLVES an ApiResult and never rejects.
// `status: 0` is the shape for "the request never produced a response" — a
// rejected fetch (offline, DNS) or a schema `.parse` throw on a 200.
//
// This is not cosmetic consistency. Callers treat these as total functions:
// TripProvider's sequential sender awaits one without a try/catch of its own,
// so a rejection there used to skip `inFlight.current = false` and gate the
// send queue permanently — "Saving…" forever, no failure recorded, no retry
// offered, every queued edit lost on navigation
// (docs/reviews/2026-08-28-project-review.md §1.1). `apiClient.test.ts`'s
// "never rejects" suite enforces this for the whole module; add new helpers
// to that list.

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
  // The first helper here to carry the guard (CodeRabbit, PR #32): its only
  // caller (the wizard's submit()) has no try/catch of its own, so a rejected
  // fetch left the wizard stuck "submitting" with no error shown. Every other
  // helper now carries it too, for the same reason — see the module invariant.
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
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}`));
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
    }
    const data = (await res.json()) as { trip: unknown };
    return { ok: true, value: TripDetail.parse(data.trip) };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function fetchTripHistory(tripId: string): Promise<ApiResult<TripHistory>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/history`));
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
    }
    const data = (await res.json()) as { history: unknown };
    return { ok: true, value: TripHistory.parse(data.history) };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function fetchTripDetailAt(tripId: string, seq: number): Promise<ApiResult<TripDetail>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/history/${seq}`));
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
    }
    const data = (await res.json()) as { trip: unknown };
    return { ok: true, value: TripDetail.parse(data.trip) };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export type CommandOutcome = { detail: TripDetail; history: TripHistory };

function parseOutcome(data: { detail: unknown; history: unknown }): CommandOutcome {
  return { detail: TripDetail.parse(data.detail), history: TripHistory.parse(data.history) };
}

export async function sendTripCommand(command: BoardCommand): Promise<ApiResult<CommandOutcome>> {
  try {
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
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function sendTripCommandBatch(
  tripId: string,
  commands: BatchableCommand[],
): Promise<ApiResult<CommandOutcome>> {
  try {
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
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
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
  try {
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
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
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
  try {
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
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

// Task A11's clone endpoint: POST, no body, 201 with the new trip's id. Used
// by both the trip-list row menu and SettingsSheet's in-trip mirror (A15) —
// both just need the new id to navigate to.
export async function duplicateTrip(tripId: string): Promise<ApiResult<{ tripId: string }>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/duplicate`), { method: "POST" });
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

// AccountMenu's "Reset to demo data" item (preview only — see
// src/lib/demoDataReset.ts). Clears the signed-in user's own trips and
// reseeds the Japan demo trip; POST, no body, 200 with the new trip's id.
export async function resetDemoData(): Promise<ApiResult<{ tripId: string }>> {
  try {
    const res = await fetch(apiUrl("/api/dev/reset-demo-data"), { method: "POST" });
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

/**
 * "Make this my trip" (M11 link 5). Copies the share's PINNED state into a new
 * trip owned by the caller — what the link showed, not what the source has
 * become since. 401 when signed out, which the share page turns into a trip to
 * /signin and back.
 */
export async function cloneSharedTrip(token: string): Promise<ApiResult<{ tripId: string }>> {
  try {
    const res = await fetch(apiUrl(`/api/shares/${encodeURIComponent(token)}/clone`), {
      method: "POST",
    });
    return await readJson(res, (data) => ({ tripId: (data as { tripId: string }).tripId }));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

// ── Saved parts (M11 link 6) ─────────────────────────────────────────────────

export async function fetchSavedDays(): Promise<ApiResult<SavedDay[]>> {
  try {
    const res = await fetch(apiUrl("/api/saved-days"));
    return await readJson(res, (data) =>
      ((data as { savedDays: unknown[] }).savedDays ?? []).map((d) => SavedDay.parse(d)),
    );
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function createSavedDay(input: CreateSavedDayInput): Promise<ApiResult<SavedDay>> {
  try {
    const res = await fetch(apiUrl("/api/saved-days"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await readJson(res, (data) => SavedDay.parse((data as { savedDay: unknown }).savedDay));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function deleteSavedDay(savedDayId: string): Promise<ApiResult<{ ok: true }>> {
  try {
    const res = await fetch(apiUrl(`/api/saved-days/${savedDayId}`), { method: "DELETE" });
    return await readJson(res, () => ({ ok: true as const }));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** Appends the saved day and its stops to `tripId` as ONE undoable batch. */
export async function insertSavedDay(
  tripId: string,
  savedDayId: string,
): Promise<ApiResult<CommandOutcome>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/saved-days/${savedDayId}`), {
      method: "POST",
    });
    return await readJson(res, (data) => parseOutcome(data as { detail: unknown; history: unknown }));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

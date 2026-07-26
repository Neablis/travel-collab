import {
  PageContent,
  TripDetail,
  TripHistory,
  type BatchableCommand,
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
): Promise<ApiResult<PageContent>> {
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
  const data = (await res.json()) as { content: unknown };
  return { ok: true, value: PageContent.parse(data.content) };
}

// The plan surface returns the same detail/history as a command batch, plus a
// human-readable `message` summarizing what the AI applied (or why nothing
// was) — surfaced to the user by ComposePanel.
export type PlanOutcome = CommandOutcome & { message: string };

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
  const data = (await res.json()) as { detail: unknown; history: unknown; message?: unknown };
  return {
    ok: true,
    value: {
      ...parseOutcome(data),
      message: typeof data.message === "string" ? data.message : "",
    },
  };
}

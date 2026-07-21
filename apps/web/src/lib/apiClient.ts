import { TripDetail, TripHistory, type BatchableCommand, type TripCommand } from "@tc/contracts";
import { BASE_URL } from "@/config";

export type ApiError = { status: number; message: string; code?: string };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export type BoardCommand = Exclude<TripCommand, { type: "CreateTrip" }>;

// Browsers resolve relative URLs against the page; Node's fetch (jsdom tests)
// rejects them. Resolve explicitly against the window origin, falling back to
// the dev config (Task 0) when no DOM is present.
function apiUrl(path: string): string {
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

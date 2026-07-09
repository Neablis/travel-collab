import { TripDetail, type TripCommand } from "@tc/contracts";
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

export async function sendTripCommand(command: BoardCommand): Promise<ApiResult<null>> {
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
  return { ok: true, value: null };
}

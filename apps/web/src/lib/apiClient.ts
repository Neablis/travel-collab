import {
  AskStreamMetadata,
  BatchableCommand,
  InviteLanding,
  PageDoc,
  Review,
  ReviewDayChanged,
  ReviewSummary,
  SavedDayReviewsResponse,
  SIMULATED_HEADER,
  migratePageDoc,
  SavedDay,
  SharedTripView,
  TripAccess,
  TripDetail,
  TripGlobals,
  TripWeatherResponse,
  type TripWeather,
  TripEventsPage,
  TripHistory,
  TripInvite,
  TripShare,
  TripSummary,
  UpdateUserPreferences,
  UserPreferences,
  type AssistantProposal,
  type AdminReportAction,
  type CreateInviteInput,
  type CreateReportInput,
  type CreateSavedDayInput,
  type PutReviewInput,
  type TripCommand,
} from "@tc/contracts";
import { BASE_URL } from "@/config";
import { ALL_KEYS, beginWrite, clearQueryCache, endWrite } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { inviteLookHeaders } from "@/lib/inviteLook";
import { CitySearchResponse, PlaceSearchResponse, type CityMatch, type PlaceMatch } from "@/lib/cities";
import {
  DiscoverResponse,
  LeaderboardResponse,
  PublicProfileResponse,
  type BudgetBand,
  type LengthBand,
  type DiscoverScope,
  type DiscoverSort,
  type RatingFloor,
} from "@/lib/playbooks";
import {
  AdminReportActionResponse,
  AdminReportsResponse,
  CreateReportResponse,
  type AdminReportQueueItem,
} from "@/lib/reports";
import type { ContentReport, ReportStatus } from "@tc/contracts";

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
export async function createTrip(input: {
  name: string;
  /** Supplied by the caller so a lost response can be retried safely — see
   *  `CreateTripBody` in the route, and KI-2026-09-12-e. */
  tripId?: string;
}): Promise<ApiResult<{ tripId: string }>> {
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
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      // `code` is carried for the same reason `sendTripCommand` carries it: the
      // caller has to tell "this trip already exists" from "this failed".
      return {
        ok: false,
        error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
      };
    }
    const data = (await res.json()) as { tripId: string };
    return { ok: true, value: data };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * Your trips, newest first — the list `/api/trips` has always returned.
 *
 * A helper rather than the raw `fetch` the home page still hand-rolls, because
 * M11b's "Add to a trip" needs the same list from a page that is not a trip and
 * has no TripProvider to ask. Parsed against the contract here so the second
 * caller cannot quietly disagree with the first about the shape.
 */
export async function fetchTrips(): Promise<ApiResult<TripSummary[]>> {
  try {
    const res = await fetch(apiUrl("/api/trips"));
    return await readJson(res, (data) =>
      ((data as { trips: unknown[] }).trips ?? []).map((t) => TripSummary.parse(t)),
    );
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function fetchTripDetail(tripId: string): Promise<ApiResult<TripDetail>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}`), { headers: inviteLookHeaders(tripId) });
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
    const res = await fetch(apiUrl(`/api/trips/${tripId}/history`), { headers: inviteLookHeaders(tripId) });
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

/**
 * One poll of a trip's log (M13 link 2, ADR-049): what happened after `after`,
 * and where the head is now.
 *
 * `after` is a per-stream `seq`, not `events.global_seq` — see ADR-049
 * Decision 1 for why the cursor cannot be the bigserial.
 */
export async function fetchTripEvents(
  tripId: string,
  after: number,
): Promise<ApiResult<TripEventsPage>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/events?after=${after}`), {
      headers: inviteLookHeaders(tripId),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
    }
    return { ok: true, value: TripEventsPage.parse(await res.json()) };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function fetchTripDetailAt(tripId: string, seq: number): Promise<ApiResult<TripDetail>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/history/${seq}`), { headers: inviteLookHeaders(tripId) });
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
  const scope = tripKeys.all(command.tripId);
  beginWrite(scope);
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
  } finally {
    endWrite(scope);
  }
}

export async function sendTripCommandBatch(
  tripId: string,
  commands: BatchableCommand[],
): Promise<ApiResult<CommandOutcome>> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
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
  } finally {
    endWrite(scope);
  }
}

// Task A11's clone endpoint: POST, no body, 201 with the new trip's id. Used
// by both the trip-list row menu and SettingsSheet's in-trip mirror (A15) —
// both just need the new id to navigate to.
export async function duplicateTrip(tripId: string): Promise<ApiResult<{ tripId: string }>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/duplicate`), { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      // `code` is carried for the same reason `sendTripCommand` carries it: the
      // caller has to tell "this trip already exists" from "this failed".
      return {
        ok: false,
        error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
      };
    }
    const data = (await res.json()) as { tripId: string };
    return { ok: true, value: data };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * **Leave a trip somebody shared with you** — M26 link 6b, SPEC §27.
 *
 * `DELETE /api/trips/{id}/membership`, which takes the CALLER off the trip and
 * answers `{ ok: true }` rather than the trip's member list: whoever just left
 * is no longer entitled to read it.
 *
 * Deliberately not `sendTripCommand`. Leaving is not a planning command — no
 * event is appended, nothing enters the trip's history, and the optimistic
 * queue has nothing to predict (ADR-003: access is CRUD). Routing it through
 * the command pipeline would have been the shorter diff and the wrong one.
 */
export async function leaveTrip(tripId: string): Promise<ApiResult<{ ok: true }>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/membership`), { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
    }
    return { ok: true, value: { ok: true } };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

// AccountMenu's "Reset to demo data" item (preview only — see
// src/lib/demoDataReset.ts). Clears the signed-in user's own trips and
// reseeds the Japan demo trip; POST, no body, 200 with the new trip's id.
export async function resetDemoData(): Promise<ApiResult<{ tripId: string }>> {
  // The whole cache, not one trip's keys: this endpoint deletes every trip the
  // account has and reseeds the demo. A per-trip scope would be the wrong shape
  // — there is no one trip it moved.
  const scope = ALL_KEYS;
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl("/api/dev/reset-demo-data"), { method: "POST" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      // `code` is carried for the same reason `sendTripCommand` carries it: the
      // caller has to tell "this trip already exists" from "this failed".
      return {
        ok: false,
        error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
      };
    }
    const data = (await res.json()) as { tripId: string };
    return { ok: true, value: data };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  } finally {
    endWrite(scope);
    clearQueryCache();
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
    const res = await fetch(apiUrl(`/api/trips/${tripId}/access`), { headers: inviteLookHeaders(tripId) });
    return await readJson(res, (data) => TripAccess.parse((data as { access: unknown }).access));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

export async function createTripInvite(
  tripId: string,
  input: CreateInviteInput,
): Promise<ApiResult<TripInvite>> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/invites`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await readJson(res, (data) => TripInvite.parse((data as { invite: unknown }).invite));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  } finally {
    endWrite(scope);
  }
}

export async function revokeTripInvite(
  tripId: string,
  inviteId: string,
): Promise<ApiResult<TripInvite>> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/invites/${inviteId}`), { method: "DELETE" });
    return await readJson(res, (data) => TripInvite.parse((data as { invite: unknown }).invite));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  } finally {
    endWrite(scope);
  }
}

/**
 * The invite landing's one read (M27 link 6) — public, so it works signed out.
 *
 * **A 404 or a 410 is an answer, not a failure.** The route puts the state the
 * screen should draw (`revoked`, `unavailable`) in the body of those, so this
 * resolves `ok` for them. Only a response with no landing in it — a 500, the
 * network — is an error, and that is the one the screen offers a retry for.
 */
export async function fetchInviteLanding(token: string): Promise<ApiResult<InviteLanding>> {
  try {
    const res = await fetch(apiUrl(`/api/invites/${encodeURIComponent(token)}`), { cache: "no-store" });
    if (res.ok || res.status === 404 || res.status === 410) {
      const data = (await res.json()) as { landing: unknown };
      return { ok: true, value: InviteLanding.parse(data.landing) };
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: { status: res.status, message: data.error ?? res.statusText } };
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

// ── Account preferences (M17) ────────────────────────────────────────────────

/**
 * This person's preferences. Never 404s — the endpoint answers with the storage
 * defaults for a session whose row has gone (ADR-025: JWT sessions outlive
 * rows), so a failure here is a real failure.
 *
 * Read through the API rather than handed down from a server component, which
 * is the shape ADR-019 prefers for a server-only value — because the lint wall
 * forbids a page file importing `@/server/*` at all (`eslint.config.mjs` block
 * 1; `scripts/check-lint-wall.mjs` fixtures exactly that import from `src/app`
 * and asserts it is rejected). "UI calls the API" is the wall's own instruction
 * for this case, and it is what `TripProvider` already does with trip state.
 */
/**
 * The trip's addressable collections (ADR-037 open question 4).
 *
 * Separate from `fetchTripDetail` on purpose — see the route's own comment. A
 * caller that only renders the board never asks for this.
 */
export async function fetchTripGlobals(tripId: string): Promise<ApiResult<TripGlobals>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/globals`), { headers: inviteLookHeaders(tripId) });
    return await readJson(res, (data) => TripGlobals.parse((data as { globals: unknown }).globals));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * The trip's weather (ADR-052 decision 3). Only the trip id is sent: the server
 * derives the rounded points from the trip, so nothing the reader chose leaves.
 *
 * Asked for only by a page that holds a widget declaring `needs: ["weather"]` —
 * see `useExternalInputs`.
 */
export async function fetchTripWeather(tripId: string): Promise<ApiResult<TripWeather>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/weather`), { headers: inviteLookHeaders(tripId) });
    return await readJson(res, (data) => TripWeatherResponse.parse(data).weather);
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * What `GET /api/account/preferences` answers: the person's preferences, and
 * whether the account is an operator (M20 link 7).
 *
 * `isAdmin` rides ALONGSIDE `preferences` rather than inside it, because it is
 * not a preference — widening `UserPreferences` would put an authorisation fact
 * in a shape whose contract is "what this person chose about themselves". It
 * is **advisory, and it decides one link**: the console's layout, its page and
 * every admin endpoint answer 404 to a non-admin regardless.
 */
export type AccountPreferencesRead = { preferences: UserPreferences; isAdmin: boolean };

/**
 * The account's preferences and its operator flag, in ONE request.
 *
 * One helper for both fields, not two (KI-2026-09-14-f). A `fetchIsAdmin`
 * beside this used to issue the identical GET to take the other field, so every
 * page load read the row twice. `PreferencesProvider` is the one caller, and it
 * hands `isAdmin` on to the account menu — which keeps an authorisation read
 * out of the query cache altogether rather than de-duplicating two reads
 * through it.
 *
 * Anything but a literal `true` is `false`: a menu item that fails to appear
 * costs an operator one typed URL, and one that appears wrongly is a 404
 * nobody expected.
 */
export async function fetchPreferences(): Promise<ApiResult<AccountPreferencesRead>> {
  try {
    const res = await fetch(apiUrl("/api/account/preferences"));
    return await readJson(res, (data) => {
      const body = data as { preferences: unknown; isAdmin?: unknown };
      return { preferences: UserPreferences.parse(body.preferences), isAdmin: body.isAdmin === true };
    });
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * Change some of them, and get the whole of what is now stored back.
 *
 * A PARTIAL patch: an absent field is left alone, an explicit `null` clears it.
 * The empty patch is refused with a 400 rather than treated as a no-op — see
 * `UpdateUserPreferences`. `homeAirport` is normalized SERVER-side (trim +
 * uppercase), so this helper deliberately sends what the person typed rather
 * than tidying it here, where a second client would be free not to.
 */
export async function updatePreferences(
  patch: UpdateUserPreferences,
): Promise<ApiResult<UserPreferences>> {
  try {
    const res = await fetch(apiUrl("/api/account/preferences"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return await readJson(res, (data) =>
      UserPreferences.parse((data as { preferences: unknown }).preferences),
    );
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

/**
 * Remove one of your own saved days. A SOFT delete server-side (2026-09-01) —
 * the row survives so it can be restored later — and it refuses a PUBLISHED
 * day with a 409 carrying `code: "published"`, which is what the shared-day
 * rail branches on. Anything else is the usual 404: not yours, gone, or never
 * there. No change was needed here for either: `readJson` already forwards
 * `code`, and the URL is the same one this always called.
 */
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
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/saved-days/${savedDayId}`), {
      method: "POST",
    });
    return await readJson(res, (data) => parseOutcome(data as { detail: unknown; history: unknown }));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  } finally {
    endWrite(scope);
  }
}

// ── The public library (M11b) ────────────────────────────────────────────────

/**
 * One saved day: your own, or anybody's published one.
 *
 * `isAuthor` comes back beside the day because the client cannot work it out —
 * the signed-in id is not something the browser holds — and it is what decides
 * whether the shared-day route offers Unpublish.
 */
export async function fetchSavedDay(
  savedDayId: string,
): Promise<
  ApiResult<{ savedDay: SavedDay; isAuthor: boolean; pinning: boolean; publishedAt?: string | null }>
> {
  try {
    const res = await fetch(apiUrl(`/api/saved-days/${savedDayId}`));
    return await readJson(res, (data) => {
      const body = data as { savedDay: unknown; isAuthor: unknown; pinning: unknown; publishedAt?: unknown };
      return {
        savedDay: SavedDay.parse(body.savedDay),
        isAuthor: body.isAuthor === true,
        // True while the server is putting this day's stops on the map after
        // the response (M27 link 10) — the page reads again until it is not.
        pinning: body.pinning === true,
        // When the day was last published — a held review's `seenPublishedAt`
        // (M12). Absent when the server did not say, which is "do not check",
        // never `null` ("I saw it unpublished"), so it stays `undefined`.
        publishedAt:
          typeof body.publishedAt === "string" ? body.publishedAt : body.publishedAt === null ? null : undefined,
      };
    });
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** Puts one of YOUR days into the public library. 404 if it is not yours. */
export async function publishSavedDay(savedDayId: string): Promise<ApiResult<SavedDay>> {
  try {
    const res = await fetch(apiUrl(`/api/saved-days/${savedDayId}/publish`), { method: "POST" });
    return await readJson(res, (data) => SavedDay.parse((data as { savedDay: unknown }).savedDay));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** Takes it back out. The author's control over their own content, not M12's. */
export async function unpublishSavedDay(savedDayId: string): Promise<ApiResult<SavedDay>> {
  try {
    const res = await fetch(apiUrl(`/api/saved-days/${savedDayId}/publish`), { method: "DELETE" });
    return await readJson(res, (data) => SavedDay.parse((data as { savedDay: unknown }).savedDay));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * Cities whose name starts with `q`, with how many published days touch each.
 *
 * An empty or blank `q` is answered by the server with `[]` rather than
 * short-circuited here: the endpoint is the boundary, and a client that has to
 * remember not to ask is a client that will one day forget. The caller
 * debounces; this does not (a helper that owned a timer would be untestable and
 * would fight the caller's own).
 */
export async function searchCities(q: string): Promise<ApiResult<CityMatch[]>> {
  try {
    const res = await fetch(apiUrl(`/api/cities?q=${encodeURIComponent(q)}`));
    return await readJson(res, (data) => CitySearchResponse.parse(data).cities);
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * Cities AND countries whose name starts with `q`, labelled by kind (M12 link
 * 7) — `searchCities`' successor, on its terms: the server answers a blank `q`,
 * and the caller debounces.
 */
export async function searchPlaces(q: string): Promise<ApiResult<PlaceMatch[]>> {
  try {
    const res = await fetch(apiUrl(`/api/places?q=${encodeURIComponent(q)}`));
    return await readJson(res, (data) => PlaceSearchResponse.parse(data).places);
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * Discover's day search (M11b link 5).
 *
 * `city` is repeated rather than comma-joined — a city name may contain a
 * comma, and splitting on one would invent a city called " Japan". The caller
 * debounces the text box that feeds it; this does not.
 */
export async function searchPlaybooks(query: {
  cities?: readonly string[];
  /** ISO alpha-2 codes, repeated as `?country=` like `city` (M12 link 7). */
  countries?: readonly string[];
  scope?: DiscoverScope;
  sort?: DiscoverSort;
  budget?: BudgetBand;
  length?: LengthBand;
  /** The rating floor (M12 link 5). `"any"` is sent as nothing, like every other filter's default. */
  rating?: RatingFloor;
}): Promise<ApiResult<DiscoverResponse>> {
  const params = new URLSearchParams();
  for (const city of query.cities ?? []) params.append("city", city);
  for (const country of query.countries ?? []) params.append("country", country);
  if (query.scope) params.set("scope", query.scope);
  if (query.sort) params.set("sort", query.sort);
  if (query.budget) params.set("budget", query.budget);
  if (query.length) params.set("length", query.length);
  if (query.rating && query.rating !== "any") params.set("rating", query.rating);
  try {
    const res = await fetch(apiUrl(`/api/playbooks?${params.toString()}`));
    return await readJson(res, (data) => DiscoverResponse.parse(data));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** The leaderboard (M11b link 7): everyone, ranked on the adds ledger. */
export async function fetchLeaderboard(): Promise<ApiResult<LeaderboardResponse>> {
  try {
    const res = await fetch(apiUrl("/api/playbooks/board"));
    return await readJson(res, (data) => LeaderboardResponse.parse(data));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** One person's public profile (M11b link 8) — every number derived. */
export async function fetchPublicProfile(userId: string): Promise<ApiResult<PublicProfileResponse>> {
  try {
    const res = await fetch(apiUrl(`/api/playbooks/profile/${encodeURIComponent(userId)}`));
    return await readJson(res, (data) => PublicProfileResponse.parse(data));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

// ── Reviews and reports (M12 links 3-6) ─────────────────────────────────────

/** A shared day's rating rail: the summary, the visible reviews, and the reader's own. */
export async function fetchReviews(savedDayId: string): Promise<ApiResult<SavedDayReviewsResponse>> {
  try {
    const res = await fetch(apiUrl(`/api/saved-days/${savedDayId}/reviews`));
    return await readJson(res, (data) => SavedDayReviewsResponse.parse(data));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * What posting a review can come back as. **The 409 is a state, not an error**
 * (§15's conflict banner, M12 D4): it carries who changed the day and when,
 * which `ApiError`'s message string cannot, so it is its own arm rather than a
 * `code` the caller would then have to re-fetch the details for.
 */
export type PutReviewOutcome =
  | { kind: "saved"; review: Review; summary: ReviewSummary }
  | { kind: "day-changed"; changed: ReviewDayChanged };

/**
 * Create or replace the caller's review — one per person per day, so a second
 * post is an update. A note over 140 characters is refused by the server (400
 * `invalid-review`), never truncated here.
 */
export async function putReview(
  savedDayId: string,
  input: PutReviewInput,
): Promise<ApiResult<PutReviewOutcome>> {
  try {
    const res = await fetch(apiUrl(`/api/saved-days/${savedDayId}/reviews`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 409) {
      const body = ReviewDayChanged.safeParse(await res.json().catch(() => null));
      if (body.success) return { ok: true, value: { kind: "day-changed", changed: body.data } };
      return { ok: false, error: { status: 409, message: "Conflict" } };
    }
    return await readJson(res, (data) => {
      const body = data as { review: unknown; summary: unknown };
      return { kind: "saved" as const, review: Review.parse(body.review), summary: ReviewSummary.parse(body.summary) };
    });
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** Withdraw the caller's own review; answers with the fresh summary. */
export async function deleteReview(savedDayId: string): Promise<ApiResult<ReviewSummary>> {
  try {
    const res = await fetch(apiUrl(`/api/saved-days/${savedDayId}/reviews`), { method: "DELETE" });
    return await readJson(res, (data) => ReviewSummary.parse((data as { summary: unknown }).summary));
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/**
 * Report a shared day or a review. Reporting the same thing twice returns the
 * report already on file (200), so a double-click is harmless; your own
 * content is 403 `own-content`.
 */
export async function createReport(input: CreateReportInput): Promise<ApiResult<ContentReport>> {
  try {
    const res = await fetch(apiUrl("/api/reports"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await readJson(res, (data) => CreateReportResponse.parse(data).report);
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** The operator's report queue, one status at a time. 404 for anyone who is not an operator. */
export async function fetchAdminReports(
  status: ReportStatus = "open",
): Promise<ApiResult<AdminReportQueueItem[]>> {
  try {
    const res = await fetch(apiUrl(`/api/admin/reports?status=${encodeURIComponent(status)}`));
    return await readJson(res, (data) => AdminReportsResponse.parse(data).reports);
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

/** Act on one report; the decision settles every open report on the same target. */
export async function actOnReport(
  reportId: string,
  action: AdminReportAction,
): Promise<ApiResult<ContentReport>> {
  try {
    const res = await fetch(apiUrl(`/api/admin/reports/${reportId}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    return await readJson(res, (data) => AdminReportActionResponse.parse(data).report);
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

// ---------------------------------------------------------------------------
// The assistant conversation — POST /api/trips/:id/ask (M16, ADR-022).
//
// Deliberately NOT `applyAssistantProposal`'s shape. Applying a batch answers
// with a derived receipt; this one answers with the model's own prose,
// streamed, and writes nothing. Two channels have to be handled and they are
// easy to conflate:
//
//   * A **non-200 only ever happens before the stream opens**, and its body is
//     JSON. That is every row of the endpoint's error table — 400s with
//     actionable text, 403 `demo-trip-unsupported`, **402** `ai-not-entitled`,
//     429, 503.
//   * Once the stream is open the status is 200 forever, and a failure arrives
//     as an `{"type":"error","errorText":…}` frame inside it.
//
// A client that only checks `res.ok` reports a mid-answer provider outage as a
// success with a truncated answer. Both are mapped onto the same ApiResult, so
// callers do not have to know which door the failure came through.
//
// No `useChat`: `@ai-sdk/react` is not a dependency of this app, and the two
// things it would buy (thread state, a transport) are the two things the rail
// has to own itself — the thread lives in TripBoardScreen so the queued-edit
// and viewer refusals can happen BEFORE a turn is ever appended.
// ---------------------------------------------------------------------------

/**
 * What a turn is about.
 *
 * `dayIndex` is 0-based — it indexes `TripDetail.days`, matching the server.
 *
 * `page` is the Notebook's turn (ADR-033 Decision 4): the assistant drafts that
 * page's body instead of answering. The id is sent, never trusted — the server
 * resolves it to a page on THIS trip that this actor may edit before it offers
 * a page tool, and refuses rather than widening if it cannot.
 */
export type AskScope =
  | { kind: "trip" }
  | { kind: "day"; dayIndex: number }
  | { kind: "page"; pageId: string };

/** An AI SDK v7 UIMessage, narrowed to the one part type this client sends. */
export type AskWireMessage = {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string }[];
};

// `ProposedChange` and `AssistantProposal` are `@tc/contracts` types since P6
// (KI-22). They were declared here AND in `writeTools.ts` — the same shape
// spelled twice on two sides of one wire, which is the duplication invariant 5
// forbids and which this file's two copies had already begun to diverge over
// (`type` was `string` here and `BatchableCommand["type"]` there). Why the
// `inserts` travel by reference and what `skipped` excludes moved with them to
// `packages/contracts/src/assistant.ts`.

export type AskEvent =
  /** A tool call, seen the moment it is issued — before any answer text. */
  | { type: "tool"; toolCallId: string; toolName: string; input: unknown }
  | { type: "text"; delta: string }
  /**
   * Emitted once, from the response HEADER, before a byte of the body — so a
   * turn that dies mid-answer is still badged correctly. Replaces Task 5's
   * `answerIsSimulated`, which decided this by matching a sentence in the
   * model's own prose.
   */
  | { type: "meta"; simulated: boolean }
  /** The turn's proposal, carried on the stream's final chunk. At most one. */
  | { type: "proposal"; proposal: AssistantProposal }
  /**
   * What a `page`-scoped turn wants INSERTED, on that same final chunk. Already
   * validated against the macro registry server-side, so nodes that failed
   * validation arrive as `page-error` instead and never as content.
   *
   * Inserted, not composed (ADR-035 decision 5). It carries no title because it
   * is not a whole page any more — a turn adds to the document the reader is
   * looking at, which is what lets a second turn mean something.
   */
  | { type: "page-inserts"; content: PageDoc }
  /** A page turn whose nodes failed validation, with the server's own reason. */
  | { type: "page-error"; message: string }
  | { type: "error"; message: string };

/** Set on the ApiError when the failure arrived inside an already-open stream. */
export const ASK_STREAM_ERROR_CODE = "ask-stream-error";
/** Set when the caller aborted the turn (New conversation, navigation). */
export const ASK_ABORTED_CODE = "ask-aborted";
/**
 * The server's refusal code for the demo trip (`handleAskRequest`, KI-79).
 * Duplicated as a literal rather than imported because the UI may not import
 * `@/server/*` (AGENTS.md's dependency rules); branching on the code instead
 * of the prose is the whole point of the server emitting one.
 */
export const DEMO_TRIP_UNSUPPORTED_CODE = "demo-trip-unsupported";
/** The server's refusal code when the actor has no AI entitlement. */
export const AI_NOT_ENTITLED_CODE = "ai-not-entitled";
/**
 * And its status, since M20 link 4: **402 Payment Required**, not 403.
 *
 * Duplicated as a literal for the same reason the code above is — the UI may
 * not import `@/server/*` (AGENTS.md's dependency rules) — and pinned by a test
 * that imports both sides, so the two copies cannot drift.
 */
export const AI_NOT_ENTITLED_STATUS = 402;

// `SIMULATED_HEADER` is a `@tc/contracts` name since P6 (KI-22). It was
// re-declared here as a literal because the UI may not import `@/server/*`
// (AGENTS.md's dependency rules) and `handleAskRequest.ts` owned the only other
// copy — contracts is the third place both may import from, which is what that
// rule always pointed at. Why the verdict is a header rather than a field of
// the stream envelope moved with it.
//
// The two refusal codes above stay duplicated literals: they are `@/server/*`
// exports with no contract of their own, and widening P6 to cover them is a
// change to the error surface rather than to this envelope.

// One SSE frame -> zero or one AskEvent. Exported for its own unit test: the
// chunk vocabulary is a wire contract, and the frames this deliberately
// IGNORES (start, start-step, tool-output-available, finish, [DONE]) matter as
// much as the ones it reads — the stream is a superset the server may grow,
// and an unknown part type must never break a conversation.
export function askEventFromFrame(frame: string): AskEvent | null {
  const payload = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (payload === "" || payload === "[DONE]") return null;
  let chunk: unknown;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof chunk !== "object" || chunk === null) return null;
  const part = chunk as Record<string, unknown>;
  if (part.type === "text-delta" && typeof part.delta === "string") {
    return { type: "text", delta: part.delta };
  }
  if (part.type === "tool-input-available" && typeof part.toolName === "string") {
    return {
      type: "tool",
      toolCallId: typeof part.toolCallId === "string" ? part.toolCallId : part.toolName,
      toolName: part.toolName,
      input: part.input,
    };
  }
  if (part.type === "error") {
    return {
      type: "error",
      message: typeof part.errorText === "string" ? part.errorText : "The assistant stopped mid-answer.",
    };
  }
  // The turn's outcome rides on the run's final chunk as message metadata — the
  // first moment the server knows every tool call the model made. A proposal OR
  // a page, never both: the two tool sets are disjoint server-side — the page
  // surface caps the `itinerary` domain at `read` and no other surface grants
  // `pages` at all (assistant/grants.ts) — so the scope that asked decides
  // which arrives.
  //
  // **Parsed through `AskStreamMetadata` (`@tc/contracts`), not cast** —
  // `commands` go straight back to `/ask/apply` and `content` goes straight
  // into the editor, so a payload the contract does not accept is dropped here
  // rather than acted on. Until P6 this was one `typeof` guard per key over two
  // hand-written narrowing functions, and the gap that shape leaves is not
  // hypothetical: a malformed entry in `changes` was silently skipped, so a
  // card could describe fewer changes than Approve would commit.
  //
  // A turn with no outcome sends no `messageMetadata` at all, and that fails
  // the parse exactly as a malformed one does. Both mean the same thing to a
  // reader — this frame carries no outcome — and the stream is a superset the
  // server may grow, so an envelope a newer deployment sends must be ignored
  // rather than allowed to break the conversation.
  if (part.type === "finish") {
    const metadata = AskStreamMetadata.safeParse(part.messageMetadata);
    if (!metadata.success) return null;
    if ("proposal" in metadata.data) return { type: "proposal", proposal: metadata.data.proposal };
    if ("pageInserts" in metadata.data) return pageInsertsEvent(metadata.data.pageInserts.content);
    if ("composeError" in metadata.data) return { type: "page-error", message: metadata.data.composeError };
    return null;
  }
  return null;
}

/**
 * A parsed `pageInserts.content` → the nodes we are willing to put in the
 * editor, or `null`.
 *
 * **Migrated, not merely parsed.** What comes back here goes straight into the
 * editor and then into `updatePage`, so it is a document entering this build
 * and gets the same migrate-on-read every other entry point gives one (ADR-038
 * decision 2). Without it, a payload carrying an older `v` — from a server
 * mid-deploy, or a `finish` frame replayed from before one — would reach the
 * editor still spelling widgets the registry has retired, and the reader would
 * see "unknown macro" chips in content the assistant had just written for them.
 *
 * This is the one step the schema cannot do for us: `PageDoc` says the document
 * is well-formed, and migration says it is well-formed *for this build*.
 */
function pageInsertsEvent(content: PageDoc): AskEvent | null {
  try {
    return { type: "page-inserts", content: migratePageDoc(content) };
  } catch {
    // A document from a FUTURE version. Refusing is what `migratePageDoc` is
    // saying, and dropping the payload is the same answer this reader gives
    // everything else it cannot use.
    return null;
  }
}

/**
 * Asks one turn. `messages` is the WHOLE thread — conversation state is
 * client-held (Ruling R1, no migration), so turn N+1 is the same POST with a
 * longer array and the server keeps nothing.
 *
 * `onEvent` fires as the stream arrives; the resolved value repeats the full
 * answer text for callers that only want the end.
 */
export async function askAssistant(
  tripId: string,
  messages: AskWireMessage[],
  scope: AskScope,
  onEvent: (event: AskEvent) => void = () => {},
  signal?: AbortSignal,
): Promise<ApiResult<{ text: string }>> {
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/ask`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, scope }),
      signal,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      return {
        ok: false,
        error: { status: res.status, message: data.error ?? res.statusText, code: data.code },
      };
    }
    // Before a byte of the body, so a turn that fails mid-answer is still
    // badged. `false` when the header is absent rather than "unknown": an
    // unbadged answer claims a model wrote it, and that is the wrong way to be
    // wrong.
    onEvent({ type: "meta", simulated: res.headers.get(SIMULATED_HEADER) === "true" });

    if (res.body === null) {
      return { ok: false, error: { status: res.status, message: "The assistant sent no answer." } };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let streamError: string | null = null;

    // Frames are separated by a blank line and a network read lands wherever
    // it lands — mid-JSON as often as not — so an incomplete frame stays in
    // the buffer until its terminator arrives. Parsing per read() instead
    // drops deltas on exactly the connections slow enough to need streaming.
    const drain = (final: boolean) => {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end === -1) break;
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = askEventFromFrame(frame);
        if (event === null) continue;
        if (event.type === "text") text += event.delta;
        if (event.type === "error") streamError = event.message;
        onEvent(event);
      }
      // A stream that ends without a trailing blank line still owes us its
      // last frame.
      if (final && buffer.trim() !== "") {
        const event = askEventFromFrame(buffer);
        buffer = "";
        if (event !== null) {
          if (event.type === "text") text += event.delta;
          if (event.type === "error") streamError = event.message;
          onEvent(event);
        }
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drain(false);
    }
    buffer += decoder.decode();
    drain(true);

    if (streamError !== null) {
      // 200, because that is what the server really sent. The code is how a
      // caller tells "the answer broke half way" from "the request bounced".
      return { ok: false, error: { status: res.status, message: streamError, code: ASK_STREAM_ERROR_CODE } };
    }
    return { ok: true, value: { text } };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { status: 0, message: "The answer was cancelled.", code: ASK_ABORTED_CODE } };
    }
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  }
}

// What applying a batch answers with: the same detail/history a command batch
// returns, plus the server's derived `message` receipt. Named for the command
// endpoint's plan surface, which is where it started and which retired with
// ADR-033 Decision 4 — `/ask/apply` is its only caller now, and `simulated` is
// always false there (see below).
export type PlanOutcome = CommandOutcome & { message: string; simulated: boolean };

/**
 * Approve a proposal — the ONE atomic batch (ADR-013), one history entry, one
 * undo.
 *
 * Rejecting has no counterpart here on purpose: a rejected proposal is this
 * function not being called. Nothing is queued server-side, so there is no
 * "discard" to get wrong, which is what makes "reject leaves the trip
 * byte-identical" a property of the shape rather than of a code path.
 *
 * Answers with the same `{ detail, history }` a command batch does, plus the
 * server's derived receipt — so the board reconciles an approved plan through
 * `applyOutcome`, exactly as it does an undo.
 */
export async function applyAssistantProposal(
  tripId: string,
  proposal: AssistantProposal,
): Promise<ApiResult<PlanOutcome>> {
  const scope = tripKeys.all(tripId);
  beginWrite(scope);
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/ask/apply`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposalId: proposal.proposalId,
        commands: proposal.commands,
        inserts: proposal.inserts,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      return { ok: false, error: { status: res.status, message: data.error ?? res.statusText, code: data.code } };
    }
    const data = (await res.json()) as { detail: unknown; history: unknown; message?: unknown };
    return {
      ok: true,
      value: {
        ...parseOutcome(data),
        message: typeof data.message === "string" ? data.message : "",
        // Approving calls no model — the proposal it applies already carried
        // whatever authorship the turn had, and this endpoint has none of its
        // own to claim.
        simulated: false,
      },
    };
  } catch (err) {
    return { ok: false, error: { status: 0, message: err instanceof Error ? err.message : "Network error" } };
  } finally {
    endWrite(scope);
  }
}

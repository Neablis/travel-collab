import {
  BatchableCommand,
  InvitePreview,
  PageContent,
  SavedDay,
  SharedTripView,
  TripAccess,
  TripDetail,
  TripHistory,
  TripInvite,
  TripShare,
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

// ---------------------------------------------------------------------------
// The assistant conversation — POST /api/trips/:id/ask (M16, ADR-022).
//
// Deliberately NOT `composeAiPlan`'s shape. That endpoint applies a batch and
// answers with a derived receipt; this one answers with the model's own prose,
// streamed, and writes nothing. Two channels have to be handled and they are
// easy to conflate:
//
//   * A **non-200 only ever happens before the stream opens**, and its body is
//     JSON. That is every row of the endpoint's error table — 400s with
//     actionable text, 403 `demo-trip-unsupported`, 403 `ai-not-entitled`,
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

/** `dayIndex` is 0-based — it indexes `TripDetail.days`, matching the server. */
export type AskScope = { kind: "trip" } | { kind: "day"; dayIndex: number };

/** An AI SDK v7 UIMessage, narrowed to the one part type this client sends. */
export type AskWireMessage = {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string }[];
};

/**
 * One change an approved proposal would make. `type` is the command type so a
 * client can group them; `text` is the server's own conditional-mood sentence
 * ("Add “Coffee” to day 2"), written where the commands are (writeTools.ts) so
 * the UI never has to interpret a command to describe it.
 */
export type ProposedChange = { type: string; text: string };

/**
 * What the assistant would change, before it is true (M9).
 *
 * `commands` are already-resolved `BatchableCommand`s — parsed here rather than
 * trusted, because they are posted straight back to `/ask/apply`. They are the
 * batch that was REVIEWED: re-resolving on approval could commit a different
 * set than the one on screen.
 */
export type AssistantProposal = {
  proposalId: string;
  changes: ProposedChange[];
  commands: BatchableCommand[];
  /** Changes the server could not match to this trip, as sentences. */
  skipped: string[];
};

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
 * The header `/ask` sets on every turn (`SIMULATED_HEADER` in
 * handleAskRequest.ts). Duplicated as a literal for the same reason the refusal
 * codes above are: the UI may not import `@/server/*` (AGENTS.md's dependency
 * rules).
 *
 * It replaced a prose sniff. Task 5 decided `simulated` by matching the
 * sentence "AI is switched off on this deployment" in the model's own answer,
 * because the stream carried no flag — a display concern derived from generated
 * text, which breaks silently the moment the sentence is reworded, and which
 * could not badge a turn that failed before it said anything.
 */
const SIMULATED_HEADER = "x-tc-ai-simulated";

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
  // The turn's proposal rides on the run's final chunk as message metadata —
  // the first moment the server knows every write tool call the model made.
  // Parsed, not cast: `commands` go straight back to `/ask/apply`, so a
  // malformed proposal must be dropped here rather than posted.
  if (part.type === "finish") {
    const proposal = proposalFrom((part.messageMetadata as { proposal?: unknown } | undefined)?.proposal);
    return proposal === null ? null : { type: "proposal", proposal };
  }
  return null;
}

/** `unknown` → a proposal we are willing to act on, or `null`. */
function proposalFrom(value: unknown): AssistantProposal | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const commands = BatchableCommand.array().safeParse(raw.commands);
  if (!commands.success || commands.data.length === 0) return null;
  if (typeof raw.proposalId !== "string" || raw.proposalId === "") return null;
  const changes = Array.isArray(raw.changes)
    ? raw.changes.flatMap((change) => {
        if (typeof change !== "object" || change === null) return [];
        const { type, text } = change as { type?: unknown; text?: unknown };
        return typeof type === "string" && typeof text === "string" ? [{ type, text }] : [];
      })
    : [];
  const skipped = Array.isArray(raw.skipped) ? raw.skipped.filter((s): s is string => typeof s === "string") : [];
  return { proposalId: raw.proposalId, changes, commands: commands.data, skipped };
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
  try {
    const res = await fetch(apiUrl(`/api/trips/${tripId}/ask/apply`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: proposal.proposalId, commands: proposal.commands }),
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
  }
}

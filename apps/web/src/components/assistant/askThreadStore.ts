/**
 * **The assistant's conversation, across a reload** — M9's third remainder.
 *
 * The 2026-09-01 audit lists it as *"Thread contract — PARTIAL: messages ride
 * the request; no conversation table in `schema.ts`, so a reload loses the
 * thread"*, and M9's own one-line summary names it as one of the three things
 * the milestone is for: *"the assistant cites the places it plans, **its
 * conversation survives a reload**, and its behaviour is provable in CI"*.
 *
 * **`localStorage` only. No table, no migration** (Mitchell, 2026-09-15, design
 * §6). That is consistent with the ruling already recorded on `AssistantTurn`
 * — *"Client-held: there is no conversations table and no migration in this
 * plan (Ruling R1), so this array IS the thread"* — and it is the cheaper half
 * of a real trade, not a shortcut:
 *
 *   * **Not the trip's event stream**, which would persist server-side with no
 *     new table and put the conversation into history and time travel. Undo
 *     would start reverting chat turns.
 *   * **Not a table.** A table is a migration, and a migration needs a
 *     production dispatch that an undispatched one turns into schema drift
 *     (`docs/guidelines/environments-and-deploys.md`).
 *
 * **What it can and cannot claim, said here so no gate box over-claims it:** a
 * thread survives a RELOAD. It does not survive a device change or cleared site
 * data. The thread is a working surface, not a record.
 *
 * **Every access is wrapped**, following `lib/pendingDemoClone.ts` — *"Safari's
 * private mode throws on `localStorage`"* — and there are two more recorded
 * reasons beside that one: KI-2026-09-02-a (Node 26 leaves
 * `window.localStorage` undefined in the jsdom unit lane), and `SPEC.md` §28,
 * where the old `theme` key still held a stale stored value, which is why the
 * key (`lib/askOwnership.ts`) carries a version.
 */

import type { AssistantTurn } from "@/components/assistant/Transcript";
import type { BeyondTripAskScope, PlaybookAskPage } from "@/lib/apiClient";
import { ASK_DRAFT_PREFIX as DRAFT_PREFIX, ASK_THREAD_PREFIX as KEY_PREFIX } from "@/lib/askOwnership";

/**
 * How many turns are kept.
 *
 * `MAX_ASK_MESSAGES` already bounds what the server will accept, and
 * `useAskThread` counts against it — so this is not a second ceiling on the
 * conversation, it is a ceiling on the STORAGE. A thread at the server's cap is
 * ~40 turns of prose, which is comfortably inside a 5 MB origin quota; what
 * this stops is an unbounded accumulation across many trips in one browser.
 * The oldest turns go first, because a conversation is read from the bottom.
 */
const MAX_STORED_TURNS = 40;

/**
 * A ceiling on one stored thread, in characters.
 *
 * `localStorage` throws `QuotaExceededError` when the ORIGIN is full, and the
 * throw lands on whichever write happens to be last — so one enormous thread
 * takes down the next unrelated write rather than its own. Trimming here keeps
 * the failure local. Roughly 200 KB, which is far more prose than 40 turns of
 * conversation, so it binds only on something pathological.
 */
const MAX_STORED_CHARS = 200_000;

/** The key for one conversation. `name` is the consumer's — see `useAskThread`. */
function keyFor(name: string): string {
  return `${KEY_PREFIX}:${name}`;
}

/**
 * What is worth storing, which is less than what is on screen.
 *
 * Two fields are deliberately dropped, and both for the same reason — a
 * restored thread is a TRANSCRIPT, not a live turn:
 *
 *   * **`pending` is forced false.** A turn stored mid-stream would rehydrate
 *     as one that streams forever; `cancel()` already settles a pending answer
 *     for exactly this reason, and a reload is the one abandonment it cannot
 *     catch.
 *   * **`proposal` is dropped.** A proposal is a live offer the user is being
 *     asked to approve now. Restoring one a day later would put an Approve
 *     button over a plan built against a trip that has since moved — the apply
 *     door would still be safe (it re-reads the trip inside its own
 *     transaction), but "safe" is not the bar for a button that says it will
 *     change your trip. The prose above it survives, which is the part that
 *     makes the conversation readable.
 */
function storable(turn: AssistantTurn): AssistantTurn {
  if (turn.role === "user") return turn;
  // The key is REMOVED rather than set to undefined: a stored `proposal: null`
  // and a stored absence render the same, but only one of them survives a
  // round trip through JSON as the thing it was.
  const rest: Record<string, unknown> = { ...turn, pending: false };
  delete rest.proposal;
  // Its note says where the board was when the turn ended. The suggestions
  // themselves are on the board, and a reload shows them there, decided or not.
  delete rest.suggested;
  return rest as unknown as AssistantTurn;
}

/**
 * Read one conversation back. Never throws; an unreadable value is no
 * conversation, which is the same answer as never having had one.
 *
 * Validated field by field rather than trusted: this is the browser's own
 * storage, so nothing hostile can be in it that the user did not put there —
 * but a value written by an older build can be, and a `map` over a shape that
 * turns out not to be an array is a render crash on the one surface the user
 * was trying to get back to.
 */
export function loadAskThread(name: string): AssistantTurn[] {
  sweepUnownedOnce();
  try {
    const raw = window.localStorage.getItem(keyFor(name));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTurn).map(storable);
  } catch {
    return [];
  }
}

/**
 * Save one conversation, trimmed. Never throws — a full origin loses a thread,
 * not a turn.
 *
 * **An empty thread writes nothing and removes nothing**, and that asymmetry is
 * a correctness guard rather than tidiness. Restoring happens in an effect, so
 * there is one commit where the component has a stored conversation and an
 * empty `thread` — and a save that treated empty as "forget this" would delete
 * the conversation on the way to showing it. Found by a mutation test; the
 * first spelling of this had the removal here and a latch in the hook trying to
 * outrun it.
 *
 * Forgetting is `clearAskThread`, which is a thing a caller DOES rather than a
 * thing a state shape implies.
 */
export function saveAskThread(name: string, thread: readonly AssistantTurn[]): void {
  try {
    if (thread.length === 0) return;
    let kept = thread.slice(-MAX_STORED_TURNS).map(storable);
    let serialised = JSON.stringify(kept);
    // Drop from the front until it fits: a conversation is read from the
    // bottom, so the oldest turn is the one whose loss costs least.
    while (serialised.length > MAX_STORED_CHARS && kept.length > 1) {
      kept = kept.slice(1);
      serialised = JSON.stringify(kept);
    }
    // **One turn can be over the ceiling on its own**, and the loop above stops
    // at `kept.length > 1` — so without this it wrote a value past the limit it
    // documents (CodeRabbit, PR #184). A single pasted message is all it takes.
    //
    // The write is SKIPPED rather than the turn truncated: a transcript is a
    // working surface, and half a message read back would be a quieter lie than
    // no message. The conversation on screen is untouched either way — this
    // function only ever decides what survives a reload.
    if (serialised.length > MAX_STORED_CHARS) return;
    window.localStorage.setItem(keyFor(name), serialised);
  } catch {
    // Private mode, a full origin, or no `localStorage` at all. The
    // conversation on screen is unaffected; only its durability is.
  }
}

/** Forget one conversation — what "New conversation" means to storage. */
export function clearAskThread(name: string): void {
  try {
    window.localStorage.removeItem(keyFor(name));
  } catch {
    // See `saveAskThread`.
  }
}

/** Whether a stored value is a turn this build can render. */
function isTurn(value: unknown): value is AssistantTurn {
  if (typeof value !== "object" || value === null) return false;
  const turn = value as Record<string, unknown>;
  if (typeof turn.id !== "string" || typeof turn.text !== "string") return false;
  if (turn.role === "user") return true;
  // An assistant turn needs its tool notes to be an array of renderable notes;
  // `Transcript` maps over them with no guard of its own.
  return (
    turn.role === "assistant" &&
    Array.isArray(turn.tools) &&
    turn.tools.every(
      (note) =>
        typeof note === "object" &&
        note !== null &&
        typeof (note as { id?: unknown }).id === "string" &&
        typeof (note as { label?: unknown }).label === "string",
    )
  );
}

/**
 * The conversation name of a scope about no one trip, which no trip-bound name
 * (`trip:<id>`, `notebook:<id>`, `page:<id>`) can be. A switch with no default
 * so a new kind does not compile until it is named here: one that covers many
 * pages (a playbook's) needs the page in its name, or they share one thread.
 */
export function beyondTripThreadName(scope: BeyondTripAskScope): string {
  switch (scope.kind) {
    case "account":
      return "account";
    case "playbook":
      return `playbook:${playbookPageName(scope.page)}`;
    default: {
      const unhandled: never = scope;
      return unhandled;
    }
  }
}

/**
 * One playbook page's part of its thread's name (M45 D9): each shared day by
 * its id, a city or tag page by what it lists at any `?page=N`, and Discover
 * as one page whatever its filters are set to, so changing a filter or paging
 * keeps the conversation.
 */
function playbookPageName(page: PlaybookAskPage): string {
  switch (page.kind) {
    case "day":
      return `day:${page.savedDayId}`;
    case "discover":
      return "discover";
    case "city":
      return `city:${page.slug}`;
    case "tag":
      return `tag:${page.tag}:${page.city ?? "everywhere"}`;
    default: {
      const unhandled: never = page;
      return unhandled;
    }
  }
}

// The composer's unsent text, beside its conversation (KI-2026-10-12-g).

/** The stored draft for conversation `name`, or null. Never throws. */
export function loadAskDraft(name: string): string | null {
  sweepUnownedOnce();
  try {
    return window.localStorage.getItem(`${DRAFT_PREFIX}:${name}`);
  } catch {
    return null;
  }
}

/** Stores `text` as the draft for `name`; a blank one removes it. Never throws. */
export function saveAskDraft(name: string, text: string): void {
  if (text.trim() === "") {
    clearAskDraft(name);
    return;
  }
  try {
    window.localStorage.setItem(`${DRAFT_PREFIX}:${name}`, text);
  } catch {
    // See `saveAskThread`.
  }
}

/** Forgets the draft for `name`. Never throws. */
export function clearAskDraft(name: string): void {
  try {
    window.localStorage.removeItem(`${DRAFT_PREFIX}:${name}`);
  } catch {
    // See `saveAskThread`.
  }
}

// **Keys from before conversations had owners** (PR 426, round 1): every name
// was the bare conversation (`trip:<id>`, `account`, `notebook:<id>`,
// `page:<id>`), so whoever used this browser before can have left a thread or
// a draft under one. Nothing reads them any more; they are removed once per
// page load, at the store's first read. An owned name always puts the owner
// first, so it never has one of these shapes.
const UNOWNED_KEY = new RegExp(`^(${KEY_PREFIX}|${DRAFT_PREFIX}):(account|(trip|notebook|page):[^:]+)$`);
let unownedSwept = false;

function sweepUnownedOnce(): void {
  if (unownedSwept) return;
  unownedSwept = true;
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i));
    for (const key of keys) {
      if (key !== null && UNOWNED_KEY.test(key)) window.localStorage.removeItem(key);
    }
  } catch {
    // See `saveAskThread`.
  }
}

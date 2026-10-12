/**
 * **Whose stored conversations are whose** (PR 426): the storage keys of the
 * assistant's threads and drafts, and the owner every one is filed under. Here,
 * not in `components/assistant/askThreadStore.ts`, because sign-out lives in
 * the account's components and must forget them without importing the
 * assistant (dependency-cruiser's `no-folder-cycle`).
 */

/**
 * **Versioned, because §28 is a recorded incident rather than a worry.** The
 * shape stored here is `AssistantTurn`'s, which is a UI type and will change;
 * a stale value under an unversioned key is read as a current one. Bumping this
 * abandons every stored thread, which is the correct cost for a working surface
 * and would be the wrong one for a record.
 */
export const ASK_THREAD_PREFIX = "ask_thread_v1";

// **The composer's unsent text, beside its conversation** (KI-2026-10-12-g). A
// reply that runs a page-leaving command unmounts the rail with whatever the
// person had typed while it answered; so does a reload. Its own versioned
// prefix, since it is a string and not a thread, and wrapped like the thread's
// accesses for the same reasons: losing storage costs the draft's durability,
// never the composer.
export const ASK_DRAFT_PREFIX = "ask_draft_v1";

/**
 * Conversation `name` as `owner` keeps it: the signed-in user's id, so two
 * accounts on one browser never read each other's threads or drafts (PR 426's
 * review: Home's account thread is wholly personal, and every account landed
 * on it). Every stored name goes through here; `useOwnedAskName` is how.
 */
export function ownedAskName(owner: string, name: string): string {
  return `${owner}:${name}`;
}

/** The owner of what a signed-out visitor asks (the demo trip at `/plans`). */
export const SIGNED_OUT_OWNER = "signed-out";

/**
 * Forgets every thread and draft `owner` stored. Sign-out calls it: a shared
 * browser keeps nothing of the account that just left. Never throws.
 */
export function forgetAskConversationsOf(owner: string): void {
  try {
    const mine = [`${ASK_THREAD_PREFIX}:${ownedAskName(owner, "")}`, `${ASK_DRAFT_PREFIX}:${ownedAskName(owner, "")}`];
    const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i));
    for (const key of keys) {
      if (key !== null && mine.some((prefix) => key.startsWith(prefix))) window.localStorage.removeItem(key);
    }
  } catch {
    // Private mode, or no `localStorage`: nothing was stored to forget.
  }
}

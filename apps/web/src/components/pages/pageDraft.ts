import type { PageDoc } from "@tc/contracts";
import { toStoredPageDoc } from "@/components/pages/editor/storedPageDoc";

/**
 * A notebook document the server has not confirmed, kept in this browser until
 * it does — the browser-local draft ADR-036 decision 3 names as the durability
 * answer for one-write-per-session.
 *
 * Written in the two places the edit session cannot carry a document itself:
 * a commit that FAILED (the session retries while the screen is up, but not
 * after it unmounts), and every `pagehide` commit, written before it is sent:
 * that request may die with the page, `keepalive` or not, and nothing will
 * ever say so. The latest commit the server takes clears it; one that landed
 * after all is dropped on the next load, the page already matching it.
 *
 * **Not `navigator.sendBeacon`.** It only POSTs, and the page route is a
 * PATCH behind the editor guard; a POST twin would be a second write endpoint
 * to keep in step with the first, for the one case a draft already covers.
 *
 * `base` is the page's `updatedAt` when the document was typed. On the next
 * load it says whether anyone wrote since: if not, the draft is simply the
 * newer version; if so, it is offered rather than applied (invariant 3).
 */
export type PageDraft = { base: string; doc: PageDoc };

const key = (pageId: string) => `page_draft:${pageId}`;

/** Every access is wrapped: Safari's private mode throws on `localStorage`. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Keep this page's unconfirmed document in the browser, replacing any earlier one. */
export function rememberPageDraft(pageId: string, draft: PageDraft): void {
  try {
    storage()?.setItem(key(pageId), JSON.stringify(draft));
  } catch {
    // Over quota, or refused. The session still holds the document while the
    // screen is up; only the after-unload copy is lost.
  }
}

/** Drop this page's draft, once the server has taken what it held. */
export function forgetPageDraft(pageId: string): void {
  try {
    storage()?.removeItem(key(pageId));
  } catch {
    // Nothing to do: a draft that cannot be removed is offered again, not lost.
  }
}

/**
 * The draft for this page, re-checked through the same guard a save uses — a
 * draft is only ever something we would write, so one this build cannot store
 * is dropped rather than offered.
 */
export function readPageDraft(pageId: string): PageDraft | null {
  let raw: unknown;
  try {
    const text = storage()?.getItem(key(pageId));
    if (text == null) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const { base, doc } = (raw ?? {}) as { base?: unknown; doc?: unknown };
  const stored = typeof base === "string" ? toStoredPageDoc(doc) : null;
  if (stored === null) {
    forgetPageDraft(pageId);
    return null;
  }
  return { base: base as string, doc: stored };
}

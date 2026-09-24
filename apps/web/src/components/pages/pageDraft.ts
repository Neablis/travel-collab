import type { PageDoc } from "@tc/contracts";
import { toStoredPageDoc } from "@/components/pages/editor/storedPageDoc";

/**
 * A notebook document the server has not confirmed, kept in this browser until
 * it does — the browser-local draft ADR-036 decision 3 names as the durability
 * answer for one-write-per-session.
 *
 * Written in the two places the edit session cannot carry a document itself:
 * a commit that FAILED (the session retries while the screen is up, but not
 * after it unmounts), and a `pagehide` whose body is too big for `keepalive`
 * (`fitsKeepalive`), where the request may die with the page and nothing will
 * ever say so. Any commit the server takes clears it.
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

export function rememberPageDraft(pageId: string, draft: PageDraft): void {
  try {
    storage()?.setItem(key(pageId), JSON.stringify(draft));
  } catch {
    // Over quota, or refused. The session still holds the document while the
    // screen is up; only the after-unload copy is lost.
  }
}

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

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageDoc } from "@tc/contracts";

/**
 * How long an editing session may sit untouched before it settles anyway.
 *
 * ADR-036 decision 3 asks for this number and says which way to lean: with one
 * clock it carries durability AND readability, and the two pull apart. A short
 * idle loses less on a crash and writes a history entry per pause for thought,
 * which is the "event per autosave" failure that ADR rejected. So it is long,
 * and browser-local drafts are the named answer for durability when they land.
 */
export const EDIT_SESSION_IDLE_MS = 60_000;

/**
 * Sends one session's document. Resolving `false` says the server did not take
 * it, and the session keeps it; returning nothing is a commit with no way to
 * tell, which is treated as taken.
 *
 * Resolving `"superseded"` says the server refused it as typed against an
 * older page. It is neither kept nor retried, and nor is anything typed on top
 * of it: the same send would be refused again, and the caller has already put
 * it where the author can choose it back.
 *
 * `overtaking` is set on a keepalive commit sent past an ordinary one still in
 * flight. The page revision the caller last saw is about to be moved by that
 * commit, so this one cannot name it (CodeRabbit, PR #222).
 */
export type CommitSession = (
  doc: PageDoc,
  options: { keepalive: boolean; overtaking: boolean },
) => void | Promise<boolean | "superseded">;

/**
 * One write per editing session (ADR-036 decisions 3 and 5, M14 link 9).
 *
 * It replaces the 800ms autosave. Every edit went through that as its own
 * `PageEdited`, and each one moved `headSeq` and woke every co-traveller. Now
 * `change` only remembers the document. It is committed once, on whichever
 * comes first:
 *
 * - **leaving Editing**, the explicit "I'm done";
 * - **unmount**, since navigating away is stopping. The debounce this replaces
 *   was CANCELLED here, which is KI-2026-09-24-g;
 * - **`pagehide`**, because a reload or a closed tab never unmounts. Sent with
 *   `keepalive` so the request outlives the page;
 * - **`visibilitychange` to hidden**, also with `keepalive`, because mobile
 *   Safari does not reliably fire `pagehide` when a backgrounded tab is killed.
 *   Switching tabs therefore ends the session too; the `pagehide` that often
 *   follows finds nothing pending and sends nothing;
 * - **`EDIT_SESSION_IDLE_MS` without a change.**
 *
 * Nothing pending means nothing is written, so opening Editing to read and
 * leaving again makes no history entry. A session that ends where it began
 * still commits, and the server appends nothing for it (`decidePageCommand`).
 *
 * **Each document is committed through the `commit` it was typed under**, not
 * the latest one. `commit` closes over the page id, so a screen reused for a
 * different page must not send the first page's prose to the second.
 *
 * **A commit that fails puts its document back**, because with one write per
 * session nothing else will ever send it: `failed` goes true, the next idle
 * retries, and `flush` is the manual retry. It is not put back over a change
 * made while it was in flight, which already holds everything it did. After
 * unmount nothing here can retry, which is why `PageScreen` also keeps a failed
 * document in the browser (`pageDraft.ts`).
 *
 * **At most one ordinary commit is in flight.** Two PATCHes can land in either
 * order, so a settle made while one is in flight waits for it and then sends
 * only the newest document. The `pagehide` commit cannot wait, so it goes at
 * once, marked `overtaking`. The race it then runs is settled by the server:
 * the ordinary commit names the revision it was typed against, the keepalive
 * names none, so whichever lands second, the older document is never the one
 * kept (`expectedUpdatedAt`). Found by CodeRabbit on PR #222.
 *
 * **Only the latest commit started may act on its result.** An older one can
 * still answer after a newer one (past a keepalive), and what it says is
 * history: it may not report a failure or put its document back.
 */
export function useEditSession(
  editing: boolean,
  commit: CommitSession,
): { change: (doc: PageDoc) => void; flush: () => void; failed: boolean } {
  const pending = useRef<{ doc: PageDoc; commit: CommitSession } | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const mounted = useRef(true);
  const [failed, setFailed] = useState(false);
  // Which commit is the latest started, and whether an ordinary one is in
  // flight with a settle queued behind it. See "at most one" above.
  const started = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef(false);

  const settle = useCallback((keepalive: boolean) => {
    if (idle.current !== null) clearTimeout(idle.current);
    idle.current = null;
    if (!keepalive && inFlight.current) {
      // Left pending, so a change made while waiting replaces it.
      queued.current = true;
      return;
    }
    const session = pending.current;
    pending.current = null;
    if (session === null) return;
    const seq = ++started.current;
    const overtaking = keepalive && inFlight.current;
    if (!keepalive) inFlight.current = true;
    // A rejection counts as a failure: left unhandled, `inFlight` would stay
    // set and every commit after it would queue forever.
    const result = Promise.resolve(session.commit(session.doc, { keepalive, overtaking })).catch(() => false as const);
    void result.then((taken) => {
      if (!keepalive) inFlight.current = false;
      if (taken === "superseded" && seq === started.current) {
        // Anything typed while it was in flight was typed on the same stale
        // page, and is already in what the caller kept.
        if (idle.current !== null) clearTimeout(idle.current);
        idle.current = null;
        pending.current = null;
      }
      if (seq === started.current && mounted.current) {
        setFailed(taken === false);
        if (taken === false && pending.current === null) {
          pending.current = session;
          idle.current = setTimeout(() => settle(false), EDIT_SESSION_IDLE_MS);
        }
      }
      // Even after unmount: the unmount's own settle may be the one queued.
      if (!keepalive && queued.current) {
        queued.current = false;
        settle(false);
      }
    });
  }, []);

  const change = useCallback(
    (doc: PageDoc) => {
      if (idle.current !== null) clearTimeout(idle.current);
      pending.current = { doc, commit: commitRef.current };
      idle.current = setTimeout(() => settle(false), EDIT_SESSION_IDLE_MS);
    },
    [settle],
  );

  const flush = useCallback(() => settle(false), [settle]);

  useEffect(() => {
    if (!editing) settle(false);
  }, [editing, settle]);

  useEffect(() => {
    mounted.current = true;
    const onPageHide = () => settle(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") settle(true);
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      settle(false);
      mounted.current = false;
    };
  }, [settle]);

  return { change, flush, failed };
}

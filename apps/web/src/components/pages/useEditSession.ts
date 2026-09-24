"use client";
import { useCallback, useEffect, useRef } from "react";
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

export type CommitSession = (doc: PageDoc, options: { keepalive: boolean }) => void;

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
 */
export function useEditSession(
  editing: boolean,
  commit: CommitSession,
): { change: (doc: PageDoc) => void; discard: () => void } {
  const pending = useRef<{ doc: PageDoc; commit: CommitSession } | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const discard = useCallback(() => {
    if (idle.current !== null) clearTimeout(idle.current);
    idle.current = null;
    pending.current = null;
  }, []);

  const settle = useCallback(
    (keepalive: boolean) => {
      const session = pending.current;
      discard();
      if (session !== null) session.commit(session.doc, { keepalive });
    },
    [discard],
  );

  const change = useCallback(
    (doc: PageDoc) => {
      if (idle.current !== null) clearTimeout(idle.current);
      pending.current = { doc, commit: commitRef.current };
      idle.current = setTimeout(() => settle(false), EDIT_SESSION_IDLE_MS);
    },
    [settle],
  );

  useEffect(() => {
    if (!editing) settle(false);
  }, [editing, settle]);

  useEffect(() => {
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
    };
  }, [settle]);

  return { change, discard };
}

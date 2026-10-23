"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatLink, ChatMessage, ChatPage } from "@tc/contracts";
import { useKnownSessionUser } from "@/components/account/useSessionUser";
import {
  deleteChatMessage,
  editChatMessage,
  fetchChat,
  markChatRead,
  postChatMessage,
  type ApiError,
  type ApiResult,
} from "@/lib/apiClient";
import { whenIdle } from "@/lib/whenIdle";

/**
 * - `loading`: the first read has not answered.
 * - `ready`: a page is held; later failed re-reads keep it.
 * - `no-access`: the server answered 403, to a chat call or to the trip's
 *   poll. A removed member's page does not otherwise learn it was removed
 *   (KI-2026-10-05-h), so the chat says so rather than looking live (M46 D2).
 * - `failed`: the first read failed for another reason.
 */
export type TripChatStatus = "loading" | "ready" | "no-access" | "failed";

/**
 * A line of the conversation. `pending` is the reader's own message, shown
 * from the moment they sent it and not yet stored: its id is this page's own,
 * so nothing may be done to it until the server's message takes its place.
 */
export type ChatLine = ChatMessage & { pending?: true };

/** A pending line, and the messages already on the page when it was sent. */
type Sending = { line: Extract<ChatLine, { removed: false }>; before: ReadonlySet<string> };

export type TripChat = {
  tripId: string;
  status: TripChatStatus;
  messages: readonly ChatLine[];
  hasEarlier: boolean;
  /** Messages by others since the caller's read cursor; 0 while the chat is being read. */
  unread: number;
  /** False after the owner's lapse: the chat is readable and the composer is not. */
  canPost: boolean;
  /**
   * Shows the message at once, as `pending`, and sends it after any still
   * sending, so they are stored in the order they were sent. Resolves `null`
   * once stored. One not stored is taken back with every send queued behind
   * it, and resolves to all their text, joined, for the composer to give back;
   * those queued sends resolve `null`.
   */
  post: (body: string, link?: ChatLink) => Promise<string | null>;
  postError: string | null;
  /** The author's new text; resolves false when it was not stored. */
  edit: (messageId: string, body: string) => Promise<boolean>;
  /** Soft-delete (D6); resolves false when the server refused. */
  remove: (messageId: string) => Promise<boolean>;
  /** Why the last edit or delete did not land, for the panel to say. */
  changeError: string | null;
};

const READ_ONLY = 402;
const NO_ACCESS = 403;
// An edit of a message deleted or hidden since this page last read it.
const REMOVED = 409;

/**
 * A trip's chat, held by the board so the header's pill can count it while the
 * panel is closed (M46 D4, D5).
 *
 * **Live by `chatRev`**: the events poll serves it to every reader, and every
 * new value re-reads the page. The value means nothing here; that it moved
 * is the news, as `remoteRevision` is for the trip.
 *
 * **Read while `reading`**: the caller says when the Chat tab is on screen,
 * and the newest message is marked read then and again as each new one
 * arrives. Marking read is allowed after a lapse (D2), so it is not gated on
 * `canPost`.
 *
 * **The first read waits for idle**, unless the panel opens or `chatRev`
 * moves first, and then it is at once.
 */
export function useTripChat({
  tripId,
  enabled,
  chatRev,
  reading,
  accessLost,
}: {
  tripId: string;
  /** False on the demo, which refuses every chat route (ADR-073 §5). */
  enabled: boolean;
  chatRev: string | null;
  reading: boolean;
  /**
   * The trip's events poll was refused (`useTrip().accessLost`). Once removed,
   * nothing moves `chatRev` for this reader again, so without this the panel
   * would look live until they pressed Send.
   */
  accessLost: boolean;
}): TripChat {
  const [page, setPage] = useState<ChatPage | null>(null);
  const [readStatus, setStatus] = useState<TripChatStatus>("loading");
  const status = accessLost ? "no-access" : readStatus;
  // Sent and not yet stored, in the order sent. Kept apart from the page, so a
  // re-read neither drops them nor counts them, and the read cursor never
  // sees an id the server did not make. The ref is the queue's own copy: a
  // send reads it after an await, when the state it closed over is stale.
  const [pending, setPending] = useState<readonly Sending[]>([]);
  const queued = useRef<readonly Sending[]>([]);
  const setQueued = useCallback((next: readonly Sending[]) => {
    queued.current = next;
    setPending(next);
  }, []);
  // The tail of the queue: each POST starts once the one before it answers.
  // Two at once could be stored, and shown to everyone, in either order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sent = useRef(0);
  // The page as last rendered, for a send to note which messages it predates.
  const latestPage = useRef(page);
  useEffect(() => {
    latestPage.current = page;
  }, [page]);
  const me = useKnownSessionUser()?.id ?? "";
  const [postError, setPostError] = useState<string | null>(null);
  // Why the last edit or delete failed. Cleared by a fresh read or a post as
  // well as by the next change: by then it describes a page that has moved on.
  const [changeError, setChangeError] = useState<string | null>(null);

  // A 403 from any of the three calls is the same news.
  const refused = useCallback((error: ApiError) => {
    if (error.status === NO_ACCESS) setStatus("no-access");
    return error.status === NO_ACCESS;
  }, []);

  // The first read is not for the first paint: until the panel opens, the
  // conversation feeds only the header's count. Left on the mount it was one
  // more request racing the trip's own (2.5s into a mobile load, measured
  // 2026-10-18). Opening the panel, or a new `chatRev`, reads at once; either
  // latches `due`, so the idle callback is cancelled rather than read again.
  const [dueFor, setDueFor] = useState<string | null>(null);
  const [seenRev, setSeenRev] = useState(chatRev);
  if (seenRev !== chatRev) setSeenRev(chatRev);
  if (dueFor !== tripId && (reading || seenRev !== chatRev)) setDueFor(tripId);
  const due = dueFor === tripId;
  useEffect(() => {
    if (!enabled || due) return;
    return whenIdle(() => setDueFor(tripId));
  }, [tripId, enabled, due]);

  useEffect(() => {
    if (!enabled || !due) return;
    // A slower read for an older revision must not overwrite a newer one.
    let live = true;
    void fetchChat(tripId).then((result) => {
      if (!live) return;
      if (result.ok) {
        setPage(result.value);
        setStatus("ready");
        setChangeError(null);
      } else if (!refused(result.error)) {
        setStatus((current) => (current === "loading" ? "failed" : current));
      }
    });
    return () => {
      live = false;
    };
  }, [tripId, enabled, due, chatRev, refused]);

  const newest = page?.messages.at(-1)?.messageId ?? null;
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !reading || newest === null || newest === marked.current || status === "no-access") return;
    marked.current = newest;
    setPage((current) => (current === null ? current : { ...current, unread: 0 }));
    void markChatRead(tripId, newest).then((result) => {
      if (!result.ok && !refused(result.error)) marked.current = null;
    });
  }, [tripId, enabled, reading, newest, status, refused]);

  const post = useCallback(
    (body: string, link?: ChatLink) => {
      sent.current += 1;
      const line: Sending["line"] = {
        messageId: `pending-${sent.current}`,
        authorId: me,
        kind: "member",
        requestedBy: null,
        replyTo: null,
        suggestionId: null,
        asksAssistant: false,
        createdAt: new Date().toISOString(),
        editedAt: null,
        removed: false,
        body,
        ...(link === undefined ? {} : { link }),
        pending: true,
      };
      setQueued([...queued.current, { line, before: new Set(latestPage.current?.messages.map((m) => m.messageId)) }]);
      setPostError(null);
      setChangeError(null);
      const turn = queue.current.then(async (): Promise<string | null> => {
        // Taken back with an earlier send that was not stored.
        if (!queued.current.some((s) => s.line === line)) return null;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = await postChatMessage(tripId, link === undefined ? { body, timeZone } : { body, link, timeZone });
        if (result.ok) {
          setQueued(queued.current.filter((s) => s.line !== line));
          // In the pending line's place, in the same render. A re-read may have
          // brought it already, and the next one brings it again.
          setPage((current) =>
            current === null || current.messages.some((m) => m.messageId === result.value.messageId)
              ? current
              : { ...current, messages: [...current.messages, result.value] },
          );
          return null;
        }
        // This send is the queue's head, so every line still pending was sent
        // after it. They go back with it rather than be stored without it.
        const unsent = queued.current.map((s) => s.line.body).join(" ");
        setQueued([]);
        if (refused(result.error)) return unsent;
        if (result.error.status === READ_ONLY) {
          // The owner lapsed since the last read: the panel turns read-only now
          // rather than on the next one.
          setPage((current) => (current === null ? current : { ...current, canPost: false }));
          return unsent;
        }
        setPostError(result.error.status === 0 ? "Couldn't send. Check your connection and try again." : result.error.message);
        return unsent;
      });
      queue.current = turn;
      return turn;
    },
    [tripId, me, refused, setQueued],
  );

  // An edit or a delete answers with the message as stored, so the author's
  // own line changes now; everyone else's page re-reads on `chatRev`.
  const change = useCallback(
    async (result: ApiResult<ChatMessage>) => {
      if (result.ok) {
        setChangeError(null);
        setPage((current) =>
          current === null
            ? current
            : { ...current, messages: current.messages.map((m) => (m.messageId === result.value.messageId ? result.value : m)) },
        );
        return true;
      }
      if (refused(result.error)) return false;
      if (result.error.status === READ_ONLY) {
        setPage((current) => (current === null ? current : { ...current, canPost: false }));
        return false;
      }
      setChangeError(
        result.error.status === 0
          ? "Couldn't reach the server. Check your connection and try again."
          : result.error.status === REMOVED
            ? "That message has been removed."
            : result.error.message,
      );
      return false;
    },
    [refused],
  );
  const edit = useCallback(
    async (messageId: string, body: string) => change(await editChatMessage(tripId, messageId, { body })),
    [tripId, change],
  );
  const remove = useCallback(async (messageId: string) => change(await deleteChatMessage(tripId, messageId)), [tripId, change]);

  // A re-read can bring a sent message before its POST answers. The pending
  // line gives way to it: the reader's own, the same words and link, and new
  // since the send. Each stored message stands in for one pending line.
  const messages = useMemo(() => {
    const stored = page?.messages ?? [];
    const matched = new Set<string>();
    const waiting = pending.filter(({ line, before }) => {
      const match = stored.find(
        (m) =>
          !m.removed &&
          !before.has(m.messageId) &&
          !matched.has(m.messageId) &&
          m.authorId === line.authorId &&
          m.body === line.body &&
          m.link?.kind === line.link?.kind &&
          m.link?.id === line.link?.id,
      );
      if (match !== undefined) matched.add(match.messageId);
      return match === undefined;
    });
    return [...stored, ...waiting.map((s) => s.line)];
  }, [page, pending]);

  return {
    tripId,
    status,
    messages,
    hasEarlier: page?.hasEarlier ?? false,
    unread: reading ? 0 : (page?.unread ?? 0),
    canPost: page?.canPost ?? false,
    post,
    postError,
    edit,
    remove,
    changeError,
  };
}

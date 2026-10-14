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
   * Shows the message at once, as `pending`, and takes it back if it was not
   * stored: resolves false then, so the composer can give the text back.
   */
  post: (body: string, link?: ChatLink) => Promise<boolean>;
  posting: boolean;
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
  const [posting, setPosting] = useState(false);
  // Sent and not yet answered, oldest first. Kept apart from the page, so a
  // re-read neither drops them nor counts them, and the read cursor never
  // sees an id the server did not make.
  const [pending, setPending] = useState<readonly ChatLine[]>([]);
  const sent = useRef(0);
  const inFlight = useRef(0);
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

  useEffect(() => {
    if (!enabled) return;
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
  }, [tripId, enabled, chatRev, refused]);

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
    async (body: string, link?: ChatLink) => {
      sent.current += 1;
      inFlight.current += 1;
      const line: ChatLine = {
        messageId: `pending-${sent.current}`,
        authorId: me,
        createdAt: new Date().toISOString(),
        editedAt: null,
        removed: false,
        body,
        ...(link === undefined ? {} : { link }),
        pending: true,
      };
      setPending((current) => [...current, line]);
      setPosting(true);
      setPostError(null);
      setChangeError(null);
      const result = await postChatMessage(tripId, link === undefined ? { body } : { body, link });
      inFlight.current -= 1;
      setPosting(inFlight.current > 0);
      setPending((current) => current.filter((m) => m.messageId !== line.messageId));
      if (result.ok) {
        // In the pending line's place, in the same render. A re-read may have
        // brought it already, and the next one brings it again.
        setPage((current) =>
          current === null || current.messages.some((m) => m.messageId === result.value.messageId)
            ? current
            : { ...current, messages: [...current.messages, result.value] },
        );
        return true;
      }
      if (refused(result.error)) return false;
      if (result.error.status === READ_ONLY) {
        // The owner lapsed since the last read: the panel turns read-only now
        // rather than on the next one.
        setPage((current) => (current === null ? current : { ...current, canPost: false }));
        return false;
      }
      setPostError(result.error.status === 0 ? "Couldn't send. Check your connection and try again." : result.error.message);
      return false;
    },
    [tripId, me, refused],
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

  const messages = useMemo(() => [...(page?.messages ?? []), ...pending], [page, pending]);

  return {
    tripId,
    status,
    messages,
    hasEarlier: page?.hasEarlier ?? false,
    unread: reading ? 0 : (page?.unread ?? 0),
    canPost: page?.canPost ?? false,
    post,
    posting,
    postError,
    edit,
    remove,
    changeError,
  };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatPage } from "@tc/contracts";
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

export type TripChat = {
  tripId: string;
  status: TripChatStatus;
  messages: readonly ChatMessage[];
  hasEarlier: boolean;
  /** Messages by others since the caller's read cursor; 0 while the chat is being read. */
  unread: number;
  /** False after the owner's lapse: the chat is readable and the composer is not. */
  canPost: boolean;
  /** Resolves false when the message was not stored, so the composer keeps the text. */
  post: (body: string) => Promise<boolean>;
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
  const [postError, setPostError] = useState<string | null>(null);

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
    async (body: string) => {
      setPosting(true);
      setPostError(null);
      const result = await postChatMessage(tripId, { body });
      setPosting(false);
      if (result.ok) {
        // Shown at once; the next re-read brings the same message back.
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
    [tripId, refused],
  );

  const [changeError, setChangeError] = useState<string | null>(null);
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

  return {
    tripId,
    status,
    messages: page?.messages ?? [],
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

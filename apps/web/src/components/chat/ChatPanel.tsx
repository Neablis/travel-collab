"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ASK_MAX_DURATION_SECONDS } from "@tc/contracts";
import { useKnownSessionUser } from "@/components/account/useSessionUser";
import type { Persona } from "@/lib/persona";
import { usePinToBottom } from "@/components/assistant/usePinToBottom";
import { useOptionalTrip } from "@/components/trip/context/TripProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { fetchPages } from "@/lib/pagesClient";
import { cachedRead, DEDUPE } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { useAiEntitled } from "@/lib/useAiEntitled";
import { ChatMessage, type ChatReader, type MessageViewer } from "./ChatMessage";
import { ChatMentionsProvider, type ChatMentions } from "./MessageChip";
import { useTargetPicker } from "./TargetPicker";
import type { ChatLine, TripChat } from "./useTripChat";
import { HOME_PATH } from "@/lib/homePath";

/** The read-only line after the owner's lapse (M46 D2): why, not just that. */
export const READ_ONLY_LINE = "This chat is read-only: the trip owner's plan no longer includes collaborators.";
export const NO_ACCESS_LINE = "You no longer have access to this trip";
/** While an `@assistant` is unanswered (M52 decision 18): its reply lands whole, never streamed. */
export const THINKING_LINE = "Assistant is thinking…";

/**
 * When the last unanswered `@assistant` in `messages` stops counting as one,
 * or null when none is waiting at `now`. An ask waits until a reply names it
 * in `replyTo`, and no longer than a turn can run: one the platform killed, or
 * whose reply could not be posted, is never answered.
 */
export function thinkingUntil(messages: readonly ChatLine[], now: number): number | null {
  const answered = new Set(messages.flatMap((m) => (m.kind === "assistant" && m.replyTo !== null ? [m.replyTo] : [])));
  const ends = messages
    .filter((m) => m.asksAssistant && !answered.has(m.messageId))
    .map((m) => Date.parse(m.createdAt) + ASK_MAX_DURATION_SECONDS * 1000)
    .filter((end) => end > now);
  return ends.length === 0 ? null : Math.max(...ends);
}

/** Whether the thread shows the assistant at work, read again the moment the last ask stops counting. */
function useThinking(messages: readonly ChatLine[]): boolean {
  // The clock as of the last expiry, not read in render: an ask newer than it
  // still counts, and the timeout below moves it past the last one to end.
  const [now, setNow] = useState(() => Date.now());
  const until = thinkingUntil(messages, now);
  useEffect(() => {
    if (until === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  return until !== null;
}

/**
 * The Chat tab's body: the conversation, pinned to its newest line, and the
 * composer under it (M46, the layout). The conversation itself is the
 * caller's (`useTripChat`), so it outlives this panel being closed.
 *
 * `touch` is the sheet's: its controls take SPEC §13.1's 44px floor, as the
 * Ask tab's do. `reader` is who is reading where no `TripProvider` says (a
 * notebook), so the owner's Delete and the asker's Accept are there too.
 */
export function ChatPanel({
  chat,
  personas,
  touch = false,
  reader,
}: {
  chat: TripChat;
  personas: Readonly<Record<string, Persona>> | null;
  touch?: boolean;
  reader?: ChatReader | undefined;
}) {
  const trip = useOptionalTrip();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Save, Cancel and a confirmed Delete each unmount the control focus was on
  // (the edit form, the `⋯` trigger); the line keeps focus instead of <body>.
  const lines = useRef(new Map<string, HTMLLIElement>());
  const focusLine = (messageId: string | null) => (messageId === null ? undefined : lines.current.get(messageId)?.focus());
  const deletingFrom = useRef<string | null>(null);
  // The trip's notebooks, for the picker and a message's notebook chip: the
  // board's own read of them, shared through the cache rather than asked again,
  // and read again on `remoteRevision`, as the board's is, so a notebook added
  // since is offered and resolves without the panel remounting.
  const remoteRevision = trip?.remoteRevision;
  const [notebooks, setNotebooks] = useState<ChatMentions["notebooks"]>([]);
  useEffect(() => {
    let live = true;
    void cachedRead(tripKeys.pages(chat.tripId), () => fetchPages(chat.tripId), { dedupeMs: DEDUPE.DOCUMENT }).then((result) => {
      if (live && result.ok) setNotebooks(result.value.pages.map(({ id, title }) => ({ id, title })));
    });
    return () => {
      live = false;
    };
  }, [chat.tripId, remoteRevision]);
  const mentions = useMemo<ChatMentions>(() => ({ tripId: chat.tripId, personas, notebooks }), [chat.tripId, personas, notebooks]);
  // Offered to everyone; `null`, not yet known, reads as entitled, as the rail does.
  const picker = useTargetPicker(draft, setDraft, mentions, { entitled: useAiEntitled() !== false });
  const thinking = useThinking(chat.messages);
  // Whether the composer holds anything as last rendered: `send` asks after
  // its await, when the draft it closed over is stale.
  const composing = useRef(false);
  const picked = picker.held.picked !== null;
  useEffect(() => {
    composing.current = draft !== "" || picked;
  }, [draft, picked]);
  // Sends taken back behind a failed one, in the order sent, each with the
  // picker as it was at its Send; and whether the failed one was dropped, so
  // those behind it are too. Refs: `send` reads them after its await.
  const waiting = useRef<{ body: string; held: typeof picker.held }[]>([]);
  const dropping = useRef(false);
  const giveBack = (unsent: { body: string; held: typeof picker.held }) => {
    // At once, not on the next render: a send taken back behind this one
    // resolves before then, and must find the composer taken.
    composing.current = true;
    setDraft(unsent.body);
    picker.restore(unsent.held);
  };
  const scrollport = useRef<HTMLDivElement>(null);
  usePinToBottom(scrollport, [chat.messages.length]);
  // Who is reading decides what each line offers (D6). Neither is a request of
  // its own: the `(app)` layout's session, and the trip's own access read.
  const me = useKnownSessionUser()?.id ?? null;
  const isOwner = (reader ?? trip)?.myRole === "owner";
  const viewerOf = (authorId: string): MessageViewer | null =>
    me === null
      ? null
      : { mine: authorId === me, mayEdit: authorId === me && chat.canPost, mayDelete: authorId === me || isOwner };
  const personaOf = (userId: string | null) => (personas === null ? null : userId === null ? undefined : personas[userId]);

  if (chat.status === "no-access") {
    return (
      <div role="status" className="flex flex-col items-start gap-2 px-4 py-3.5">
        <p className="text-sm text-ink">{NO_ACCESS_LINE}</p>
        <Link href={HOME_PATH} className={buttonVariants({ variant: "secondary", size: touch ? "touch" : "sm" })}>
          Back to your trips
        </Link>
      </div>
    );
  }

  // The line shows at once (`useTripChat`), so the composer empties at once.
  // A send that was not stored gives its text back, with its @ link (any kind),
  // unless the reader has started another message by then: that one is not
  // overwritten, and the failed text is dropped, with the hook's "Couldn't
  // send" alert still up to say so.
  //
  // Sends queued behind the failed one come back too, one at a time, each with
  // its own link (KI-2026-10-14-b): the composer holds one draft and one
  // link, so the next waits until the one before it is stored, and comes back
  // then if the composer is empty. They are dropped with the failed one when
  // it was. A send that never answers holds every later one at "Sending…"
  // (KI-2026-10-14-a).
  const send = async () => {
    const body = draft.trim();
    if (body === "") return;
    const link = picker.linkFor(body);
    const asks = picker.asks(body);
    const held = picker.held;
    setDraft("");
    picker.clear();
    const unsent = await (asks ? chat.post(body, link, true) : chat.post(body, link));
    if (unsent === null) {
      const next = waiting.current[0];
      if (next === undefined || composing.current) return;
      waiting.current = waiting.current.slice(1);
      giveBack(next);
    } else if (unsent.behind) {
      if (!dropping.current) waiting.current = [...waiting.current, { body: unsent.body, held }];
    } else {
      dropping.current = composing.current;
      if (!dropping.current) giveBack({ body: unsent.body, held });
    }
  };

  return (
    <ChatMentionsProvider value={mentions}>
      <div ref={scrollport} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-4 py-3.5">
        {/* Nothing until the first read answers (KI-2026-09-20-e): the
            conversation arrives whole, and is usually here before it opens. */}
        {chat.status === "loading" ? null : chat.status === "failed" ? (
          <p role="alert" className="text-sm text-danger">
            The chat couldn&apos;t be loaded. It will try again when someone posts.
          </p>
        ) : chat.messages.length === 0 ? (
          <p className="text-sm leading-relaxed text-slate">No messages yet. Say hello to the people on this trip.</p>
        ) : (
          <>
            {chat.hasEarlier && <p className="text-xs text-slate">Earlier messages aren&apos;t shown.</p>}
            <ol aria-label="Messages" className="flex flex-col gap-3">
              {chat.messages.map((message) => (
                <ChatMessage
                  key={message.messageId}
                  ref={(line) => {
                    if (line !== null) lines.current.set(message.messageId, line);
                    return () => void lines.current.delete(message.messageId);
                  }}
                  message={message}
                  persona={personaOf(message.authorId)}
                  askedBy={personaOf(message.requestedBy)}
                  reader={reader}
                  tripId={chat.tripId}
                  // A pending line's id is this page's own: nothing on it
                  // would reach a stored message.
                  viewer={message.pending ? null : viewerOf(message.authorId)}
                  pending={message.pending}
                  // Closed by a lapse mid-edit as well: the save would be refused.
                  editing={editing === message.messageId && chat.canPost}
                  onEdit={() => setEditing(message.messageId)}
                  onDelete={() => {
                    deletingFrom.current = message.messageId;
                    setDeleting(message.messageId);
                  }}
                  onSave={async (body) => {
                    const saved = await chat.edit(message.messageId, body);
                    if (saved) {
                      focusLine(message.messageId);
                      setEditing(null);
                    }
                    return saved;
                  }}
                  onCancelEdit={() => {
                    focusLine(message.messageId);
                    setEditing(null);
                  }}
                />
              ))}
            </ol>
          </>
        )}
        {/* Mounted empty, out of the flow until it speaks: a live region that
            arrives holding its words is often not read out. */}
        <p role="status" className={cn("text-xs text-slate", !thinking && "sr-only")}>
          {thinking ? THINKING_LINE : null}
        </p>
      </div>
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this message?"
        // Opened from a menu, so there is no trigger to go back to.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusLine(deletingFrom.current);
        }}
      >
        <Text variant="secondary">Everyone on the trip will see “message removed” in its place.</Text>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (deleting !== null) void chat.remove(deleting);
              setDeleting(null);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
      {chat.status === "ready" && (
        <div className="shrink-0 border-t border-hairline px-4 py-3">
          {chat.changeError !== null && (
            <p role="alert" className="mb-1.5 text-xs text-danger">
              {chat.changeError}
            </p>
          )}
          {!chat.canPost ? (
            <p role="status" className="text-xs text-slate">
              {READ_ONLY_LINE}
            </p>
          ) : (
            <>
              {picker.offer}
              {chat.postError !== null && (
                <p role="alert" className="mb-1.5 text-xs text-danger">
                  {chat.postError}
                </p>
              )}
              <form
                className="relative flex gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                {picker.list}
                <Input
                  {...picker.inputProps}
                  aria-label="Message"
                  placeholder="Message the people on this trip…"
                  className={cn(touch && "h-11")}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button type="submit" variant="primary" size={touch ? "touch" : "md"} disabled={draft.trim() === ""}>
                  Send
                </Button>
              </form>
            </>
          )}
        </div>
      )}
    </ChatMentionsProvider>
  );
}

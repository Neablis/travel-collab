"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useKnownSessionUser } from "@/components/account/useSessionUser";
import type { Persona } from "@/components/pages/people";
import { usePinToBottom } from "@/components/assistant/usePinToBottom";
import { useOptionalTrip } from "@/components/trip/context/TripProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { ChatMessage, type MessageViewer } from "./ChatMessage";
import { useTargetPicker } from "./TargetPicker";
import type { TripChat } from "./useTripChat";

/** The read-only line after the owner's lapse (M46 D2): why, not just that. */
export const READ_ONLY_LINE = "This chat is read-only: the trip owner's plan no longer includes collaborators.";
export const NO_ACCESS_LINE = "You no longer have access to this trip";

/**
 * The Chat tab's body: the conversation, pinned to its newest line, and the
 * composer under it (M46, the layout). The conversation itself is the
 * caller's (`useTripChat`), so it outlives this panel being closed.
 *
 * `touch` is the sheet's: its controls take SPEC §13.1's 44px floor, as the
 * Ask tab's do.
 */
export function ChatPanel({
  chat,
  personas,
  touch = false,
}: {
  chat: TripChat;
  personas: Readonly<Record<string, Persona>> | null;
  touch?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Save, Cancel and a confirmed Delete each unmount the control focus was on
  // (the edit form, the `⋯` trigger); the line keeps focus instead of <body>.
  const lines = useRef(new Map<string, HTMLLIElement>());
  const focusLine = (messageId: string | null) => (messageId === null ? undefined : lines.current.get(messageId)?.focus());
  const deletingFrom = useRef<string | null>(null);
  const picker = useTargetPicker(draft, setDraft);
  const scrollport = useRef<HTMLDivElement>(null);
  usePinToBottom(scrollport, [chat.messages.length]);
  // Who is reading decides what each line offers (D6). Neither is a request of
  // its own: the `(app)` layout's session, and the trip's own access read.
  const me = useKnownSessionUser()?.id ?? null;
  const isOwner = useOptionalTrip()?.myRole === "owner";
  const viewerOf = (authorId: string): MessageViewer | null =>
    me === null
      ? null
      : { mine: authorId === me, mayEdit: authorId === me && chat.canPost, mayDelete: authorId === me || isOwner };

  if (chat.status === "no-access") {
    return (
      <div role="status" className="flex flex-col items-start gap-2 px-4 py-3.5">
        <p className="text-sm text-ink">{NO_ACCESS_LINE}</p>
        <Link href="/" className={buttonVariants({ variant: "secondary", size: touch ? "touch" : "sm" })}>
          Back to your trips
        </Link>
      </div>
    );
  }

  const send = async () => {
    const body = draft.trim();
    if (body === "" || chat.posting) return;
    if (await chat.post(body, picker.linkFor(body))) {
      setDraft("");
      picker.clear();
    }
  };

  return (
    <>
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
                  persona={personas === null ? null : personas[message.authorId]}
                  tripId={chat.tripId}
                  viewer={viewerOf(message.authorId)}
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
                <Button type="submit" variant="primary" size={touch ? "touch" : "md"} disabled={chat.posting || draft.trim() === ""}>
                  {chat.posting ? "Sending…" : "Send"}
                </Button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}

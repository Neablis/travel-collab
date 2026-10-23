"use client";
import { useRef, useState, type Ref } from "react";
import type { ChatMessage as ChatMessageData } from "@tc/contracts";
import { useKnownSessionUser } from "@/components/account/useSessionUser";
import { SuggestionCard } from "@/components/assistant/ProposalCard";
import type { Persona } from "@/lib/persona";
import { ReportAction } from "@/components/report/ReportDialog";
import { useOptionalTrip } from "@/components/trip/context/TripProvider";
import { PersonMenu, type PersonAction } from "@/components/trip/people/PersonMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonChip } from "@/components/ui/person-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageBody } from "./MessageChip";

/** Who wrote a message that a member no longer on the trip wrote. */
export const FORMER_MEMBER = "Former member";
/** Who wrote an `@assistant`'s reply (M52 decision 18). */
export const ASSISTANT_NAME = "Assistant";

/**
 * What the reader may do to one message (M46 D6), decided by the panel from
 * who they are. The server refuses the rest; this only keeps a control that
 * would be refused off the line.
 */
export type MessageViewer = { mine: boolean; mayEdit: boolean; mayDelete: boolean };

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * One message, with its author's persona (M38) where everyone on the trip is
 * drawn. An author no longer on the trip keeps their words under a neutral
 * name: the conversation does not lose its lines when someone leaves.
 *
 * `persona` is `null` while the members are not known (or could not be
 * read): nobody is named then, because "Former member" before they arrive
 * says something false about the people still on the trip.
 *
 * `viewer` is `null` until the reader is known, and the line offers nothing
 * then. Edit and Delete sit in the `⋯` menu; Report is the library's own
 * control (`ReportAction`) drawn as a flag, on other people's messages only.
 *
 * The assistant's reply is drawn as a message under its own name, with the
 * card for any change it proposed; a change line is the app's, a quiet line
 * nobody acts on (M52 decisions 17 and 18).
 */
export function ChatMessage({
  ref,
  message,
  persona,
  tripId,
  viewer,
  editing,
  onEdit,
  onDelete,
  onSave,
  onCancelEdit,
  pending = false,
  askedBy,
}: {
  /** The line, which takes focus when the control the reader used is gone. */
  ref?: Ref<HTMLLIElement>;
  message: ChatMessageData;
  /**
   * Sent and not yet stored: "Sending…" where its time will be, and busy to a
   * screen reader, until it is or it goes. Said in words, not dimmed: a faded
   * line falls below AA contrast (PR 444 review).
   */
  pending?: boolean;
  persona: Persona | undefined | null;
  tripId: string;
  viewer: MessageViewer | null;
  editing: boolean;
  onEdit: () => void;
  /** Asks; the panel confirms before anything is deleted. */
  onDelete: () => void;
  /** Resolves false when the edit was not stored, so the field keeps the text. */
  onSave: (body: string) => Promise<boolean>;
  onCancelEdit: () => void;
  /**
   * On an assistant reply, the member who asked, for its card to say whose it
   * is to accept: null until the members are known, undefined once they have left.
   */
  askedBy?: Persona | null | undefined;
}) {
  if (message.kind === "system") return <ChangeLine ref={ref} message={message} name={persona === null ? null : (persona?.name ?? FORMER_MEMBER)} />;
  const name = message.kind === "assistant" ? ASSISTANT_NAME : persona === null ? null : (persona?.name ?? FORMER_MEMBER);
  const whose = `${name ?? "this"}${name === null ? "" : "'s"} message`;
  const live = viewer !== null && !message.removed;
  const actions: PersonAction[] = [];
  if (live && viewer.mayEdit) actions.push({ label: "Edit", onSelect: onEdit });
  if (live && viewer.mayDelete) actions.push({ label: "Delete", onSelect: onDelete, destructive: true });

  return (
    // `tabIndex={-1}`: focusable by the panel, not a Tab stop.
    <li
      ref={ref}
      tabIndex={-1}
      aria-busy={pending || undefined}
      className="group flex gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-brand"
    >
      {name === null ? (
        <Skeleton circle className="mt-0.5 size-7 shrink-0" />
      ) : (
        <PersonChip name={name} avatar={persona?.avatar ?? null} color={persona?.color ?? null} size="sm" className="mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5 text-xs">
          {name !== null && <span className="font-semibold text-ink">{name}</span>}
          {pending ? (
            <span className="text-slate">Sending…</span>
          ) : (
            <time dateTime={message.createdAt} className="text-slate">
              {time(message.createdAt)}
            </time>
          )}
          {!message.removed && message.editedAt !== null && <span className="text-slate">edited</span>}
        </p>
        {message.removed ? (
          <p className="text-sm italic text-slate">message removed</p>
        ) : editing ? (
          <EditForm initial={message.body} onSave={onSave} onCancel={onCancelEdit} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-ink">
            <MessageBody body={message.body} link={message.link} />
          </p>
        )}
        {!message.removed && message.suggestionId !== null && message.requestedBy !== null && (
          <ChatSuggestion
            suggestionId={message.suggestionId}
            requestedBy={message.requestedBy}
            askedBy={askedBy}
          />
        )}
      </div>
      {/* Quiet until the line is pointed at or focused, where a mouse can do
          that; always there on touch, which cannot hover. A Report dialog open
          here closes if the message is removed under it, deliberately: the
          server would refuse that report as not found, and the line now says
          "message removed", which is the explanation. */}
      {live && !editing && (
        <div className="flex shrink-0 items-start fine:opacity-0 fine:group-focus-within:opacity-100 fine:group-hover:opacity-100">
          {!viewer.mine && <ReportAction target={{ kind: "trip_message", tripId, messageId: message.messageId }} name={whose} flag />}
          <PersonMenu label={whose} actions={actions} />
        </div>
      )}
    </li>
  );
}

/**
 * A change line (M52 decision 17): who changed what, linked to the stop, and
 * when. The line stores only what was done; its actor is named here, as their
 * messages are, and not at all until the members are known.
 */
function ChangeLine({ ref, message, name }: { ref?: Ref<HTMLLIElement> | undefined; message: ChatMessageData; name: string | null }) {
  return (
    <li ref={ref} tabIndex={-1} className="rounded-md px-2 text-center text-xs text-slate focus-visible:outline-2 focus-visible:outline-brand">
      {message.removed ? (
        <span className="italic">message removed</span>
      ) : (
        <>
          {name !== null && `${name} `}
          <MessageBody body={message.body} link={message.link} />
        </>
      )}
      {" · "}
      <time dateTime={message.createdAt}>{time(message.createdAt)}</time>
    </li>
  );
}

/** A member who left can accept nothing; the owner's dismiss still holds. */
const ASKER_LEFT = "Asked by a member who has left: only the owner can dismiss this";

/**
 * The card for what an `@assistant` proposed, while any of it is pending on
 * the board's list (`useTripSuggestions`): the asker, if they may review,
 * accepts it whole or dismisses it; anyone else reads who it waits on, and the
 * owner may dismiss it (ADR-067's 2026-10-23 amendment). The server refuses
 * the rest; this only keeps a control that would be refused off it.
 *
 * A reader who is not served the whole list (a viewer, a suggester) cannot
 * tell pending from decided, so they are told only whose it is to accept,
 * from the reply itself: words that stay true once the asker has decided,
 * where "Waiting on" would not.
 */
function ChatSuggestion({ suggestionId, requestedBy, askedBy }: { suggestionId: string; requestedBy: string; askedBy: Persona | null | undefined }) {
  const trip = useOptionalTrip();
  const me = useKnownSessionUser()?.id ?? null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const suggestions = trip?.suggestions ?? null;
  const changes = suggestions?.changes.filter((change) => change.suggestionId === suggestionId) ?? [];
  if (suggestions === null || changes.length === 0) {
    // A reviewer's list is whole, so an empty one means it was decided.
    if (trip?.boardMode === "write") return null;
    if (askedBy === undefined) return <p className="mt-1 text-xs text-slate">{ASKER_LEFT}</p>;
    return <p className="mt-1 text-xs text-slate">Only {askedBy?.name ?? "the member who asked"} can accept this</p>;
  }

  const decide = async (run: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    // Taken before the card can go: a decision that lands takes it, and the
    // focused button with it, so the line keeps focus instead of <body>.
    const line = card.current?.closest("li");
    setBusy(true);
    const result = await run();
    setBusy(false);
    setNote(result.ok ? null : (result.error?.message ?? null));
    if (result.ok) line?.focus();
  };
  const ids = changes.map((change) => change.id);
  // Dismissing a change takes everything built on it along, so only the ones
  // built on nothing else here are sent.
  const roots = changes.filter((change) => !change.dependsOn.some((id) => ids.includes(id)));
  const dismiss = async () => {
    for (const root of roots) {
      const result = await suggestions.resolve(root.id, "dismiss");
      if (!result.ok) return result;
    }
    return { ok: true };
  };

  return (
    <div ref={card} className="mt-1.5">
      <SuggestionCard
        descriptions={changes.map((change) => change.description)}
        may={me !== null && me === requestedBy && trip?.boardMode === "write" ? "decide" : trip?.myRole === "owner" ? "dismiss" : "wait"}
        // Nobody waits on a member who left: the card says what the viewer is told.
        lead={askedBy === undefined ? ASKER_LEFT : `Waiting on ${askedBy?.name ?? "the member who asked"}`}
        busy={busy}
        note={note}
        onAccept={() => void decide(() => suggestions.acceptMany(ids))}
        onDismiss={() => void decide(dismiss)}
      />
    </div>
  );
}

function EditForm({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<boolean>; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const unchanged = draft.trim() === "" || draft.trim() === initial;
  return (
    <form
      className="mt-1 flex gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (unchanged || saving) return;
        setSaving(true);
        void onSave(draft.trim()).finally(() => setSaving(false));
      }}
    >
      <Input aria-label="Edit message" value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
      <Button type="submit" variant="primary" size="sm" disabled={unchanged || saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

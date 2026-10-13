"use client";
import { useState } from "react";
import type { ChatMessage as ChatMessageData } from "@tc/contracts";
import type { Persona } from "@/components/pages/people";
import { ReportAction } from "@/components/playbooks/ReportDialog";
import { PersonMenu, type PersonAction } from "@/components/trip/people/PersonMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonChip } from "@/components/ui/person-chip";
import { Skeleton } from "@/components/ui/skeleton";

/** Who wrote a message that a member no longer on the trip wrote. */
export const FORMER_MEMBER = "Former member";

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
 * control (`ReportAction`), on other people's messages only.
 */
export function ChatMessage({
  message,
  persona,
  tripId,
  viewer,
  editing,
  onEdit,
  onDelete,
  onSave,
  onCancelEdit,
}: {
  message: ChatMessageData;
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
}) {
  const name = persona === null ? null : (persona?.name ?? FORMER_MEMBER);
  const whose = `${name ?? "this"}${name === null ? "" : "'s"} message`;
  const live = viewer !== null && !message.removed;
  const actions: PersonAction[] = [];
  if (live && viewer.mayEdit) actions.push({ label: "Edit", onSelect: onEdit });
  if (live && viewer.mayDelete) actions.push({ label: "Delete", onSelect: onDelete, destructive: true });

  return (
    <li className="group flex gap-2">
      {name === null ? (
        <Skeleton circle className="mt-0.5 size-7 shrink-0" />
      ) : (
        <PersonChip name={name} avatar={persona?.avatar ?? null} color={persona?.color ?? null} size="sm" className="mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5 text-xs">
          {name !== null && <span className="font-semibold text-ink">{name}</span>}
          <time dateTime={message.createdAt} className="text-slate">
            {time(message.createdAt)}
          </time>
          {!message.removed && message.editedAt !== null && <span className="text-slate">edited</span>}
        </p>
        {message.removed ? (
          <p className="text-sm italic text-slate">message removed</p>
        ) : editing ? (
          <EditForm initial={message.body} onSave={onSave} onCancel={onCancelEdit} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{message.body}</p>
        )}
      </div>
      {/* Quiet until the line is pointed at or focused, where a mouse can do
          that; always there on touch, which cannot hover. */}
      {live && !editing && (
        <div className="flex shrink-0 items-start fine:opacity-0 fine:group-focus-within:opacity-100 fine:group-hover:opacity-100">
          {!viewer.mine && <ReportAction target={{ kind: "trip_message", tripId, messageId: message.messageId }} name={whose} />}
          <PersonMenu label={whose} actions={actions} />
        </div>
      )}
    </li>
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

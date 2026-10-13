"use client";
import type { ChatMessage as ChatMessageData } from "@tc/contracts";
import type { Persona } from "@/components/pages/people";
import { PersonChip } from "@/components/ui/person-chip";

/** Who wrote a message that a member no longer on the trip wrote. */
export const FORMER_MEMBER = "Former member";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * One message, with its author's persona (M38) where everyone on the trip is
 * drawn. An author no longer on the trip keeps their words under a neutral
 * name: the conversation does not lose its lines when someone leaves.
 */
export function ChatMessage({ message, persona }: { message: ChatMessageData; persona: Persona | undefined }) {
  const name = persona?.name ?? FORMER_MEMBER;
  return (
    <li className="flex gap-2">
      <PersonChip name={name} avatar={persona?.avatar ?? null} color={persona?.color ?? null} size="sm" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5 text-xs">
          <span className="font-semibold text-ink">{name}</span>
          <time dateTime={message.createdAt} className="text-slate">
            {time(message.createdAt)}
          </time>
        </p>
        {message.removed ? (
          <p className="text-sm italic text-slate">message removed</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{message.body}</p>
        )}
      </div>
    </li>
  );
}

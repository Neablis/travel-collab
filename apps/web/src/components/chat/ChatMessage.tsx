"use client";
import type { ChatMessage as ChatMessageData } from "@tc/contracts";
import type { Persona } from "@/components/pages/people";
import { PersonChip } from "@/components/ui/person-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageBody } from "./MessageChip";

/** Who wrote a message that a member no longer on the trip wrote. */
export const FORMER_MEMBER = "Former member";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * One message, with its author's persona (M38) where everyone on the trip is
 * drawn. An author no longer on the trip keeps their words under a neutral
 * name: the conversation does not lose its lines when someone leaves.
 *
 * `persona` is `null` while the members are not known (or could not be
 * read): nobody is named then, because "Former member" before they arrive
 * says something false about the people still on the trip.
 */
export function ChatMessage({ message, persona }: { message: ChatMessageData; persona: Persona | undefined | null }) {
  const name = persona === null ? null : (persona?.name ?? FORMER_MEMBER);
  return (
    <li className="flex gap-2">
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
        </p>
        {message.removed ? (
          <p className="text-sm italic text-slate">message removed</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-ink">
            <MessageBody body={message.body} link={message.link} />
          </p>
        )}
      </div>
    </li>
  );
}

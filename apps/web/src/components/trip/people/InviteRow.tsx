import { Link2, Mail } from "lucide-react";
import type { TripInvite } from "@tc/contracts";
import { Avatar } from "@/components/ui/avatar";
import { Text } from "@/components/ui/text";
import { formatRelativeInstant } from "@/lib/formatDate";
import { roleLabel } from "@/lib/tripRole";

/** What a pending invite's row is called: the address it went to, or "Link invite". */
export function inviteName(invite: TripInvite): string {
  return invite.email ?? "Link invite";
}

/**
 * "Can edit · will travel · sent 2 days ago". An invite that will not travel
 * says nothing about it rather than "won't travel": the role already reads as
 * the reason, and the Not travelling group is where that shows once they join.
 */
function sublineParts(invite: TripInvite): string[] {
  const sent = formatRelativeInstant(invite.createdAt);
  return [roleLabel(invite.role), invite.travelling ? "will travel" : null, sent === null ? null : `sent ${sent}`].filter(
    (part) => part !== null,
  );
}

/**
 * What the row's `⋯` is named for. An address tells two invites apart; a link
 * invite has none, so two of them were both "Link invite" to a screen reader.
 * It says what the row says under the name instead.
 */
export function inviteMenuLabel(invite: TripInvite): string {
  return invite.email ?? [inviteName(invite), ...sublineParts(invite)].join(", ");
}

/**
 * One pending invite: an envelope (or a link, for an invite with no address),
 * who it is for, a plain-words subline, and the row's `⋯`. `copied` marks the
 * row whose link was just put on the clipboard.
 */
export function InviteRow({ invite, copied, menu }: { invite: TripInvite; copied: boolean; menu: React.ReactNode }) {
  const name = inviteName(invite);
  const Icon = invite.email === null ? Link2 : Mail;
  return (
    <li data-testid="invite-row" data-invite-id={invite.inviteId} className="flex min-h-11 items-center gap-2.5 py-1">
      <Avatar name={name} icon={<Icon className="size-3.5 text-slate" />} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Text as="span" className="truncate text-sm text-ink">
          {name}
        </Text>
        <Text as="span" variant="muted">
          {sublineParts(invite).join(" · ")}
        </Text>
      </div>
      {copied ? (
        <Text as="span" className="shrink-0 text-xs text-success-ink">
          Copied
        </Text>
      ) : null}
      {menu}
    </li>
  );
}
